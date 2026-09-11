//! Los avisos de terceros, dentro del binario.
//!
//! Kuidy se reparte como un `.exe` suelto, sin instalador y sin carpeta al
//! lado. Eso deja un problema: el diccionario japones que lleva dentro pide
//! que su aviso de copyright acompane a cualquier copia del programa, y la
//! clausula de ICOT Free Software que arrastra exige ademas que la seccion
//! "NO WARRANTY" **siempre** aparezca junto a lo que se distribuye.
//!
//! Un archivo en el repositorio no cumple eso para quien solo se baja el
//! ejecutable. Asi que el texto va empotrado aqui y se puede sacar desde el
//! menu de la bandeja: se escribe al lado de los ajustes y se abre con lo
//! que el sistema use para el texto plano.

use std::path::PathBuf;

/// Como se llama el archivo que se deja al usuario.
const ARCHIVO: &str = "avisos-de-terceros.txt";

/// La licencia del diccionario IPADIC, tal cual viene.
const IPADIC_COPYING: &str = include_str!("../assets/ipadic-COPYING.txt");

/// De donde salen los datos del diccionario.
const IPADIC_NOTICE: &str = include_str!("../assets/ipadic-NOTICE.txt");

/// El texto entero, ya montado.
fn texto() -> String {
    format!(
        "kuidy {version}
Avisos de terceros

kuidy se distribuye bajo la licencia MIT. Este programa incluye o usa el
software de terceros que se lista aqui. La lista completa, con versiones y
licencias de todas las dependencias, esta en:

  https://github.com/yoiberdev/kuidy-lyrics/blob/main/THIRD-PARTY-NOTICES.md

================================================================
Diccionario japones IPADIC
================================================================

kuidy lleva dentro una version recortada del diccionario IPADIC, que es lo
que le permite leer el japones en romaji sin conexion. Su licencia obliga a
que este aviso acompane a cualquier copia del programa.

{IPADIC_COPYING}
----------------------------------------------------------------
{IPADIC_NOTICE}
================================================================
chaika
================================================================

La interfaz esta hecha con chaika (MIT OR Apache-2.0), un toolkit propio:
https://github.com/yoiberdev/chaika

================================================================
Servicios que se consultan
================================================================

lrclib.net  -- las letras. Sin clave y sin cuenta.
              https://lrclib.net

Google Translate -- solo si enciendes la traduccion, y se pregunta antes.
              El romaji NO pasa por aqui: se hace en tu equipo.
",
        version = env!("CARGO_PKG_VERSION"),
    )
}

/// Escribe los avisos al lado de los ajustes y los abre.
pub fn abrir() {
    match escribir() {
        Ok(ruta) => {
            log::info!("avisos de terceros en {}", ruta.display());
            if let Err(e) = chaika::app::open_url(&ruta.to_string_lossy()) {
                log::warn!("no se pudieron abrir los avisos: {e}");
            }
        }
        Err(e) => log::warn!("no se pudieron escribir los avisos: {e}"),
    }
}

fn escribir() -> std::io::Result<PathBuf> {
    let dir = crate::store::dir()?;
    let ruta = dir.join(ARCHIVO);
    // Se reescribe siempre: asi una version nueva no deja el aviso viejo.
    std::fs::write(&ruta, texto())?;
    Ok(ruta)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lo que la licencia de IPADIC exige que aparezca, aparece.
    ///
    /// No es una formalidad: la clausula de ICOT dice que la seccion
    /// "NO WARRANTY" tiene que ir SIEMPRE con el programa, y kuidy se
    /// reparte como un ejecutable suelto.
    #[test]
    fn los_avisos_llevan_lo_que_la_licencia_obliga() {
        let t = texto();
        assert!(
            t.contains("Nara Institute of Science"),
            "falta el aviso de copyright de NAIST"
        );
        assert!(t.contains("LegalOn Technologies"), "falta el otro titular");
        assert!(t.contains("NO WARRANTY"), "falta la seccion que ICOT exige");
        assert!(t.contains("ICOT Free Software"), "falta la mencion a ICOT");
        assert!(t.contains("BCCWJ"), "falta de donde salen los datos remapeados");
    }

    #[test]
    fn los_avisos_dicen_de_que_version_son() {
        assert!(texto().contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn queda_claro_que_el_romaji_no_sale_de_la_maquina() {
        let t = texto();
        assert!(t.contains("se hace en tu equipo"));
    }
}
