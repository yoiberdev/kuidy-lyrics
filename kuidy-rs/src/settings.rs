//! El popover de ajustes: una ventanita aparte para tocar lo que se ve.
//!
//! Ventana propia y no un panel dentro del overlay porque el overlay tiene
//! que poder ser diminuto y dejar pasar los clics; meterle ajustes dentro
//! obligaria a agrandarlo justo cuando estorba.
//!
//! Los ajustes se agrupan por lo que el usuario quiere conseguir, no por el
//! tipo de control que usan. "Opacidad" y "Solo subtitulos" viven juntos
//! porque las dos responden a "como se ve", aunque una sea un deslizador y
//! la otra un interruptor.

use chaika::prelude::*;
use chaika::widgets::{self, Palette, slider, switch_row};

use crate::prefs::Prefs;

/// El tinte que va **encima** del acrilico, no un fondo opaco.
///
/// El difuminado lo compone el escritorio por detras; lo que pinta la app es
/// una capa oscura con alfa que le da color y hace legible el texto. Con un
/// color opaco aqui el acrilico no se veria en absoluto.
const BG: Color = Color::rgba8(18, 18, 26, 170);
const CARD: Color = Color::hex(0x1e1e28);
const MUTED: Color = Color::hex(0x8a8a9a);
const LABEL: Color = Color::rgba8(220, 220, 232, 255);

/// La escala de espaciado. Todo lo que separa sale de aqui, y cada paso es
/// visiblemente distinto del anterior: con una escala de 2 en 2 nadie
/// distingue los niveles y el resultado es una sopa.
const HUECO_APRETADO: f32 = 6.;
const HUECO: f32 = 12.;
const HUECO_ANCHO: f32 = 18.;

/// El alto de la ventana.
///
/// Esta MEDIDO, no estimado: se abrio la ventana con un alto de sobra y se
/// miro en la captura donde acaba de verdad el contenido. Estimarlo fue lo
/// que dejo la version anterior comiendose seis pixeles del margen de
/// abajo. Si se anade un ajuste, hay que volver a medir.
const ALTO: f32 = 738.;

/// Abre el popover, o lo trae al frente si ya estaba.
pub fn open(prefs: Prefs, abierto: Signal<Option<WindowToken>>) {
    // Abrir los ajustes devuelve los clics al overlay, siempre.
    //
    // Es la salvaguarda que el kuidy de Electron escribio despues de que
    // alguien se quedara encerrado: con los clics atravesando y el panel
    // quitado, el overlay no se puede ni agarrar ni pulsar, y si ademas
    // fallo el registro del atajo no queda ninguna salida. Si el usuario
    // vino a los ajustes, es que quiere tocar algo.
    if prefs.click_through.get_untracked() {
        log::info!("ajustes abiertos: se devuelven los clics al overlay");
        prefs.click_through.set(false);
    }

    if let Some(token) = abierto.get_untracked() {
        if let Some(window) = app::window(token) {
            window.focus();
            return;
        }
    }

    widgets::set_palette(Palette {
        accent: Color::hex(0x5b8cff),
        accent_hover: Color::hex(0x7aa2ff),
        surface: Color::hex(0x2e2e3a),
        border: Color::hex(0x44444f),
        ..Palette::default()
    });

    let options = AppOptions {
        window: WindowOptions {
            title: "kuidy — ajustes".into(),
            // El de 16 para la barra de titulo y el de 64 para la barra de
            // tareas: reducir el grande a 16 lo dejaba borroso (chaika#8).
            icon: Some(crate::tray_icon()),
            icon_large: Some(crate::window_icon()),
            size: size(px(360.), px(ALTO)),
            // Sin barra de titulo y con acrilico: el escritorio difumina lo
            // que hay detras, que es lo que hace que un panel flotante no
            // parezca una ventana mas. Para que se vea hay que dejarle sitio:
            // `transparent` y un fondo con alfa, no un color opaco encima.
            transparent: true,
            decorations: false,
            backdrop: Backdrop::Acrylic,
            corner: Corner::Round,
            resizable: false,
            skip_taskbar: true,
            // Por encima, como los flotantes del sistema. Sin esto se abre
            // detras de lo que tengas delante y parece que no se abrio; y
            // como ademas nunca llega a tener el foco, tampoco se cierra
            // sola. Un flotante que no se ve ni se va es lo peor de los dos
            // mundos.
            always_on_top: true,
            ..Default::default()
        },
        background: BG,
        escape_closes: true,
    };

    // La colocacion va **dentro** del constructor: `app::open` encola la
    // creacion, asi que justo despues de llamarla la ventana todavia no
    // existe y `app::window` devuelve `None`. Es el mismo sitio donde el
    // overlay se coloca a si mismo.
    let token = app::open(options, move |token| {
        colocar_junto_a_la_bandeja(token);
        view(prefs, token)
    });
    abierto.set(Some(token));
}

fn view(prefs: Prefs, token: WindowToken) -> Element {
    div()
        .size_full()
        .flex_col()
        // Entre grupos se separa mas que dentro de un grupo: es lo que hace
        // que se lean como grupos y no como una lista larga.
        .gap(px(HUECO_ANCHO))
        .p(px(HUECO_ANCHO))
        .family("Segoe UI, sans-serif")
        .child(
            text("Ajustes")
                .text_size(px(20.))
                .weight(FontWeight::BOLD)
                .color(Color::WHITE),
        )
        .child(grupo(
            "COMO SE VE",
            div()
                .flex_col()
                .gap(px(HUECO))
                // Las dos en porcentaje: antes una decia "95%" y la de al
                // lado "1.20x", y no hay forma de comparar eso de un vistazo.
                .child(regulador("Opacidad", prefs.opacity, 0.4..=1.0))
                .child(regulador("Tamano de letra", prefs.font_scale, 0.8..=1.6))
                .child(switch_row("Solo subtitulos", prefs.minimal))
                .child(nota(
                    "Sin panel ni cabecera: la letra sola, sobre el escritorio.",
                )),
        ))
        .child(grupo(
            "LA LINEA DE ABAJO",
            div()
                .flex_col()
                .gap(px(HUECO_APRETADO))
                .child(switch_row("Ensenarla", prefs.show_subs))
                .child(switch_row("Traducir la letra", prefs.translation_allowed))
                .child(nota(
                    "Traducir manda el texto de la letra a Google. El romaji \
                     del japones no: ese se calcula aqui.",
                )),
        ))
        .child(grupo(
            "COMO ESTORBA",
            div()
                .flex_col()
                .gap(px(HUECO_APRETADO))
                .child(switch_row("Dejar pasar los clics", prefs.click_through))
                .child(nota(
                    "Con esto puesto, el overlay deja de poder arrastrarse. \
                     Se apaga solo al abrir estos ajustes.",
                )),
        ))
        .child(
            div()
                .flex_col()
                .gap(px(2.))
                .child(atajo("Ctrl+Alt+H", "mostrar u ocultar las letras"))
                .child(atajo("Ctrl+Alt+J", "abrir estos ajustes"))
                .child(atajo("Ctrl+Alt+M", "dejar solo los subtitulos")),
        )
        // Sin estirador: el contenido tiene una altura natural y la ventana
        // se hace a esa medida. Con un `flex_1` aqui, el contenido llenaba
        // la ventana fuera cual fuera su alto y no habia forma de saber
        // cuanto necesitaba de verdad.
        .child(
            div()
                .flex_row()
                .justify_center()
                .child(boton("Cerrar", move |_| app::close(token))),
        )
}

/// Una tarjeta con su titulo.
fn grupo(titulo: &'static str, contenido: Element) -> Element {
    div()
        .flex_col()
        .gap(px(HUECO))
        .p(px(HUECO))
        .rounded(px(12.))
        .bg(CARD)
        .child(
            text(titulo)
                .text_size(px(11.))
                .weight(FontWeight::SEMI_BOLD)
                .color(MUTED),
        )
        .child(contenido)
}

/// Una explicacion pequena bajo un control, para lo que no se adivina.
fn nota(texto: &'static str) -> Element {
    text(texto).text_size(px(11.)).color(MUTED)
}

/// Una linea de la chuleta de atajos.
fn atajo(teclas: &'static str, que: &'static str) -> Element {
    div()
        .flex_row()
        .gap(px(HUECO_APRETADO))
        .child(
            text(teclas)
                .text_size(px(11.))
                .weight(FontWeight::SEMI_BOLD)
                .color(MUTED),
        )
        .child(text(que).text_size(px(11.)).color(MUTED))
}

/// Un boton que se puede pulsar y al que se llega con el tabulador.
fn boton(etiqueta: &'static str, al_pulsar: impl Fn(&ClickEvent) + 'static) -> Element {
    div()
        .px(px(16.))
        .py(px(8.))
        .rounded(px(8.))
        .bg(CARD)
        .border(px(1.), Color::TRANSPARENT)
        .cursor(CursorIcon::Pointer)
        // Se llega con el tabulador y se ve cuando se llega: antes era el
        // unico control de la ventana al que no se podia llegar sin raton,
        // mientras los interruptores de al lado si.
        .focusable()
        .hover(|s| s.background = Some(Color::hex(0x2a2a36)))
        .focus(|s| s.border_color = Some(Color::hex(0x5b8cff)))
        .transition(ms(120))
        .on_click(al_pulsar)
        .child(text(etiqueta).text_size(px(13.)).color(Color::WHITE))
}

/// Una fila con su etiqueta, el deslizador y el valor actual en porcentaje.
fn regulador(
    etiqueta: &'static str,
    valor: Signal<f32>,
    rango: std::ops::RangeInclusive<f32>,
) -> Element {
    div()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .flex_row()
                .justify_between()
                .child(text(etiqueta).text_size(px(15.)).color(LABEL))
                .child(
                    text(derive(move || format!("{:.0}%", valor.get() * 100.0)))
                        .text_size(px(13.))
                        .color(MUTED),
                ),
        )
        .child(slider(valor, rango).w_full())
}

/// Coloca el panel donde Windows pone sus propios flotantes: pegado a la
/// esquina de la bandeja, sobre la barra de tareas.
///
/// No se pregunta donde esta el icono --- la bandeja no lo cuenta --- sino
/// donde acaba el area util, que es justo por encima de la barra. Es lo que
/// hacen el panel de volumen y el de red, y cae bien tenga la barra donde la
/// tenga: si esta arriba, el area util empieza mas abajo y el panel tambien.
fn colocar_junto_a_la_bandeja(token: WindowToken) {
    let Some(w) = app::window(token) else { return };
    let Some(monitor) = w.primary_monitor() else {
        return;
    };
    let area = monitor.work_area;
    let tam = size(px(360.), px(ALTO));
    // Un dedo de margen con el borde, como los flotantes del sistema.
    let margen = px(12.);
    let x = area.origin.x + area.size.width - tam.width - margen;
    let y = area.origin.y + area.size.height - tam.height - margen;
    w.set_position(point(x, y));
    // Y que tome el foco: un flotante que se cierra al perderlo y nace sin el
    // se cierra solo antes de que nadie lo vea.
    w.focus();
}

/// Se cierra al hacer clic fuera, como cualquier flotante.
///
/// Es lo que lo distingue de una ventana: no se queda ahi ocupando sitio.
///
/// **No registra su propio manejador**: `app::on_window_event` guarda uno
/// solo y el segundo pisa al primero sin avisar. Lo llama el unico manejador
/// que hay, en `main`.
pub fn al_perder_el_foco(token: WindowToken, abierto: Signal<Option<WindowToken>>) {
    if abierto.get_untracked() == Some(token) {
        app::close(token);
        abierto.set(None);
    }
}
