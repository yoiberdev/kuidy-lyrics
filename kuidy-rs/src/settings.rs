//! El popover de ajustes: una ventanita aparte para tocar lo que se ve.
//!
//! Ventana propia y no un panel dentro del overlay porque el overlay tiene
//! que poder ser diminuto y dejar pasar los clics; meterle ajustes dentro
//! obligaria a agrandarlo justo cuando estorba.

use chaika::prelude::*;
use chaika::widgets::{self, Palette, slider, switch_row};

use crate::prefs::Prefs;

const BG: Color = Color::hex(0x14141c);
const CARD: Color = Color::hex(0x1e1e28);
const MUTED: Color = Color::hex(0x8a8a9a);

/// Abre el popover, o lo trae al frente si ya estaba.
pub fn open(prefs: Prefs, abierto: Signal<Option<WindowToken>>) {
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
            icon: Some(crate::window_icon()),
            size: size(px(340.), px(430.)),
            transparent: false,
            decorations: true,
            resizable: false,
            skip_taskbar: false,
            ..Default::default()
        },
        background: BG,
        escape_closes: true,
    };

    let token = app::open(options, move |token| view(prefs, token));
    abierto.set(Some(token));
}

fn view(prefs: Prefs, token: WindowToken) -> Element {
    div()
        .size_full()
        .flex_col()
        .gap(px(14.))
        .p(px(18.))
        .family("Segoe UI, sans-serif")
        .child(
            text("Ajustes")
                .text_size(px(20.))
                .weight(FontWeight::BOLD)
                .color(Color::WHITE),
        )
        .child(grupo(
            "APARIENCIA",
            div()
                .flex_col()
                .gap(px(14.))
                .child(regulador(
                    "Opacidad",
                    prefs.opacity,
                    0.4..=1.0,
                    |v| format!("{:.0}%", v * 100.0),
                ))
                .child(regulador(
                    "Tamano de letra",
                    prefs.font_scale,
                    0.8..=1.6,
                    |v| format!("{v:.2}x"),
                )),
        ))
        .child(grupo(
            "COMPORTAMIENTO",
            div()
                .flex_col()
                .gap(px(12.))
                .child(switch_row("Ensenar la linea de abajo", prefs.show_subs))
                .child(switch_row("Traducir la letra", prefs.translation_allowed))
                .child(switch_row("Dejar pasar los clics", prefs.click_through)),
        ))
        .child(
            text("Ctrl+Alt+H muestra u oculta las letras")
                .text_size(px(11.))
                .color(MUTED),
        )
        .child(
            div()
                .flex_1()
                .justify_center()
                .items_center()
                .child(
                    div()
                        .px(px(16.))
                        .py(px(8.))
                        .rounded(px(8.))
                        .bg(CARD)
                        .cursor(CursorIcon::Pointer)
                        .hover(|s| s.background = Some(Color::hex(0x2a2a36)))
                        .transition(ms(120))
                        .on_click(move |_| app::close(token))
                        .child(text("Cerrar").text_size(px(13.)).color(Color::WHITE)),
                ),
        )
}

fn grupo(titulo: &'static str, contenido: Element) -> Element {
    div()
        .flex_col()
        .gap(px(10.))
        .p(px(14.))
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

/// Una fila con su etiqueta, el deslizador y el valor actual.
fn regulador(
    etiqueta: &'static str,
    valor: Signal<f32>,
    rango: std::ops::RangeInclusive<f32>,
    formato: fn(f32) -> String,
) -> Element {
    div()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .flex_row()
                .justify_between()
                .child(text(etiqueta).text_size(px(13.)).color(Color::rgba8(220, 220, 232, 255)))
                .child(
                    text(derive(move || formato(valor.get())))
                        .text_size(px(13.))
                        .color(MUTED),
                ),
        )
        .child(slider(valor, rango).w_full())
}
