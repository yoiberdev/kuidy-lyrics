//! Donde se guardan las credenciales y los ajustes.
//!
//! En la carpeta del usuario, no junto al binario: la app puede estar en
//! `Archivos de programa`, donde no se escribe. Los nombres son los mismos
//! que usa el kuidy de Electron para que las dos versiones puedan convivir
//! mientras dure el port, pero en su propia carpeta — compartir el archivo
//! de tokens entre dos apps que refrescan a la vez es pedir una carrera.

use std::io;
use std::path::PathBuf;

/// La carpeta de datos de la app, creada si no existe.
pub fn dir() -> io::Result<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| io::Error::other("sin carpeta de usuario"))?;
    let dir = base.join("kuidy-rs");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Lee un archivo de la carpeta de datos. `None` si no existe todavia, que
/// es lo normal la primera vez y no un error.
pub fn read(name: &str) -> Option<String> {
    let path = dir().ok()?.join(name);
    match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => {
            log::warn!("no se pudo leer {}: {e}", path.display());
            None
        }
    }
}

/// Escribe un archivo de la carpeta de datos.
///
/// Primero a un temporal y luego un renombrado: si la app muere a mitad, el
/// archivo viejo sigue entero en vez de quedarse a medias. Un archivo de
/// tokens truncado equivale a perder la sesion.
pub fn write(name: &str, contents: &str) -> io::Result<()> {
    let dir = dir()?;
    let temp = dir.join(format!("{name}.tmp"));
    std::fs::write(&temp, contents)?;
    std::fs::rename(&temp, dir.join(name))
}

/// Borra un archivo de la carpeta de datos. No se queja si no estaba.
///
/// Se quedo sin usuarios al dejar de guardarse la sesion de Spotify; sigue
/// aqui porque las pruebas tienen que recoger lo que ensucian.
#[cfg(test)]
fn remove(name: &str) {
    if let Ok(dir) = dir() {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escribir_y_leer_dan_la_vuelta() {
        let name = "prueba-kuidy.json";
        write(name, "{\"a\":1}").expect("escribir");
        assert_eq!(read(name).as_deref(), Some("{\"a\":1}"));
        remove(name);
        assert_eq!(read(name), None, "y borrado no queda rastro");
    }

    #[test]
    fn lo_que_no_existe_no_es_un_error() {
        assert_eq!(read("no-existe-de-verdad-kuidy.json"), None);
        remove("no-existe-de-verdad-kuidy.json");
    }
}
