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
///
/// El `default` va en el contenedor y no campo a campo, y la diferencia
/// importa: campo a campo, un archivo al que le falte `opacity` se leeria
/// como `0.0` -- el `Default` del f32 -- en vez de como `0.95`, que es el
/// valor de serie de verdad. En el contenedor, lo que falte sale de
/// `Stored::default()`.
///
/// Sin esto, anadir un ajuste nuevo hace que el archivo de quien actualice
/// deje de entenderse entero y pierda todo lo que tenia puesto.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stored {
    pub opacity: f32,
    #[serde(rename = "fontScale")]
    pub font_scale: f32,
    #[serde(rename = "showSubs")]
    pub show_subs: bool,
    #[serde(rename = "clickThrough")]
    pub click_through: bool,
    /// Si ya se pregunto por la traduccion. Es de kuidy en Rust y no existe
    /// en el archivo de Electron; los archivos viejos no lo llevan y por
    /// eso entran como `false`, que es lo que toca: a esa gente todavia no
    /// se le ha preguntado nada.
    #[serde(rename = "translationAsked")]
    pub translation_asked: bool,
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
            // Apagada de serie: traducir manda la letra entera a un
            // servicio de fuera, y eso no se hace sin permiso. La primera
            // vez que haga falta se pregunta, y lo que se conteste se
            // queda.
            show_subs: false,
            click_through: false,
            translation_asked: false,
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
    /// Si ya se pregunto por la traduccion.
    pub translation_asked: Signal<bool>,
    /// Donde quedo la ventana. Vive aqui y no se relee del disco: antes,
    /// cada guardado abria y parseaba el archivo solo para recuperar este
    /// campo, y encima desde el hilo de la interfaz.
    pub window: Signal<Option<(f32, f32)>>,
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
            translation_asked: Signal::new(stored.translation_asked),
            window: Signal::new(stored.window),
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
            translation_asked: self.translation_asked.get_untracked(),
            window: self.window.get_untracked(),
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
            // Leerlos todos para suscribirse a todos.
            let _ = (
                prefs.opacity.get(),
                prefs.font_scale.get(),
                prefs.show_subs.get(),
                prefs.click_through.get(),
                prefs.translation_asked.get(),
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
        self.window.set(Some((x, y)));
        self.save_now();
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
        assert!(
            !d.show_subs,
            "de serie no se traduce: eso manda la letra fuera y nadie lo ha autorizado"
        );
        assert!(!d.translation_asked, "y todavia no se ha preguntado");
        assert!(!d.click_through, "de serie el overlay recibe clics");
    }

    /// La prueba que protege los ajustes de quien actualiza.
    ///
    /// Cuando se anade un campo nuevo a `Stored`, el archivo que ya tiene el
    /// usuario no lo lleva. Sin `#[serde(default)]` en el contenedor, ese
    /// archivo deja de entenderse ENTERO y el usuario pierde todo lo que
    /// tenia puesto sin enterarse.
    #[test]
    fn un_archivo_al_que_le_falten_campos_no_borra_el_resto() {
        let viejo = r#"{"opacity":0.6,"fontScale":1.2}"#;
        let s: Stored = serde_json::from_str(viejo).expect("se entiende igual");
        assert_eq!(s.opacity, 0.6, "lo que si estaba se respeta");
        assert_eq!(s.font_scale, 1.2);
        assert!(!s.show_subs, "y lo que falta toma el valor DE SERIE, no el del tipo");
        assert!(!s.click_through);
        assert_eq!(s.window, None);
    }

    /// Quien ya usaba kuidy tiene `showSubs` escrito en su archivo, asi que
    /// conserva lo que tuviera. Lo que no tiene es `translationAsked`, y por
    /// eso se le pregunta una vez: nunca dio permiso explicito.
    #[test]
    fn a_quien_ya_lo_usaba_se_le_respeta_el_ajuste_pero_se_le_pregunta() {
        let de_antes = r#"{"opacity":0.9,"fontScale":1.0,"showSubs":true,"clickThrough":false}"#;
        let s: Stored = serde_json::from_str(de_antes).expect("se entiende");
        assert!(s.show_subs, "lo que tenia puesto no se le toca");
        assert!(!s.translation_asked, "pero no consta que se le preguntara");
    }

    #[test]
    fn una_vez_contestado_no_se_vuelve_a_preguntar() {
        let contestado = r#"{"showSubs":false,"translationAsked":true}"#;
        let s: Stored = serde_json::from_str(contestado).expect("se entiende");
        assert!(!s.show_subs);
        assert!(s.translation_asked);
    }

    #[test]
    fn un_archivo_vacio_da_los_valores_de_serie() {
        let s: Stored = serde_json::from_str("{}").expect("se entiende");
        assert_eq!(s, Stored::default());
        assert_eq!(s.opacity, 0.95, "no 0.0, que es lo que daria un default por campo");
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
        let parcial: Stored =
            serde_json::from_str(r#"{"opacity":0.5}"#).expect("lo que falta se rellena");
        assert_eq!(parcial.opacity, 0.5);
        assert_eq!(parcial.font_scale, 1.0);
        assert!(!parcial.show_subs, "y el de serie de la traduccion es apagada");

        // Y con todos menos `window`, que si lo tiene, se lee bien.
        let completo: Stored = serde_json::from_str(
            r#"{"opacity":0.5,"fontScale":1.2,"showSubs":false,"clickThrough":true}"#,
        )
        .expect("se entiende");
        assert_eq!(completo.opacity, 0.5);
        assert!(completo.window.is_none());
    }
}
