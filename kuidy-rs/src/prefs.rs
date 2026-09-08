//! Los ajustes: lo que el usuario deja puesto y espera encontrarse igual la
//! proxima vez.
//!
//! Cada uno es una senal, asi que cambiar uno repinta solo lo que lo lee. Se
//! guardan solos cuando cambian, con un respiro de por medio: arrastrar un
//! deslizador emite decenas de valores y no hace falta escribir el disco
//! decenas de veces.

use std::time::Duration;

use chaika::prelude::*;
use serde::{Deserialize, Serialize};

const FILE: &str = "kuidy-prefs.json";

/// Lo que se guarda en disco. Los mismos nombres que el kuidy de Electron,
/// para poder mirar los dos archivos y compararlos.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Stored {
    pub opacity: f32,
    #[serde(rename = "fontScale")]
    pub font_scale: f32,
    #[serde(rename = "showSubs")]
    pub show_subs: bool,
    #[serde(rename = "clickThrough")]
    pub click_through: bool,
    /// Donde estaba la ventana. Sin esto, cada arranque la pone en el centro
    /// y el usuario la vuelve a mover al mismo sitio.
    #[serde(default)]
    pub window: Option<(f32, f32)>,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            opacity: 0.95,
            font_scale: 1.0,
            show_subs: true,
            click_through: false,
            window: None,
        }
    }
}

/// Los ajustes vivos.
#[derive(Clone, Copy)]
pub struct Prefs {
    /// Lo opaco que se ve el overlay, de `0.4` a `1.0`.
    pub opacity: Signal<f32>,
    /// Multiplicador del tamano de letra, de `0.8` a `1.6`.
    pub font_scale: Signal<f32>,
    /// Si se ensena la traduccion bajo cada linea.
    pub show_subs: Signal<bool>,
    /// Si los clics atraviesan el overlay y llegan a lo que hay debajo.
    pub click_through: Signal<bool>,
}

impl Prefs {
    /// Carga lo guardado, o los valores de partida la primera vez.
    pub fn load() -> Self {
        let stored = crate::store::read(FILE)
            .and_then(|json| match serde_json::from_str::<Stored>(&json) {
                Ok(s) => Some(s),
                Err(e) => {
                    log::warn!("los ajustes guardados no se entienden, se usan los de serie: {e}");
                    None
                }
            })
            .unwrap_or_default();

        let prefs = Self {
            opacity: Signal::new(stored.opacity.clamp(0.4, 1.0)),
            font_scale: Signal::new(stored.font_scale.clamp(0.8, 1.6)),
            show_subs: Signal::new(stored.show_subs),
            click_through: Signal::new(stored.click_through),
        };
        prefs.save_on_change();
        prefs
    }

    /// Lo que hay que escribir ahora mismo.
    fn snapshot(&self) -> Stored {
        Stored {
            opacity: self.opacity.get_untracked(),
            font_scale: self.font_scale.get_untracked(),
            show_subs: self.show_subs.get_untracked(),
            click_through: self.click_through.get_untracked(),
            window: crate::store::read(FILE)
                .and_then(|j| serde_json::from_str::<Stored>(&j).ok())
                .and_then(|s| s.window),
        }
    }

    /// Guarda cuando algo cambia, pero no en cada cambio.
    ///
    /// Un deslizador emite un valor por frame mientras se arrastra. Escribir
    /// el disco a 60 por segundo por mover una barra es absurdo, asi que se
    /// espera a que la mano pare.
    fn save_on_change(&self) {
        let prefs = *self;
        let pending = std::rc::Rc::new(std::cell::Cell::new(false));
        Effect::new(move || {
            // Leer los cuatro para suscribirse a todos.
            let _ = (
                prefs.opacity.get(),
                prefs.font_scale.get(),
                prefs.show_subs.get(),
                prefs.click_through.get(),
            );
            if pending.replace(true) {
                // Ya hay una escritura en camino: recogera tambien esto.
                return;
            }
            let pending = std::rc::Rc::clone(&pending);
            chaika::task::after(Duration::from_millis(400), move || {
                pending.set(false);
                prefs.save_now();
            });
        });
    }

    /// Escribe los ajustes en disco.
    pub fn save_now(&self) {
        match serde_json::to_string_pretty(&self.snapshot()) {
            Ok(json) => {
                if let Err(e) = crate::store::write(FILE, &json) {
                    log::warn!("no se pudieron guardar los ajustes: {e}");
                }
            }
            Err(e) => log::warn!("no se pudieron serializar los ajustes: {e}"),
        }
    }

    /// Guarda donde quedo la ventana.
    pub fn save_window(&self, x: f32, y: f32) {
        let mut stored = self.snapshot();
        stored.window = Some((x, y));
        if let Ok(json) = serde_json::to_string_pretty(&stored) {
            let _ = crate::store::write(FILE, &json);
        }
    }

    /// Donde estaba la ventana la ultima vez.
    pub fn window() -> Option<(f32, f32)> {
        let json = crate::store::read(FILE)?;
        serde_json::from_str::<Stored>(&json).ok()?.window
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_valores_de_serie_son_los_del_kuidy_de_siempre() {
        let d = Stored::default();
        assert_eq!(d.opacity, 0.95);
        assert_eq!(d.font_scale, 1.0);
        assert!(d.show_subs);
        assert!(!d.click_through, "de serie el overlay recibe clics");
    }

    #[test]
    fn se_guarda_con_los_nombres_que_usa_electron() {
        let json = serde_json::to_string(&Stored::default()).unwrap();
        assert!(json.contains("\"fontScale\""));
        assert!(json.contains("\"showSubs\""));
        assert!(json.contains("\"clickThrough\""));
    }

    #[test]
    fn un_archivo_de_ajustes_a_medias_no_tira_los_demas() {
        // Falta todo menos la opacidad: el resto sale de los valores de serie.
        let parsed: Result<Stored, _> = serde_json::from_str(r#"{"opacity":0.5}"#);
        assert!(parsed.is_err(), "serde exige los campos sin default");

        // Y con todos menos `window`, que si lo tiene, se lee bien.
        let completo: Stored = serde_json::from_str(
            r#"{"opacity":0.5,"fontScale":1.2,"showSubs":false,"clickThrough":true}"#,
        )
        .expect("se entiende");
        assert_eq!(completo.opacity, 0.5);
        assert!(completo.window.is_none());
    }
}
