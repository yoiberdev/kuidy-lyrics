//! kuidy en Rust: el overlay de letras, sin navegador debajo.
//!
//! Tercera rebanada, y ya es la app: Spotify dice que suena, lrclib pone la
//! letra y el overlay la sigue.
//!
//! Al arrancar hay tres caminos. Con sesion guardada, a sondear. Sin ella,
//! se entra en la cuenta con `--login`, que abre el navegador. Y con
//! `--demo` no se toca la red: cancion y letra inventadas, para ver la
//! interfaz sin cuenta.

mod fetch;
mod lrc;
mod lrclib;
mod lyrics;
mod overlay;
mod playback;
mod poller;
mod spotify;
mod store;

use std::time::Duration;

use chaika::prelude::*;

use overlay::Overlay;
use playback::{Playback, Track};

fn demo() -> bool {
    std::env::args().any(|a| a == "--demo")
}

/// Arranca el sondeo con la sesion que haya, o entra en la cuenta si se
/// pidio con `--login`.
///
/// Entrar bloquea hasta que el usuario termina en el navegador, asi que va
/// en otro hilo como cualquier otra espera larga.
fn connect(playback: Playback, visible: Signal<bool>) {
    if let Some(tokens) = spotify::Tokens::load() {
        log::info!("sesion de Spotify recuperada");
        poller::start(tokens, playback, visible);
        return;
    }
    if !std::env::args().any(|a| a == "--login") {
        log::warn!("sin sesion de Spotify: arranca con --login para conectar la cuenta");
        return;
    }

    log::info!("abriendo el navegador para entrar en Spotify");
    chaika::task::spawn(
        || spotify::login(spotify::CLIENT_ID, open_browser),
        move |result| match result {
            Ok(tokens) => {
                tokens.save();
                log::info!("cuenta conectada");
                poller::start(tokens, playback, visible);
            }
            Err(e) => log::error!("no se pudo conectar la cuenta: {e}"),
        },
    );
}

/// Abre una URL en el navegador del sistema.
///
/// APANO(chaika#6): esto deberia darlo el toolkit. Hacerlo a mano en Windows
/// tiene dos trampas que costaron una sesion: `cmd /C start` trata el `&`
/// como separador de comandos — la URL de Spotify llega cortada en el primer
/// parametro — y ademas expande los `%` de una URL ya codificada. Se usa el
/// crate `open`, que por dentro llama a `ShellExecuteW` y no pasa por cmd.
fn open_browser(url: &str) {
    log::debug!("abriendo {url}");
    if let Err(e) = open::that_detached(url) {
        log::error!("no se pudo abrir el navegador: {e}");
        log::info!("abrelo a mano: {url}");
    }
}

fn main() -> Result<(), chaika::platform::Error> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let options = AppOptions {
        window: WindowOptions {
            title: "kuidy".into(),
            // Lo mismo que el overlay de Electron.
            size: size(px(420.), px(320.)),
            transparent: true,
            decorations: false,
            always_on_top: true,
            skip_taskbar: true,
            resizable: true,
            // Oculta hasta colocarla sobre el area util.
            visible: false,
            ..Default::default()
        },
        background: Color::TRANSPARENT,
        escape_closes: true,
    };

    chaika::app::run(options, || {
        // Abajo y centrada, como la deja kuidy la primera vez.
        if let Some(window) = app::window(WindowToken::MAIN) {
            if let Some(monitor) = window.primary_monitor() {
                let area = monitor.work_area;
                let size = window.size();
                let x = area.origin.x + (area.size.width - size.width).half();
                let y = area.origin.y + area.size.height - size.height - px(48.);
                window.set_position(point(x, y));
            }
            window.set_visible(true);
        }

        let playback = Playback::new();
        let visible = Signal::new(true);

        let lyrics = if demo() {
            // Sin tocar la red: cancion y letra inventadas.
            playback.fake(Track {
                id: "demo".into(),
                name: "Rebanada vertical".into(),
                artists: vec!["kuidy".into()],
                album: String::new(),
                duration: Duration::from_secs(52),
            });
            fetch::demo()
        } else {
            let lyrics = fetch::follow(playback.track);
            connect(playback.clone(), visible);
            lyrics
        };

        Overlay { playback, lyrics }.view()
    })
}
