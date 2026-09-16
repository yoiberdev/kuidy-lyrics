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

/// Lo que mide la cabecera con el panel entero.
///
/// Esta escrito y no medido porque el velo de arriba tiene que empezar justo
/// donde ella acaba, y los dos se encogen a la vez.
const ALTO_CABECERA: f32 = 52.;

/// Lo que tarda el panel en irse o en volver.
///
/// Corto y frenando al final: el usuario acaba de pulsar un atajo y quiere
/// ver el resultado, no una animacion. Pasados los 200ms deja de leerse como
/// respuesta y empieza a leerse como lentitud.
const PASO: Transition = Transition::ease_out(ms(160));

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
        // Cuanto panel hay: 1 es la ventana entera, 0 es la letra sola sobre
        // el escritorio.
        //
        // Va animado porque el cambio toca cuatro cosas a la vez -- fondo,
        // contorno, veladuras y cabecera -- y hacerlas saltar todas de golpe
        // se ve como un parpadeo. Cruzandolas, el panel se disuelve y deja la
        // letra donde ya estaba.
        let panel = Animated::new(if minimal.get_untracked() { 0.0_f32 } else { 1.0 }, PASO);
        let sigue = panel.clone();
        Effect::new(move || sigue.set(if minimal.get() { 0.0 } else { 1.0 }));
        let panel = panel.signal();

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
                FONDO.with_alpha(FONDO.a * prefs.opacity.get() * panel.get())
            }))
            // Sin panel detras, el texto se apoya en el escritorio, que puede
            // ser de cualquier color. Sin contorno no hay color de letra que
            // sirva para todos.
            // Un pixel basta y sobra: con mas, el contorno se come la letra
            // pequena de la traduccion, que es la que menos margen tiene.
            //
            // El ancho no se anima, solo el color: un contorno de medio pixel
            // no se dibuja a medias, se dibuja mal.
            .text_outline(derive(move || {
                let fuerza = 1.0 - panel.get();
                TextOutline::new(px(1.), Color::rgba8(0, 0, 0, (190.0 * fuerza) as u8))
            }))
            .family("Segoe UI, sans-serif")
            // Sin barra de titulo: se arrastra por donde sea.
            .drag_window()
            .child(cabecera(&playback, panel))
            .child(
                div()
                    .flex_1()
                    .w_full()
                    // Se desplaza pero sin barra: en un overlay sin marco
                    // sobre el escritorio, la barra se ve como una linea
                    // clara pegada al borde y no pinta nada.
                    .overflow_scroll_hidden()
                    .scroll_handle(lista)
                    .flex_col()
                    .items_center()
                    // Pocas lineas (o el aviso) van al centro; una letra
                    // entera empieza arriba. Es lo que hace `justify_center`
                    // en una caja con scroll desde chaika#5: antes dejaba
                    // las primeras lineas por encima del borde.
                    .justify_center()
                    .px(px(16.))
                    .py(px(60.))
                    .gap(px(10.))
                    // Una sola fuente de hijos, que es el contrato de chaika:
                    // un elemento admite **una** lista dinamica, y llamar dos
                    // veces a `children_for` protesta con un `debug_assert`.
                    // Los `.child()` fijos si sobreviven y van delante. Por eso
                    // el aviso y las lineas salen de la misma fuente, con un
                    // enum, en vez de dos listas.
                    .children_for(
                        move || match cuantas.get() {
                            0 => vec![Fila::Aviso(aviso.get())],
                            n => (0..n).map(Fila::Linea).collect(),
                        },
                        Fila::clave,
                        move |fila| match fila {
                            Fila::Linea(i) => linea(*i, lyrics, actual, prefs),
                            // El aviso lo centra la lista, como a cualquier
                            // otra fila.
                            Fila::Aviso(m) => text(m.clone())
                                .text_align(TextAlign::Center)
                                .text_size(px(13.))
                                .color(Color::rgba8(255, 255, 255, 150)),
                        },
                    ),
            )
            // Los bordes se desvanecen para que las lineas no aparezcan
            // cortadas: dos degradados del color del fondo a nada, encima de
            // la lista y sin estorbar al puntero.
            .child(velo(true, panel))
            .child(velo(false, panel))
    }
}

/// El desvanecido de arriba o de abajo.
///
/// En "solo subtitulos" desaparece: es del color del panel, y sin panel se
/// veria como dos bandas oscuras flotando sobre el escritorio. Se va con el
/// panel, no antes, para que no queden bandas sueltas a mitad del cruce.
fn velo(arriba: bool, panel: Signal<f32>) -> Element {
    let transparente = Color::rgba(FONDO.r, FONDO.g, FONDO.b, 0.0);
    let solido = move || FONDO.with_alpha(FONDO.a * panel.get());
    let mut v = div()
        .absolute()
        .left(px(0.))
        .w_full()
        .h(px(56.))
        .pointer_none()
        .gradient(derive(move || {
            if arriba {
                Gradient::vertical(solido(), transparente)
            } else {
                Gradient::vertical(transparente, solido())
            }
        }));
    // El de arriba sube hasta el borde segun se va la cabecera, en vez de
    // saltar los 52 pixeles que ocupaba.
    v = if arriba {
        v.top(derive(move || px(ALTO_CABECERA * panel.get())))
    } else {
        v.bottom(px(0.))
    };
    v
}

/// Titulo y artista de lo que suena.
fn cabecera(playback: &Playback, panel: Signal<f32>) -> Element {
    let track = playback.track;
    let playing = playback.playing;
    div()
        // En "solo subtitulos" no hay cabecera: el titulo y el artista los
        // sabe el usuario, que para eso los esta escuchando.
        //
        // Se apaga y se encoge a la vez. Lo segundo es lo que evita el salto:
        // una cabecera transparente seguiria ocupando sus pixeles, y la letra
        // daria un brinco hacia arriba justo al terminar el cruce, que es
        // precisamente el tiron que se queria quitar.
        .h(derive(move || px(ALTO_CABECERA * panel.get())))
        .overflow_clip()
        .opacity(derive(move || panel.get()))
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
            text(derive(move || if playing.get() { "" } else { "PAUSA" }))
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
                // Centrado dentro del propio texto, no solo la caja: un verso
                // largo envuelve en varias lineas, y sin esto la segunda se
                // pega a la izquierda mientras el bloque entero parece
                // centrado.
                .text_align(TextAlign::Center)
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
            .text_align(TextAlign::Center)
            .text_size(derive(move || {
                let base = if es_actual() { 13. } else { 11. };
                px(base * prefs.font_scale.get())
            }))
            .color(derive(move || Color::rgba(1.0, 1.0, 1.0, opacidad() * 0.6))),
        )
}

