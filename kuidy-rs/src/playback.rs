//! Que suena y por donde va.
//!
//! De momento lo inventa un reloj local; cuando entre Spotify, esta misma
//! forma se rellenara con lo que diga su API. Lo importante es que el
//! overlay no sepa de donde viene: solo lee senales.

use std::time::{Duration, Instant};

use chaika::prelude::*;

/// La cancion que suena.
#[derive(Clone, Debug, PartialEq)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub artists: Vec<String>,
    /// Cuanto dura, para saber cuando se acaba.
    pub duration: Duration,
}

impl Track {
    /// Los artistas como los lee una persona.
    pub fn artists_line(&self) -> String {
        self.artists.join(", ")
    }
}

/// El estado de la reproduccion, tal como lo ve la interfaz.
#[derive(Clone)]
pub struct Playback {
    /// La cancion, o `None` si no suena nada.
    pub track: Signal<Option<Track>>,
    /// Por donde va.
    pub position: Signal<Duration>,
    /// Si esta sonando o en pausa.
    pub playing: Signal<bool>,
}

impl Playback {
    pub fn new() -> Self {
        Self {
            track: Signal::new(None),
            position: Signal::new(Duration::ZERO),
            playing: Signal::new(false),
        }
    }

    /// Una reproduccion de mentira que avanza sola, para ver el overlay sin
    /// cuenta ni red.
    ///
    /// Adelanta la posicion con un temporizador en vez de leer el reloj en
    /// cada frame: asi la app sigue durmiendo entre linea y linea en vez de
    /// girar a 60 fps para mover un texto que cambia cada tres segundos.
    pub fn fake(&self, track: Track) {
        self.track.set(Some(track.clone()));
        self.playing.set(true);
        let started = Instant::now();
        let position = self.position;
        tick(started, track.duration, position);
    }
}

impl Default for Playback {
    fn default() -> Self {
        Self::new()
    }
}

/// Un latido cada cuarto de segundo: suficiente para que la linea cambie a
/// tiempo y barato de sobra.
const BEAT: Duration = Duration::from_millis(250);

fn tick(started: Instant, duration: Duration, position: Signal<Duration>) {
    chaika::task::after(BEAT, move || {
        let elapsed = started.elapsed();
        if elapsed >= duration {
            position.set(duration);
            return;
        }
        position.set(elapsed);
        tick(started, duration, position);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_artistas_se_leen_separados_por_comas() {
        let t = Track {
            id: "1".into(),
            name: "x".into(),
            artists: vec!["Ana".into(), "Beto".into()],
            duration: Duration::from_secs(1),
        };
        assert_eq!(t.artists_line(), "Ana, Beto");
    }
}
