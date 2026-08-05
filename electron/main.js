const { app, globalShortcut } = require('electron');
const path = require('path');
// Empaquetada, la app carga el .env desde resources (ver build.extraResources en
// package.json); en desarrollo, desde la raíz del proyecto.
require('dotenv').config({
  path: app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '..', '.env'),
});

const ctx = require('./context');
const { loadConfig } = require('./config');
const spotify = require('./spotify');
const windows = require('./windows');
const tray = require('./tray');
const poller = require('./poller');
const { registerIpc } = require('./ipc');

ctx.clientId = process.env.SPOTIFY_CLIENT_ID || '';

// Una sola instancia: si la app ya está corriendo (icono en la bandeja),
// un segundo arranque solo muestra el overlay de la instancia existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) ctx.mainWindow.showInactive();
});

app.whenReady().then(() => {
  if (ctx.clientId) spotify.setClientId(ctx.clientId);
  spotify.loadTokensFromDisk();

  registerIpc();
  windows.createWindow();
  windows.createPopoverWindow();
  tray.createTray();

  globalShortcut.register('Control+Alt+H', () => {
    const w = ctx.mainWindow;
    if (!w) return;
    if (w.isVisible()) w.hide();
    else w.showInactive();
  });

  globalShortcut.register('Control+Alt+M', () => {
    const c = loadConfig();
    windows.applyMinimalMode(!c.minimalMode);
  });

  if (spotify.isAuthenticated()) {
    poller.startPolling();
  }
});

app.on('window-all-closed', () => {
  // La app vive en la bandeja; no hacer nada aquí.
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
