const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, globalShortcut, screen } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadConfig, saveConfig } = require('./config');
const spotify = require('./spotify');
const lyrics = require('./lyrics');

const isDev = process.env.NODE_ENV === 'development';
const ENV_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';

let mainWindow = null;
let tray = null;
let pollTimer = null;
let lastTrackId = null;
let currentLyrics = null;
let isFetchingLyrics = false;

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
    skipTaskbar: false,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Above almost everything, including borderless-fullscreen games.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    const c = loadConfig();
    if (c.minimalMode) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    if (c.opacity != null) mainWindow.setOpacity(c.opacity);
  });

  // Persist window position on move/resize
  const saveBounds = () => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    const c = loadConfig();
    saveConfig({ ...c, windowX: b.x, windowY: b.y, windowW: b.width, windowH: b.height });
  };
  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopPolling();
  });
}

// ---------- Polling Spotify ----------
function startPolling() {
  stopPolling();
  const tick = async () => {
    try {
      const playing = await spotify.getCurrentlyPlaying();
      if (!mainWindow) return;

      if (!playing || !playing.item) {
        mainWindow.webContents.send('playback:update', { playing: false });
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
        mainWindow.webContents.send('playback:update', { ...payload, lyrics: null, loadingLyrics: true });

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
            if (mainWindow) {
              mainWindow.webContents.send('playback:update', { ...payload, lyrics: fetched, loadingLyrics: false });
            }
          }
          // si la canción cambió mientras buscábamos, descartamos este resultado
        } catch (err) {
          if (lastTrackId === trackId) {
            isFetchingLyrics = false;
            currentLyrics = { synced: false, plain: null, lines: [], error: err.message };
            if (mainWindow) {
              mainWindow.webContents.send('playback:update', { ...payload, lyrics: currentLyrics, loadingLyrics: false });
            }
          }
        }
      } else if (isFetchingLyrics) {
        // Mismo track pero todavía buscando letras: mantener el estado de carga
        mainWindow.webContents.send('playback:update', { ...payload, lyrics: null, loadingLyrics: true });
      } else {
        mainWindow.webContents.send('playback:update', { ...payload, lyrics: currentLyrics, loadingLyrics: false });
      }
    } catch (err) {
      console.error('[poll] error:', err.message);
      if (mainWindow) {
        mainWindow.webContents.send('playback:error', { message: err.message });
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
  };
});

ipcMain.handle('spotify:authenticate', async () => {
  if (!ENV_CLIENT_ID) {
    return {
      ok: false,
      error: 'Falta SPOTIFY_CLIENT_ID en el archivo .env del proyecto.',
    };
  }
  spotify.setClientId(ENV_CLIENT_ID);
  try {
    await spotify.authenticate({ openUrl: (url) => shell.openExternal(url) });
    startPolling();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('spotify:logout', () => {
  spotify.logout();
  stopPolling();
  if (mainWindow) {
    mainWindow.webContents.send('playback:update', { playing: false });
  }
  return { ok: true };
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());

ipcMain.handle('window:setClickThrough', (_e, enabled) => {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(!!enabled, { forward: true });
  const cfg = loadConfig();
  saveConfig({ ...cfg, clickThrough: !!enabled });
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
  // En modo minimal NO usamos forward:true para evitar que el cursor "despierte" la UI.
  mainWindow.setIgnoreMouseEvents(!!enabled, { forward: false });
  mainWindow.setHasShadow(false);
  mainWindow.webContents.send('settings:minimalMode', !!enabled);
  mainWindow.webContents.send('settings:clickThrough', !!enabled);
  rebuildTrayMenu();
}

ipcMain.handle('window:setMinimalMode', (_e, enabled) => {
  applyMinimalMode(!!enabled);
});

// ---------- System Tray ----------
function rebuildTrayMenu() {
  if (!tray) return;
  const cfg = loadConfig();
  const minimal = !!cfg.minimalMode;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Mostrar / Ocultar ventana',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
      },
    },
    { type: 'separator' },
    {
      label: minimal ? '✓  Modo flotante puro' : '   Modo flotante puro',
      click: () => applyMinimalMode(!minimal),
    },
    {
      label: 'Atajos: Ctrl+Alt+M (flotante)  ·  Ctrl+Alt+H (ocultar)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Salir de Kuidy Lyrics',
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(minimal ? 'Kuidy Lyrics — modo flotante' : 'Kuidy Lyrics');
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Kuidy Lyrics');
  // Click izquierdo: alterna visibilidad de ventana
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
  // Doble click: alterna modo flotante (acceso rápido)
  tray.on('double-click', () => {
    const c = loadConfig();
    applyMinimalMode(!(c.minimalMode ?? false));
  });
  rebuildTrayMenu();
}

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  if (ENV_CLIENT_ID) spotify.setClientId(ENV_CLIENT_ID);
  spotify.loadTokensFromDisk();

  createWindow();
  createTray();

  // Global hotkey: Ctrl+Alt+L toggles click-through mode
  globalShortcut.register('Control+Alt+L', () => {
    if (!mainWindow) return;
    const cfg = loadConfig();
    const next = !(cfg.clickThrough ?? false);
    mainWindow.setIgnoreMouseEvents(next, { forward: true });
    saveConfig({ ...cfg, clickThrough: next });
    mainWindow.webContents.send('settings:clickThrough', next);
  });

  // Global hotkey: Ctrl+Alt+H hides/shows
  globalShortcut.register('Control+Alt+H', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });

  // Global hotkey: Ctrl+Alt+M toggles minimal floating mode
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
