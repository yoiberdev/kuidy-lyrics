const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { loadConfig, saveConfig, getOpenAtLogin } = require('./config');
const spotify = require('./spotify');
const ctx = require('./context');

// tray.js y poller.js también llaman a funciones de este módulo, así que los
// requerimos de forma perezosa dentro de cada función para no crear un ciclo
// de require en tiempo de carga.

let lastPopoverBlurAt = 0;
let popoverBlurTimer = null;
const POPOVER_BLUR_GRACE_MS = 180;

// ---------- Ventana principal (overlay de letras) ----------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const cfg = loadConfig();

  const width = cfg.windowW ?? 440;
  const height = cfg.windowH ?? 220;
  let x = cfg.windowX ?? workArea.x + workArea.width - width - 24;
  let y = cfg.windowY ?? workArea.y + 24;

  // Si la posición guardada quedó fuera de todas las pantallas (p. ej. se
  // desconectó un monitor), volver a la esquina por defecto del display primario.
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      x + width > a.x + 8 &&
      x < a.x + a.width - 8 &&
      y + height > a.y + 8 &&
      y < a.y + a.height - 8
    );
  });
  if (!onScreen) {
    x = workArea.x + workArea.width - width - 24;
    y = workArea.y + 24;
  }

  const mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
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
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ctx.mainWindow = mainWindow;

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (ctx.isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173/');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    const c = loadConfig();
    // Con la guía pendiente no se activa el click-through: sus botones
    // necesitan recibir clicks. guideDismissed lo aplica al cerrar.
    if (c.minimalMode && c.guideSeen) {
      mainWindow.setIgnoreMouseEvents(true, { forward: false });
    }
    if (c.opacity != null) mainWindow.setOpacity(c.opacity);
  });

  const saveBounds = () => {
    if (!ctx.mainWindow) return;
    const b = ctx.mainWindow.getBounds();
    const c = loadConfig();
    saveConfig({ ...c, windowX: b.x, windowY: b.y, windowW: b.width, windowH: b.height });
  };
  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

  // Cerrar desde su propio botón solo la oculta (la app sigue en la bandeja)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('show', () => {
    require('./tray').rebuildTrayMenu();
    sendPopoverState();
    require('./poller').pokePolling();
  });

  mainWindow.on('hide', () => {
    require('./tray').rebuildTrayMenu();
    sendPopoverState();
  });
}

// ---------- Popover (menú de la bandeja) ----------
function createPopoverWindow() {
  const popoverWindow = new BrowserWindow({
    width: 320,
    height: 560,
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
    },
  });
  ctx.popoverWindow = popoverWindow;

  popoverWindow.setAlwaysOnTop(true, 'pop-up-menu');

  if (ctx.isDev) {
    popoverWindow.loadURL('http://127.0.0.1:5173/#popover');
  } else {
    popoverWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'popover' });
  }

  // Blur con periodo de gracia: si el foco vuelve en POPOVER_BLUR_GRACE_MS
  // (parpadeos de foco por el reordenado de always-on-top en Windows),
  // se cancela el ocultado y el popover sigue abierto.
  popoverWindow.on('blur', () => {
    lastPopoverBlurAt = Date.now();
    if (popoverBlurTimer) clearTimeout(popoverBlurTimer);
    popoverBlurTimer = setTimeout(() => {
      popoverBlurTimer = null;
      if (
        popoverWindow &&
        !popoverWindow.isDestroyed() &&
        popoverWindow.isVisible() &&
        !popoverWindow.isFocused()
      ) {
        popoverWindow.hide();
      }
    }, POPOVER_BLUR_GRACE_MS);
  });

  popoverWindow.on('focus', () => {
    if (popoverBlurTimer) {
      clearTimeout(popoverBlurTimer);
      popoverBlurTimer = null;
    }
  });

  popoverWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      popoverWindow.hide();
    }
  });
}

function positionPopover() {
  const { tray, popoverWindow } = ctx;
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
  const { popoverWindow } = ctx;
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
  require('./poller').pokePolling();
}

function sendPopoverState() {
  const { popoverWindow, mainWindow } = ctx;
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  const cfg = loadConfig();
  popoverWindow.webContents.send('popover:state', {
    overlayVisible: !!(mainWindow && mainWindow.isVisible()),
    minimalMode: !!cfg.minimalMode,
    opacity: cfg.opacity,
    showSubs: !!cfg.showSubs,
    fontScale: cfg.fontScale,
    isAuthenticated: spotify.isAuthenticated(),
    hasClientId: !!ctx.clientId,
    openAtLogin: getOpenAtLogin(),
    playback: ctx.lastPlaybackPayload,
  });
}

function applyMinimalMode(enabled) {
  const { mainWindow } = ctx;
  if (!mainWindow) return;
  const cfg = loadConfig();
  saveConfig({ ...cfg, minimalMode: !!enabled, clickThrough: !!enabled });
  mainWindow.setIgnoreMouseEvents(!!enabled, { forward: false });
  mainWindow.setHasShadow(false);
  mainWindow.webContents.send('settings:minimalMode', !!enabled);
  mainWindow.webContents.send('settings:clickThrough', !!enabled);
  require('./tray').rebuildTrayMenu();
  sendPopoverState();
}

module.exports = {
  createWindow,
  createPopoverWindow,
  positionPopover,
  togglePopover,
  sendPopoverState,
  applyMinimalMode,
};
