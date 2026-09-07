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
// desde mayo de 2025 el modo ampliado solo se concede a empresas. Por eso la
// app no puede repartir el Client ID del desarrollador: cada usuario crea su
// propia app en el dashboard y pega aquí su Client ID. El .env sigue existiendo
// como comodidad de desarrollo y como vía para una beta cerrada de <=5 cuentas.
const CLIENT_ID_RE = /^[0-9a-f]{32}$/i;

function isValidClientId(id) {
  return CLIENT_ID_RE.test(String(id || '').trim());
}

function getClientId() {
  const own = String(loadConfig().clientId || '').trim();
  if (own) return { id: own, source: 'user' };
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
