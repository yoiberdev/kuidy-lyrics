//! Traer la letra de lo que suena, sin parar la interfaz.
//!
//! El unico sitio del port donde se juntan las dos mitades: una senal dice
//! que cancion suena, otro hilo va a buscar su letra, y el resultado vuelve
//! al hilo principal convertido en otra senal que el overlay lee.

use std::cell::Cell;
use std::rc::Rc;
use chaika::prelude::*;

use crate::lrclib::{self, Query};
use crate::lyrics::Lyrics;
use crate::playback::Track;

/// En que punto esta la busqueda de la letra.
#[derive(Clone, Debug, PartialEq)]
pub enum State {
    /// No suena nada.
    Idle,
    /// Buscandola.
    Loading,
    /// Aqui esta.
    Ready(Lyrics),
    /// No la hay, y por que.
    Missing(String),
}

impl State {
    /// La letra, si la hay. El overlay pinta lineas o pinta un mensaje.
    pub fn lyrics(&self) -> Option<&Lyrics> {
        match self {
            State::Ready(l) => Some(l),
            _ => None,
        }
    }

    /// Lo que se le cuenta al usuario cuando no hay lineas que ensenar.
    pub fn message(&self) -> &str {
        match self {
            State::Idle => "Nada sonando",
            State::Loading => "Buscando letra...",
            State::Ready(_) => "",
            State::Missing(why) => why,
        }
    }
}

/// Sigue a la cancion que suena y trae su letra.
///
/// Devuelve la senal donde va apareciendo. Cada cambio de cancion cancela lo
/// anterior: si la letra de la cancion vieja llega tarde, se tira. Sin eso,
/// saltar de tema deja la letra equivocada en pantalla justo cuando el
/// usuario mas mira.
pub fn follow(track: Signal<Option<Track>>) -> Signal<State> {
    let state = Signal::new(State::Idle);
    // Cada busqueda lleva su numero; solo la ultima tiene derecho a escribir.
    let generation = Rc::new(Cell::new(0_u64));

    Effect::new(move || {
        let Some(track) = track.get() else {
            state.set(State::Idle);
            return;
        };
        let mine = generation.get() + 1;
        generation.set(mine);
        state.set(State::Loading);

        let query = Query {
            track: track.name.clone(),
            artist: track.artists.first().cloned().unwrap_or_default(),
            album: track.album.clone(),
            duration: track.duration,
        };
        let generation = Rc::clone(&generation);
        chaika::task::spawn(
            move || lrclib::fetch(&query),
            move |result| {
                // Llego tarde: mientras buscaba, el usuario cambio de cancion.
                if generation.get() != mine {
                    log::debug!("letra descartada: ya no suena esa cancion");
                    return;
                }
                state.set(match result {
                    Ok(lyrics) => State::Ready(lyrics),
                    Err(e) => {
                        log::info!("sin letra: {e}");
                        State::Missing(mensaje(&e))
                    }
                });
            },
        );
    });

    state
}

/// Lo que se le dice al usuario. Distinto para lo definitivo y lo pasajero:
/// "no hay letra" se acepta, "no se pudo mirar" invita a esperar.
fn mensaje(error: &lrclib::Error) -> String {
    match error {
        lrclib::Error::NotFound => "No hay letra para esta cancion".into(),
        lrclib::Error::Instrumental => "Instrumental".into(),
        lrclib::Error::Service(_) => "No se pudo consultar la letra".into(),
    }
}

/// Una letra de mentira, para ver el overlay sin red.
pub fn demo() -> Signal<State> {
    Signal::new(State::Ready(crate::lyrics::demo()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_mensaje_distingue_lo_definitivo_de_lo_pasajero() {
        assert_eq!(mensaje(&lrclib::Error::NotFound), "No hay letra para esta cancion");
        assert_eq!(mensaje(&lrclib::Error::Instrumental), "Instrumental");
        assert_eq!(
            mensaje(&lrclib::Error::Service("500".into())),
            "No se pudo consultar la letra",
            "al usuario no se le ensena el codigo de un servidor ajeno"
        );
    }

    #[test]
    fn sin_letra_el_estado_dice_que_pasa() {
        assert_eq!(State::Idle.message(), "Nada sonando");
        assert_eq!(State::Loading.message(), "Buscando letra...");
        assert!(State::Idle.lyrics().is_none());
        assert!(State::Ready(Lyrics::default()).lyrics().is_some());
    }
}
