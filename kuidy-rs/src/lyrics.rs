//! La letra de una cancion y por que linea va.
//!
//! Esto no habla con nadie: son datos y una busqueda. Quien los consigue
//! (Spotify, lrclib) vendra despues; separarlo desde el principio es lo que
//! permite ver el overlay funcionando sin cuenta, sin red y sin esperar.

use std::time::Duration;

/// Una linea de la letra, con el momento en que empieza a sonar.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// Desde el principio de la cancion.
    pub at: Duration,
    /// Lo que se canta. Vacio en los silencios entre estrofas.
    pub text: String,
    /// La traduccion, si se pidio.
    pub translation: Option<String>,
}

impl Line {
    #[cfg(test)]
    pub fn new(seconds: f32, text: &str) -> Self {
        Self {
            at: Duration::from_secs_f32(seconds),
            text: text.to_string(),
            translation: None,
        }
    }

    /// Lo que se muestra: los silencios llevan una nota en vez de un hueco,
    /// como en el kuidy de Electron.
    pub fn shown(&self) -> &str {
        if self.text.is_empty() { "♪" } else { &self.text }
    }
}

/// La letra de una cancion.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Lyrics {
    /// Las lineas, en orden.
    pub lines: Vec<Line>,
    /// `false` si solo hay texto plano, sin tiempos: entonces no se sigue,
    /// se lee.
    pub synced: bool,
}

impl Lyrics {
    /// Que linea suena en ese momento: la ultima que ya empezo.
    ///
    /// Devuelve `None` antes de la primera, que es lo que pasa durante la
    /// intro y no es lo mismo que "la primera".
    pub fn line_at(&self, position: Duration) -> Option<usize> {
        if !self.synced {
            return None;
        }
        // Las lineas estan ordenadas: la que buscamos es la ultima cuyo
        // instante ya paso.
        self.lines.iter().rposition(|line| line.at <= position)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn letra_de_prueba() -> Lyrics {
        Lyrics {
            lines: vec![
                Line::new(0.0, ""),
                Line::new(1.5, "primera"),
                Line::new(5.0, "segunda"),
                Line::new(8.5, "tercera"),
            ],
            synced: true,
        }
    }

    #[test]
    fn la_linea_actual_es_la_ultima_que_ya_empezo() {
        let letra = letra_de_prueba();
        assert_eq!(letra.line_at(Duration::ZERO), Some(0));
        assert_eq!(letra.line_at(Duration::from_secs_f32(1.4)), Some(0));
        assert_eq!(letra.line_at(Duration::from_secs_f32(1.6)), Some(1));
        assert_eq!(letra.line_at(Duration::from_secs(6)), Some(2));
        // Pasado el final, se queda en la ultima.
        assert_eq!(letra.line_at(Duration::from_secs(600)), Some(letra.lines.len() - 1));
    }

    #[test]
    fn una_letra_sin_tiempos_no_se_sigue() {
        let plana = Lyrics {
            lines: vec![Line::new(0.0, "solo texto")],
            synced: false,
        };
        assert_eq!(plana.line_at(Duration::from_secs(10)), None);
    }

    #[test]
    fn los_silencios_se_muestran_como_una_nota() {
        assert_eq!(Line::new(0.0, "").shown(), "♪");
        assert_eq!(Line::new(0.0, "algo").shown(), "algo");
    }
}
