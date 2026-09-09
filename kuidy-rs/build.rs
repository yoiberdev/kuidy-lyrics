//! Convierte la mascota a pixeles.
//!
//! El SVG de `assets/` es la fuente: se dibuja una vez y de ahi salen todos
//! los tamanos. Rasterizar aqui y no en la app tiene dos ventajas: `resvg`
//! es dependencia de build, asi que **no entra en el binario**, y el icono
//! no puede quedarse desfasado del dibujo, porque se rehace en cada
//! compilacion.

use std::path::PathBuf;

/// El dibujo completo, con degradado y mofletes.
const COMPLETO: &str = "assets/kuidy.svg";

/// El mismo bicho con los rasgos mas gordos y sin adornos. A 16 pixeles el
/// degradado y los mofletes se vuelven barro, asi que ese tamano se dibuja
/// aparte; es lo que hace cualquier juego de iconos decente.
const PEQUENO: &str = "assets/kuidy-16.svg";

/// Que icono se dibuja para cada sitio, y de que SVG sale.
///
/// La ventana usa 64 y no 256: en crudo son 16 KB en vez de 256 KB, y no
/// hay sitio donde el icono de una ventana se vea mas grande que eso.
const ICONOS: [(&str, u32, &str); 2] = [("bandeja", 16, PEQUENO), ("ventana", 64, COMPLETO)];

/// Lo que lleva el `.ico` del ejecutable: lo que Windows pide para la barra
/// de titulo, la barra de tareas, Alt+Tab y el explorador.
const ICO: [(u32, &str); 4] = [(16, PEQUENO), (32, COMPLETO), (48, COMPLETO), (256, COMPLETO)];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=assets");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));

    // En crudo y no en PNG: descomprimir en la app pediria un
    // descodificador, y 16x16 en crudo son 1 KB.
    for (destino, n, svg) in ICONOS {
        let rgba: Vec<u8> = dibujar(svg, n).pixels().iter().flat_map(demultiplicar).collect();
        std::fs::write(out.join(format!("{destino}.rgba")), rgba).expect("icono");
    }

    let ico = out.join("kuidy.ico");
    std::fs::write(&ico, empaquetar_ico()).expect("ico");
    if std::env::var("CARGO_CFG_WINDOWS").is_ok() {
        let mut recurso = winresource::WindowsResource::new();
        recurso.set_icon(ico.to_str().expect("ruta del ico"));
        // Si falla, se pierde el icono del ejecutable pero la app compila:
        // no vale la pena tumbar el build de alguien por esto.
        if let Err(e) = recurso.compile() {
            println!("cargo:warning=sin icono en el .exe: {e}");
        }
    }
}

/// Rasteriza un SVG a un cuadrado de `n` pixeles.
///
/// Se encuadra por donde cae la tinta y no por el viewBox: asi el dibujo
/// llena el icono en lugar de flotar dentro de un marco con aire, y
/// retocar el SVG no obliga a recentrar nada a mano.
fn dibujar(svg: &str, n: u32) -> tiny_skia::Pixmap {
    let datos = std::fs::read(svg).unwrap_or_else(|e| panic!("{svg}: {e}"));
    let arbol = usvg::Tree::from_data(&datos, &usvg::Options::default())
        .unwrap_or_else(|e| panic!("{svg} no se puede leer: {e}"));
    let caja = arbol.root().abs_layer_bounding_box();

    let mut lienzo = tiny_skia::Pixmap::new(n, n).expect("lienzo");
    // Un pelin de aire alrededor: pegado al borde, Windows lo recorta.
    let margen = n as f32 * 0.05;
    let escala = (n as f32 - margen * 2.0) / caja.width().max(caja.height());
    let dx = (n as f32 - caja.width() * escala) / 2.0 - caja.x() * escala;
    let dy = (n as f32 - caja.height() * escala) / 2.0 - caja.y() * escala;
    resvg::render(
        &arbol,
        tiny_skia::Transform::from_row(escala, 0.0, 0.0, escala, dx, dy),
        &mut lienzo.as_mut(),
    );
    lienzo
}

/// Monta el `.ico`: una cabecera, una entrada por tamano y los PNG detras.
///
/// Windows admite PNG dentro de un `.ico` desde Vista, asi que no hace
/// falta el BMP con su mascara al reves de toda la vida.
fn empaquetar_ico() -> Vec<u8> {
    let imagenes: Vec<Vec<u8>> =
        ICO.iter().map(|&(n, svg)| dibujar(svg, n).encode_png().expect("png")).collect();

    let mut out = Vec::new();
    out.extend([0, 0]); // reservado
    out.extend([1, 0]); // 1 = icono
    out.extend((ICO.len() as u16).to_le_bytes());
    // Las imagenes van detras de la cabecera y de todas las entradas.
    let mut offset = 6 + 16 * ICO.len() as u32;
    for (&(n, _), png) in ICO.iter().zip(&imagenes) {
        // 256 se escribe como 0: el campo es de un byte.
        let lado = if n == 256 { 0 } else { n as u8 };
        out.extend([lado, lado, 0, 0]);
        out.extend(1_u16.to_le_bytes()); // planos
        out.extend(32_u16.to_le_bytes()); // bits por pixel
        out.extend((png.len() as u32).to_le_bytes());
        out.extend(offset.to_le_bytes());
        offset += png.len() as u32;
    }
    for png in imagenes {
        out.extend(png);
    }
    out
}

/// tiny-skia guarda el color ya multiplicado por su alfa. Deshacerlo es lo
/// que separa un icono con los bordes limpios de uno con el halo negro.
fn demultiplicar(p: &tiny_skia::PremultipliedColorU8) -> [u8; 4] {
    let a = p.alpha();
    if a == 0 {
        return [0, 0, 0, 0];
    }
    let sube = |c: u8| ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8;
    [sube(p.red()), sube(p.green()), sube(p.blue()), a]
}
