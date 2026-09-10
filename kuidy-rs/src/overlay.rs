//! El overlay: la ventana sin marco que ensena la letra sobre el escritorio.
//!
//! Es la vista que manda de kuidy. La linea que suena va grande y blanca en
//! el centro, las de alrededor se apagan con la distancia, y la lista se
//! mueve sola para dejar la actual en medio.

use chaika::prelude::*;

use crate::fetch::State;
use crate::playback::Playback;
use crate::prefs::Prefs;

const FONDO: Color = Color::rgba8(10, 10, 14, 200);


/// Cuanto se apaga una linea por cada linea de distancia a la actual.
const DESVANECIDO: f32 = 0.22;

pub struct Overlay {
    pub playback: Playback,
    pub lyrics: Signal<State>,
    pub prefs: Prefs,
}

impl Overlay {
    pub fn view(&self) -> Element {
        let Overlay { playback, lyrics, prefs } = self;
        let (playback, lyrics, prefs) = (playback.clone(), *lyrics, *prefs);
        let position = playback.position;

        // Que linea suena, como senal derivada: la lista y la cabecera la
        // leen, y solo se repinta cuando cambia de verdad.
        let actual = Memo::new(move || {
            lyrics.with(|s| s.lyrics().and_then(|l| l.line_at(position.get())))
        });
        // Cuantas lineas hay que pintar, y si hay algo que decir en su lugar.
        let cuantas = Memo::new(move || lyrics.with(|s| s.lyrics().map_or(0, |l| l.lines.len())));
        let aviso = Memo::new(move || lyrics.with(|s| s.message().to_string()));

        let lista = ScrollHandle::new();
        let seguir = lista.clone();
        Effect::new(move || {
            if let Some(i) = actual.get() {
                seguir.to_index(i, ScrollAlign::Center);
            }
        });

        let minimal = prefs.minimal;
        div()
            .size_full()
            .flex_col()
            .rounded(px(14.))
            // La opacidad del ajuste se aplica al fondo, no a todo: el texto
            // tiene que seguir leyendose sobre cualquier escritorio.
            //
            // En "solo subtitulos" no hay fondo ninguno: la letra flota sobre
            // lo que haya, y de eso se encarga el contorno de abajo.
            .bg(derive(move || {
                if minimal.get() {
                    FONDO.with_alpha(0.)
                } else {
                    FONDO.with_alpha(FONDO.a * prefs.opacity.get())
                }
            }))
            // Sin panel detras, el texto se apoya en el escritorio, que puede
            // ser de cualquier color. Sin contorno no hay color de letra que
            // sirva para todos.
            // Un pixel basta y sobra: con mas, el contorno se come la letra
            // pequena de la traduccion, que es la que menos margen tiene.
            .text_outline(derive(move || {
                TextOutline::new(
                    if minimal.get() { px(1.) } else { px(0.) },
                    Color::rgba8(0, 0, 0, if minimal.get() { 190 } else { 0 }),
                )
            }))
            .family("Segoe UI, sans-serif")
            // Sin barra de titulo: se arrastra por donde sea.
            .drag_window()
            .child(cabecera(&playback, minimal))
            .child(
                div()
                    .flex_1()
                    // APANO(chaika#2): sin esto el contenedor crece hasta el
                    // tamano de su contenido (609px en una ventana de 320) y
                    // no queda nada que desplazar.
                    .min_h(px(0.))
                    .w_full()
                    // APANO(chaika#3): `overflow_scroll` dibuja siempre su
                    // barra, y en un overlay sobra. `overflow_clip` no la
                    // dibuja y el ScrollHandle sigue moviendolo igual.
                    .overflow_clip()
                    .scroll_handle(lista)
                    .flex_col()
                    .items_center()
                    .px(px(16.))
                    .py(px(60.))
                    .gap(px(10.))
                    // APANO(chaika#4): una sola fuente de hijos. Llamar dos
                    // veces a `children_for` no anade: la segunda pisa a la
                    // primera sin avisar, y la lista se queda vacia.
                    .children_for(
                        move || match cuantas.get() {
                            0 => vec![Fila::Aviso(aviso.get())],
                            n => (0..n).map(Fila::Linea).collect(),
                        },
                        Fila::clave,
                        move |fila| match fila {
                            Fila::Linea(i) => linea(*i, lyrics, actual, prefs),
                            // El aviso ocupa el hueco y se centra el solo.
                            // Centrar el contenedor entero (`justify_center`)
                            // dejaria las primeras lineas por encima del
                            // borde, donde el scroll no llega. Ver chaika#5.
                            Fila::Aviso(m) => div()
                                .flex_1()
                                .w_full()
                                .items_center()
                                .justify_center()
                                .child(
                                    text(m.clone())
                                        .text_size(px(13.))
                                        .color(Color::rgba8(255, 255, 255, 150)),
                                ),
                        },
                    ),
            )
            // Los bordes se desvanecen para que las lineas no aparezcan
            // cortadas: dos degradados del color del fondo a nada, encima de
            // la lista y sin estorbar al puntero.
            .child(velo(true, minimal))
            .child(velo(false, minimal))
    }
}

/// El desvanecido de arriba o de abajo.
///
/// En "solo subtitulos" desaparece: es del color del panel, y sin panel se
/// veria como dos bandas oscuras flotando sobre el escritorio.
fn velo(arriba: bool, minimal: Signal<bool>) -> Element {
    let transparente = Color::rgba(FONDO.r, FONDO.g, FONDO.b, 0.0);
    let (from, to) = if arriba { (FONDO, transparente) } else { (transparente, FONDO) };
    let mut v = div()
        .absolute()
        .left(px(0.))
        .w_full()
        .h(px(56.))
        .pointer_none()
        .gradient(derive(move || {
            if minimal.get() {
                Gradient::vertical(transparente, transparente)
            } else {
                Gradient::vertical(from, to)
            }
        }));
    v = if arriba { v.top(derive(move || if minimal.get() { px(0.) } else { px(52.) })) } else { v.bottom(px(0.)) };
    v
}

/// Titulo y artista de lo que suena.
fn cabecera(playback: &Playback, minimal: Signal<bool>) -> Element {
    let track = playback.track;
    let playing = playback.playing;
    div()
        // En "solo subtitulos" no hay cabecera: el titulo y el artista los
        // sabe el usuario, que para eso los esta escuchando.
        .visible(derive(move || !minimal.get()))
        .w_full()
        .flex_row()
        .items_center()
        .gap(px(8.))
        .px(px(14.))
        .py(px(10.))
        .child(
            div()
                .flex_1()
                .flex_col()
                .child(
                    text(derive(move || {
                        track.with(|t| t.as_ref().map_or("Nada sonando".into(), |t| t.name.clone()))
                    }))
                    .text_size(px(12.))
                    .weight(FontWeight::SEMI_BOLD)
                    .color(Color::rgba8(255, 255, 255, 230)),
                )
                .child(
                    text(derive(move || {
                        track.with(|t| t.as_ref().map_or(String::new(), |t| t.artists_line()))
                    }))
                    .text_size(px(11.))
                    .color(Color::rgba8(255, 255, 255, 115)),
                ),
        )
        .child(
            // APANO(chaika#1): derive de un literal da Prop<&str>, que no
            // convierte a Prop<String>; hay que pasar por String a mano.
            text(derive(move || {
                if playing.get() { String::new() } else { "PAUSA".to_string() }
            }))
                .text_size(px(9.))
                .color(Color::rgba8(255, 255, 255, 180)),
        )
}

/// Lo que ocupa el cuerpo del overlay: las lineas de la letra, o el motivo
/// por el que no hay ninguna.
#[derive(Clone, Debug)]
enum Fila {
    Linea(usize),
    Aviso(String),
}

impl Fila {
    fn clave(&self) -> String {
        match self {
            Fila::Linea(i) => format!("l{i}"),
            Fila::Aviso(m) => format!("a{m}"),
        }
    }
}

/// Una linea de la letra. Se apaga y encoge segun lo lejos que este de la
/// que suena.
fn linea(
    index: usize,
    lyrics: Signal<State>,
    actual: Memo<Option<usize>>,
    prefs: Prefs,
) -> Element {
    let es_actual = move || actual.get() == Some(index);
    let distancia = move || match actual.get() {
        Some(a) => a.abs_diff(index),
        None => index,
    };

    let opacidad = move || {
        if es_actual() { 1.0 } else { (0.7 - distancia() as f32 * DESVANECIDO).max(0.12) }
    };
    let con = move |f: fn(&crate::lyrics::Line) -> String| {
        derive(move || {
            lyrics.with(|s| s.lyrics().and_then(|l| l.lines.get(index)).map_or(String::new(), &f))
        })
    };

    div()
        .flex_col()
        .items_center()
        .flex_none()
        .w_full()
        .child(
            text(con(|l| l.shown().to_string()))
                .text_size(derive(move || {
                    let base = if es_actual() { 19. } else { 14. };
                    px(base * prefs.font_scale.get())
                }))
                .weight(derive(move || {
                    if es_actual() { FontWeight::BOLD } else { FontWeight::NORMAL }
                }))
                .color(derive(move || Color::rgba(1.0, 1.0, 1.0, opacidad()))),
        )
        // La traduccion, cuando la letra la trae: mas pequena y mas apagada,
        // para que se lea sin competir con el original.
        .child(
            text(derive(move || {
                if prefs.show_subs.get() {
                    lyrics.with(|s| {
                        s.lyrics()
                            .and_then(|l| l.lines.get(index))
                            .and_then(|l| l.translation.clone())
                            .unwrap_or_default()
                    })
                } else {
                    String::new()
                }
            }))
            .text_size(derive(move || {
                let base = if es_actual() { 13. } else { 11. };
                px(base * prefs.font_scale.get())
            }))
            .color(derive(move || Color::rgba(1.0, 1.0, 1.0, opacidad() * 0.6))),
        )
}

