//! El overlay: la ventana sin marco que ensena la letra sobre el escritorio.
//!
//! Es la vista que manda de kuidy. La linea que suena va grande y blanca en
//! el centro, las de alrededor se apagan con la distancia, y la lista se
//! mueve sola para dejar la actual en medio.

use chaika::prelude::*;

use crate::lyrics::Lyrics;
use crate::playback::Playback;

const FONDO: Color = Color::rgba8(10, 10, 14, 200);


/// Cuanto se apaga una linea por cada linea de distancia a la actual.
const DESVANECIDO: f32 = 0.22;

pub struct Overlay {
    pub playback: Playback,
    pub lyrics: Signal<Lyrics>,
}

impl Overlay {
    pub fn view(&self) -> Element {
        let Overlay { playback, lyrics } = self;
        let (playback, lyrics) = (playback.clone(), *lyrics);
        let position = playback.position;

        // Que linea suena, como senal derivada: la lista y la cabecera la
        // leen, y solo se repinta cuando cambia de verdad.
        let actual = Memo::new(move || lyrics.with(|l| l.line_at(position.get())));

        let lista = ScrollHandle::new();
        let seguir = lista.clone();
        Effect::new(move || {
            if let Some(i) = actual.get() {
                seguir.to_index(i, ScrollAlign::Center);
            }
        });

        div()
            .size_full()
            .flex_col()
            .rounded(px(14.))
            .bg(FONDO)
            .family("Segoe UI, sans-serif")
            // Sin barra de titulo: se arrastra por donde sea.
            .drag_window()
            .child(cabecera(&playback))
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
                    .children_for(
                        move || lyrics.with(|l| (0..l.lines.len()).collect::<Vec<_>>()),
                        |i: &usize| *i,
                        move |i| linea(*i, lyrics, actual),
                    ),
            )
            // Los bordes se desvanecen para que las lineas no aparezcan
            // cortadas: dos degradados del color del fondo a nada, encima de
            // la lista y sin estorbar al puntero.
            .child(velo(true))
            .child(velo(false))
    }
}

/// El desvanecido de arriba o de abajo.
fn velo(arriba: bool) -> Element {
    let transparente = Color::rgba(FONDO.r, FONDO.g, FONDO.b, 0.0);
    let (from, to) = if arriba { (FONDO, transparente) } else { (transparente, FONDO) };
    let mut v = div()
        .absolute()
        .left(px(0.))
        .w_full()
        .h(px(56.))
        .pointer_none()
        .gradient(Gradient::vertical(from, to));
    v = if arriba { v.top(px(52.)) } else { v.bottom(px(0.)) };
    v
}

/// Titulo y artista de lo que suena.
fn cabecera(playback: &Playback) -> Element {
    let track = playback.track;
    let playing = playback.playing;
    div()
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

/// Una linea de la letra. Se apaga y encoge segun lo lejos que este de la
/// que suena.
fn linea(index: usize, lyrics: Signal<Lyrics>, actual: Memo<Option<usize>>) -> Element {
    let es_actual = move || actual.get() == Some(index);
    let distancia = move || match actual.get() {
        Some(a) => a.abs_diff(index),
        None => index,
    };

    text(derive(move || {
        lyrics.with(|l| l.lines.get(index).map_or(String::new(), |x| x.shown().to_string()))
    }))
    .text_size(derive(move || if es_actual() { px(19.) } else { px(14.) }))
    .weight(derive(move || {
        if es_actual() { FontWeight::BOLD } else { FontWeight::NORMAL }
    }))
    .color(derive(move || {
        if es_actual() {
            Color::WHITE
        } else {
            let alpha = (0.7 - distancia() as f32 * DESVANECIDO).max(0.12);
            Color::rgba(1.0, 1.0, 1.0, alpha)
        }
    }))
    .flex_none()
}

