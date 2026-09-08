//! Preguntarle a Spotify que suena, cada tanto.
//!
//! "Cada tanto" no es un numero fijo. Con la musica sonando hay que ir
//! rapido para que la linea cambie a tiempo; en pausa, casi nada cambia; y
//! con la ventana oculta, nadie mira. Sondear siempre igual gasta bateria y
//! cuota de la API para nada.
//!
//! Y cuando falla, se espera cada vez mas. Sin eso, quedarse sin red son
//! veinticuatro peticiones fallidas por minuto, para siempre.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use chaika::prelude::*;

use crate::playback::Playback;
use crate::spotify::{self, Error, Tokens};

/// Sonando y con la ventana a la vista.
const ACTIVE: Duration = Duration::from_millis(2500);
/// En pausa: la cancion no avanza, solo puede cambiar lo que se elija.
const PAUSED: Duration = Duration::from_secs(5);
/// Con todo oculto: solo hace falta enterarse tarde.
const HIDDEN: Duration = Duration::from_secs(10);

/// Lo que se espera tras fallos seguidos. El ultimo se repite.
const BACKOFF: [Duration; 6] = [
    Duration::from_millis(2500),
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(20),
    Duration::from_secs(40),
    Duration::from_secs(60),
];

/// Entre sondeos, la posicion se estima con el reloj: preguntar cada 250 ms
/// para mover un texto que cambia cada varios segundos seria absurdo.
const TICK: Duration = Duration::from_millis(250);

/// Lo que el sondeo publica ademas de la reproduccion.
#[derive(Clone)]
pub struct Status {
    /// El ultimo problema, si lo hay, ya en castellano.
    pub error: Signal<Option<String>>,
    /// `false` cuando hay que volver a entrar en la cuenta.
    pub connected: Signal<bool>,
}

/// Arranca el sondeo. Sigue vivo mientras viva la app.
///
/// `visible` dice si hay alguna ventana a la vista, para bajar el ritmo
/// cuando nadie mira.
pub fn start(tokens: Tokens, playback: Playback, visible: Signal<bool>) -> Status {
    let status = Status { error: Signal::new(None), connected: Signal::new(true) };
    let state = Rc::new(State {
        tokens: RefCell::new(tokens),
        failures: Cell::new(0),
        playback,
        status: status.clone(),
        visible,
    });
    poll(state.clone());
    estimate(state);
    status
}

struct State {
    tokens: RefCell<Tokens>,
    /// Fallos seguidos, para saber cuanto esperar.
    failures: Cell<usize>,
    playback: Playback,
    status: Status,
    visible: Signal<bool>,
}

impl State {
    /// Cuanto esperar hasta el siguiente sondeo.
    fn next_delay(&self) -> Duration {
        let failures = self.failures.get();
        if failures > 0 {
            return BACKOFF[(failures - 1).min(BACKOFF.len() - 1)];
        }
        if !self.visible.get_untracked() {
            return HIDDEN;
        }
        if self.playback.playing.get_untracked() { ACTIVE } else { PAUSED }
    }
}

/// Un sondeo, y el siguiente programado detras.
fn poll(state: Rc<State>) {
    let tokens = state.tokens.borrow().clone();
    chaika::task::spawn(
        move || spotify::now_playing(&tokens),
        move |result| {
            match result {
                Ok((now, session)) => {
                    state.failures.set(0);
                    *state.tokens.borrow_mut() = session;
                    state.status.error.set_if_changed(None);
                    state.status.connected.set_if_changed(true);
                    apply(&state.playback, now);
                }
                Err(error) => {
                    let failures = state.failures.get() + 1;
                    state.failures.set(failures);
                    log::warn!("sondeo fallido ({failures}): {error}");
                    state.status.error.set_if_changed(Some(error.message()));
                    if error.revokes_session() {
                        // La sesion ya no vale: dejar de insistir y pedir
                        // que se vuelva a entrar.
                        Tokens::forget();
                        state.status.connected.set_if_changed(false);
                        return;
                    }
                    if let Error::RateLimited(wait) = error {
                        // Spotify dice cuanto esperar: se le hace caso.
                        let next = state.clone();
                        chaika::task::after(wait, move || poll(next));
                        return;
                    }
                }
            }
            let delay = state.next_delay();
            let next = state.clone();
            chaika::task::after(delay, move || poll(next));
        },
    );
}

/// Lleva lo que dice Spotify a las senales que lee la interfaz.
fn apply(playback: &Playback, now: spotify::Now) {
    // `set_if_changed` importa: sin el, cada sondeo repintaria la ventana
    // aunque no haya cambiado nada.
    playback.track.set_if_changed(now.track);
    playback.playing.set_if_changed(now.playing);
    playback.position.set(now.position);
}

/// Entre sondeos, la posicion avanza con el reloj de aqui.
///
/// Spotify se pregunta cada dos segundos y medio; sin esto, la letra iria a
/// saltos de dos segundos y medio. El sondeo corrige la deriva cada vez que
/// contesta.
fn estimate(state: Rc<State>) {
    chaika::task::after(TICK, move || {
        if state.playback.playing.get_untracked() {
            let position = state.playback.position.get_untracked() + TICK;
            let duration = state
                .playback
                .track
                .with_untracked(|t| t.as_ref().map(|t| t.duration))
                .unwrap_or(Duration::MAX);
            state.playback.position.set(position.min(duration));
        }
        estimate(state);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(playing: bool, visible: bool, failures: usize) -> State {
        let playback = Playback::new();
        playback.playing.set(playing);
        State {
            tokens: RefCell::new(Tokens {
                access_token: String::new(),
                refresh_token: String::new(),
                expires_at: 0,
            }),
            failures: Cell::new(failures),
            playback,
            status: Status { error: Signal::new(None), connected: Signal::new(true) },
            visible: Signal::new(visible),
        }
    }

    #[test]
    fn el_ritmo_baja_cuando_nadie_mira() {
        assert_eq!(state(true, true, 0).next_delay(), ACTIVE);
        assert_eq!(state(false, true, 0).next_delay(), PAUSED, "en pausa, mas lento");
        assert_eq!(state(true, false, 0).next_delay(), HIDDEN, "oculto, mucho mas lento");
    }

    #[test]
    fn tras_fallar_se_espera_cada_vez_mas_hasta_un_tope() {
        assert_eq!(state(true, true, 1).next_delay(), BACKOFF[0]);
        assert_eq!(state(true, true, 3).next_delay(), BACKOFF[2]);
        assert_eq!(state(true, true, 6).next_delay(), BACKOFF[5]);
        assert_eq!(state(true, true, 99).next_delay(), BACKOFF[5], "el ultimo se repite");
    }

    #[test]
    fn fallar_manda_sobre_el_ritmo_normal() {
        // Aunque este sonando y visible, si falla se espera lo del backoff.
        assert_eq!(state(true, true, 2).next_delay(), BACKOFF[1]);
    }
}
