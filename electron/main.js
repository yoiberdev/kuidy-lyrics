const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, globalShortcut, screen } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadConfig, saveConfig } = require('./config');
const spotify = require('./spotify');
const lyrics = require('./lyrics');

const isDev = process.env.NODE_ENV === 'development';
const ENV_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';

let mainWindow = null;
let popoverWindow = null;
let tray = null;
let pollTimer = null;
let lastTrackId = null;
let currentLyrics = null;
let isFetchingLyrics = false;
let lastPlaybackPayload = { playing: false };
let lastPopoverBlurAt = 0;

// ---------- Main lyrics overlay window ----------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const cfg = loadConfig();

  const width = 440;
  const height = 220;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: cfg.windowX ?? workArea.x + workArea.width - width - 24,
    y: cfg.windowY ?? workArea.y + 24,
    minWidth: 320,
    minHeight: 140,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173/');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    const c = loadConfig();
    if (c.minimalMode) {
      mainWindow.setIgnoreMouseEvents(true, { forward: false });
    }
    if (c.opacity != null) mainWindow.setOpacity(c.opacity);
  });

  const saveBounds = () => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    const c = loadConfig();
    saveConfig({ ...c, windowX: b.x, windowY: b.y, windowW: b.width, windowH: b.height });
  };
  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

  // Closing the window from its own close button just hides it (app stays in tray)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('show', () => {
    rebuildTrayMenu();
    sendPopoverState();
  });

  mainWindow.on('hide', () => {
    rebuildTrayMenu();
    sendPopoverState();
  });
}

// ---------- Popover (tray menu) window ----------
function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: 320,
    height: 380,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  popoverWindow.setAlwaysOnTop(true, 'pop-up-menu');

  if (isDev) {
    popoverWindow.loadURL('http://127.0.0.1:5173/#popover');
  } else {
    popoverWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'popover' });
  }

  popoverWindow.on('blur', () => {
    lastPopoverBlurAt = Date.now();
    if (popoverWindow && popoverWindow.isVisible()) popoverWindow.hide();
  });

  popoverWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      popoverWindow.hide();
    }
  });
}

function positionPopover() {
  if (!tray || !popoverWindow) return;
  const trayBounds = tray.getBounds();
  const winBounds = popoverWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.floor(trayBounds.width / 2),
    y: trayBounds.y + Math.floor(trayBounds.height / 2),
  });
  const work = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  x = Math.max(work.x + 8, Math.min(x, work.x + work.width - winBounds.width - 8));

  let y;
  if (trayBounds.y > work.y + work.height / 2) {
    y = trayBounds.y - winBounds.height - 8;
  } else {
    y = trayBounds.y + trayBounds.height + 8;
  }
  y = Math.max(work.y + 8, Math.min(y, work.y + work.height - winBounds.height - 8));

  popoverWindow.setPosition(x, y, false);
}

function togglePopover() {
  if (!popoverWindow) return;
  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }
  if (Date.now() - lastPopoverBlurAt < 200) return;
  positionPopover();
  popoverWindow.show();
  popoverWindow.focus();
  sendPopoverState();
}

function sendPopoverState() {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  const cfg = loadConfig();
  popoverWindow.webContents.send('popover:state', {
    overlayVisible: !!(mainWindow && mainWindow.isVisible()),
    minimalMode: !!cfg.minimalMode,
    opacity: cfg.opacity ?? 0.95,
    isAuthenticated: spotify.isAuthenticated(),
    hasClientId: !!ENV_CLIENT_ID,
    playback: lastPlaybackPayload,
  });
}

// ---------- Polling Spotify ----------
function broadcastPlayback(payload) {
  lastPlaybackPayload = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('playback:update', payload);
  }
  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.webContents.send('playback:update', payload);
  }
}

function startPolling() {
  stopPolling();
  const tick = async () => {
    try {
      const playing = await spotify.getCurrentlyPlaying();

      if (!playing || !playing.item) {
        broadcastPlayback({ playing: false });
        return;
      }

      const trackId = playing.item.id;
      const payload = {
        playing: true,
        isPlaying: playing.is_playing,
        progressMs: playing.progress_ms,
        durationMs: playing.item.duration_ms,
        track: {
          id: trackId,
          name: playing.item.name,
          artists: playing.item.artists.map((a) => a.name),
          album: playing.item.album?.name ?? '',
          albumArt: playing.item.album?.images?.[0]?.url ?? null,
        },
      };

      if (trackId !== lastTrackId) {
        lastTrackId = trackId;
        currentLyrics = null;
        isFetchingLyrics = true;
        broadcastPlayback({ ...payload, lyrics: null, loadingLyrics: true });

        try {
          const fetched = await lyrics.fetchLyrics({
            track: playing.item.name,
            artist: playing.item.artists[0]?.name ?? '',
            album: playing.item.album?.name ?? '',
            durationSec: Math.round(playing.item.duration_ms / 1000),
          });
          if (lastTrackId === trackId) {
            currentLyrics = fetched;
            isFetchingLyrics = false;
            broadcastPlayback({ ...payload, lyrics: fetched, loadingLyrics: false });
          }
        } catch (err) {
          if (lastTrackId === trackId) {
            isFetchingLyrics = false;
            currentLyrics = { synced: false, plain: null, lines: [], error: err.message };
            broadcastPlayback({ ...payload, lyrics: currentLyrics, loadingLyrics: false });
          }
        }
      } else if (isFetchingLyrics) {
        broadcastPlayback({ ...payload, lyrics: null, loadingLyrics: true });
      } else {
        broadcastPlayback({ ...payload, lyrics: currentLyrics, loadingLyrics: false });
      }
    } catch (err) {
      console.error('[poll] error:', err.message);
      if (mainWindow) {
        mainWindow.webContents.send('playback:error', { message: err.message });
      }
      if (popoverWindow && !popoverWindow.isDestroyed()) {
        popoverWindow.webContents.send('playback:error', { message: err.message });
      }
    }
  };
  tick();
  pollTimer = setInterval(tick, 2500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastTrackId = null;
  currentLyrics = null;
  isFetchingLyrics = false;
}

// ---------- IPC ----------
ipcMain.handle('app:getStatus', () => {
  const cfg = loadConfig();
  return {
    hasClientId: !!ENV_CLIENT_ID,
    isAuthenticated: spotify.isAuthenticated(),
    clickThrough: cfg.clickThrough ?? false,
    opacity: cfg.opacity ?? 0.95,
    minimalMode: cfg.minimalMode ?? false,
    overlayVisible: !!(mainWindow && mainWindow.isVisible()),
  };
});

ipcMain.handle('app:getPlayback', () => lastPlaybackPayload);

ipcMain.handle('spotify:authenticate', async () => {
  if (!ENV_CLIENT_ID) {
    return { ok: false, error: 'Falta SPOTIFY_CLIENT_ID en el archivo .env del proyecto.' };
  }
  spotify.setClientId(ENV_CLIENT_ID);
  try {
    await spotify.authenticate({ openUrl: (url) => shell.openExternal(url) });
    startPolling();
    sendPopoverState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('spotify:logout', () => {
  spotify.logout();
  stopPolling();
  broadcastPlayback({ playing: false });
  sendPopoverState();
  return { ok: true };
});

ipcMain.handle('window:hideOverlay', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('window:showOverlay', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
});

ipcMain.handle('window:toggleOverlay', () => {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('window:setOpacity', (_e, value) => {
  if (!mainWindow) return;
  const v = Math.max(0.2, Math.min(1, Number(value) || 1));
  mainWindow.setOpacity(v);
  const cfg = loadConfig();
  saveConfig({ ...cfg, opacity: v });
});

function applyMinimalMode(enabled) {
  if (!mainWindow) return;
  const cfg = loadConfig();
  saveConfig({ ...cfg, minimalMode: !!enabled, clickThrough: !!enabled });
  mainWindow.setIgnoreMouseEvents(!!enabled, { forward: false });
  mainWindow.setHasShadow(false);
  mainWindow.webContents.send('settings:minimalMode', !!enabled);
  mainWindow.webContents.send('settings:clickThrough', !!enabled);
  rebuildTrayMenu();
  sendPopoverState();
}

ipcMain.handle('window:setMinimalMode', (_e, enabled) => {
  applyMinimalMode(!!enabled);
});

ipcMain.handle('popover:close', () => {
  if (popoverWindow && popoverWindow.isVisible()) popoverWindow.hide();
});

ipcMain.handle('app:quit', () => {
  app.isQuitting = true;
  app.quit();
});

// ---------- System Tray ----------
function rebuildTrayMenu() {
  if (!tray) return;
  const overlayVisible = !!(mainWindow && mainWindow.isVisible());
  const menu = Menu.buildFromTemplate([
    {
      label: overlayVisible ? 'Ocultar letras' : 'Mostrar letras',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else {
          mainWindow.show();
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('Kuidy Lyrics');
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Kuidy Lyrics');

  // Left click: toggle Herd-style popover (no longer hides the overlay)
  tray.on('click', togglePopover);

  // Right click on Windows opens the context menu automatically via setContextMenu,
  // but on some setups it doesn't pop up unless we trigger it explicitly.
  tray.on('right-click', () => {
    tray.popUpContextMenu();
  });

  rebuildTrayMenu();
}

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  if (ENV_CLIENT_ID) spotify.setClientId(ENV_CLIENT_ID);
  spotify.loadTokensFromDisk();

  createWindow();
  createPopoverWindow();
  createTray();

  globalShortcut.register('Control+Alt+H', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  globalShortcut.register('Control+Alt+M', () => {
    const c = loadConfig();
    applyMinimalMode(!(c.minimalMode ?? false));
  });

  if (spotify.isAuthenticated()) {
    startPolling();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep the app alive in the tray; do nothing here.
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
