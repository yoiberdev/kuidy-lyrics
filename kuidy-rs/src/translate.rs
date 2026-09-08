//! Traducir las lineas de la letra.
//!
//! Habla con el endpoint que usa translate.google.com por dentro. **No es
//! una API oficial**: no tiene contrato, no esta documentado y Google puede
//! cambiarlo o cerrarlo cuando quiera. Se usa porque no pide clave y porque
//! es lo mismo que ya hacia el kuidy de Electron, no porque sea buena idea a
//! largo plazo.
//!
//! Por eso todo lo de fuera pasa por [`translate_lines`] y nada mas: el dia
//! que esto se rompa o se cambie por DeepL, se reescribe este archivo y la
//! app no se entera.
//!
//! Y por eso hay cache: cada peticion cuenta contra un limite por IP que
//! nadie publica, y volver a una cancion ya escuchada no deberia costar ni
//! una.

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Duration;

/// Cuantos caracteres caben en una peticion. El endpoint acepta mas, pero
/// pasarse es la forma mas rapida de que te empiece a contestar 429.
const MAX_CHARS: usize = 1800;

/// Lo que puede salir mal. Sin detalle para el usuario: da igual por que no
/// hay traduccion, lo unico que cambia es si vale la pena reintentar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// No se pudo llegar o contesto mal.
    Service(String),
    /// Pide esperar.
    RateLimited,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Service(why) => write!(f, "traductor: {why}"),
            Error::RateLimited => f.write_str("traductor: pide esperar"),
        }
    }
}

thread_local! {
    /// Lo ya traducido, por idioma y texto. Se queda en memoria mientras la
    /// app viva; una letra entera son unos pocos kilobytes.
    static CACHE: RefCell<HashMap<(String, String), String>> = RefCell::new(HashMap::new());
}

/// El idioma al que traducir, deducido del sistema.
///
/// Windows deja el idioma en varias variables segun como se arranque; si no
/// hay ninguna, espanol, que es el idioma de casa de esta app.
pub fn target_language() -> String {
    let raw = std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .or_else(|_| std::env::var("LANGUAGE"))
        .unwrap_or_default();
    // "es_ES.UTF-8" -> "es"
    let code = raw.split(['_', '-', '.']).next().unwrap_or("").trim().to_lowercase();
    if code.len() == 2 { code } else { "es".to_string() }
}

/// Traduce varias lineas de una vez.
///
/// Se mandan juntas y no una por una: son decenas de lineas cortas, y una
/// peticion por linea seria pedir que te bloqueen. El endpoint conserva los
/// saltos, asi que se parte por ellos a la vuelta; si aun asi no cuadra el
/// numero de lineas, se prefiere no traducir a emparejar mal — una letra con
/// las traducciones corridas una linea es peor que una sin traducir.
///
/// Bloquea: va en otro hilo.
pub fn translate_lines(lines: &[String], target: &str) -> Result<Vec<String>, Error> {
    if lines.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = vec![String::new(); lines.len()];
    // Las que ya se tradujeron alguna vez no vuelven a pedirse.
    let mut pending: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match cached(target, line) {
            Some(hit) => out[i] = hit,
            None => pending.push(i),
        }
    }
    if pending.is_empty() {
        return Ok(out);
    }

    for group in groups(lines, &pending) {
        let joined = group.iter().map(|&i| lines[i].as_str()).collect::<Vec<_>>().join("\n");
        let translated = request(&joined, target)?;
        let parts: Vec<&str> = translated.split('\n').collect();
        if parts.len() != group.len() {
            log::warn!(
                "traduccion descuadrada: {} lineas por {}; se deja sin traducir",
                parts.len(),
                group.len()
            );
            continue;
        }
        for (&i, part) in group.iter().zip(parts) {
            let text = part.trim().to_string();
            remember(target, &lines[i], &text);
            out[i] = text;
        }
    }
    Ok(out)
}

/// Reparte las lineas pendientes en grupos que quepan en una peticion.
fn groups(lines: &[String], pending: &[usize]) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut size = 0;
    for &i in pending {
        let len = lines[i].len() + 1;
        if size + len > MAX_CHARS && !current.is_empty() {
            out.push(std::mem::take(&mut current));
            size = 0;
        }
        current.push(i);
        size += len;
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn cached(target: &str, text: &str) -> Option<String> {
    CACHE.with(|c| c.borrow().get(&(target.to_string(), text.to_string())).cloned())
}

fn remember(target: &str, text: &str, translation: &str) {
    CACHE.with(|c| {
        c.borrow_mut().insert((target.to_string(), text.to_string()), translation.to_string());
    });
}

/// Una peticion al endpoint.
fn request(text: &str, target: &str) -> Result<String, Error> {
    let url = format!(
        "https://translate.googleapis.com/translate_a/single\
         ?client=gtx&sl=auto&tl={target}&dt=t&q={}",
        encode(text)
    );
    let response = ureq::get(&url)
        .config()
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .call();
    let body = match response {
        Ok(mut r) => r
            .body_mut()
            .read_to_string()
            .map_err(|e| Error::Service(format!("respuesta ilegible: {e}")))?,
        Err(ureq::Error::StatusCode(429)) => return Err(Error::RateLimited),
        Err(ureq::Error::StatusCode(code)) => {
            return Err(Error::Service(format!("respondio {code}")));
        }
        Err(e) => return Err(Error::Service(e.to_string())),
    };
    parse(&body)
}

/// La respuesta es un array anidado sin nombres, del estilo:
///
/// ```text
/// [[["hola","hello",null,null,10],["mundo","world",null,null,10]],null,"en"]
/// ```
///
/// Interesa el primer campo de cada tramo del primer array, concatenados.
fn parse(body: &str) -> Result<String, Error> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| Error::Service(format!("no es JSON: {e}")))?;
    let segments = value
        .get(0)
        .and_then(|v| v.as_array())
        .ok_or_else(|| Error::Service("sin tramos traducidos".into()))?;
    let mut out = String::new();
    for segment in segments {
        if let Some(text) = segment.get(0).and_then(|v| v.as_str()) {
            out.push_str(text);
        }
    }
    if out.is_empty() {
        return Err(Error::Service("vino vacia".into()));
    }
    Ok(out)
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_la_respuesta_anidada_de_google() {
        let body = r#"[[["hola ","hello ",null,null,10],["mundo","world",null,null,10]],null,"en"]"#;
        assert_eq!(parse(body).unwrap(), "hola mundo");
    }

    #[test]
    fn una_respuesta_rara_no_pasa_por_traduccion() {
        assert!(parse("no soy json").is_err());
        assert!(parse("[]").is_err(), "sin tramos");
        assert!(parse(r#"[[],null,"en"]"#).is_err(), "tramos vacios");
    }

    #[test]
    fn las_lineas_se_agrupan_para_que_quepan() {
        let largas: Vec<String> = (0..10).map(|_| "x".repeat(500)).collect();
        let pending: Vec<usize> = (0..10).collect();
        let grupos = groups(&largas, &pending);
        assert!(grupos.len() > 1, "5000 caracteres no caben en una peticion");
        for g in &grupos {
            let total: usize = g.iter().map(|&i| largas[i].len() + 1).sum();
            // Solo se permite pasarse con una linea que ya de sola no quepa.
            assert!(total <= MAX_CHARS || g.len() == 1);
        }
    }

    #[test]
    fn las_lineas_cortas_van_en_una_sola_peticion() {
        let lineas: Vec<String> = (0..30).map(|i| format!("linea {i}")).collect();
        let pending: Vec<usize> = (0..30).collect();
        assert_eq!(groups(&lineas, &pending).len(), 1);
    }

    #[test]
    fn lo_ya_traducido_no_se_vuelve_a_pedir() {
        remember("es", "hello", "hola");
        let lineas = vec!["hello".to_string()];
        // Sin red: si no estuviera cacheado, esto fallaria.
        assert_eq!(translate_lines(&lineas, "es").unwrap(), vec!["hola".to_string()]);
    }

    #[test]
    fn los_silencios_no_se_traducen() {
        let lineas = vec![String::new(), "  ".to_string()];
        assert_eq!(translate_lines(&lineas, "es").unwrap(), vec!["", ""]);
    }

    #[test]
    fn el_idioma_sale_del_sistema_o_es_espanol() {
        let lang = target_language();
        assert_eq!(lang.len(), 2, "un codigo de dos letras: {lang}");
    }
}

/// Una prueba contra Google de verdad. No corre en `cargo test` normal: usa
/// un endpoint no oficial que puede cambiar cualquier dia, y precisamente
/// por eso conviene poder lanzarla a mano cuando algo huela mal.
///
/// ```sh
/// cargo test -- --ignored --nocapture
/// ```
#[cfg(test)]
mod red {
    use super::*;

    #[test]
    #[ignore = "necesita internet y un endpoint no oficial"]
    fn traduce_de_verdad() {
        let lineas = vec![
            "Is this the real life?".to_string(),
            String::new(),
            "Caught in a landslide".to_string(),
        ];
        match translate_lines(&lineas, "es") {
            Ok(out) => {
                for (o, t) in lineas.iter().zip(&out) {
                    println!("  {o:32} -> {t}");
                }
                assert_eq!(out.len(), 3);
                assert!(!out[0].is_empty(), "la primera deberia traducirse");
                assert!(out[1].is_empty(), "el silencio se queda vacio");
                // Y la segunda vez sale de la cache, sin tocar la red.
                let otra = translate_lines(&lineas, "es").unwrap();
                assert_eq!(otra, out);
            }
            Err(e) => panic!("no tradujo: {e}"),
        }
    }
}
