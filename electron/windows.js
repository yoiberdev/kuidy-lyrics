const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { loadConfig, updateConfig, getOpenAtLogin } = require('./config');
const spotify = require('./spotify');
const ctx = require('./context');
const log = require('./log');

// tray.js y poller.js también llaman a funciones de este módulo, así que los
// requerimos de forma perezosa dentro de cada función para no crear un ciclo
// de require en tiempo de carga.

let lastPopoverBlurAt = 0;
let popoverBlurTimer = null;
const POPOVER_BLUR_GRACE_MS = 180;

// Arrastrar la ventana emite decenas de eventos 'move' por segundo. Sin
// debounce, cada uno acababa en un readFileSync + writeFileSync de la config:
// cientos de escrituras a disco por segundo mientras el usuario coloca el
// overlay.
const BOUNDS_SAVE_DEBOUNCE_MS = 400;
let boundsTimer = null;

// La guía de atajos enseña Ctrl+Alt+M. Si el usuario lo pulsa mientras la guía
// está abierta, activar el click-through dejaría la guía en pantalla sin poder
// cerrarla: los clicks la atravesarían. Mientras esta bandera está en alto se
// guarda la preferencia pero no se toca setIgnoreMouseEvents; el click-through
// real lo aplica applyPendingClickThrough() al cerrar la guía.
let guideOpen = false;

// Origen legítimo de la interfaz. Todo lo demás se bloquea: cualquier página
// que llegase a cargarse en estas ventanas heredaría el puente window.kuidy
// completo, porque comparten preload.
const DEV_ORIGIN = 'http://127.0.0.1:5173';
const DIST_DIR = path.join(__dirname, '..', 'dist');

function isOwnUrl(target) {
  try {
    const u = new URL(target);
    if (ctx.isDev && u.protocol + '//' + u.host === DEV_ORIGIN) return true;
    if (u.protocol === 'file:') {
      // file:///C:/…/dist/index.html -> pathname trae una barra inicial que hay
      // que quitar antes de normalizar la ruta de Windows.
      const p = path.normalize(decodeURIComponent(u.pathname).replace(/^\/+/, ''));
      return p.toLowerCase().startsWith(DIST_DIR.toLowerCase());
    }
    return false;
  } catch {
    return false;
  }
}

function hardenNavigation(win, name) {
  const wc = win.webContents;

  // Ninguna ventana de Kuidy abre popups; los enlaces externos se abren con
  // shell.openExternal desde el proceso main.
  wc.setWindowOpenHandler(({ url }) => {
    log.warn('windows', 'popup bloqueado en ' + name, url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (isOwnUrl(url)) return;
    event.preventDefault();
    log.warn('windows', 'navegación externa bloqueada en ' + name, url);
  });

  wc.on('render-process-gone', (_e, details) => {
    log.error('windows', 'el renderer de ' + name + ' se cayó', details);
  });
}

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
    log.info('windows', 'la posición guardada quedaba fuera de pantalla, se recoloca');
    x = workArea.x + workArea.width - width - 24;
    y = workArea.y + 24;
  }

  // El renderer abre la guía él solo en cuanto ve guideSeen === false, sin
  // pasar por app:showGuide, así que main tiene que darla por abierta desde el
  // arranque o el Ctrl+Alt+M de la primera sesión volvería a atraparla.
  guideOpen = !cfg.guideSeen;

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
  hardenNavigation(mainWindow, 'overlay');

  if (ctx.isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173/');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error('windows', 'el overlay no pudo cargar su interfaz', { code, desc, url });
  });

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

  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('resize', scheduleSaveBounds);

  // Cerrar desde su propio botón solo la oculta (la app sigue en la bandeja)
  mainWindow.on('close', (e) => {
    // Al salir de verdad no da tiempo a que venza el debounce: sin este volcado
    // el último movimiento se perdería y la ventana reaparecería donde estaba.
    flushBounds();
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('show', () => {
    require('./tray').rebuildTrayMenu();
    sendPopoverState();
    emitStatus();
    require('./poller').pokePolling();
  });

  mainWindow.on('hide', () => {
    require('./tray').rebuildTrayMenu();
    sendPopoverState();
    emitStatus();
  });
}

// ---------- Persistencia de posición y tamaño ----------
function flushBounds() {
  if (boundsTimer) {
    clearTimeout(boundsTimer);
    boundsTimer = null;
  }
  const w = ctx.mainWindow;
  if (!w || w.isDestroyed()) return;
  try {
    const b = w.getBounds();
    updateConfig({ windowX: b.x, windowY: b.y, windowW: b.width, windowH: b.height });
  } catch (err) {
    log.warn('windows', 'no se pudo guardar la posición de la ventana', err);
  }
}

function scheduleSaveBounds() {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    boundsTimer = null;
    flushBounds();
  }, BOUNDS_SAVE_DEBOUNCE_MS);
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
  hardenNavigation(popoverWindow, 'popover');

  if (ctx.isDev) {
    popoverWindow.loadURL('http://127.0.0.1:5173/#popover');
  } else {
    popoverWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'popover' });
  }

  popoverWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error('windows', 'el popover no pudo cargar su interfaz', { code, desc, url });
  });

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
  if (!tray || !popoverWindow || popoverWindow.isDestroyed()) return;
  const winBounds = popoverWindow.getBounds();

  let trayBounds = null;
  try {
    if (!tray.isDestroyed()) trayBounds = tray.getBounds();
  } catch (err) {
    log.warn('windows', 'no se pudieron leer los límites del icono de bandeja', err);
  }

  // En Windows 11 los iconos poco usados van al desbordamiento de la bandeja y
  // getBounds devuelve un rectángulo vacío: anclar ahí el popover lo mandaría a
  // la esquina superior izquierda de la pantalla. Lo pegamos abajo a la derecha,
  // que es donde está la bandeja de todas formas.
  if (!trayBounds || trayBounds.width <= 0 || trayBounds.height <= 0) {
    const work = screen.getPrimaryDisplay().workArea;
    popoverWindow.setPosition(
      Math.round(work.x + work.width - winBounds.width - 12),
      Math.round(work.y + work.height - winBounds.height - 12),
      false
    );
    return;
  }

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
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
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
    overlayVisible: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
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

// ---------- Estado compartido por las dos ventanas ----------
// El payload lo construye ipc.js, que es quien conoce todos los campos de
// app:getStatus; aquí solo se reparte. Construirlo desde windows.js obligaría a
// requerir ipc.js en tiempo de carga y cerraría el ciclo de requires.
function broadcastStatus(status) {
  for (const w of [ctx.mainWindow, ctx.popoverWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('status:changed', status);
  }
}

// Los cambios que nacen aquí (mostrar/ocultar el overlay desde el atajo global
// o desde la bandeja, modo flotante) también deberían refrescar el estado de
// ambas ventanas. El payload solo lo sabe construir ipc.js, así que se lo
// pedimos con require perezoso; si no lo exporta, estas rutas se quedan como
// hasta ahora (el popover sigue enterándose por popover:state) en vez de
// duplicar aquí la construcción del estado.
let statusBuilderMissingLogged = false;
function emitStatus() {
  try {
    const ipc = require('./ipc');
    const build = ipc.buildStatus;
    if (typeof build !== 'function') {
      if (!statusBuilderMissingLogged) {
        statusBuilderMissingLogged = true;
        log.info('windows', 'ipc.js no exporta buildStatus: status:changed solo se emite desde ipc.js');
      }
      return;
    }
    broadcastStatus(build());
  } catch (err) {
    log.warn('windows', 'no se pudo emitir status:changed', err);
  }
}

// ---------- Modo flotante y click-through ----------
function setGuideOpen(open) {
  guideOpen = !!open;
}

// Aplica el click-through que pide la config. Se llama al cerrar la guía, que
// es cuando vuelve a ser seguro dejar que los clicks atraviesen el overlay.
function applyPendingClickThrough() {
  const { mainWindow } = ctx;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const enabled = !!loadConfig().minimalMode;
  mainWindow.setIgnoreMouseEvents(enabled, { forward: false });
}

function applyMinimalMode(enabled) {
  const { mainWindow } = ctx;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  updateConfig({ minimalMode: !!enabled, clickThrough: !!enabled });

  if (guideOpen) {
    // La guía está en pantalla y sus botones tienen que seguir siendo
    // clicables: la preferencia queda guardada y applyPendingClickThrough la
    // aplicará cuando el usuario la cierre.
    log.info('windows', 'modo flotante cambiado con la guía abierta: click-through aplazado');
  } else {
    mainWindow.setIgnoreMouseEvents(!!enabled, { forward: false });
  }

  mainWindow.setHasShadow(false);
  mainWindow.webContents.send('settings:minimalMode', !!enabled);
  mainWindow.webContents.send('settings:clickThrough', !!enabled);
  require('./tray').rebuildTrayMenu();
  sendPopoverState();
  emitStatus();
}

module.exports = {
  createWindow,
  createPopoverWindow,
  positionPopover,
  togglePopover,
  sendPopoverState,
  applyMinimalMode,
  setGuideOpen,
  applyPendingClickThrough,
  broadcastStatus,
  emitStatus,
};
