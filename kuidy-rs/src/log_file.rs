//! El log a disco.
//!
//! Es la unica traza que deja la app cuando no se arranca desde una
//! terminal, que es como la va a usar todo el mundo. Cuando alguien reporte
//! que "no salen las letras", este archivo es lo primero que hay que pedir.
//!
//! Va a `%APPDATA%\kuidy-rs\logs\main.log`, con el mismo nombre y formato
//! que el de la version de Electron para poder leerlos igual.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use log::{Log, Metadata, Record};

/// Al pasarse, `main.log` pasa a `main.log.1` y se empieza de cero. Medio
/// mega es de sobra para ver que paso y poco para mandarlo por ahi.
const MAX_BYTES: u64 = 512 * 1024;

/// La carpeta de los logs.
pub fn dir() -> Option<PathBuf> {
    let dir = crate::store::dir().ok()?.join("logs");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn path() -> Option<PathBuf> {
    Some(dir()?.join("main.log"))
}

/// Escribe a la vez en la terminal y en el archivo.
///
/// El filtrado lo sigue haciendo `env_logger`, asi que `RUST_LOG` funciona
/// igual que siempre.
struct Dual {
    terminal: env_logger::Logger,
    file: Mutex<Option<File>>,
}

impl Log for Dual {
    fn enabled(&self, metadata: &Metadata) -> bool {
        self.terminal.enabled(metadata)
    }

    fn log(&self, record: &Record) {
        if !self.terminal.enabled(record.metadata()) {
            return;
        }
        self.terminal.log(record);

        let Ok(mut file) = self.file.lock() else { return };
        let Some(file) = file.as_mut() else { return };
        let line = format!(
            "{} {:<5} [{}] {}\n",
            timestamp(),
            record.level(),
            record.target(),
            redact(&record.args().to_string())
        );
        // Perder una linea de log nunca debe tumbar la app.
        let _ = file.write_all(line.as_bytes());
    }

    fn flush(&self) {
        self.terminal.flush();
        if let Ok(mut file) = self.file.lock() {
            if let Some(file) = file.as_mut() {
                let _ = file.flush();
            }
        }
    }
}

/// La fecha y la hora en ISO-8601 y UTC, como el log de la version de
/// Electron, sin arrastrar una biblioteca de fechas para esto.
///
/// UTC y no la hora local a proposito: un log que cruza husos horarios o un
/// cambio de hora se ordena mal, y quien lo lee suele estar en otro sitio
/// que quien lo genero.
fn timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let (hh, mm, ss) = (secs / 3600 % 24, secs / 60 % 60, secs % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{:03}Z", now.subsec_millis())
}

/// Dias desde 1970 a fecha del calendario.
///
/// Es el algoritmo de Howard Hinnant: mueve el ano para que empiece en marzo,
/// con lo que el dia bisiesto cae al final y desaparecen los casos
/// especiales de febrero.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Tapa lo que no puede salir de esta maquina.
///
/// Un log lo manda un tester por chat sin mirarlo; si dentro va su token de
/// Spotify, le acabamos de regalar la cuenta a quien lo lea.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    // Las claves que preceden a un secreto. Se corta desde el separador
    // hasta el primer espacio o comilla.
    const KEYS: [&str; 6] = [
        "access_token",
        "refresh_token",
        "code_verifier",
        "client_secret",
        "Bearer ",
        "code=",
    ];
    'fuera: while !rest.is_empty() {
        let mut mejor: Option<(usize, &str)> = None;
        for key in KEYS {
            if let Some(at) = rest.find(key) {
                if mejor.is_none_or(|(m, _)| at < m) {
                    mejor = Some((at, key));
                }
            }
        }
        let Some((at, key)) = mejor else { break 'fuera };
        out.push_str(&rest[..at + key.len()]);
        let after = &rest[at + key.len()..];
        // Saltar el separador (`=`, `:`, comillas, espacios) y el valor.
        let value_start = after
            .find(|c: char| !matches!(c, '=' | ':' | '"' | '\'' | ' '))
            .unwrap_or(after.len());
        out.push_str(&after[..value_start]);
        let value = &after[value_start..];
        let end = value
            .find(|c: char| !(c.is_ascii_alphanumeric() || "._~+/-".contains(c)))
            .unwrap_or(value.len());
        if end == 0 {
            rest = value;
            continue;
        }
        out.push_str("<redactado>");
        rest = &value[end..];
    }
    out.push_str(rest);
    out
}

/// Arranca el log: terminal siempre, archivo si se puede.
pub fn init() {
    let terminal = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .build();
    let level = terminal.filter();

    let file = path().and_then(|path| {
        rotate(&path);
        OpenOptions::new().create(true).append(true).open(&path).ok()
    });
    let tiene_archivo = file.is_some();

    let dual = Dual { terminal, file: Mutex::new(file) };
    if log::set_boxed_logger(Box::new(dual)).is_ok() {
        log::set_max_level(level);
    }

    if tiene_archivo {
        if let Some(dir) = dir() {
            log::info!("log en {}", dir.display());
        }
    } else {
        log::warn!("sin log a disco: no se pudo abrir el archivo");
    }
}

/// Si el archivo crecio demasiado, se guarda como `.1` y se empieza de cero.
/// Solo se conserva uno viejo: el interesante es siempre el ultimo.
fn rotate(path: &std::path::Path) {
    let Ok(meta) = std::fs::metadata(path) else { return };
    if meta.len() <= MAX_BYTES {
        return;
    }
    let _ = std::fs::rename(path, path.with_extension("log.1"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_tokens_no_salen_en_el_log() {
        let sucio = "guardando access_token=BQD123abc.-_~ y refresh_token: AQx999";
        let limpio = redact(sucio);
        assert!(!limpio.contains("BQD123abc"), "{limpio}");
        assert!(!limpio.contains("AQx999"), "{limpio}");
        assert!(limpio.contains("access_token"), "la clave si se ve: {limpio}");
        assert!(limpio.contains("<redactado>"));
    }

    #[test]
    fn la_cabecera_de_autorizacion_tampoco() {
        let limpio = redact("Authorization: Bearer BQC_muy_secreto123 fin");
        assert!(!limpio.contains("BQC_muy_secreto123"));
        assert!(limpio.contains("Bearer <redactado>"));
        assert!(limpio.ends_with(" fin"), "lo de despues se conserva: {limpio}");
    }

    #[test]
    fn el_codigo_de_la_vuelta_de_oauth_tampoco() {
        let limpio = redact("callback?code=AQABGACNvq8eSYewLujfVx&state=xyz");
        assert!(!limpio.contains("AQABGACNvq8eSYewLujfVx"));
        assert!(limpio.contains("state=xyz"), "lo que no es secreto se queda: {limpio}");
    }

    #[test]
    fn un_texto_sin_secretos_no_se_toca() {
        let normal = "sesion de Spotify recuperada; 56 lineas de letra";
        assert_eq!(redact(normal), normal);
    }

    #[test]
    fn el_sello_de_tiempo_es_una_fecha_de_verdad() {
        let t = timestamp();
        // 2026-09-08T22:46:49.526Z
        assert_eq!(t.len(), 24, "{t}");
        assert!(t.ends_with('Z') && t.contains('T'), "{t}");
        let anio: i32 = t[..4].parse().expect("los cuatro primeros son el ano");
        assert!(anio >= 2024, "el ano tiene que ser creible: {t}");
    }

    #[test]
    fn el_calendario_acierta_en_los_casos_que_duelen() {
        assert_eq!(civil_from_days(0), (1970, 1, 1), "el principio de los tiempos");
        assert_eq!(civil_from_days(59), (1970, 3, 1), "1970 no fue bisiesto");
        assert_eq!(civil_from_days(365), (1971, 1, 1));
        // 2000 fue bisiesto (divisible por 400) y 1900 no (por 100).
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(20_698), (2026, 9, 2));
    }
}
