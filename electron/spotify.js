// OAuth con PKCE contra un servidor local en 127.0.0.1:8888 y las llamadas a la
// Web API que necesita el overlay.
//
// Todo error que sale de este módulo lleva `err.kind` con uno de los códigos del
// contrato ('auth' | 'forbidden' | 'ratelimit' | 'network' | 'server' |
// 'unknown'), y `err.retryAfterMs` cuando Spotify manda cabecera Retry-After.
// Quien llama pinta el aviso a partir de eso: si dejáramos escapar el texto
// crudo de la API, el usuario leería "Spotify API 403" y no sabría qué hacer.

const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { loadTokens, saveTokens, clearTokens } = require('./config');
const log = require('./log');

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = ['user-read-currently-playing', 'user-read-playback-state'].join(' ');
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
// additional_types=episode es obligatorio para los podcasts: sin él, Spotify
// devuelve item:null mientras suena el episodio y el overlay dice que no hay
// nada reproduciéndose.
const PLAYER_URL =
  'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode';

// Sin timeout, un socket colgado deja la promesa sin resolver para siempre: el
// poller se queda esperando y la app parece muerta sin un solo error en el log.
const FETCH_TIMEOUT_MS = 10000;
// Antes eran 5 minutos. Nadie tarda tanto en pulsar "Aceptar" en Spotify, y
// mientras tanto el puerto sigue ocupado por nosotros mismos.
const AUTH_TIMEOUT_MS = 3 * 60 * 1000;

// Textos del contrato de errores, en un solo sitio para que el mensaje que ve el
// usuario no dependa de por qué rama del código llegó el fallo.
const MSG = {
  auth: 'Tu sesión de Spotify caducó',
  forbidden: 'Tu cuenta no está autorizada en esta app de Spotify',
  ratelimit: 'Spotify nos está limitando',
  network: 'Sin conexión con Spotify',
  server: 'Spotify está teniendo problemas',
};

let clientId = null;
let tokens = null; // { access_token, refresh_token, expires_at }
let authFlow = null; // flujo OAuth en vuelo, o null
let refreshInFlight = null;

function setClientId(id) {
  clientId = String(id || '').trim() || null;
}

function loadTokensFromDisk() {
  tokens = loadTokens();
}

function isAuthenticated() {
  return !!(tokens && tokens.refresh_token);
}

function logout() {
  tokens = null;
  clearTokens();
}

// ---------- errores tipados ----------

function fail(kind, message, extra) {
  const err = new Error(message);
  err.kind = kind;
  if (extra) Object.assign(err, extra);
  return err;
}

// Retry-After viene en segundos; quien reintenta trabaja en ms.
function retryAfterMs(resp) {
  const raw = resp.headers.get('retry-after');
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.round(secs * 1000);
}

// El cuerpo de error de Spotify es JSON, pero ante un 502 de su CDN puede ser
// HTML: nunca damos por hecho que parsea.
function spotifyErrorCode(raw) {
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.error?.message || parsed.error || '').trim();
  } catch {
    return '';
  }
}

// ---------- fetch con timeout ----------

async function fetchWithTimeout(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    // Aborto por timeout y caída de red son lo mismo para quien llama: no hubo
    // respuesta y toca reintentar más tarde.
    throw fail('network', MSG.network, { cause: err });
  }
}

async function readText(resp) {
  try {
    return await resp.text();
  } catch (err) {
    // El timeout también corta la lectura del cuerpo a medias.
    throw fail('network', MSG.network, { cause: err });
  }
}

// ---------- PKCE ----------

function base64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkcePair() {
  const verifier = base64urlEncode(crypto.randomBytes(48));
  const challenge = base64urlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCallbackPage(errorMessage) {
  const body = errorMessage
    ? `<h1 class="err">Algo falló</h1><p>${escapeHtml(errorMessage)}</p>`
    : `<h1 class="ok">¡Conectado!</h1><p>Ya puedes cerrar esta pestaña y volver a Kuidy Lyrics.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kuidy Lyrics</title>
<style>body{font-family:system-ui;background:#0a0a0f;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{padding:32px 40px;border-radius:16px;background:#15151c;border:1px solid #2a2a35;text-align:center;max-width:400px}
h1{margin:0 0 8px;font-size:22px;font-weight:600}p{margin:0;color:#9a9aae;font-size:14px}
.ok{color:#7dd3a0}.err{color:#f87171}</style></head>
<body><div class="card">
${body}
</div></body></html>`;
}

// ---------- servidor de callback ----------

function closeServer(server) {
  try {
    server.close();
    // Una conexión keep-alive del navegador puede mantener el puerto ocupado
    // después del close() y hacer fallar el siguiente intento de conexión.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  } catch {
    // el servidor ya estaba cerrado
  }
}

// Levanta el servidor y devuelve tres cosas separadas a propósito: `listening`
// para saber si el puerto es nuestro ANTES de abrir el navegador, `code` con el
// resultado del callback, y `abort` para cancelarlo desde fuera.
function createCallbackServer(expectedState) {
  let resolveCode;
  let rejectCode;
  const code = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // El flujo puede morir en `listening` sin que nadie llegue a esperar `code`;
  // sin este handler eso sería un unhandled rejection que tumba el proceso.
  code.catch(() => {});

  let settled = false;
  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    // El navegador pide /favicon.ico por su cuenta. Antes cualquier petición
    // cerraba el servidor, así que ese favicon mataba el flujo antes de que
    // llegara el callback real.
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const authCode = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const denied = url.searchParams.get('error');

    // El veredicto se decide ANTES de pintar el HTML: antes se respondía
    // "¡Conectado!" y solo después se validaba el state, de modo que una
    // respuesta manipulada veía la tarjeta de éxito.
    let failure = null;
    if (denied === 'access_denied') {
      failure = fail('auth', 'Cancelaste el permiso en Spotify.');
    } else if (denied) {
      failure = fail('auth', `Spotify rechazó la autorización (${denied}).`);
    } else if (!authCode) {
      failure = fail('unknown', 'Spotify no devolvió el código de autorización.');
    } else if (state !== expectedState) {
      failure = fail(
        'unknown',
        'La respuesta no coincide con la petición que hicimos. Vuelve a intentarlo.'
      );
    }

    res.writeHead(failure ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderCallbackPage(failure ? failure.message : null), () => closeServer(server));

    if (failure) settle(rejectCode, failure);
    else settle(resolveCode, authCode);
  });

  let rejectListening;
  const listening = new Promise((resolve, reject) => {
    rejectListening = reject;
    server.once('listening', resolve);
    server.on('error', (err) => {
      const mapped =
        err && err.code === 'EADDRINUSE'
          ? fail(
              'unknown',
              `El puerto ${REDIRECT_PORT} está ocupado por otro programa. Ciérralo y vuelve a intentarlo.`
            )
          : fail(
              'unknown',
              `No se pudo abrir el servidor local de conexión (${err?.code || 'error'}).`
            );
      log.warn('spotify', 'fallo del servidor de callback', err);
      // Si el error llega ya escuchando, el reject de `listening` es un no-op y
      // lo que corta el flujo es el de `code`.
      reject(mapped);
      settle(rejectCode, mapped);
      closeServer(server);
    });
  });

  // Si el flujo se cancela antes de que salte 'listening', cerrar el servidor
  // hace que ese evento no llegue nunca: sin este catch, `listening` quedaría
  // pendiente para siempre y la promesa de authenticate() no volvería.
  listening.catch(() => {});

  server.listen(REDIRECT_PORT, '127.0.0.1');

  return {
    server,
    listening,
    code,
    abort(err) {
      rejectListening(err);
      settle(rejectCode, err);
      closeServer(server);
    },
    close() {
      closeServer(server);
    },
  };
}

// ---------- flujo de autenticación ----------

function isAuthenticating() {
  return !!authFlow;
}

// Cierra el servidor, limpia el timer y rechaza la promesa en vuelo. Sin esto,
// un intento abandonado dejaba el puerto ocupado durante minutos y el siguiente
// intento chocaba con nuestro propio EADDRINUSE.
function cancelAuthentication() {
  const flow = authFlow;
  if (!flow) return false;
  authFlow = null;
  clearTimeout(flow.timer);
  log.info('spotify', 'conexión con Spotify cancelada');
  flow.abort(fail('unknown', 'Conexión cancelada.'));
  return true;
}

async function authenticate({ openUrl }) {
  if (!clientId) {
    throw fail('unknown', 'Falta el Client ID de Spotify. Pégalo en los ajustes de Kuidy Lyrics.');
  }

  // Un segundo intento siempre gana al anterior: si el usuario cerró la pestaña
  // del navegador, el flujo viejo seguiría vivo y bloquearía el puerto.
  if (authFlow) cancelAuthentication();

  const { verifier, challenge } = generatePkcePair();
  const state = base64urlEncode(crypto.randomBytes(16));

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', SCOPES);

  const callback = createCallbackServer(state);
  const flow = { timer: null, abort: callback.abort };
  authFlow = flow;

  try {
    // Esperar a 'listening' es lo que impide el bug gordo: si el puerto está
    // ocupado por otro programa y abrimos el navegador igualmente, Spotify le
    // entrega NUESTRO código de autorización a ese proceso ajeno.
    await callback.listening;
    log.info('spotify', `servidor de callback escuchando en 127.0.0.1:${REDIRECT_PORT}`);

    flow.timer = setTimeout(() => {
      log.warn('spotify', 'el flujo de conexión caducó sin respuesta de Spotify');
      callback.abort(
        fail('auth', 'Se agotó el tiempo para conectar con Spotify. Vuelve a intentarlo.')
      );
    }, AUTH_TIMEOUT_MS);

    try {
      await openUrl(authUrl.toString());
    } catch (err) {
      throw fail('unknown', 'No se pudo abrir el navegador para autorizar en Spotify.', {
        cause: err,
      });
    }

    const code = await callback.code;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    });
    const data = await postToken(body, 'login');

    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in - 30) * 1000,
    };
    persistTokens();
    log.info('spotify', 'sesión de Spotify iniciada');
    return tokens;
  } finally {
    clearTimeout(flow.timer);
    callback.close();
    // Si mientras tanto arrancó otro flujo (cancelAuthentication ya puso
    // authFlow a null), no lo pisamos.
    if (authFlow === flow) authFlow = null;
  }
}

// ---------- tokens ----------

function persistTokens() {
  // Sin DPAPI, config.saveTokens no escribe nada a propósito para no dejar el
  // refresh token en claro. La sesión sigue viva en memoria hasta cerrar la app.
  if (!saveTokens(tokens)) {
    log.warn('spotify', 'la sesión no se pudo guardar cifrada: durará hasta cerrar la app');
  }
}

function tokenError(status, raw, resp, phase) {
  if (status === 429) {
    return fail('ratelimit', MSG.ratelimit, { retryAfterMs: retryAfterMs(resp) });
  }
  if (status >= 500) return fail('server', MSG.server);

  const code = spotifyErrorCode(raw);
  if (code === 'invalid_client') {
    return fail(
      'unknown',
      'Spotify no reconoce ese Client ID. Revísalo en los ajustes de Kuidy Lyrics.'
    );
  }
  if (code === 'invalid_grant') {
    // En el refresco significa que el permiso se revocó o caducó: quien llama
    // debe cerrar sesión en vez de reintentar eternamente.
    if (phase === 'refresh') return fail('auth', MSG.auth, { authRevoked: true });
    return fail('auth', 'Spotify rechazó el código de autorización. Vuelve a intentarlo.');
  }
  if (status === 400 || status === 401) {
    return fail(
      'auth',
      phase === 'refresh' ? MSG.auth : 'Spotify rechazó la conexión. Vuelve a intentarlo.',
      phase === 'refresh' ? { authRevoked: true } : undefined
    );
  }
  if (status === 403) return fail('forbidden', MSG.forbidden);
  return fail('unknown', 'Spotify no pudo completar la conexión. Vuelve a intentarlo.');
}

async function postToken(body, phase) {
  const resp = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const raw = await resp.text().catch(() => '');
    const err = tokenError(resp.status, raw, resp, phase);
    // Se registra solo el código de error de Spotify, nunca el cuerpo: en las
    // respuestas de este endpoint viajan tokens.
    log.warn(
      'spotify',
      `${phase}: Spotify respondió ${resp.status}`,
      spotifyErrorCode(raw) || undefined
    );
    throw err;
  }
  const raw = await readText(resp);
  try {
    return JSON.parse(raw);
  } catch {
    throw fail('server', MSG.server);
  }
}

async function doRefresh() {
  if (!tokens?.refresh_token) throw fail('auth', MSG.auth, { authRevoked: true });
  if (!clientId) {
    throw fail('unknown', 'Falta el Client ID de Spotify. Pégalo en los ajustes de Kuidy Lyrics.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  });
  const data = await postToken(body, 'refresh');
  tokens = {
    access_token: data.access_token,
    // Spotify no siempre devuelve uno nuevo; conservamos el que ya teníamos.
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in - 30) * 1000,
  };
  persistTokens();
  return tokens;
}

function refreshAccessToken() {
  // Spotify puede rotar el refresh token en cada refresco: dos refrescos a la
  // vez invalidarían el token del otro y tirarían la sesión. Compartimos el que
  // ya está en vuelo.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function getAccessToken() {
  if (!tokens) throw fail('auth', MSG.auth, { authRevoked: true });
  if (Date.now() >= (tokens.expires_at || 0)) {
    await refreshAccessToken();
  }
  return tokens.access_token;
}

// ---------- Web API ----------

function apiError(resp) {
  if (resp.status === 401) return fail('auth', MSG.auth, { authRevoked: true });
  if (resp.status === 403) return fail('forbidden', MSG.forbidden);
  if (resp.status === 429) {
    return fail('ratelimit', MSG.ratelimit, { retryAfterMs: retryAfterMs(resp) });
  }
  if (resp.status >= 500) return fail('server', MSG.server);
  return fail('unknown', 'Spotify no respondió a lo que le pedimos.');
}

function requestPlayer(token) {
  return fetchWithTimeout(PLAYER_URL, { headers: { Authorization: `Bearer ${token}` } });
}

async function getCurrentlyPlaying() {
  if (!isAuthenticated()) return null;

  let resp = await requestPlayer(await getAccessToken());
  if (resp.status === 401) {
    // El access token pudo caducar entre nuestro cálculo de expires_at y la
    // petición: un refresco y un reintento antes de dar la sesión por perdida.
    await refreshAccessToken();
    resp = await requestPlayer(await getAccessToken());
  }

  if (resp.status === 204) return null; // no hay nada sonando
  if (!resp.ok) throw apiError(resp);

  const raw = await readText(resp);
  if (!raw) return null; // 200 con cuerpo vacío: Spotify lo hace de vez en cuando
  try {
    return JSON.parse(raw);
  } catch {
    throw fail('server', MSG.server);
  }
}

module.exports = {
  setClientId,
  loadTokensFromDisk,
  isAuthenticated,
  authenticate,
  cancelAuthentication,
  isAuthenticating,
  logout,
  getCurrentlyPlaying,
};
