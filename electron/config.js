const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const log = require('./log');

function configPath() {
  return path.join(app.getPath('userData'), 'kuidy-config.json');
}

// Única fuente de defaults de la app: lo que loadConfig no encuentre en disco
// sale de aquí, así los valores no viven repartidos por main.js y el renderer.
const DEFAULTS = {
  opacity: 0.95,
  minimalMode: false,
  clickThrough: false,
  showSubs: true, // sub-líneas: romaji / traducción bajo cada frase
  subsLang: '', // idioma de la traducción; '' = deducirlo del idioma de Windows
  translateConsent: false, // enviar letras a Google para traducir requiere un sí explícito
  fontScale: 1, // multiplicador del tamaño de letra (0.8 – 1.6)
  guideSeen: false, // la guía de atajos se muestra hasta que el usuario la descarte
  clientId: '', // Client ID de Spotify del propio usuario (ver getClientId)
};

let cache = null;

function loadConfig() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function saveConfig(cfg) {
  cache = { ...DEFAULTS, ...cfg };
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    log.error('config', 'no se pudo guardar la config', err);
  }
}

// Azúcar para el patrón read-modify-write, que aparecía repetido en cada
// handler de ipc.js y en windows.js.
function updateConfig(patch) {
  saveConfig({ ...loadConfig(), ...patch });
  return cache;
}

function tokensPath() {
  return path.join(app.getPath('userData'), 'kuidy-tokens.json');
}

// Los tokens se cifran con safeStorage (DPAPI en Windows) cuando está disponible.
// Los archivos antiguos en JSON plano se siguen leyendo y quedan cifrados en el
// siguiente guardado.
function loadTokens() {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokensPath(), 'utf8'));
    if (parsed && parsed.encrypted && parsed.data) {
      const json = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
      return JSON.parse(json);
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  try {
    fs.mkdirSync(path.dirname(tokensPath()), { recursive: true });
    let payload;
    if (safeStorage.isEncryptionAvailable()) {
      const data = safeStorage.encryptString(JSON.stringify(tokens)).toString('base64');
      payload = JSON.stringify({ encrypted: true, data });
    } else {
      // Sin DPAPI el refresh token quedaría en claro en el disco. Preferimos no
      // persistirlo: el usuario tendrá que reconectar en cada arranque, que es
      // molesto pero no filtra el acceso a su cuenta.
      log.warn('tokens', 'safeStorage no disponible: la sesión no se guardará en disco');
      return false;
    }
    fs.writeFileSync(tokensPath(), payload, 'utf8');
    return true;
  } catch (err) {
    log.error('tokens', 'no se pudieron guardar los tokens', err);
    return false;
  }
}

function clearTokens() {
  try {
    fs.unlinkSync(tokensPath());
  } catch {
    // ignore
  }
}

// ---------- Client ID de Spotify ----------
// Spotify limita cada app en Development Mode a 5 cuentas añadidas a mano, y
// desde mayo de 2025 el modo ampliado solo se concede a empresas con 250k
// usuarios activos. De ahí el modelo en dos escalones:
//
//   1. El build puede llevar horneado el Client ID del desarrollador. Quien esté
//      en sus 5 plazas solo tiene que pulsar Conectar: cero configuración. Y el
//      único que necesita Spotify Premium es el dueño de la app.
//   2. Quien no quepa recibe un 403, y entonces la app le ofrece crear su propia
//      app y pegar su Client ID. Eso no tiene techo de usuarios, pero convierte
//      a cada usuario en dueño de su app y por tanto le exige Premium a él.
//
// El .env queda como comodidad de desarrollo.
const CLIENT_ID_RE = /^[0-9a-f]{32}$/i;

function isValidClientId(id) {
  return CLIENT_ID_RE.test(String(id || '').trim());
}

// El Client ID que scripts/bundle-client-id.js hornea en el build. El modulo no
// existe hasta que corre ese script, de ahi el require defensivo.
let bundledCache;
function getBundledClientId() {
  if (bundledCache === undefined) {
    try {
      bundledCache = String(require('./bundled-client-id') || '').trim();
    } catch {
      bundledCache = '';
    }
  }
  return bundledCache;
}

// Prioridad: lo que haya pegado el usuario gana siempre, porque si esta aqui es
// que el horneado no le servia (no esta en la lista de 5 de esa app, o su
// cuenta quedo bloqueada). Despues el horneado, y el .env solo en desarrollo.
function getClientId() {
  const own = String(loadConfig().clientId || '').trim();
  if (own) return { id: own, source: 'user' };
  const bundled = getBundledClientId();
  if (bundled) return { id: bundled, source: 'bundled' };
  const fromEnv = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
  if (fromEnv) return { id: fromEnv, source: 'env' };
  return { id: '', source: 'none' };
}

function setClientId(id) {
  updateConfig({ clientId: String(id || '').trim() });
}

// ---------- Idioma de las sub-líneas ----------
// Sin preferencia explícita usamos el idioma de Windows, no un 'es' cableado:
// traducir al español a alguien que no lo habla convierte la función estrella
// de la app en ruido.
function getSubsLang() {
  const chosen = String(loadConfig().subsLang || '').trim();
  if (chosen) return chosen;
  try {
    return (app.getLocale() || 'en').split('-')[0].toLowerCase();
  } catch {
    return 'en';
  }
}

// Arranque con Windows. Solo tiene efecto empaquetada: en desarrollo,
// setLoginItemSettings registraría electron.exe a secas, que al iniciar
// sesión abriría la ventana por defecto de Electron en vez de la app.
function getOpenAtLogin() {
  if (!app.isPackaged) return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (err) {
    log.warn('config', 'no se pudo leer openAtLogin', err);
    return false;
  }
}

function setOpenAtLogin(enabled) {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
  } catch (err) {
    log.warn('config', 'no se pudo escribir openAtLogin', err);
  }
}

module.exports = {
  DEFAULTS,
  loadConfig,
  saveConfig,
  updateConfig,
  loadTokens,
  saveTokens,
  clearTokens,
  getClientId,
  setClientId,
  isValidClientId,
  getSubsLang,
  getOpenAtLogin,
  setOpenAtLogin,
};
