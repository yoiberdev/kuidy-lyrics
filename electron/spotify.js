const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { loadTokens, saveTokens, clearTokens } = require('./config');

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = ['user-read-currently-playing', 'user-read-playback-state'].join(' ');

let clientId = null;
let tokens = null; // { access_token, refresh_token, expires_at }

function setClientId(id) {
  clientId = id;
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

function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1:8888');
        if (u.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const code = u.searchParams.get('code');
        const state = u.searchParams.get('state');
        const error = u.searchParams.get('error');

        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Kuidy Lyrics</title>
<style>body{font-family:system-ui;background:#0a0a0f;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{padding:32px 40px;border-radius:16px;background:#15151c;border:1px solid #2a2a35;text-align:center;max-width:400px}
h1{margin:0 0 8px;font-size:22px;font-weight:600}p{margin:0;color:#9a9aae;font-size:14px}
.ok{color:#7dd3a0}.err{color:#f87171}</style></head>
<body><div class="card">
${error ? `<h1 class="err">Algo falló</h1><p>${escapeHtml(error)}</p>` : `<h1 class="ok">¡Conectado!</h1><p>Ya puedes cerrar esta pestaña y volver a Kuidy Lyrics.</p>`}
</div></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);

        server.close();
        if (error) return settle(reject, new Error(error));
        if (!code) return settle(reject, new Error('No se recibió el código de autorización.'));
        if (state !== expectedState) return settle(reject, new Error('State mismatch (posible CSRF).'));
        settle(resolve, code);
      } catch (err) {
        try {
          res.writeHead(500);
          res.end('error');
        } catch {}
        settle(reject, err);
      }
    });
    server.on('error', (err) => settle(reject, err));
    server.listen(8888, '127.0.0.1');
    // safety timeout: 5 minutes
    timer = setTimeout(() => {
      try {
        server.close();
      } catch {}
      settle(reject, new Error('Tiempo de espera agotado para la autenticación.'));
    }, 5 * 60 * 1000);
  });
}

async function authenticate({ openUrl }) {
  if (!clientId) throw new Error('Falta el Client ID de Spotify.');

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

  const codePromise = startCallbackServer(state);
  openUrl(authUrl.toString());
  const code = await codePromise;

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Spotify token error: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 30) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshAccessToken() {
  if (!tokens?.refresh_token) throw new Error('No refresh token.');
  if (!clientId) throw new Error('Falta el Client ID.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  });
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    const err = new Error(`Refresh error: ${resp.status} ${txt}`);
    // invalid_grant = refresh token revocado o caducado: la sesión ya no sirve
    // y quien llama debe cerrar sesión en vez de reintentar.
    if (resp.status === 400 && txt.includes('invalid_grant')) {
      err.authRevoked = true;
    }
    throw err;
  }
  const data = await resp.json();
  tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in - 30) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function getAccessToken() {
  if (!tokens) throw new Error('No autenticado.');
  if (Date.now() >= (tokens.expires_at || 0)) {
    await refreshAccessToken();
  }
  return tokens.access_token;
}

async function getCurrentlyPlaying() {
  if (!isAuthenticated()) return null;
  const token = await getAccessToken();
  const resp = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 204) return null; // nothing playing
  if (resp.status === 401) {
    // token expired mid-request, refresh once and retry
    await refreshAccessToken();
    const retryToken = await getAccessToken();
    const retry = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${retryToken}` },
    });
    if (retry.status === 204) return null;
    if (!retry.ok) throw new Error(`Spotify API ${retry.status}`);
    return retry.json();
  }
  if (!resp.ok) throw new Error(`Spotify API ${resp.status}`);
  return resp.json();
}

module.exports = {
  setClientId,
  loadTokensFromDisk,
  isAuthenticated,
  authenticate,
  logout,
  getCurrentlyPlaying,
};
