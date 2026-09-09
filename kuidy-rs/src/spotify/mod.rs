//! Spotify: la cuenta y que suena.
//!
//! Todo lo de aqui bloquea — son peticiones de red — y va en otro hilo. La
//! interfaz nunca llama a esto directamente: lo hace el sondeo, y lo que
//! vuelve son senales.
//!
//! Los errores se traducen a algo que se le pueda decir a una persona. Que
//! el usuario lea "Spotify API 403" no le sirve de nada; que lea "esa cuenta
//! no tiene permiso" ya le dice si el problema es suyo.

mod auth;

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::playback::Track;

pub use auth::login;

/// El identificador publico de la app. Es publico de verdad: PKCE existe
/// justamente para que esto no tenga que ser un secreto.
pub const CLIENT_ID: &str = "47ad7282933c41c98f10e32a8dede477";

/// Donde se puede dejar otro Client ID.
const CLIENT_ID_FILE: &str = "client-id.txt";

/// El Client ID que toca usar.
///
/// Spotify solo deja **cinco** cuentas autorizadas mientras una app esta en
/// Development Mode, y desde 2025 ya no concede el modo ampliado a proyectos
/// de una persona. O sea que el de aqui arriba solo funciona para las cinco
/// cuentas que esten dadas de alta en el panel: cualquier otra recibe un
/// 403 y no hay nada que hacer desde el codigo.
///
/// Por eso quien se baje el ejecutable puede poner el suyo, sacado de
/// <https://developer.spotify.com/dashboard> en dos minutos. Se busca:
///
/// 1. La variable de entorno `SPOTIFY_CLIENT_ID`, para desarrollo.
/// 2. `%APPDATA%\kuidy-rs\client-id.txt`, para el resto del mundo.
/// 3. El de aqui arriba.
pub fn client_id() -> String {
    if let Ok(id) = std::env::var("SPOTIFY_CLIENT_ID") {
        let id = id.trim().to_string();
        if !id.is_empty() {
            log::info!("Client ID tomado de SPOTIFY_CLIENT_ID");
            return id;
        }
    }
    if let Ok(dir) = crate::store::dir() {
        if let Ok(texto) = std::fs::read_to_string(dir.join(CLIENT_ID_FILE)) {
            // Se ignoran las lineas de comentario para poder explicar el
            // archivo dentro del propio archivo.
            let id: String = texto
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with('#'))
                .unwrap_or_default()
                .to_string();
            if !id.is_empty() {
                log::info!("Client ID tomado de {}", CLIENT_ID_FILE);
                return id;
            }
        }
    }
    CLIENT_ID.to_string()
}

/// Donde se guarda la sesion.
const TOKENS_FILE: &str = "kuidy-tokens.json";

/// Lo que puede salir mal, ya traducido a algo que se le puede decir a una
/// persona.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// La sesion no vale: hay que volver a entrar.
    Auth(String),
    /// La cuenta no tiene permiso — cuentas sin activar en el panel.
    Forbidden,
    /// Spotify pide esperar. Trae cuanto.
    RateLimited(Duration),
    /// Spotify no esta bien ahora mismo.
    Server,
    /// No se pudo llegar.
    Network(String),
}

impl Error {
    /// Lo que se le ensena al usuario.
    pub fn message(&self) -> String {
        match self {
            Error::Auth(_) => "Vuelve a conectar tu cuenta de Spotify".into(),
            Error::Forbidden => "Esa cuenta no tiene acceso a la app".into(),
            Error::RateLimited(_) => "Spotify pide esperar un momento".into(),
            Error::Server => "Spotify no responde bien ahora mismo".into(),
            Error::Network(_) => "Sin conexion con Spotify".into(),
        }
    }

    /// `true` si hay que echar al usuario a la pantalla de entrar.
    pub fn revokes_session(&self) -> bool {
        matches!(self, Error::Auth(_))
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Auth(why) => write!(f, "sesion invalida: {why}"),
            Error::Forbidden => f.write_str("cuenta sin permiso"),
            Error::RateLimited(d) => write!(f, "limite de peticiones, esperar {d:?}"),
            Error::Server => f.write_str("Spotify no responde bien"),
            Error::Network(why) => write!(f, "sin conexion: {why}"),
        }
    }
}

/// La sesion: lo que permite pedirle cosas a Spotify.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Cuando caduca el de acceso, en segundos desde la epoca.
    pub expires_at: u64,
}

impl Tokens {
    /// `true` si el de acceso ya no sirve o esta a punto.
    fn expired(&self) -> bool {
        now() >= self.expires_at
    }

    /// Guarda la sesion para la proxima vez que se abra la app.
    pub fn save(&self) {
        match serde_json::to_string(self) {
            Ok(json) => {
                if let Err(e) = crate::store::write(TOKENS_FILE, &json) {
                    log::warn!("no se pudo guardar la sesion: {e}");
                }
            }
            Err(e) => log::warn!("no se pudo serializar la sesion: {e}"),
        }
    }

    /// La sesion guardada, si la hay.
    pub fn load() -> Option<Self> {
        let json = crate::store::read(TOKENS_FILE)?;
        match serde_json::from_str(&json) {
            Ok(tokens) => Some(tokens),
            Err(e) => {
                log::warn!("la sesion guardada no se entiende, se descarta: {e}");
                crate::store::remove(TOKENS_FILE);
                None
            }
        }
    }

    /// Olvida la sesion.
    pub fn forget() {
        crate::store::remove(TOKENS_FILE);
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Lo que Spotify contesta al dar o refrescar una sesion.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: u64,
}

/// Pide o refresca tokens. Comun a entrar y a refrescar porque el endpoint y
/// el manejo de errores son los mismos.
fn token_request(form: &[(&str, &str)]) -> Result<Tokens, Error> {
    let response = ureq::post("https://accounts.spotify.com/api/token").send_form(form.to_vec());
    let data: TokenResponse = match response {
        Ok(mut r) => r
            .body_mut()
            .read_json()
            .map_err(|e| Error::Server_with(format!("respuesta ilegible: {e}")))?,
        Err(ureq::Error::StatusCode(400 | 401)) => {
            return Err(Error::Auth("Spotify rechazo la sesion".into()));
        }
        Err(ureq::Error::StatusCode(403)) => return Err(Error::Forbidden),
        Err(ureq::Error::StatusCode(429)) => {
            return Err(Error::RateLimited(Duration::from_secs(5)));
        }
        Err(ureq::Error::StatusCode(code)) if code >= 500 => return Err(Error::Server),
        Err(e) => return Err(Error::Network(e.to_string())),
    };
    Ok(Tokens {
        access_token: data.access_token,
        // Al refrescar, Spotify a veces no manda uno nuevo: se conserva el
        // que habia, y por eso quien llama lo rellena si viene vacio.
        refresh_token: data.refresh_token.unwrap_or_default(),
        // Treinta segundos de margen: el reloj de aqui y el de alli no son el
        // mismo, y un token que caduca a mitad de peticion cuesta un reintento.
        expires_at: now() + data.expires_in.saturating_sub(30),
    })
}

impl Error {
    #[allow(non_snake_case)]
    fn Server_with(why: String) -> Error {
        log::warn!("spotify: {why}");
        Error::Server
    }
}

/// Renueva la sesion con el token de refresco.
pub fn refresh(tokens: &Tokens) -> Result<Tokens, Error> {
    if tokens.refresh_token.is_empty() {
        return Err(Error::Auth("no hay con que refrescar".into()));
    }
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", tokens.refresh_token.as_str()),
        ("client_id", CLIENT_ID),
    ];
    let mut fresh = token_request(&form)?;
    if fresh.refresh_token.is_empty() {
        fresh.refresh_token = tokens.refresh_token.clone();
    }
    Ok(fresh)
}

/// Lo que suena, tal como lo cuenta Spotify.
#[derive(Debug, Deserialize)]
struct PlayerResponse {
    #[serde(default)]
    is_playing: bool,
    #[serde(default)]
    progress_ms: Option<u64>,
    #[serde(default)]
    item: Option<Item>,
}

#[derive(Debug, Deserialize)]
struct Item {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    artists: Vec<Named>,
    #[serde(default)]
    album: Option<Named>,
}

#[derive(Debug, Deserialize)]
struct Named {
    #[serde(default)]
    name: String,
}

/// El estado de la reproduccion, ya en los tipos de la app.
#[derive(Clone, Debug, PartialEq)]
pub struct Now {
    pub track: Option<Track>,
    pub position: Duration,
    pub playing: bool,
}

/// Pregunta que suena. Bloquea: va en otro hilo.
///
/// Devuelve tambien la sesion, que puede haberse renovado por el camino;
/// quien llama tiene que quedarse con la nueva o el siguiente sondeo
/// refrescara otra vez.
pub fn now_playing(tokens: &Tokens) -> Result<(Now, Tokens), Error> {
    let mut session = tokens.clone();
    if session.expired() {
        session = refresh(&session)?;
        session.save();
    }

    let mut response = request_player(&session.access_token);
    // El token pudo caducar entre el calculo y la peticion: un refresco y un
    // reintento antes de dar la sesion por perdida.
    if matches!(response, Err(ureq::Error::StatusCode(401))) {
        session = refresh(&session)?;
        session.save();
        response = request_player(&session.access_token);
    }

    match response {
        // 204: no hay nada sonando. Es una respuesta, no un fallo.
        Ok(r) if r.status() == 204 => {
            Ok((Now { track: None, position: Duration::ZERO, playing: false }, session))
        }
        Ok(mut r) => {
            let body = r.body_mut().read_to_string().unwrap_or_default();
            // Spotify devuelve 200 con cuerpo vacio de vez en cuando.
            if body.trim().is_empty() {
                return Ok((
                    Now { track: None, position: Duration::ZERO, playing: false },
                    session,
                ));
            }
            let parsed: PlayerResponse = serde_json::from_str(&body)
                .map_err(|e| Error::Server_with(format!("cuerpo ilegible: {e}")))?;
            Ok((to_now(parsed), session))
        }
        Err(ureq::Error::StatusCode(401)) => Err(Error::Auth("Spotify rechazo el token".into())),
        Err(ureq::Error::StatusCode(403)) => Err(Error::Forbidden),
        Err(ureq::Error::StatusCode(429)) => Err(Error::RateLimited(Duration::from_secs(5))),
        Err(ureq::Error::StatusCode(code)) if code >= 500 => Err(Error::Server),
        Err(e) => Err(Error::Network(e.to_string())),
    }
}

fn request_player(token: &str) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    ureq::get("https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode")
        .header("Authorization", &format!("Bearer {token}"))
        .call()
}

fn to_now(response: PlayerResponse) -> Now {
    // Con un podcast, Spotify manda `item: null` y no hay letra que buscar:
    // para la app es lo mismo que no sonar nada.
    let track = response.item.and_then(|item| {
        Some(Track {
            id: item.id?,
            name: item.name,
            artists: item.artists.into_iter().map(|a| a.name).collect(),
            album: item.album.map(|a| a.name).unwrap_or_default(),
            duration: Duration::from_millis(item.duration_ms),
        })
    });
    Now {
        position: Duration::from_millis(response.progress_ms.unwrap_or(0)),
        playing: response.is_playing,
        track,
    }
}

#[cfg(test)]
mod tests_client_id {
    use super::*;

    #[test]
    fn la_variable_de_entorno_manda() {
        // Se usa una variable propia para no pisar la del entorno real.
        let antes = std::env::var("SPOTIFY_CLIENT_ID").ok();
        unsafe { std::env::set_var("SPOTIFY_CLIENT_ID", "  mio123  ") };
        assert_eq!(client_id(), "mio123", "se recorta el espacio de sobra");
        unsafe { std::env::set_var("SPOTIFY_CLIENT_ID", "   ") };
        assert_ne!(client_id(), "", "una variable vacia no cuenta");
        match antes {
            Some(v) => unsafe { std::env::set_var("SPOTIFY_CLIENT_ID", v) },
            None => unsafe { std::env::remove_var("SPOTIFY_CLIENT_ID") },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Now {
        to_now(serde_json::from_str(json).expect("json de prueba"))
    }

    #[test]
    fn lee_lo_que_suena() {
        let now = parse(
            r#"{"is_playing":true,"progress_ms":42000,"item":{
                 "id":"abc","name":"Bohemian Rhapsody","duration_ms":354000,
                 "artists":[{"name":"Queen"}],"album":{"name":"A Night at the Opera"}}}"#,
        );
        let track = now.track.expect("hay pista");
        assert_eq!(track.name, "Bohemian Rhapsody");
        assert_eq!(track.artists, vec!["Queen"]);
        assert_eq!(track.album, "A Night at the Opera");
        assert_eq!(track.duration, Duration::from_secs(354));
        assert_eq!(now.position, Duration::from_secs(42));
        assert!(now.playing);
    }

    #[test]
    fn un_podcast_es_como_no_sonar_nada() {
        // Con episodios, Spotify manda item nulo.
        let now = parse(r#"{"is_playing":true,"progress_ms":1000,"item":null}"#);
        assert!(now.track.is_none(), "sin pista no hay letra que buscar");
        assert!(now.playing);
    }

    #[test]
    fn una_pista_sin_id_no_sirve() {
        // Sin id no se puede saber si cambio de cancion.
        let now = parse(r#"{"is_playing":true,"item":{"name":"x","duration_ms":1000}}"#);
        assert!(now.track.is_none());
    }

    #[test]
    fn aguanta_lo_que_falte() {
        let now = parse(r#"{}"#);
        assert!(now.track.is_none());
        assert!(!now.playing);
        assert_eq!(now.position, Duration::ZERO);
    }

    #[test]
    fn varios_artistas_se_conservan_en_orden() {
        let now = parse(
            r#"{"item":{"id":"a","name":"x","duration_ms":1,
                 "artists":[{"name":"Uno"},{"name":"Dos"}]}}"#,
        );
        assert_eq!(now.track.unwrap().artists_line(), "Uno, Dos");
    }

    #[test]
    fn los_errores_se_cuentan_en_castellano_y_sin_codigos() {
        assert_eq!(Error::Forbidden.message(), "Esa cuenta no tiene acceso a la app");
        assert!(Error::Auth("lo que sea".into()).revokes_session());
        assert!(!Error::Server.revokes_session(), "un fallo de Spotify no es culpa de la sesion");
        assert!(!Error::Network("timeout".into()).message().contains("timeout"));
    }

    #[test]
    fn una_sesion_caducada_se_sabe_caducada() {
        let viva = Tokens {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: now() + 600,
        };
        let muerta = Tokens { expires_at: now().saturating_sub(1), ..viva.clone() };
        assert!(!viva.expired());
        assert!(muerta.expired());
    }
}
