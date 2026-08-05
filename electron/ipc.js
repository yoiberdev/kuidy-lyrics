const { app, ipcMain, shell } = require('electron');
const { loadConfig, saveConfig, getOpenAtLogin, setOpenAtLogin } = require('./config');
const spotify = require('./spotify');
const ctx = require('./context');
const windows = require('./windows');
const poller = require('./poller');

// Preferencias de presentación que el overlay aplica en caliente.
function sendPrefs() {
  const cfg = loadConfig();
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send('settings:prefs', {
      showSubs: cfg.showSubs,
      fontScale: cfg.fontScale,
    });
  }
}

function registerIpc() {
  ipcMain.handle('app:getStatus', () => {
    const cfg = loadConfig();
    return {
      hasClientId: !!ctx.clientId,
      isAuthenticated: spotify.isAuthenticated(),
      clickThrough: cfg.clickThrough,
      opacity: cfg.opacity,
      minimalMode: cfg.minimalMode,
      showSubs: cfg.showSubs,
      fontScale: cfg.fontScale,
      guideSeen: cfg.guideSeen,
      openAtLogin: getOpenAtLogin(),
      overlayVisible: !!(ctx.mainWindow && ctx.mainWindow.isVisible()),
    };
  });

  ipcMain.handle('app:getPlayback', () => ctx.lastPlaybackPayload);

  ipcMain.handle('app:getLyrics', () => ctx.lastLyricsPayload);

  ipcMain.handle('spotify:authenticate', async () => {
    if (!ctx.clientId) {
      return { ok: false, error: 'Falta SPOTIFY_CLIENT_ID en el archivo .env del proyecto.' };
    }
    spotify.setClientId(ctx.clientId);
    try {
      await spotify.authenticate({ openUrl: (url) => shell.openExternal(url) });
      poller.startPolling();
      windows.sendPopoverState();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('spotify:logout', () => {
    spotify.logout();
    poller.stopPolling();
    poller.broadcastPlayback({ playing: false });
    poller.broadcastLyrics({ lyrics: null, loadingLyrics: false });
    windows.sendPopoverState();
    return { ok: true };
  });

  ipcMain.handle('window:hideOverlay', () => {
    if (ctx.mainWindow) ctx.mainWindow.hide();
  });

  ipcMain.handle('window:showOverlay', () => {
    if (ctx.mainWindow) ctx.mainWindow.showInactive();
  });

  ipcMain.handle('window:toggleOverlay', () => {
    const w = ctx.mainWindow;
    if (!w) return;
    if (w.isVisible()) w.hide();
    else w.showInactive();
  });

  ipcMain.handle('window:close', () => {
    if (ctx.mainWindow) ctx.mainWindow.hide();
  });

  ipcMain.handle('window:setOpacity', (_e, value) => {
    if (!ctx.mainWindow) return;
    const v = Math.max(0.3, Math.min(1, Number(value) || 1));
    ctx.mainWindow.setOpacity(v);
    const cfg = loadConfig();
    saveConfig({ ...cfg, opacity: v });
  });

  ipcMain.handle('window:setMinimalMode', (_e, enabled) => {
    windows.applyMinimalMode(!!enabled);
  });

  ipcMain.handle('app:setShowSubs', (_e, enabled) => {
    const cfg = loadConfig();
    saveConfig({ ...cfg, showSubs: !!enabled });
    sendPrefs();
    windows.sendPopoverState();
  });

  ipcMain.handle('app:setFontScale', (_e, value) => {
    const v = Math.max(0.8, Math.min(1.6, Number(value) || 1));
    const cfg = loadConfig();
    saveConfig({ ...cfg, fontScale: v });
    sendPrefs();
  });

  ipcMain.handle('app:setOpenAtLogin', (_e, enabled) => {
    setOpenAtLogin(!!enabled);
    windows.sendPopoverState();
    return { ok: true, openAtLogin: getOpenAtLogin() };
  });

  // La guía necesita recibir clicks aunque el modo flotante los ignore:
  // se desactiva el click-through mientras está abierta y guideDismissed
  // lo restaura según la config.
  ipcMain.handle('app:showGuide', () => {
    const w = ctx.mainWindow;
    if (!w || w.isDestroyed()) return;
    if (!w.isVisible()) w.showInactive();
    w.setIgnoreMouseEvents(false, { forward: false });
    w.webContents.send('guide:show');
  });

  ipcMain.handle('app:guideDismissed', (_e, dontShowAgain) => {
    const cfg = loadConfig();
    saveConfig({ ...cfg, guideSeen: !!dontShowAgain });
    if (cfg.minimalMode && ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.setIgnoreMouseEvents(true, { forward: false });
    }
  });

  ipcMain.handle('popover:close', () => {
    const { popoverWindow } = ctx;
    if (popoverWindow && popoverWindow.isVisible()) popoverWindow.hide();
  });

  ipcMain.handle('app:quit', () => {
    app.isQuitting = true;
    app.quit();
  });
}

module.exports = { registerIpc };
