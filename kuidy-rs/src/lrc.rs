//! El formato LRC: una letra con marcas de tiempo.
//!
//! ```text
//! [00:12.34] La primera linea
//! [00:15.00][01:03.20] Un estribillo que suena dos veces
//! ```
//!
//! Es texto de internet escrito por gente, asi que aqui no se rechaza nada
//! por estar mal: lo que no se entiende se salta y se sigue. Una letra con
//! tres lineas rotas vale mucho mas que ninguna letra.

use std::time::Duration;

use crate::lyrics::{Line, Lyrics};

/// Convierte un LRC en lineas ordenadas por tiempo.
///
/// Una linea puede llevar varias marcas — es como los LRC escriben un
/// estribillo sin repetirlo — y entonces el texto aparece una vez por marca.
pub fn parse(text: &str) -> Vec<Line> {
    let mut lines = Vec::new();
    for raw in text.lines() {
        let (stamps, rest) = stamps_of(raw);
        if stamps.is_empty() {
            continue;
        }
        let (text, translation) = split_bilingual(rest.trim());
        for at in stamps {
            lines.push(Line {
                at,
                text: text.to_string(),
                translation: translation.map(str::to_string),
            });
        }
    }
    // Las marcas multiples y los LRC mal ordenados dejan la lista revuelta.
    lines.sort_by_key(|l| l.at);
    lines
}

/// Algunos registros de lrclib traen la linea y su traduccion en el mismo
/// renglon, separadas por `^`. Sin partirlas se lee un churro:
/// "Tomate algo, vamos a perrear^Have a drink, let's dance".
///
/// Solo se parte por el primero y solo si las dos mitades tienen algo: un
/// `^` suelto en una letra es raro, pero mas raro es tirar media linea.
fn split_bilingual(text: &str) -> (&str, Option<&str>) {
    match text.split_once('^') {
        Some((original, translation)) => {
            let (original, translation) = (original.trim_end(), translation.trim_start());
            if original.is_empty() || translation.is_empty() {
                (text, None)
            } else {
                (original, Some(translation))
            }
        }
        None => (text, None),
    }
}

/// Una letra completa a partir de su LRC, o `None` si no habia ni una marca.
pub fn lyrics(text: &str) -> Option<Lyrics> {
    let lines = parse(text);
    (!lines.is_empty()).then_some(Lyrics { lines, synced: true })
}

/// Las marcas del principio de una linea y lo que queda detras.
///
/// Solo cuentan las marcas *seguidas* desde el principio: un `[algo]` en
/// mitad del verso es parte del verso, no una marca.
fn stamps_of(raw: &str) -> (Vec<Duration>, &str) {
    let mut stamps = Vec::new();
    let mut rest = raw.trim_start();
    while let Some(end) = bracket_end(rest) {
        let Some(at) = parse_stamp(&rest[1..end]) else { break };
        stamps.push(at);
        rest = &rest[end + 1..];
    }
    (stamps, rest)
}

/// El indice del `]` que cierra el `[` inicial, si la linea empieza por `[`.
fn bracket_end(s: &str) -> Option<usize> {
    s.starts_with('[').then(|| s.find(']')).flatten()
}

/// `mm:ss`, `mm:ss.cc` o `mm:ss.mmm`. Dos digitos de fraccion son
/// centesimas y tres son milesimas, que es la confusion clasica del formato.
fn parse_stamp(s: &str) -> Option<Duration> {
    let (minutes, rest) = s.split_once(':')?;
    let minutes: u64 = minutes.trim().parse().ok()?;
    let (seconds, fraction) = match rest.split_once(['.', ':']) {
        Some((s, f)) => (s, Some(f)),
        None => (rest, None),
    };
    let seconds: u64 = seconds.trim().parse().ok()?;
    let millis = match fraction {
        Some(f) => {
            // Nada detras de la fraccion: `[99:99:99:99]` no es una marca con
            // basura al final, es basura entera.
            if f.is_empty() || !f.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let value: u64 = f.parse().ok()?;
            match f.len() {
                1 => value * 100,
                2 => value * 10,
                _ => value,
            }
        }
        None => 0,
    };
    Some(Duration::from_millis(minutes * 60_000 + seconds * 1000 + millis))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(line: &Line) -> u128 {
        line.at.as_millis()
    }

    #[test]
    fn lee_marcas_con_centesimas_y_milesimas() {
        let lines = parse("[00:12.34] uno\n[00:15.5] dos\n[01:00.250] tres\n[02:03] cuatro");
        assert_eq!(lines.len(), 4);
        assert_eq!(ms(&lines[0]), 12_340, "dos digitos son centesimas");
        assert_eq!(ms(&lines[1]), 15_500, "uno son decimas");
        assert_eq!(ms(&lines[2]), 60_250, "tres son milesimas");
        assert_eq!(ms(&lines[3]), 123_000, "sin fraccion, cero");
    }

    #[test]
    fn una_linea_con_varias_marcas_aparece_varias_veces() {
        let lines = parse("[00:10.00][01:20.00] estribillo");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "estribillo");
        assert_eq!(lines[1].text, "estribillo");
        assert_eq!(ms(&lines[1]), 80_000);
    }

    #[test]
    fn ordena_aunque_el_archivo_venga_revuelto() {
        let lines = parse("[00:30.00] tarde\n[00:10.00] pronto");
        assert_eq!(lines[0].text, "pronto");
        assert_eq!(lines[1].text, "tarde");
    }

    #[test]
    fn se_salta_lo_que_no_entiende_en_vez_de_rendirse() {
        let lines = parse(
            "[ti:Titulo]\n\
             [ar:Artista]\n\
             una linea sin marca\n\
             [00:05.00] esta si\n\
             [99:99:99:99] basura\n\
             [00:07.00] y esta tambien",
        );
        // Las cabeceras [ti:...] no son tiempos y caen solas: `ti` no es un
        // numero. Quedan las dos buenas.
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "esta si");
        assert_eq!(lines[1].text, "y esta tambien");
    }

    #[test]
    fn las_lineas_bilingues_se_parten_en_dos() {
        let lines = parse("[00:05.00] Tomate algo, vamos a perrear^Have a drink, let's dance");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Tomate algo, vamos a perrear");
        assert_eq!(lines[0].translation.as_deref(), Some("Have a drink, let's dance"));
    }

    #[test]
    fn un_acento_circunflejo_suelto_no_parte_la_linea() {
        // Sin nada a un lado, no es un separador: es parte del verso.
        let lines = parse("[00:05.00] solo esto ^
[00:06.00] ^ y esto");
        assert_eq!(lines[0].text, "solo esto ^");
        assert!(lines[0].translation.is_none());
        assert_eq!(lines[1].text, "^ y esto");
        assert!(lines[1].translation.is_none());
    }

    #[test]
    fn un_corchete_en_mitad_del_verso_es_parte_del_verso() {
        let lines = parse("[00:05.00] mira [esto] de aqui");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "mira [esto] de aqui");
    }

    #[test]
    fn los_silencios_se_conservan_como_lineas_vacias() {
        let lines = parse("[00:05.00] canta\n[00:09.00]\n[00:12.00] sigue");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[1].text, "");
        assert_eq!(lines[1].shown(), "♪");
    }

    #[test]
    fn sin_ninguna_marca_no_hay_letra_sincronizada() {
        assert!(lyrics("solo texto plano\nsin tiempos").is_none());
        assert!(lyrics("").is_none());
        assert!(lyrics("[00:01.00] con marca").is_some());
    }
}
