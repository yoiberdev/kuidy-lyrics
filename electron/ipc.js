const { app, ipcMain, shell } = require('electron');
const {
  loadConfig,
  updateConfig,
  getOpenAtLogin,
  setOpenAtLogin,
  getClientId,
  setClientId: saveClientId,
  isValidClientId,
  getSubsLang,
} = require('./config');
const log = require('./log');
const spotify = require('./spotify');
const ctx = require('./context');
const windows = require('./windows');
const poller = require('./poller');

// La URI de retorno del login. Se repite aquí (spotify.js tiene la suya) porque
// el usuario tiene que pegarla tal cual en el dashboard de Spotify: la interfaz
// la muestra desde app:getStatus y una errata en ella rompe el login entero.
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';

const GENERIC_AUTH_ERROR =
  'No se pudo conectar con Spotify. Vuelve a intentarlo; si sigue fallando, abre el registro desde el icono de la bandeja.';

// Mensajes del fallo de login por err.kind (spotify.js lo adjunta). Sin esto al
// usuario le llegaría un "Spotify API 403" que no le dice qué tiene que hacer.
const AUTH_ERROR_MESSAGES = {
  auth: `Spotify rechazó la conexión. Comprueba que el Client ID es el de tu app y que su Redirect URI es exactamente ${REDIRECT_URI}.`,
  forbidden:
    'Tu cuenta no está autorizada en esta app de Spotify. Añade tu email en el dashboard de Spotify, en Settings > User Management.',
  ratelimit: 'Spotify nos está limitando. Espera unos segundos y vuelve a intentarlo.',
  network: 'Sin conexión con Spotify. Comprueba tu conexión a internet y vuelve a intentarlo.',
  server: 'Spotify está teniendo problemas ahora mismo. Inténtalo de nuevo en un par de minutos.',
};

// Cadenas que vienen de fetch, de node o de la propia API: son ruido técnico y
// nunca se enseñan. El resto de mensajes que lanza spotify.js (tiempo agotado,
// state inválido, cancelación) ya están redactados en español para el usuario.
const TECHNICAL_MESSAGE_RE =
  /^(spotify api|fetch|listen |connect |socket|econn|etimedout|enotfound|eaddrinuse|network|request to|unexpected token)/i;

function authErrorMessage(err) {
  if (!err) return GENERIC_AUTH_ERROR;
  // El servidor de callback necesita el 8888 en exclusiva: si otro programa lo
  // tiene cogido, el login no llega a empezar y conviene decirlo con nombre.
  if (err.code === 'EADDRINUSE') {
    return 'El puerto 8888 está ocupado por otro programa y Kuidy lo necesita para recibir la respuesta de Spotify. Ciérralo y vuelve a intentarlo.';
  }
  const mapped = AUTH_ERROR_MESSAGES[err.kind];
  if (mapped) return mapped;
  const raw = String(err.message || '').trim();
  if (raw && !TECHNICAL_MESSAGE_RE.test(raw)) return raw;
  return GENERIC_AUTH_ERROR;
}

// Preferencias de presentación que el overlay aplica en caliente.
function sendPrefs() {
  const cfg = loadConfig();
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send('settings:prefs', {
      showSubs: cfg.showSubs,
      fontScale: cfg.fontScale,
      subsLang: getSubsLang(),
    });
  }
}

// Estado completo de la app. Lo consumen el overlay y el popover, así que vive
// en una sola función: app:getStatus y el evento 'status:changed' tienen que
// devolver exactamente lo mismo o las dos ventanas se desincronizan.
function buildStatus() {
  const cfg = loadConfig();
  const { id, source } = getClientId();
  return {
    hasClientId: !!id,
    clientIdSource: source,
    isAuthenticated: spotify.isAuthenticated(),
    clickThrough: cfg.clickThrough,
    opacity: cfg.opacity,
    minimalMode: cfg.minimalMode,
    showSubs: cfg.showSubs,
    subsLang: getSubsLang(),
    translateConsent: !!cfg.translateConsent,
    fontScale: cfg.fontScale,
    guideSeen: cfg.guideSeen,
    openAtLogin: getOpenAtLogin(),
    overlayVisible: !!(ctx.mainWindow && !ctx.mainWindow.isDestroyed() && ctx.mainWindow.isVisible()),
    version: app.getVersion(),
    redirectUri: REDIRECT_URI,
    logPath: log.logPath(),
  };
}

// Empuja el estado a las dos ventanas. Es lo que evita que el overlay se quede
// clavado en "Conecta con Spotify" cuando el usuario conecta desde el popover:
// el overlay no se entera de nada si nadie se lo cuenta.
function emitStatus() {
  windows.broadcastStatus(buildStatus());
}

// Un handler que lanza deja al renderer con una promesa rechazada y sin ningún
// rastro en el log, que es justo lo que no podemos permitirnos en la beta.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      log.error('ipc', `el handler ${channel} falló`, err);
      return {
        ok: false,
        error: 'Algo falló dentro de Kuidy. Abre el registro desde el icono de la bandeja para ver el detalle.',
      };
    }
  });
}

function registerIpc() {
  handle('app:getStatus', () => buildStatus());

  handle('app:getPlayback', () => ctx.lastPlaybackPayload);

  handle('app:getLyrics', () => ctx.lastLyricsPayload);

  handle('spotify:authenticate', async () => {
    // El login abre un navegador y levanta un servidor en el 8888: dos flujos a
    // la vez chocarían por el puerto y dejarían el primero colgado.
    if (spotify.isAuthenticating()) {
      return { ok: false, error: 'Ya hay una conexión en curso.' };
    }
    const { id } = getClientId();
    if (!id) {
      return {
        ok: false,
        error: 'Todavía no has puesto tu Client ID de Spotify. Crea tu app en el dashboard de Spotify y pega aquí su Client ID.',
      };
    }
    spotify.setClientId(id);
    try {
      await spotify.authenticate({ openUrl: (url) => shell.openExternal(url) });
      log.info('ipc', 'sesión de Spotify iniciada');
      poller.startPolling();
      windows.sendPopoverState();
      emitStatus();
      return { ok: true };
    } catch (err) {
      log.warn('ipc', 'la autenticación con Spotify falló', err);
      // También hay que avisar cuando falla: el overlay pudo pintar un "conectando"
      // que si no se queda ahí para siempre.
      windows.sendPopoverState();
      emitStatus();
      return { ok: false, error: authErrorMessage(err) };
    }
  });

  handle('spotify:cancelAuth', () => {
    spotify.cancelAuthentication();
    log.info('ipc', 'el usuario canceló la conexión con Spotify');
    windows.sendPopoverState();
    emitStatus();
    return { ok: true };
  });

  handle('spotify:setClientId', (_e, id) => {
    const clean = String(id || '').trim();
    if (!isValidClientId(clean)) {
      return {
        ok: false,
        error: 'El Client ID debe tener 32 caracteres (letras de la a a la f y números). Cópialo del dashboard de Spotify.',
      };
    }
    // Los tokens son de una app concreta de Spotify: con otro Client ID el
    // refresh token guardado deja de valer, así que la sesión anterior se cierra
    // antes de guardar en vez de dejar al usuario con un 401 permanente.
    const previous = getClientId().id;
    if (previous && previous.toLowerCase() !== clean.toLowerCase() && spotify.isAuthenticated()) {
      log.info('ipc', 'el Client ID cambió: se cierra la sesión anterior');
      spotify.logout();
      poller.stopPolling();
      poller.broadcastPlayback({ playing: false });
      poller.broadcastLyrics({ lyrics: null, loadingLyrics: false });
    }
    saveClientId(clean);
    spotify.setClientId(clean);
    ctx.clientId = clean;
    log.info('ipc', 'Client ID de Spotify guardado');
    windows.sendPopoverState();
    emitStatus();
    return { ok: true };
  });

  handle('spotify:logout', () => {
    spotify.logout();
    poller.stopPolling();
    poller.broadcastPlayback({ playing: false });
    poller.broadcastLyrics({ lyrics: null, loadingLyrics: false });
    log.info('ipc', 'sesión de Spotify cerrada');
    windows.sendPopoverState();
    emitStatus();
    return { ok: true };
  });

  handle('app:openLogs', () => {
    log.openLogFolder();
    return { ok: true, path: log.logPath() };
  });

  // El renderer no puede abrir ventanas ni navegar (windows.js lo deniega), así
  // que el asistente de configuración necesita esta salida para llevar al
  // usuario al dashboard de Spotify. Solo https, y solo a los dominios que la
  // propia app enseña: un openExternal abierto sería una primitiva de ejecución
  // regalada a cualquiera que llegara a inyectar algo en el renderer.
  const EXTERNAL_ALLOWED = new Set([
    'developer.spotify.com',
    'lrclib.net',
    'github.com',
    'ko-fi.com',
    'buymeacoffee.com',
  ]);
  handle('app:openExternal', async (_e, url) => {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      return { ok: false, error: 'Enlace no válido.' };
    }
    if (parsed.protocol !== 'https:' || !EXTERNAL_ALLOWED.has(parsed.hostname)) {
      log.warn('ipc', 'openExternal bloqueado', { host: parsed.hostname });
      return { ok: false, error: 'Enlace no permitido.' };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  });

  handle('window:hideOverlay', () => {
    if (ctx.mainWindow) ctx.mainWindow.hide();
    emitStatus();
  });

  handle('window:showOverlay', () => {
    if (ctx.mainWindow) ctx.mainWindow.showInactive();
    emitStatus();
  });

  handle('window:toggleOverlay', () => {
    const w = ctx.mainWindow;
    if (!w) return;
    if (w.isVisible()) w.hide();
    else w.showInactive();
    emitStatus();
  });

  handle('window:close', () => {
    if (ctx.mainWindow) ctx.mainWindow.hide();
    emitStatus();
  });

  handle('window:setOpacity', (_e, value) => {
    if (!ctx.mainWindow) return;
    const v = Math.max(0.3, Math.min(1, Number(value) || 1));
    ctx.mainWindow.setOpacity(v);
    updateConfig({ opacity: v });
  });

  handle('window:setMinimalMode', (_e, enabled) => {
    windows.applyMinimalMode(!!enabled);
    emitStatus();
  });

  handle('app:setShowSubs', (_e, enabled) => {
    updateConfig({ showSubs: !!enabled });
    sendPrefs();
    windows.sendPopoverState();
    emitStatus();
  });

  handle('app:setSubsLang', (_e, lang) => {
    // Códigos ISO cortos ('es', 'en', 'pt-br'): se normalizan aquí para que la
    // config no acabe con lo que sea que mande el renderer.
    const clean = String(lang || '').trim().toLowerCase().slice(0, 8);
    updateConfig({ subsLang: clean });
    log.info('ipc', `idioma de las sub-líneas: ${clean || 'automático'}`);
    sendPrefs();
    emitStatus();
    return { ok: true };
  });

  handle('app:setTranslateConsent', (_e, enabled) => {
    updateConfig({ translateConsent: !!enabled });
    log.info('ipc', `consentimiento de traducción: ${!!enabled}`);
    emitStatus();
    return { ok: true };
  });

  handle('app:setFontScale', (_e, value) => {
    const v = Math.max(0.8, Math.min(1.6, Number(value) || 1));
    updateConfig({ fontScale: v });
    sendPrefs();
  });

  handle('app:setOpenAtLogin', (_e, enabled) => {
    setOpenAtLogin(!!enabled);
    windows.sendPopoverState();
    return { ok: true, openAtLogin: getOpenAtLogin() };
  });

  // La guía necesita recibir clicks aunque el modo flotante los ignore: mientras
  // está abierta el click-through queda en suspenso y guideDismissed lo restaura
  // según la config. setGuideOpen es lo que impide que un Ctrl+Alt+M a media
  // guía la deje atrapada detrás del click-through.
  handle('app:showGuide', () => {
    const w = ctx.mainWindow;
    if (!w || w.isDestroyed()) return;
    windows.setGuideOpen(true);
    if (!w.isVisible()) w.showInactive();
    w.setIgnoreMouseEvents(false, { forward: false });
    w.webContents.send('guide:show');
  });

  handle('app:guideDismissed', (_e, dontShowAgain) => {
    updateConfig({ guideSeen: !!dontShowAgain });
    windows.setGuideOpen(false);
    windows.applyPendingClickThrough();
  });

  handle('popover:close', () => {
    const { popoverWindow } = ctx;
    if (popoverWindow && popoverWindow.isVisible()) popoverWindow.hide();
  });

  handle('app:quit', () => {
    app.isQuitting = true;
    app.quit();
  });
}

// windows.js y poller.js emiten 'status:changed' desde rutas que no nacen en un
// handler IPC (bandeja, atajos globales, sesión revocada por Spotify), así que
// necesitan llegar hasta aquí. broadcastStatus es el alias que usa el poller.
module.exports = { registerIpc, buildStatus, emitStatus, broadcastStatus: emitStatus };
