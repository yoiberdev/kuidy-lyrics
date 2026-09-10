//! Leer el japones en alfabeto latino, sin salir de la maquina.
//!
//! Es la funcion por la que existe kuidy para quien escucha musica japonesa:
//! la letra en kanji no se puede cantar si no sabes leerla. Antes esto se
//! le pedia a un endpoint no oficial de Google, con tres pegas: manda la
//! letra fuera, el `robots.txt` de Google prohibe esa ruta, y devuelve 429
//! cuando alguien que comparte tu IP abusa. Ahora se hace aqui.
//!
//! Cuesta 5,7 MB de diccionario dentro del binario. Se paga entero en disco
//! y **nada en memoria hasta que suena algo en japones**: quien no escuche
//! japones no carga el diccionario nunca.
//!
//! # De donde sale el diccionario
//!
//! De IPADIC, recortado. IPADIC trae trece campos por entrada y para leer
//! hacen falta tres: categoria, subcategoria y la lectura. Tirando los otros
//! nueve baja de 7,7 a 5,7 MB **sin quitar ni una palabra**, que es lo que
//! lo mete por debajo de lo aceptable. El recorte lo hace
//! `tools/recortar-ipadic.py`.
//!
//! Se eligio IPADIC y no UniDic por un detalle que solo se ve al probarlo:
//! IPADIC guarda la lectura (読み) y la pronunciacion (発音) por separado,
//! asi que se puede usar la lectura en general y caer a la pronunciacion en
//! las particulas, que es donde esta la diferencia que importa: は se lee
//! "wa" y no "ha". El UniDic recortado solo conserva la pronunciacion, y
//! entonces 今日 sale "kyoo" en vez de "kyou".

use std::io::Read;
use std::sync::OnceLock;

use vibrato::{Dictionary, Tokenizer};
use wana_kana::ConvertJapanese;

/// El diccionario, comprimido. Ocupa dentro del binario y no se toca hasta
/// que hace falta.
static COMPRIMIDO: &[u8] = include_bytes!("../assets/ipadic-recortado.dic.zst");

/// Palabras cuya lectura IPADIC da mal y que salen constantemente en las
/// letras. Son numerales que en japones se leen de forma irregular cuando
/// cuentan personas, y el diccionario los parte por su lectura regular.
///
/// La lista es corta a proposito: cada entrada es una decision a mano, y una
/// tabla larga seria un diccionario paralelo mal hecho.
const EXCEPCIONES: &[(&str, &str)] = &[
    ("一人", "ヒトリ"),
    ("二人", "フタリ"),
    ("大人", "オトナ"),
];

/// El tokenizador, construido una sola vez y solo si se usa.
fn tokenizador() -> Option<&'static Tokenizer> {
    static UNA_VEZ: OnceLock<Option<Tokenizer>> = OnceLock::new();
    UNA_VEZ
        .get_or_init(|| {
            let reloj = std::time::Instant::now();
            let mut crudo = Vec::new();
            let leido = ruzstd::StreamingDecoder::new(COMPRIMIDO)
                .ok()
                .and_then(|mut d| d.read_to_end(&mut crudo).ok());
            if leido.is_none() {
                log::error!("el diccionario japones no se pudo descomprimir");
                return None;
            }
            match Dictionary::read(&crudo[..]) {
                Ok(dic) => {
                    log::info!("diccionario japones listo en {:?}", reloj.elapsed());
                    Some(Tokenizer::new(dic))
                }
                Err(e) => {
                    log::error!("el diccionario japones no se pudo leer: {e}");
                    None
                }
            }
        })
        .as_ref()
}

/// Si una linea lleva escritura japonesa: kana o kanji.
///
/// No vale aqui el `is_japanese` que decide si una CANCION es japonesa: ese
/// exige kana a proposito, porque los kanji solos tambien los usa el chino.
/// Pero dentro de una letra ya identificada como japonesa hay lineas de puro
/// kanji -- 「夢」, 「一人」 -- que hay que leer igual.
fn tiene_japones(texto: &str) -> bool {
    texto.chars().any(|c| {
        ('\u{3040}'..='\u{30ff}').contains(&c) || ('\u{4e00}'..='\u{9fff}').contains(&c)
    })
}

/// La lectura de unas lineas en japones, en alfabeto latino.
///
/// Devuelve una cadena por linea, vacia para las que no llevan japones. Sin
/// red y sin mandar nada a ninguna parte.
///
/// Bloquea la primera vez unos 400 ms mientras monta el diccionario, asi que
/// va en otro hilo como cualquier otra espera.
pub fn romanize(lines: &[String]) -> Vec<String> {
    let Some(tk) = tokenizador() else {
        return vec![String::new(); lines.len()];
    };
    let mut worker = tk.new_worker();
    lines
        .iter()
        .map(|linea| {
            if tiene_japones(linea) {
                romanizar_linea(&mut worker, linea)
            } else {
                String::new()
            }
        })
        .collect()
}

/// Una linea.
fn romanizar_linea(worker: &mut vibrato::tokenizer::worker::Worker, linea: &str) -> String {
    worker.reset_sentence(linea);
    worker.tokenize();

    // Primero los trozos tal cual los ve el diccionario, y despues se juntan
    // y se pegan. En dos pasadas y no en una porque las excepciones abarcan
    // varios trozos: 一人 sale partido en 一 y 人.
    let mut trozos: Vec<Trozo> = Vec::with_capacity(worker.num_tokens());
    for i in 0..worker.num_tokens() {
        let token = worker.token(i);
        let campos: Vec<&str> = token.feature().split(',').collect();
        trozos.push(Trozo {
            superficie: token.surface().to_string(),
            pos: campos.first().copied().unwrap_or("").to_string(),
            sub1: campos.get(1).copied().unwrap_or("").to_string(),
            lectura: campos.get(2).copied().unwrap_or("*").to_string(),
        });
    }
    juntar_excepciones(&mut trozos);

    let mut palabras: Vec<String> = Vec::new();
    let mut anterior = String::new();
    for t in &trozos {
        // Lo que se pega a la palabra de antes en vez de ir suelto. Las
        // particulas van sueltas ("kimi no na wa"), pero la terminacion de
        // un verbo no: 会った es "atta", no "a tta".
        //
        // Los auxiliares solo se pegan detras de un verbo o un adjetivo: si
        // no, です se pegaria al sustantivo y 天気です saldria "tenkidesu"
        // en vez de "tenki desu".
        // Y los verbos no autonomos (el いる de ていた) van sueltos, para
        // que 見ていた se lea "mite ita" y no "miteita". Las dos son
        // romanizaciones validas; se separa porque una letra se lee para
        // cantarla, y separada se sigue mejor.
        let pegada = if t.pos == "助動詞" {
            matches!(anterior.as_str(), "動詞" | "形容詞" | "助動詞")
        } else {
            t.sub1 == "接尾" || (t.pos == "助詞" && t.sub1 == "接続助詞")
        };

        let kana = lectura_de(&t.superficie, &t.lectura);
        match palabras.last_mut() {
            Some(p) if pegada => p.push_str(&kana),
            _ => palabras.push(kana),
        }
        anterior = t.pos.clone();
    }

    palabras
        .iter()
        .map(|p| p.as_str().to_romaji())
        // wana_kana translitera ヲ como "wo", que es correcto como kana pero
        // no como lectura: la particula を se pronuncia "o".
        .map(|r| if r == "wo" { "o".to_string() } else { r })
        .filter(|r| !r.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Un trozo de linea tal como lo devuelve el diccionario.
struct Trozo {
    superficie: String,
    pos: String,
    sub1: String,
    lectura: String,
}

/// Junta los trozos que forman una palabra de la lista de excepciones.
///
/// Hace falta porque el diccionario parte 一人 en 一 y 人, y por separado los
/// lee bien: "ichi" y "nin". Es al juntarlos cuando la lectura deja de ser la
/// suma de las partes.
///
/// Se junta y no se sustituye en el texto antes de partir, que seria mas
/// corto, porque asi 一人前 -- que el diccionario si conoce como una sola
/// palabra -- se queda en paz y sigue leyendose "ichininmae".
fn juntar_excepciones(trozos: &mut Vec<Trozo>) {
    let mut i = 0;
    while i < trozos.len() {
        let mut juntados = None;
        for (palabra, _) in EXCEPCIONES {
            let mut largo = 0;
            let mut cuantos = 0;
            while largo < palabra.len() && i + cuantos < trozos.len() {
                largo += trozos[i + cuantos].superficie.len();
                cuantos += 1;
            }
            if cuantos > 1
                && largo == palabra.len()
                && trozos[i..i + cuantos].iter().map(|t| t.superficie.as_str()).collect::<String>()
                    == *palabra
            {
                juntados = Some((cuantos, (*palabra).to_string()));
                break;
            }
        }
        if let Some((cuantos, palabra)) = juntados {
            trozos.splice(
                i..i + cuantos,
                [Trozo {
                    superficie: palabra,
                    pos: "名詞".into(),
                    sub1: String::new(),
                    // La lectura buena la pone `lectura_de` desde la tabla.
                    lectura: "*".into(),
                }],
            );
        }
        i += 1;
    }
}

/// La lectura de una palabra: la del diccionario, salvo que este en la lista
/// corta de las que da mal.
fn lectura_de(superficie: &str, lectura: &str) -> String {
    if let Some((_, buena)) = EXCEPCIONES.iter().find(|(p, _)| *p == superficie) {
        return (*buena).to_string();
    }
    if lectura != "*" && !lectura.is_empty() {
        return lectura.to_string();
    }
    // Sin lectura en el diccionario: se deja la palabra tal cual. Si llevaba
    // kanji, saldra sin romanizar, que es mejor que inventarse la lectura.
    superficie.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Las lecturas que importan. Cada una esta aqui por un motivo.
    #[test]
    fn lee_el_japones_como_se_canta() {
        let casos: &[(&str, &str)] = &[
            // El caso que kakasi fallaba con "kun no mei ha", y el que
            // decidio descartar aquella via.
            ("君の名は", "kimi no na wa"),
            // La particula は se lee "wa" y no "ha": es lo que se pierde con
            // un diccionario que solo guarda la pronunciacion.
            ("私は本を読む", "watashi wa hon o yomu"),
            // Y を se lee "o", no "wo".
            ("夢を見ていた", "yume o mite ita"),
            // Un auxiliar detras de un sustantivo va suelto.
            ("今日はいい天気です", "kyou wa ii tenki desu"),
            // Pero la terminacion de un verbo no: no puede salir "a tta".
            ("初めて会った日から", "hajimete atta hi kara"),
            ("沈むように溶けてゆくように", "shizumu you ni tokete yuku you ni"),
            ("立ち上がれ", "tachiagare"),
        ];
        for (japones, esperado) in casos {
            let salida = romanize(&[japones.to_string()]);
            assert_eq!(&salida[0], esperado, "leyendo {japones}");
        }
    }

    #[test]
    fn los_numerales_de_personas_se_leen_irregulares() {
        // IPADIC los parte por su lectura regular y salen "ichinin" y
        // "fudari"; en una letra eso canta muchisimo.
        assert_eq!(romanize(&["一人".to_string()])[0], "hitori");
        assert_eq!(romanize(&["二人".to_string()])[0], "futari");
    }

    #[test]
    fn lo_que_no_es_japones_se_deja_en_paz() {
        let lineas = vec!["just english".to_string(), String::new(), "夢".to_string()];
        let salida = romanize(&lineas);
        assert_eq!(salida[0], "", "el ingles no se toca");
        assert_eq!(salida[1], "");
        assert_eq!(salida[2], "yume");
    }

    #[test]
    fn una_letra_entera_sale_sin_kanji_sueltos() {
        let letra: Vec<String> = [
            "沈むように溶けてゆくように",
            "二人だけの空が広がる夜に",
            "「さよなら」だけだった",
            "その一言で全てが分かった",
            "日が沈み出した空と君の姿",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        for (original, leido) in letra.iter().zip(romanize(&letra)) {
            assert!(!leido.is_empty(), "sin lectura: {original}");
            assert!(
                !leido.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)),
                "quedo kanji sin leer en {original} -> {leido}"
            );
        }
    }
}
