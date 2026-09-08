//! kuidy en Rust: el overlay de letras, sin navegador debajo.
//!
//! Esta es la primera rebanada del port. Todavia no habla con Spotify ni con
//! lrclib: la cancion y la letra son de mentira, y avanzan solas. Lo que si
//! es de verdad es todo lo demas — la ventana sin marco sobre el escritorio,
//! el seguimiento de la linea que suena y el desplazamiento que la deja en
//! el centro.

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

        let playback = Playback::new();
        playback.fake(Track {
            id: "demo".into(),
            name: "Rebanada vertical".into(),
            artists: vec!["kuidy".into(), "chaika".into()],
            duration: Duration::from_secs(52),
        });

        Overlay { playback, lyrics: Signal::new(lyrics::demo()) }.view()
    })
}
