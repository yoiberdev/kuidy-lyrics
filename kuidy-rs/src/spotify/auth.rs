//! Entrar en la cuenta de Spotify con PKCE.
//!
//! PKCE existe para aplicaciones que no pueden guardar un secreto, que es
//! exactamente el caso de un programa de escritorio: cualquiera puede abrir
//! el binario y leer lo que haya dentro. En vez de un secreto, cada intento
//! se inventa un numero al azar (el *verificador*), manda su hash a Spotify
//! y, al canjear el codigo, ensena el numero original. Quien intercepte el
//! codigo no puede usarlo sin ese numero.
//!
//! El navegador devuelve al usuario a `127.0.0.1:8888`, asi que hace falta
//! un servidor minimo escuchando ahi el rato que dure la vuelta.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::{Error, Tokens};

/// El puerto del redirect. Tiene que cuadrar con el que este dado de alta en
/// el panel de Spotify, asi que no se puede elegir otro al vuelo.
const PORT: u16 = 8888;
const REDIRECT: &str = "http://127.0.0.1:8888/callback";

/// Lo minimo para saber que suena: el estado del reproductor y la pista.
const SCOPES: &str = "user-read-currently-playing user-read-playback-state";

/// Cuanto se espera a que el usuario termine en el navegador antes de
/// rendirse y soltar el puerto.
const TIMEOUT: Duration = Duration::from_secs(300);

/// Un verificador y su desafio.
struct Pkce {
    verifier: String,
    challenge: String,
}

impl Pkce {
    fn new() -> Self {
        // 48 bytes de aleatoriedad: mas que los 32 que exige el estandar y
        // dentro del maximo de 128 caracteres una vez codificado.
        let bytes: [u8; 48] = rand::random();
        let verifier = base64url(&bytes);
        let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
        Self { verifier, challenge }
    }
}

/// base64 de los de URL: sin `+`, sin `/` y sin relleno.
fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        let indices = [n >> 18 & 63, n >> 12 & 63, n >> 6 & 63, n & 63];
        for (i, index) in indices.iter().enumerate() {
            // Cada 3 bytes dan 4 caracteres; con 1 o 2 bytes sobran los
            // ultimos, y aqui se tiran en vez de rellenar con `=`.
            if i <= chunk.len() {
                out.push(ALPHABET[*index as usize] as char);
            }
        }
    }
    out
}

/// La URL a la que hay que mandar al usuario.
fn authorize_url(client_id: &str, challenge: &str, state: &str) -> String {
    format!(
        "https://accounts.spotify.com/authorize?response_type=code&client_id={client_id}\
         &redirect_uri={}&code_challenge_method=S256&code_challenge={challenge}\
         &state={state}&scope={}",
        urlencode(REDIRECT),
        urlencode(SCOPES)
    )
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Entra en la cuenta. Bloquea hasta que el usuario termina en el navegador,
/// asi que va en otro hilo.
///
/// `open` recibe la URL a la que hay que llevar al usuario; se pasa desde
/// fuera para poder probar el flujo sin abrir un navegador de verdad.
pub fn login(client_id: &str, open: impl FnOnce(&str)) -> Result<Tokens, Error> {
    let pkce = Pkce::new();
    // El `state` ata la vuelta a esta peticion: si vuelve otro, no es nuestro.
    let state = base64url(&rand::random::<[u8; 16]>());

    // El servidor se abre *antes* de mandar al usuario: si el puerto esta
    // ocupado, mejor decirlo ya que despues de que abra el navegador.
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| {
        Error::Auth(format!(
            "el puerto {PORT} esta ocupado por otro programa, cierralo y vuelve a intentarlo ({e})"
        ))
    })?;
    listener
        .set_nonblocking(false)
        .map_err(|e| Error::Auth(format!("no se pudo preparar la espera: {e}")))?;

    open(&authorize_url(client_id, &pkce.challenge, &state));

    let code = wait_for_code(&listener, &state)?;
    exchange(client_id, &code, &pkce.verifier)
}

/// Espera a que el navegador vuelva con el codigo.
fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, Error> {
    let deadline = std::time::Instant::now() + TIMEOUT;
    for stream in listener.incoming() {
        if std::time::Instant::now() > deadline {
            return Err(Error::Auth("se agoto el tiempo de espera".into()));
        }
        let mut stream = stream.map_err(|e| Error::Auth(format!("conexion fallida: {e}")))?;
        let Some(target) = request_target(&stream) else { continue };
        // El navegador pide tambien el favicon y demas: solo interesa la
        // vuelta del callback.
        if !target.starts_with("/callback") {
            respond(&mut stream, "404 Not Found", "");
            continue;
        }

        let params = query_params(&target);
        let answer = match (params.get("code"), params.get("error"), params.get("state")) {
            (_, Some(why), _) => Err(Error::Auth(format!("Spotify dijo que no: {why}"))),
            (_, _, Some(got)) if got != state => {
                Err(Error::Auth("la respuesta no era de esta peticion".into()))
            }
            (Some(code), _, _) => Ok(code.clone()),
            _ => Err(Error::Auth("la respuesta no traia el codigo".into())),
        };
        respond(&mut stream, "200 OK", &page(answer.is_ok()));
        return answer;
    }
    Err(Error::Auth("no llego ninguna respuesta".into()))
}

/// La primera linea de la peticion: `GET /callback?code=... HTTP/1.1`.
fn request_target(stream: &TcpStream) -> Option<String> {
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).ok()?;
    line.split_whitespace().nth(1).map(str::to_string)
}

fn query_params(target: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let Some((_, query)) = target.split_once('?') else { return out };
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            out.insert(k.to_string(), urldecode(v));
        }
    }
    out
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Lo que ve el usuario en el navegador al volver.
fn page(ok: bool) -> String {
    let (titulo, texto) = if ok {
        ("Listo", "Ya puedes cerrar esta pestana y volver a kuidy.")
    } else {
        ("No se pudo", "Vuelve a kuidy e intentalo otra vez.")
    };
    format!(
        "<!doctype html><meta charset=utf-8><title>kuidy</title>\
         <body style=\"font-family:system-ui;background:#101014;color:#fff;\
         display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><h1 style=\"font-weight:600\">{titulo}</h1>\
         <p style=\"color:#8a8a9a\">{texto}</p></div>"
    )
}

/// Cambia el codigo por los tokens.
fn exchange(client_id: &str, code: &str, verifier: &str) -> Result<Tokens, Error> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];
    super::token_request(&form)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_verificador_y_su_desafio_son_distintos_cada_vez() {
        let a = Pkce::new();
        let b = Pkce::new();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.challenge, b.challenge);
        // Y el desafio es el hash del verificador, no el verificador.
        assert_ne!(a.verifier, a.challenge);
        assert_eq!(a.challenge, base64url(&Sha256::digest(a.verifier.as_bytes())));
    }

    #[test]
    fn el_base64_es_del_tipo_que_cabe_en_una_url() {
        let encoded = base64url(&[251, 255, 190, 0, 1, 2]);
        assert!(!encoded.contains('+'), "nada de + en una URL");
        assert!(!encoded.contains('/'), "nada de /");
        assert!(!encoded.contains('='), "sin relleno");
        // Vector conocido: "hola" -> aG9sYQ
        assert_eq!(base64url(b"hola"), "aG9sYQ");
        assert_eq!(base64url(b"h"), "aA");
    }

    #[test]
    fn la_url_de_autorizacion_lleva_lo_que_spotify_exige() {
        let url = authorize_url("ID", "DESAFIO", "ESTADO");
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=ID"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("code_challenge=DESAFIO"));
        assert!(url.contains("state=ESTADO"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback"));
        assert!(url.contains("user-read-currently-playing"));
    }

    #[test]
    fn se_leen_los_parametros_de_la_vuelta() {
        let p = query_params("/callback?code=AQA%2Bbc&state=xyz");
        assert_eq!(p.get("code").map(String::as_str), Some("AQA+bc"));
        assert_eq!(p.get("state").map(String::as_str), Some("xyz"));

        let sin = query_params("/callback");
        assert!(sin.is_empty());
    }

    #[test]
    fn el_texto_codificado_vuelve_entero() {
        assert_eq!(urldecode("a%20b"), "a b");
        assert_eq!(urldecode("a+b"), "a b");
        assert_eq!(urldecode("Ma%C3%B1ana"), "Mañana");
        assert_eq!(urldecode("sin nada raro"), "sin nada raro");
    }
}
