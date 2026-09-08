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

/// Una letra de mentira para ver el overlay sin cuenta ni red.
pub fn demo() -> Lyrics {
    let letra = [
        (0.0, ""),
        (1.5, "Esto es kuidy, en Rust"),
        (5.0, "sin navegador por debajo"),
        (8.5, "la letra la pinta la GPU"),
        (12.0, ""),
        (13.5, "cada linea llega a su hora"),
        (17.0, "y la lista se mueve sola"),
        (20.5, "para dejarla en el centro"),
        (24.0, ""),
        (25.5, "si algo se rompe por el camino"),
        (29.0, "no se arregla: se anota"),
        (32.5, "y el port sigue adelante"),
        (36.0, ""),
        (37.5, "porque la lista de lo que falla"),
        (41.0, "es el producto de este viaje"),
        (44.5, "tanto como la app"),
        (48.0, ""),
    ];
    Lyrics {
        lines: letra.iter().map(|(t, s)| Line::new(*t, s)).collect(),
        synced: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_linea_actual_es_la_ultima_que_ya_empezo() {
        let letra = demo();
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
