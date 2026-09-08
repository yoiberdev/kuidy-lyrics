//! Letras desde lrclib.net: gratis, sin cuenta, con letras sincronizadas.
//!
//! <https://lrclib.net/docs>
//!
//! Dos endpoints y un orden: primero `/api/get`, que exige que titulo,
//! artista, album y duracion cuadren exactamente y por eso acierta de lleno
//! cuando acierta; si no hay o viene sin tiempos, `/api/search`, que trae
//! candidatos entre los que hay que elegir.
//!
//! Nada de esto puede correr en el hilo de la interfaz: son peticiones de
//! red. Se llama desde `chaika::task::spawn`, y por eso todo aqui es
//! bloqueante y sin estado.

use std::time::Duration;

use serde::Deserialize;

use crate::lrc;
use crate::lyrics::{Line, Lyrics};

/// Por que no hay letra. Se distingue "no existe" de "no se pudo mirar"
/// porque al usuario se le cuentan cosas distintas: una es definitiva y la
/// otra invita a reintentar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// lrclib contesto que no la tiene. No es un fallo.
    NotFound,
    /// Es instrumental: no hay letra que buscar.
    Instrumental,
    /// No se pudo llegar o contesto mal.
    Service(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NotFound => f.write_str("sin letra para esta cancion"),
            Error::Instrumental => f.write_str("instrumental"),
            Error::Service(why) => write!(f, "lrclib: {why}"),
        }
    }
}

/// Lo que hace falta para buscar una letra.
#[derive(Clone, Debug)]
pub struct Query {
    pub track: String,
    pub artist: String,
    pub album: String,
    pub duration: Duration,
}

/// Un registro de lrclib.
#[derive(Debug, Deserialize)]
struct Record {
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default, rename = "syncedLyrics")]
    synced: Option<String>,
    #[serde(default, rename = "plainLyrics")]
    plain: Option<String>,
}

impl Record {
    fn has_synced(&self) -> bool {
        self.synced.as_ref().is_some_and(|s| !s.trim().is_empty())
    }
}

/// lrclib pide identificarse, y con razon: es un servicio gratuito que
/// aguanta a mucha gente.
fn user_agent() -> String {
    format!(
        "Kuidy Lyrics/{} (https://github.com/yoiberdev/kuidy-lyrics)",
        env!("CARGO_PKG_VERSION")
    )
}

/// Busca la letra de una cancion. Bloquea: va en otro hilo.
pub fn fetch(query: &Query) -> Result<Lyrics, Error> {
    // El camino bueno: coincidencia exacta.
    let exact = get(query)?;
    if let Some(record) = &exact {
        if record.instrumental {
            return Err(Error::Instrumental);
        }
        if record.has_synced() {
            return to_lyrics(record);
        }
    }

    // Sin tiempos o sin registro, mirar entre los candidatos: puede haber
    // uno sincronizado del mismo tema con otro album o otra duracion.
    let candidates = search(query)?;
    let best = pick_best(candidates, query.duration);
    match best {
        // Solo se cambia el exacto por el de la busqueda si aporta tiempos,
        // o si no habia exacto.
        Some(record) if record.has_synced() || exact.is_none() => {
            if record.instrumental {
                return Err(Error::Instrumental);
            }
            to_lyrics(&record)
        }
        _ => match &exact {
            Some(record) => to_lyrics(record),
            None => Err(Error::NotFound),
        },
    }
}

fn to_lyrics(record: &Record) -> Result<Lyrics, Error> {
    if record.instrumental {
        return Err(Error::Instrumental);
    }
    if let Some(synced) = record.synced.as_deref().and_then(lrc::lyrics) {
        return Ok(synced);
    }
    let plain = record.plain.as_deref().unwrap_or("").trim();
    if plain.is_empty() {
        return Err(Error::NotFound);
    }
    // Sin tiempos no se sigue, se lee: todas las lineas en el instante cero.
    Ok(Lyrics {
        lines: plain
            .lines()
            .map(|l| Line { at: Duration::ZERO, text: l.trim().to_string(), translation: None })
            .collect(),
        synced: false,
    })
}

/// El mejor candidato: sincronizado primero — los registros basura de lrclib
/// (paginas raspadas, anotaciones) casi siempre son solo texto plano — y a
/// igualdad, el mas cercano en duracion a la pista real.
fn pick_best(mut candidates: Vec<Record>, duration: Duration) -> Option<Record> {
    let target = duration.as_secs_f64();
    candidates.sort_by(|a, b| {
        let synced = b.has_synced().cmp(&a.has_synced());
        let closeness = distance(a, target).total_cmp(&distance(b, target));
        synced.then(closeness)
    });
    candidates.into_iter().next()
}

fn distance(record: &Record, target: f64) -> f64 {
    match record.duration {
        Some(d) if target > 0.0 => (d - target).abs(),
        _ => f64::MAX,
    }
}

fn get(query: &Query) -> Result<Option<Record>, Error> {
    let url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}&album_name={}&duration={}",
        encode(&query.track),
        encode(&query.artist),
        encode(&query.album),
        query.duration.as_secs()
    );
    request(&url)
}

fn search(query: &Query) -> Result<Vec<Record>, Error> {
    let url = format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        encode(&query.track),
        encode(&query.artist)
    );
    Ok(request::<Vec<Record>>(&url)?.unwrap_or_default())
}

/// Una peticion a lrclib. `Ok(None)` es un 404, que es una respuesta
/// legitima — "no la tengo" — y no un fallo del servicio.
fn request<T: for<'de> Deserialize<'de>>(url: &str) -> Result<Option<T>, Error> {
    let response = ureq::get(url)
        .header("User-Agent", &user_agent())
        .call();
    match response {
        Ok(mut r) => r
            .body_mut()
            .read_json::<T>()
            .map(Some)
            .map_err(|e| Error::Service(format!("respuesta ilegible: {e}"))),
        Err(ureq::Error::StatusCode(404)) => Ok(None),
        Err(ureq::Error::StatusCode(429)) => Err(Error::Service("demasiadas peticiones".into())),
        Err(ureq::Error::StatusCode(code)) => Err(Error::Service(format!("respondio {code}"))),
        Err(e) => Err(Error::Service(format!("inalcanzable ({e})"))),
    }
}

/// Lo justo para meter texto en una URL: ni titulos ni artistas traen cosas
/// mas raras que espacios, `&` y acentos.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(synced: Option<&str>, plain: Option<&str>, duration: Option<f64>) -> Record {
        Record {
            instrumental: false,
            duration,
            synced: synced.map(str::to_string),
            plain: plain.map(str::to_string),
        }
    }

    #[test]
    fn gana_la_sincronizada_aunque_la_duracion_cuadre_peor() {
        let candidates = vec![
            record(None, Some("texto plano"), Some(200.0)),
            record(Some("[00:01.00] con tiempos"), None, Some(260.0)),
        ];
        let best = pick_best(candidates, Duration::from_secs(200)).unwrap();
        assert!(best.has_synced(), "la basura de lrclib casi siempre es texto plano");
    }

    #[test]
    fn a_igualdad_gana_la_duracion_mas_cercana() {
        let candidates = vec![
            record(Some("[00:01.00] lejos"), None, Some(400.0)),
            record(Some("[00:01.00] cerca"), None, Some(203.0)),
        ];
        let best = pick_best(candidates, Duration::from_secs(200)).unwrap();
        assert_eq!(best.duration, Some(203.0));
    }

    #[test]
    fn un_registro_sin_duracion_no_gana_por_descarte() {
        let candidates = vec![
            record(Some("[00:01.00] sin duracion"), None, None),
            record(Some("[00:01.00] con duracion"), None, Some(201.0)),
        ];
        let best = pick_best(candidates, Duration::from_secs(200)).unwrap();
        assert_eq!(best.duration, Some(201.0));
    }

    #[test]
    fn el_texto_plano_se_lee_pero_no_se_sigue() {
        let letra = to_lyrics(&record(None, Some("una\ndos"), None)).unwrap();
        assert!(!letra.synced);
        assert_eq!(letra.lines.len(), 2);
        assert_eq!(letra.line_at(Duration::from_secs(30)), None, "sin tiempos no se sigue");
    }

    #[test]
    fn un_registro_vacio_es_no_encontrada() {
        assert_eq!(to_lyrics(&record(None, Some("   "), None)), Err(Error::NotFound));
        assert_eq!(to_lyrics(&record(None, None, None)), Err(Error::NotFound));
    }

    #[test]
    fn lo_instrumental_se_dice_asi_y_no_como_error() {
        let mut r = record(None, None, None);
        r.instrumental = true;
        assert_eq!(to_lyrics(&r), Err(Error::Instrumental));
    }

    #[test]
    fn la_url_aguanta_titulos_con_espacios_y_acentos() {
        assert_eq!(encode("Cafe con leche"), "Cafe%20con%20leche");
        assert_eq!(encode("Mañana"), "Ma%C3%B1ana");
        assert_eq!(encode("a&b=c"), "a%26b%3Dc");
    }
}

/// Una prueba contra lrclib de verdad. No corre en `cargo test` normal
/// porque depende de la red y del catalogo de un tercero; se pide a mano:
///
/// ```sh
/// cargo test --features red -- --ignored --nocapture
/// ```
#[cfg(test)]
mod red {
    use super::*;

    #[test]
    #[ignore = "necesita internet"]
    fn trae_una_letra_de_verdad() {
        let query = Query {
            track: "Bohemian Rhapsody".into(),
            artist: "Queen".into(),
            album: "A Night at the Opera".into(),
            duration: Duration::from_secs(354),
        };
        match fetch(&query) {
            Ok(letra) => {
                println!("sincronizada: {}, lineas: {}", letra.synced, letra.lines.len());
                for line in letra.lines.iter().take(4) {
                    println!("  [{:>6}ms] {}", line.at.as_millis(), line.shown());
                }
                assert!(!letra.lines.is_empty());
            }
            Err(e) => panic!("no vino letra: {e}"),
        }
    }
}
