//! Que suena, preguntandoselo a Windows.
//!
//! Windows lleva un registro de lo que reproduce cada programa -- es lo que
//! alimenta el panel de medios del sistema y los botones del teclado -- y
//! ahi esta todo lo que hace falta para seguir una letra: titulo, artista,
//! album, duracion, posicion y si suena o no.
//!
//! Preguntar ahi en lugar de a la API de Spotify quita de en medio la
//! cuenta de desarrollador, el Client ID, el OAuth, la cuota y el limite de
//! cinco usuarios que Spotify impone a las apps en Development Mode. Y de
//! propina funciona con cualquier reproductor, no solo con Spotify.
//!
//! Es lo unico de kuidy atado a un sistema operativo concreto. El resto no
//! lo esta, asi que si algun dia hay version de Linux, el trabajo es este
//! archivo y nada mas: alli lo mismo se pide por MPRIS
//! (`org.mpris.MediaPlayer2`) sobre D-Bus, que Spotify implementa y que da
//! los mismos datos. macOS es el dificil: no hay API publica para esto.
//!
//! Pide Windows 10 version 1809 (10.0.17763), que es cuando aparecio
//! `Windows.Media.Control`.
//!
//! El precio es que la posicion no es un cronometro: Windows publica una
//! foto (`Position`) con la hora a la que se tomo (`LastUpdatedTime`), y
//! Spotify solo la refresca cada dos segundos largos. La posicion de verdad
//! se calcula sumando lo que ha pasado desde esa hora. Medido contra el
//! reloj, esa cuenta no se desvia ni un milisegundo.

#[cfg(not(windows))]
compile_error!(
    "kuidy solo sabe leer lo que suena en Windows. El equivalente en Linux es      MPRIS (org.mpris.MediaPlayer2) sobre D-Bus; hay que escribir ese `leer()`      y devolver la misma `Foto`."
);

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Once;
use std::time::Duration;

use chaika::prelude::*;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

use windows_future::{AsyncStatus, IAsyncOperation};

use crate::playback::{Playback, Track};

/// Con la ventana a la vista. No es una peticion de red: preguntar sale
/// barato, pero tampoco hace falta mas.
const ACTIVE: Duration = Duration::from_millis(1000);
/// Con todo oculto, basta con enterarse tarde.
const HIDDEN: Duration = Duration::from_secs(5);
/// Si Windows contesta con un error, se insiste mas despacio.
const RETRY: Duration = Duration::from_secs(3);

/// Entre preguntas, la posicion avanza con el reloj de aqui: mover un texto
/// que cambia cada varios segundos no merece preguntar cuatro veces por
/// segundo.
const TICK: Duration = Duration::from_millis(250);

/// Los reproductores que se prefieren cuando hay varios sonando a la vez.
/// Kuidy es una app de letras de Spotify; si Spotify esta ahi, gana el.
const PREFERIDO: &str = "spotify";

/// Empieza a seguir lo que suena. Sigue vivo mientras viva la app.
pub fn start(playback: Playback, visible: Signal<bool>) {
    let state = Rc::new(State { playback, visible, fallos: Cell::new(0) });
    preguntar(state.clone());
    estimar(state);
}

struct State {
    playback: Playback,
    visible: Signal<bool>,
    fallos: Cell<u32>,
}

impl State {
    fn siguiente(&self) -> Duration {
        if self.fallos.get() > 0 {
            RETRY
        } else if self.visible.get_untracked() {
            ACTIVE
        } else {
            HIDDEN
        }
    }
}

/// Lo que se ve en una foto.
#[derive(Clone, Debug, PartialEq)]
pub struct Foto {
    pub track: Option<Track>,
    pub position: Duration,
    pub playing: bool,
}

/// Una pregunta, y la siguiente programada detras.
fn preguntar(state: Rc<State>) {
    chaika::task::spawn(leer, move |resultado| {
        match resultado {
            Ok(foto) => {
                state.fallos.set(0);
                aplicar(&state.playback, foto);
            }
            Err(e) => {
                let fallos = state.fallos.get() + 1;
                state.fallos.set(fallos);
                // Solo la primera vez: si Windows no contesta, no hace falta
                // llenar el log con lo mismo cada tres segundos.
                if fallos == 1 {
                    log::warn!("no se pudo leer lo que suena: {e}");
                }
            }
        }
        let espera = state.siguiente();
        chaika::task::after(espera, move || preguntar(state));
    });
}

/// Lleva la foto a las senales que lee la interfaz.
fn aplicar(playback: &Playback, foto: Foto) {
    // Al cambiar de cancion, una linea en el log: es lo primero que hay que
    // mirar cuando alguien dice que no le salen las letras.
    if playback.track.with_untracked(|t| t.as_ref() != foto.track.as_ref()) {
        match &foto.track {
            Some(t) => log::info!("suena: {} - {}", t.artists_line(), t.name),
            None => log::info!("no suena nada"),
        }
    }
    // `set_if_changed` importa: sin el, cada pregunta repintaria la ventana
    // aunque no haya cambiado nada.
    playback.track.set_if_changed(foto.track);
    playback.playing.set_if_changed(foto.playing);
    playback.position.set(foto.position);
}

/// Entre preguntas, la posicion avanza con el reloj de aqui; cada respuesta
/// la corrige.
fn estimar(state: Rc<State>) {
    chaika::task::after(TICK, move || {
        if state.playback.playing.get_untracked() {
            let position = state.playback.position.get_untracked() + TICK;
            let duracion = state
                .playback
                .track
                .with_untracked(|t| t.as_ref().map(|t| t.duration))
                .unwrap_or(Duration::MAX);
            state.playback.position.set(position.min(duracion));
        }
        estimar(state);
    });
}

/// Bloquea: va en otro hilo.
fn leer() -> windows::core::Result<Foto> {
    apartamento();
    let manager = esperar(Manager::RequestAsync()?)?;
    let Some(sesion) = elegir(&manager) else {
        return Ok(Foto { track: None, position: Duration::ZERO, playing: false });
    };

    let playing = sesion.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    let linea = sesion.GetTimelineProperties()?;
    let duracion = ticks(linea.EndTime()?.Duration - linea.StartTime()?.Duration);

    // La foto trae la hora a la que se tomo. Lo que ha pasado desde
    // entonces se suma a mano, que es lo que la convierte en un reloj.
    let mut position = ticks(linea.Position()?.Duration);
    if playing {
        let edad = ahora_en_ticks().saturating_sub(linea.LastUpdatedTime()?.UniversalTime);
        position += ticks(edad);
    }
    if duracion > Duration::ZERO {
        position = position.min(duracion);
    }

    let props = esperar(sesion.TryGetMediaPropertiesAsync()?)?;
    let titulo = props.Title()?.to_string_lossy();
    let track = if titulo.trim().is_empty() {
        None
    } else {
        Some(Track {
            name: titulo,
            artists: artistas(&props.Artist()?.to_string_lossy()),
            album: props.AlbumTitle()?.to_string_lossy(),
            duration: duracion,
        })
    };

    Ok(Foto { track, position, playing })
}

/// Espera a que termine una operacion de WinRT.
///
/// La biblioteca esta pensada para `async`/`await` y no ofrece una espera
/// bloqueante publica. Aqui no hace falta: esto corre en un hilo de trabajo
/// y estas operaciones tardan milisegundos, asi que basta con mirar el
/// estado. El limite existe para que un cuelgue del servicio de medios no
/// se lleve el hilo por delante para siempre.
fn esperar<T: windows::core::RuntimeType>(op: IAsyncOperation<T>) -> windows::core::Result<T> {
    const LIMITE: Duration = Duration::from_secs(2);
    const PASO: Duration = Duration::from_millis(2);
    let hasta = std::time::Instant::now() + LIMITE;
    loop {
        match op.Status()? {
            AsyncStatus::Completed => return op.GetResults(),
            AsyncStatus::Started if std::time::Instant::now() < hasta => std::thread::sleep(PASO),
            AsyncStatus::Started => {
                return Err(windows::core::Error::new(
                    windows::core::HRESULT(-2147024891),
                    "el servicio de medios no contesto",
                ));
            }
            _ => return Err(windows::core::Error::from_hresult(op.ErrorCode()?)),
        }
    }
}

/// De todo lo que suene, con cual quedarse.
///
/// Windows llama "sesion actual" a la del programa con el que se interactuo
/// por ultima vez, que no siempre es el que suena. Si Spotify esta entre
/// ellas, gana el; si no, la actual.
fn elegir(manager: &Manager) -> Option<Session> {
    if let Ok(sesiones) = manager.GetSessions() {
        for sesion in &sesiones {
            let suyo = sesion
                .SourceAppUserModelId()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if suyo.contains(PREFERIDO) {
                return Some(sesion);
            }
        }
    }
    manager.GetCurrentSession().ok()
}

/// Windows da los artistas en una sola cadena. Se parte porque lrclib busca
/// por un artista, y "A, B" no encuentra lo que encuentra "A".
fn artistas(crudo: &str) -> Vec<String> {
    let crudo = crudo.trim();
    if crudo.is_empty() {
        return Vec::new();
    }
    crudo.split(", ").map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
}

/// Windows cuenta el tiempo en unidades de 100 nanosegundos.
fn ticks(cien_nanos: i64) -> Duration {
    Duration::from_nanos(cien_nanos.max(0) as u64 * 100)
}

/// La hora de ahora en la escala de Windows: 100 ns desde 1601.
fn ahora_en_ticks() -> i64 {
    /// Segundos entre 1601-01-01 y 1970-01-01.
    const DESDE_1601: u64 = 11_644_473_600;
    let desde_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    ((desde_epoch.as_secs() + DESDE_1601) * 10_000_000 + desde_epoch.subsec_nanos() as u64 / 100)
        as i64
}

/// COM tiene que estar arrancado en el hilo que pregunta.
///
/// Las tareas van a un hilo distinto cada vez, asi que en lugar de
/// inicializar cada uno se crea un apartamento para todo el proceso: los
/// hilos que no lo tengan se apuntan solos al usarlo.
fn apartamento() {
    static UNA_VEZ: Once = Once::new();
    UNA_VEZ.call_once(|| unsafe {
        let _ = windows::Win32::System::Com::CoIncrementMTAUsage();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_artistas_se_parten_por_la_coma() {
        assert_eq!(artistas("YOASOBI"), vec!["YOASOBI"]);
        assert_eq!(artistas("Queen, David Bowie"), vec!["Queen", "David Bowie"]);
        assert!(artistas("   ").is_empty(), "sin artista no se inventa uno");
    }

    #[test]
    fn el_tiempo_de_windows_se_convierte_bien() {
        // Un segundo son diez millones de unidades de 100 ns.
        assert_eq!(ticks(10_000_000), Duration::from_secs(1));
        assert_eq!(ticks(0), Duration::ZERO);
        assert_eq!(ticks(-5), Duration::ZERO, "una resta negativa no es tiempo");
    }

    #[test]
    fn la_hora_en_la_escala_de_windows_es_creible() {
        let ahora = ahora_en_ticks();
        // 2024-01-01 y 2100-01-01 en la escala de Windows.
        assert!(ahora > 133_170_048_000_000_000, "no puede ser anterior a 2024");
        assert!(ahora < 157_000_000_000_000_000, "ni posterior a 2100");
    }

    #[test]
    fn el_ritmo_baja_cuando_nadie_mira() {
        let state = |visible: bool, fallos: u32| State {
            playback: Playback::new(),
            visible: Signal::new(visible),
            fallos: Cell::new(fallos),
        };
        assert_eq!(state(true, 0).siguiente(), ACTIVE);
        assert_eq!(state(false, 0).siguiente(), HIDDEN, "oculto, mas lento");
        assert_eq!(state(true, 3).siguiente(), RETRY, "fallando, se insiste despacio");
    }
}
