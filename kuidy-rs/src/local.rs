//! Letras que pone el usuario, para lo que no esta en ninguna base.
//!
//! lrclib es comunitario: si una cancion falta es porque nadie la subio, y no
//! hay consulta que la haga aparecer. Musixmatch y Genius tampoco resuelven
//! eso --- la primera recorta la letra al 30% salvo licencia de pago, y la
//! segunda no devuelve letras por su API a proposito --- asi que la salida que
//! queda, y la unica que no depende de nadie, es que el archivo lo traigas tu.
//!
//! Un `.lrc` guardado aqui **manda sobre la red**: si existe, ni se pregunta.
//! Es lo que hace que valga la pena ponerlo una vez.

use std::io;

use crate::lrc;
use crate::lyrics::Lyrics;
use crate::playback::Track;
use crate::store;

/// El nombre del archivo donde vive la letra de una pista.
///
/// Sale del artista y el titulo, no de ningun identificador del reproductor:
/// la misma cancion en Spotify y en YouTube tiene que dar la misma clave, que
/// es justo la gracia de guardarla.
///
/// Se normaliza a lo que cabe en cualquier sistema de archivos --- minusculas,
/// letras y numeros, y un guion por todo lo demas --- y se acota, porque hay
/// titulos absurdamente largos y un nombre de archivo tiene tope.
fn clave(track: &Track) -> String {
    let artista = track.artists.first().map(String::as_str).unwrap_or("");
    let crudo = format!("{artista} {}", track.name);
    let mut out = String::with_capacity(crudo.len());
    let mut guion = false;
    for c in crudo.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
            guion = false;
        } else if !guion && !out.is_empty() {
            out.push('-');
            guion = true;
        }
    }
    let recortado: String = out.trim_end_matches('-').chars().take(120).collect();
    format!("letra-{}.lrc", recortado.trim_end_matches('-'))
}

/// La letra guardada para esta pista, si la hay.
pub fn leer(track: &Track) -> Option<Lyrics> {
    let texto = store::read(&clave(track))?;
    match lrc::lyrics(&texto) {
        Some(l) => {
            log::info!("letra propia para «{}»", track.name);
            Some(l)
        }
        None => {
            // El archivo esta pero no se entiende. No se borra: lo puso una
            // persona y a lo mejor quiere arreglarlo.
            log::warn!("la letra propia de «{}» no se pudo leer", track.name);
            None
        }
    }
}

/// Guarda un `.lrc` para esta pista. Devuelve la letra ya interpretada.
///
/// Se valida **antes** de escribir: guardar algo que luego no se puede leer
/// deja al usuario con un archivo que no hace nada y sin saber por que.
pub fn guardar(track: &Track, texto: &str) -> Result<Lyrics, String> {
    let Some(lyrics) = lrc::lyrics(texto) else {
        return Err("ese archivo no parece una letra".into());
    };
    store::write(&clave(track), texto)
        .map_err(|e: io::Error| format!("no se pudo guardar: {e}"))?;
    Ok(lyrics)
}

/// `true` si esta pista ya tiene letra propia guardada.
pub fn hay(track: &Track) -> bool {
    store::read(&clave(track)).is_some()
}

/// Olvida la letra propia de esta pista, para volver a la de la red.
pub fn olvidar(track: &Track) -> io::Result<()> {
    let path = store::dir()?.join(clave(track));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn track(artista: &str, nombre: &str) -> Track {
        Track {
            name: nombre.into(),
            artists: if artista.is_empty() {
                vec![]
            } else {
                vec![artista.into()]
            },
            album: String::new(),
            duration: Duration::from_secs(200),
        }
    }

    /// La clave no depende del reproductor: la misma cancion desde Spotify y
    /// desde YouTube tiene que caer en el mismo archivo.
    #[test]
    fn la_clave_es_la_misma_venga_de_donde_venga() {
        let a = clave(&track("Alejandro Sanz", "Cancion"));
        let b = clave(&track("alejandro sanz", "  Cancion  "));
        assert_eq!(a, b);
        assert_eq!(a, "letra-alejandro-sanz-cancion.lrc");
    }

    /// Y sirve como nombre de archivo pase lo que pase con el titulo.
    #[test]
    fn la_clave_aguanta_cualquier_titulo() {
        for (artista, nombre) in [
            ("AC/DC", "T.N.T."),
            ("宇多田ヒカル", "First Love"),
            ("", "Sin artista"),
            ("Raro", "// \\\\ :: ?? ** ||"),
        ] {
            let k = clave(&track(artista, nombre));
            assert!(k.starts_with("letra-") && k.ends_with(".lrc"), "{k}");
            assert!(
                !k.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']),
                "{k} lleva algo que un nombre de archivo no admite"
            );
            assert!(!k.contains("--"), "{k} tiene guiones seguidos");
        }
    }

    /// Un titulo enorme no da un nombre de archivo enorme.
    #[test]
    fn un_titulo_larguisimo_se_recorta() {
        let k = clave(&track("Artista", &"palabra ".repeat(80)));
        assert!(k.len() < 140, "{} caracteres", k.len());
        assert!(!k.contains("-.lrc"), "no acaba en guion suelto: {k}");
    }

    /// Lo que no es una letra no se guarda, y se dice por que.
    #[test]
    fn un_archivo_que_no_es_letra_no_se_guarda() {
        let t = track("Artista", "Cancion");
        assert!(guardar(&t, "").is_err());
        assert!(guardar(&t, "esto no lleva ni un tiempo").is_err());
    }
}
