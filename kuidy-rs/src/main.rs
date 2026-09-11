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

mod avisos;
mod fetch;
mod log_file;
mod media;
mod lrc;
mod lrclib;
mod lyrics;
mod overlay;
mod playback;
mod prefs;
mod romaji;
mod settings;
mod store;
mod translate;

use std::time::Duration;

use chaika::prelude::*;

use overlay::Overlay;
use playback::{Playback, Track};
use prefs::Prefs;

/// Cuanto de la ventana tiene que asomar para poder agarrarla con el raton.
const ASOMO: (f32, f32) = (120., 40.);

/// Coloca el overlay: donde lo dejo el usuario, si ese sitio sigue existiendo.
///
/// La posicion guardada no se puede restaurar a ciegas. Quien la dejo en un
/// segundo monitor y luego lo desconecta, o cambia de resolucion, se
/// encontraria el overlay fuera de la pantalla y sin forma de recuperarlo:
/// no tiene marco, no sale en la barra de tareas y solo se arrastra
/// agarrandolo.
fn colocar(window: &chaika::platform::Window, guardada: Option<(f32, f32)>) {
    let size = window.size();
    let areas: Vec<(f32, f32, f32, f32)> = window
        .monitors()
        .iter()
        .map(|m| {
            let a = m.work_area;
            (a.origin.x.get(), a.origin.y.get(), a.size.width.get(), a.size.height.get())
        })
        .collect();

    if let Some((x, y)) = guardada {
        if a_la_vista((x, y), (size.width.get(), size.height.get()), &areas) {
            window.set_position(point(px(x), px(y)));
            return;
        }
        log::info!("la posicion guardada ({x}, {y}) ya no cae en ninguna pantalla; se recoloca");
    }

    // Abajo y centrada sobre el area util, como la deja kuidy la primera vez.
    if let Some(monitor) = window.primary_monitor() {
        let area = monitor.work_area;
        let x = area.origin.x + (area.size.width - size.width).half();
        let y = area.origin.y + area.size.height - size.height - px(48.);
        window.set_position(point(x, y));
    }
}

/// Si una ventana en esa posicion asomaria lo suficiente por alguna pantalla.
fn a_la_vista(pos: (f32, f32), tam: (f32, f32), areas: &[(f32, f32, f32, f32)]) -> bool {
    // Sin monitores que consultar no se puede decir que no; mejor respetar
    // lo que el usuario dejo puesto que recolocarle la ventana sin motivo.
    if areas.is_empty() {
        return true;
    }
    areas.iter().any(|&(ax, ay, aw, ah)| {
        let ancho = (pos.0 + tam.0).min(ax + aw) - pos.0.max(ax);
        let alto = (pos.1 + tam.1).min(ay + ah) - pos.1.max(ay);
        ancho >= ASOMO.0 && alto >= ASOMO.1
    })
}

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

/// El texto de la entrada del modo de solo subtitulos.
fn etiqueta_minimal(minimal: bool) -> &'static str {
    if minimal { "Volver al panel" } else { "Solo subtitulos" }
}

fn menu_bandeja(visible: bool, minimal: bool) -> Vec<MenuEntry> {
    vec![
        MenuEntry::item("toggle", etiqueta_toggle(visible)),
        MenuEntry::item("minimal", etiqueta_minimal(minimal)),
        MenuEntry::item("ajustes", "Ajustes..."),
        MenuEntry::separator(),
        // Quien reporte un fallo tiene que poder mandar el log sin ir a
        // buscar %APPDATA% a mano.
        MenuEntry::item("logs", "Abrir carpeta de logs"),
        // La licencia del diccionario japones obliga a que su aviso
        // acompane al programa, y kuidy se reparte como un .exe suelto: sin
        // esto, quien solo se baja el ejecutable no lo recibe.
        MenuEntry::item("avisos", "Avisos de terceros"),
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

    // Solo los subtitulos: se va el panel y los clics pasan de largo, que es
    // como lo hacia el kuidy de Electron -- los dos ajustes viajaban juntos,
    // porque una letra flotando sin fondo que ademas se traga los clics no
    // tiene ningun sentido.
    let alternar_minimal = move || {
        let ahora = !prefs.minimal.get_untracked();
        prefs.minimal.set(ahora);
        prefs.click_through.set(ahora);
        app::with_tray(|t| t.set_label("minimal", etiqueta_minimal(ahora)));
        log::info!("solo subtitulos: {}", if ahora { "encendido" } else { "apagado" });
    };

    if let Err(e) = app::tray(TrayOptions {
        icon: tray_icon(),
        tooltip: concat!("kuidy v", env!("CARGO_PKG_VERSION")).into(),
        menu: menu_bandeja(true, prefs.minimal.get_untracked()),
    }) {
        log::error!("sin icono en la bandeja: {e}");
    }

    app::on_menu(move |id| match id {
        "toggle" => alternar(),
        "minimal" => alternar_minimal(),
        "ajustes" => settings::open(prefs, ajustes),
        "avisos" => avisos::abrir(),
        "logs" => match log_file::dir() {
            Some(dir) => {
                log::info!("abriendo la carpeta de logs: {}", dir.display());
                if let Err(e) = open::that_detached(&dir) {
                    log::warn!("no se pudo abrir la carpeta de logs: {e}");
                }
            }
            None => log::warn!("no hay carpeta de logs que abrir"),
        },
        "salir" => {
            // Los ajustes van en ventana aparte: si se quedan abiertos, la
            // app sigue viva sin overlay y sin forma de recuperarlo.
            if let Some(token) = ajustes.get_untracked() {
                app::close(token);
            }
            app::close(WindowToken::MAIN);
        }
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
        (
            KeyCode::KeyM,
            "dejar solo los subtitulos",
            Box::new(alternar_minimal) as Box<dyn Fn()>,
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
        // El overlay no se cierra con Escape. Es una ventana sin marco que
        // vive encima de todo: un Escape suelto mientras se juega o se
        // escribe no puede cerrar la aplicacion entera.
        escape_closes: false,
    };

    chaika::app::run(options, || {
        let prefs = Prefs::load();
        if let Some(window) = app::window(WindowToken::MAIN) {
            colocar(&window, prefs.window.get_untracked());
            window.set_visible(true);
        }

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
            fetch::follow(playback.track, prefs)
        } else {
            media::start(playback.clone(), visible);
            fetch::follow(playback.track, prefs)
        };

        Overlay { playback, lyrics, prefs }.view()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un monitor de 1920x1080 con la barra de tareas abajo.
    const PRINCIPAL: (f32, f32, f32, f32) = (0., 0., 1920., 1032.);
    /// Uno secundario a la izquierda, como se suele poner.
    const SEGUNDO: (f32, f32, f32, f32) = (-1920., 0., 1920., 1080.);
    const OVERLAY: (f32, f32) = (420., 320.);

    #[test]
    fn una_posicion_normal_se_respeta() {
        assert!(a_la_vista((800., 600.), OVERLAY, &[PRINCIPAL]));
    }

    #[test]
    fn la_ventana_del_monitor_desconectado_se_recoloca() {
        // Estaba en el segundo monitor y ahora solo queda el principal.
        assert!(a_la_vista((-1200., 300.), OVERLAY, &[PRINCIPAL, SEGUNDO]));
        assert!(
            !a_la_vista((-1200., 300.), OVERLAY, &[PRINCIPAL]),
            "sin ese monitor, esa posicion es inalcanzable"
        );
    }

    #[test]
    fn asomar_un_poco_basta_para_poder_agarrarla() {
        // Casi toda fuera por la derecha, pero asoman 130 px: se puede coger.
        assert!(a_la_vista((1790., 600.), OVERLAY, &[PRINCIPAL]));
        // Solo asoman 20: no hay de donde agarrarla.
        assert!(!a_la_vista((1900., 600.), OVERLAY, &[PRINCIPAL]));
    }

    #[test]
    fn caida_bajo_la_barra_de_tareas() {
        // El area util acaba en 1032; a 1010 solo asoman 22 px de alto.
        assert!(!a_la_vista((800., 1010.), OVERLAY, &[PRINCIPAL]));
        assert!(a_la_vista((800., 950.), OVERLAY, &[PRINCIPAL]));
    }

    #[test]
    fn sin_monitores_no_se_toca_nada() {
        // Si el sistema no sabe decir que pantallas hay, se respeta lo que
        // el usuario dejo: recolocar a ciegas seria peor.
        assert!(a_la_vista((-5000., -5000.), OVERLAY, &[]));
    }
}
