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
mod log_file;
mod lrc;
mod lrclib;
mod lyrics;
mod overlay;
mod playback;
mod poller;
mod prefs;
mod settings;
mod spotify;
mod store;
mod translate;

use std::time::Duration;

use chaika::prelude::*;

use overlay::Overlay;
use playback::{Playback, Track};
use prefs::Prefs;

/// El icono de la bandeja: un disco con el azul de kuidy.
fn tray_icon() -> Icon {
    let n = 32_u32;
    let mut rgba = Vec::with_capacity((n * n * 4) as usize);
    for y in 0..n {
        for x in 0..n {
            let (dx, dy) = (x as f32 - 15.5, y as f32 - 15.5);
            let d = (dx * dx + dy * dy).sqrt();
            // Un disco con un agujero: un vinilo, que es lo que suena.
            let fuera = (15.0 - d).clamp(0.0, 1.0);
            let dentro = (d - 4.0).clamp(0.0, 1.0);
            let alpha = fuera * dentro;
            rgba.extend([0x5b, 0x8c, 0xff, (alpha * 255.0) as u8]);
        }
    }
    Icon { width: n, height: n, rgba }
}

fn menu_bandeja(visible: bool) -> Vec<MenuEntry> {
    vec![
        MenuEntry::item("toggle", if visible { "Ocultar letras" } else { "Mostrar letras" }),
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
        app::with_tray(|t| t.set_menu(&menu_bandeja(ahora)));
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
        id: "demo".into(),
        name: name.into(),
        artists: if artist.is_empty() { Vec::new() } else { vec![artist.into()] },
        album: String::new(),
        duration: Duration::from_secs(duration),
    })
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
            let lyrics = fetch::follow(playback.track);
            connect(playback.clone(), visible);
            lyrics
        };

        Overlay { playback, lyrics, prefs }.view()
    })
}
