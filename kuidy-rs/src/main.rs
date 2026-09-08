//! kuidy en Rust: el overlay de letras, sin navegador debajo.
//!
//! Segunda rebanada. La letra ya es de verdad: se pide a lrclib en otro hilo
//! y aparece cuando llega. Lo que sigue siendo de mentira es quien suena —
//! un reloj local en vez de Spotify — y eso entra en la siguiente.
//!
//! Con `--demo` se usa una letra inventada, para verlo sin red.

mod fetch;
mod lrc;
mod lrclib;
mod lyrics;
mod overlay;
mod playback;

use std::time::Duration;

use chaika::prelude::*;

use overlay::Overlay;
use playback::{Playback, Track};

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

        let demo = std::env::args().any(|a| a == "--demo");
        let playback = Playback::new();

        // Sin Spotify todavia: una cancion de verdad con su reloj de mentira,
        // que es lo que hace falta para que lrclib tenga algo que buscar.
        let track = if demo {
            Track {
                id: "demo".into(),
                name: "Rebanada vertical".into(),
                artists: vec!["kuidy".into()],
                album: String::new(),
                duration: Duration::from_secs(52),
            }
        } else {
            Track {
                id: "4u7EnebtmKWzUH433cf5Qv".into(),
                name: "Bohemian Rhapsody".into(),
                artists: vec!["Queen".into()],
                album: "A Night at the Opera".into(),
                duration: Duration::from_secs(354),
            }
        };
        playback.fake(track);

        let lyrics = if demo { fetch::demo() } else { fetch::follow(playback.track) };
        Overlay { playback, lyrics }.view()
    })
}
