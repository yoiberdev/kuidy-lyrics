const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

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
  fontScale: 1, // multiplicador del tamaño de letra (0.8 – 1.6)
  guideSeen: false, // la guía de atajos se muestra hasta que el usuario la descarte
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] save failed:', err.message);
  }
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
      payload = JSON.stringify(tokens, null, 2);
    }
    fs.writeFileSync(tokensPath(), payload, 'utf8');
  } catch (err) {
    console.error('[tokens] save failed:', err.message);
  }
}

function clearTokens() {
  try {
    fs.unlinkSync(tokensPath());
  } catch {
    // ignore
  }
}

// Arranque con Windows. Solo tiene efecto empaquetada: en desarrollo,
// setLoginItemSettings registraría electron.exe a secas, que al iniciar
// sesión abriría la ventana por defecto de Electron en vez de la app.
function getOpenAtLogin() {
  if (!app.isPackaged) return false;
  return app.getLoginItemSettings().openAtLogin;
}

function setOpenAtLogin(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!enabled });
}

module.exports = {
  loadConfig,
  saveConfig,
  loadTokens,
  saveTokens,
  clearTokens,
  getOpenAtLogin,
  setOpenAtLogin,
};
