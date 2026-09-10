//! kuidy en Rust: el overlay de letras, sin navegador debajo.
//!
//! Tercera rebanada, y ya es la app: Spotify dice que suena, lrclib pone la
//! letra y el overlay la sigue.
//!
//! Lo que suena se lo pregunta a Windows, no a Spotify: asi no hay cuenta
//! que conectar ni Client ID que pedirle a nadie. Con `--demo` ni eso;
//! cancion y letra inventadas para ver la interfaz.

// Sin esto Windows abre una ventana de consola detras de la app, porque el
// ejecutable se marca como programa de consola. Solo en release: en
// desarrollo la consola es justo donde uno quiere ver los logs, y en
// release ya estan en el archivo, que para eso se hizo.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fetch;
mod log_file;
mod media;
mod lrc;
mod lrclib;
mod lyrics;
mod overlay;
mod playback;
mod prefs;
mod settings;
mod store;
mod translate;

use std::time::Duration;

use chaika::prelude::*;

use overlay::Overlay;
use playback::{Playback, Track};
use prefs::Prefs;

/// La mascota, ya en pixeles.
///
/// El dibujo vive en `assets/*.svg` y lo rasteriza `build.rs`, asi que aqui
/// solo hay bytes: el binario no lleva ni un lector de SVG.
fn icono(bytes: &[u8]) -> Icon {
    let n = ((bytes.len() / 4) as f64).sqrt() as u32;
    debug_assert_eq!((n * n * 4) as usize, bytes.len(), "el icono no es cuadrado");
    Icon { width: n, height: n, rgba: bytes.to_vec() }
}

/// El icono de la bandeja: la version simplificada, que es la que aguanta
/// a 16 pixeles.
fn tray_icon() -> Icon {
    icono(include_bytes!(concat!(env!("OUT_DIR"), "/bandeja.rgba")))
}

/// El de la ventana, que sale en la barra de tareas y al hacer Alt+Tab.
pub fn window_icon() -> Icon {
    icono(include_bytes!(concat!(env!("OUT_DIR"), "/ventana.rgba")))
}

/// El texto de la entrada que muestra u oculta las letras.
fn etiqueta_toggle(visible: bool) -> &'static str {
    if visible { "Ocultar letras" } else { "Mostrar letras" }
}

fn menu_bandeja(visible: bool) -> Vec<MenuEntry> {
    vec![
        MenuEntry::item("toggle", etiqueta_toggle(visible)),
        MenuEntry::item("ajustes", "Ajustes..."),
        MenuEntry::separator(),
        // Quien reporte un fallo tiene que poder mandar el log sin ir a
        // buscar %APPDATA% a mano.
        MenuEntry::item("logs", "Abrir carpeta de logs"),
        MenuEntry::separator(),
        MenuEntry::item("version", concat!("kuidy v", env!("CARGO_PKG_VERSION"))).disabled(),
        MenuEntry::item("salir", "Salir"),
    ]
}

/// La bandeja y los atajos: lo que hace que la app viva en segundo plano.
///
/// El overlay no tiene barra de titulo ni aparece en la barra de tareas, asi
/// que sin esto no habria forma de recuperarlo una vez oculto.
fn conectar_mandos(prefs: Prefs, visible: Signal<bool>) {
    let ajustes: Signal<Option<WindowToken>> = Signal::new(None);

    let alternar = move || {
        let ahora = !visible.get_untracked();
        visible.set(ahora);
        if let Some(w) = app::window(WindowToken::MAIN) {
            w.set_visible(ahora);
        }
        // Solo el texto de esa entrada, no el menu entero: reconstruirlo
        // deja abandonada una ventana de menu de Windows de 6x6 pixeles,
        // que se queda flotando en pantalla para siempre (chaika#9).
        app::with_tray(|t| t.set_label("toggle", etiqueta_toggle(ahora)));
    };

    if let Err(e) = app::tray(TrayOptions {
        icon: tray_icon(),
        tooltip: concat!("kuidy v", env!("CARGO_PKG_VERSION")).into(),
        menu: menu_bandeja(true),
    }) {
        log::error!("sin icono en la bandeja: {e}");
    }

    app::on_menu(move |id| match id {
        "toggle" => alternar(),
        "ajustes" => settings::open(prefs, ajustes),
        "logs" => match log_file::dir() {
            Some(dir) => {
                log::info!("abriendo la carpeta de logs: {}", dir.display());
                if let Err(e) = open::that_detached(&dir) {
                    log::warn!("no se pudo abrir la carpeta de logs: {e}");
                }
            }
            None => log::warn!("no hay carpeta de logs que abrir"),
        },
        "salir" => app::close(WindowToken::MAIN),
        _ => {}
    });
    // Clic izquierdo en el icono: mostrar u ocultar, como el kuidy de siempre.
    app::on_tray(move |ev| {
        if let TrayEvent::Click { button: MouseButton::Left, .. } = ev {
            alternar();
        }
    });

    // Los mismos atajos que la version de Electron.
    let atajos = [
        (KeyCode::KeyH, "mostrar u ocultar las letras", Box::new(alternar) as Box<dyn Fn()>),
        (
            KeyCode::KeyJ,
            "abrir los ajustes",
            Box::new(move || settings::open(prefs, ajustes)) as Box<dyn Fn()>,
        ),
    ];
    for (key, que, accion) in atajos {
        let modificadores = Modifiers { ctrl: true, alt: true, ..Default::default() };
        match app::hotkey(modificadores, key, accion) {
            Ok(_) => log::info!("atajo Ctrl+Alt+{key:?} listo: {que}"),
            // Otra app lo tiene: se dice y se sigue, que no es motivo para
            // no arrancar.
            Err(e) => log::warn!("sin atajo para {que}: {e}"),
        }
    }
}

/// Guarda donde esta la ventana para que el proximo arranque la ponga ahi.
///
/// APANO(chaika#7): chaika no avisa cuando la ventana se mueve — no hay un
/// `Event::Moved` —, asi que no queda otra que mirar cada tanto. Un vistazo
/// cada dos segundos no se nota y solo escribe cuando de verdad cambio.
fn recordar_posicion(prefs: Prefs) {
    fn vigilar(prefs: Prefs, ultima: Option<(f32, f32)>) {
        chaika::task::after(std::time::Duration::from_secs(2), move || {
            let ahora = app::window(WindowToken::MAIN)
                .map(|w| w.position())
                .map(|p| (p.x.get(), p.y.get()));
            if let Some(pos) = ahora {
                if ultima != Some(pos) {
                    prefs.save_window(pos.0, pos.1);
                }
            }
            vigilar(prefs, ahora);
        });
    }
    vigilar(prefs, None);
}

/// La cancion de mentira con la que arrancar sin cuenta de Spotify.
///
/// `--demo` sola pone una conocida; `--demo "YOASOBI - Yoru ni Kakeru"`
/// pone la que se pida, que es la unica forma de ver la letra de otro
/// idioma sin tener esa cancion sonando de verdad.
fn demo() -> Option<Track> {
    let mut args = std::env::args().skip_while(|a| a != "--demo");
    args.next()?;
    // Lo que venga detras, si no es otra opcion.
    let pedida = args.next().filter(|a| !a.starts_with("--"));
    let (artist, name, duration) = match pedida.as_deref() {
        Some(texto) => match texto.split_once(" - ") {
            Some((artista, titulo)) => (artista.trim(), titulo.trim(), 240),
            // Sin guion, todo es el titulo: lrclib busca igual.
            None => ("", texto.trim(), 240),
        },
        None => ("Queen", "Bohemian Rhapsody", 354),
    };
    Some(Track {
        name: name.into(),
        artists: if artist.is_empty() { Vec::new() } else { vec![artist.into()] },
        album: String::new(),
        duration: Duration::from_secs(duration),
    })
}

fn main() -> Result<(), chaika::platform::Error> {
    // A la terminal y al archivo: cuando alguien reporte un fallo, el
    // archivo es lo unico que hay.
    log_file::init();
    log::info!(
        "kuidy {} arrancando ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    );

    let options = AppOptions {
        window: WindowOptions {
            title: "kuidy".into(),
            icon: Some(window_icon()),
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
            match Prefs::window() {
                // Donde el usuario la dejo la ultima vez.
                Some((x, y)) => window.set_position(point(px(x), px(y))),
                // La primera vez, abajo y centrada sobre el area util.
                None => {
                    if let Some(monitor) = window.primary_monitor() {
                        let area = monitor.work_area;
                        let size = window.size();
                        let x = area.origin.x + (area.size.width - size.width).half();
                        let y = area.origin.y + area.size.height - size.height - px(48.);
                        window.set_position(point(x, y));
                    }
                }
            }
            window.set_visible(true);
        }

        let prefs = Prefs::load();
        let playback = Playback::new();
        let visible = Signal::new(true);
        conectar_mandos(prefs, visible);

        recordar_posicion(prefs);

        // Los clics pasan o no segun el ajuste; y si pasan, la ventana deja
        // de poder arrastrarse, que es el trato.
        Effect::new(move || {
            if let Some(w) = app::window(WindowToken::MAIN) {
                w.set_click_through(prefs.click_through.get());
            }
        });

        let lyrics = if let Some(track) = demo() {
            // Sin cuenta de Spotify, pero con todo lo demas de verdad: la
            // cancion con su reloj local, y la letra y la traduccion pedidas
            // como siempre. Sirve para ver la app sin conectar nada y para
            // probar la tuberia entera.
            log::info!("demo: {} - {}", track.artists.join(", "), track.name);
            playback.fake(track);
            fetch::follow(playback.track)
        } else {
            media::start(playback.clone(), visible);
            fetch::follow(playback.track)
        };

        Overlay { playback, lyrics, prefs }.view()
    })
}
