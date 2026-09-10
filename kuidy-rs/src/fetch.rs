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
use crate::prefs::Prefs;

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
pub fn follow(track: Signal<Option<Track>>, prefs: Prefs) -> Signal<State> {
    let state = Signal::new(State::Idle);
    // Cada busqueda lleva su numero; solo la ultima tiene derecho a escribir.
    let generation = Rc::new(Cell::new(0_u64));
    // Una copia para el efecto de la traduccion, que se define despues pero
    // necesita la misma cuenta de generaciones.
    let generacion = Rc::clone(&generation);

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
                    // La letra se ensena ya. La traduccion la decide el
                    // efecto de abajo, que ademas mira si el usuario la
                    // quiere.
                    Ok(lyrics) => State::Ready(lyrics),
                    Err(e) => {
                        log::info!("sin letra: {e}");
                        State::Missing(mensaje(&e))
                    }
                });
            },
        );
    });

    // La traduccion manda la letra entera a un servicio de fuera, asi que
    // solo sale si el usuario lo tiene encendido. Y va en un efecto y no
    // pegada a la busqueda para que encenderlo a mitad de cancion traduzca
    // la que esta sonando, en vez de la siguiente.
    let traducida = Rc::new(Cell::new(0_u64));
    let preguntando = Rc::new(Cell::new(false));
    Effect::new(move || {
        let quiere = prefs.translation_allowed.get();
        let preguntado = prefs.translation_asked.get();
        // Leer el estado aqui suscribe: cuando llega la letra, esto vuelve.
        let pendiente = state.with(|s| match s {
            State::Ready(l) if l.lines.iter().any(|x| x.translation.is_none()) => Some(l.clone()),
            _ => None,
        });
        let mine = generacion.get();
        if traducida.get() == mine {
            return;
        }
        let Some(lyrics) = pendiente else { return };

        // El romaji se hace aqui dentro, sin red y sin mandar nada a
        // ninguna parte, asi que no hay permiso que pedir: se pone y ya.
        if en_japones(&lyrics) {
            traducida.set(mine);
            romanizar(state, lyrics, mine, Rc::clone(&generacion));
            return;
        }

        // La primera letra que se podria traducir es el momento de
        // preguntar: es cuando el permiso significa algo y cuando el usuario
        // entiende para que se lo piden. Hasta que conteste no sale nada.
        if !preguntado {
            if preguntando.replace(true) {
                return;
            }
            log::info!("primera letra traducible: se pide permiso");
            let preguntando = Rc::clone(&preguntando);
            chaika::dialog::message(
                "kuidy",
                concat!(
                    "Para traducir la letra, kuidy manda el texto a Google.\n\n",
                    "Nada sale de tu equipo si dices que no, y puedes cambiar de idea ",
                    "cuando quieras en Ajustes.\n\n",
                    "El romaji de las canciones en japones no usa internet, y funciona ",
                    "digas lo que digas.\n\n",
                    "Traducir la letra?",
                ),
            )
            .confirm(move |si| {
                log::info!("permiso para traducir: {}", if si { "concedido" } else { "denegado" });
                prefs.translation_allowed.set(si);
                // Esto despierta este mismo efecto, y ahora ya con respuesta.
                prefs.translation_asked.set(true);
                preguntando.set(false);
            });
            return;
        }

        if !quiere {
            return;
        }
        // Marcar antes de lanzar: al volver, la traduccion escribe el estado
        // y este efecto se despierta otra vez.
        traducida.set(mine);
        traducir(state, lyrics, mine, Rc::clone(&generacion));
    });

    state
}

/// Si la letra es japonesa, y por tanto lo que toca es la lectura y no la
/// traduccion: la letra se canta, y sin romaji no hay por donde entrarle.
///
/// Basta con que una parte de las lineas lleven kana; una cancion japonesa
/// tiene versos sueltos en ingles.
fn en_japones(lyrics: &Lyrics) -> bool {
    let con_letra = lyrics.lines.iter().filter(|l| !l.text.trim().is_empty()).count();
    let japonesas = lyrics.lines.iter().filter(|l| crate::translate::is_japanese(&l.text)).count();
    japonesas * 4 >= con_letra
}

/// Pone la lectura en romaji bajo cada linea, sin salir de la maquina.
fn romanizar(state: Signal<State>, lyrics: Lyrics, mine: u64, generation: Rc<Cell<u64>>) {
    if lyrics.lines.iter().all(|l| l.translation.is_some()) {
        return;
    }
    let originales: Vec<String> = lyrics.lines.iter().map(|l| l.text.clone()).collect();
    log::info!("romanizando {} lineas aqui mismo", originales.len());
    chaika::task::spawn(
        move || crate::romaji::romanize(&originales),
        move |lecturas| {
            if generation.get() != mine {
                return;
            }
            let mut lyrics = lyrics;
            for (line, lectura) in lyrics.lines.iter_mut().zip(lecturas) {
                if line.translation.is_none() && !lectura.is_empty() {
                    line.translation = Some(lectura);
                }
            }
            state.set(State::Ready(lyrics));
        },
    );
}

/// Traduce la letra en otro hilo y la mete en su sitio cuando vuelve.
///
/// Va aparte de la busqueda a proposito: la letra tiene que aparecer en
/// cuanto se tiene, no cuando ademas este traducida. Y si la cancion cambia
/// por el camino, la traduccion se tira igual que se tiraria la letra.
fn traducir(state: Signal<State>, lyrics: Lyrics, mine: u64, generation: Rc<Cell<u64>>) {
    // Las que ya vienen traducidas de lrclib — las bilingues — no se tocan.
    if lyrics.lines.iter().all(|l| l.translation.is_some()) {
        return;
    }
    let originales: Vec<String> = lyrics.lines.iter().map(|l| l.text.clone()).collect();
    // Queda dicho en el log que la letra sale de esta maquina. Es lo unico
    // que manda texto fuera, y quien lea el log tiene derecho a verlo.
    log::info!("mandando {} lineas a traducir", originales.len());
    let idioma = crate::translate::target_language();
    chaika::task::spawn(
        move || crate::translate::translate_lines(&originales, &idioma),
        move |result| {
            if generation.get() != mine {
                return;
            }
            let traducciones = match result {
                Ok(t) => t,
                Err(e) => {
                    // Sin traduccion se vive; la letra ya esta puesta.
                    log::info!("sin traduccion: {e}");
                    return;
                }
            };
            let mut lyrics = lyrics;
            for (line, traduccion) in lyrics.lines.iter_mut().zip(traducciones) {
                if line.translation.is_none() && !traduccion.is_empty() {
                    line.translation = Some(traduccion);
                }
            }
            state.set(State::Ready(lyrics));
        },
    );
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
