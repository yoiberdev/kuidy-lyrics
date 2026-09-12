const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const ctx = require('./context');
const log = require('./log');

function toggleOverlay() {
  const w = ctx.mainWindow;
  if (!w || w.isDestroyed()) return;
  if (w.isVisible()) w.hide();
  else w.showInactive();
}

function rebuildTrayMenu() {
  const { tray, mainWindow } = ctx;
  if (!tray || tray.isDestroyed()) return;
  const overlayVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const versionLabel = 'Kuidy Lyrics v' + app.getVersion();

  const menu = Menu.buildFromTemplate([
    {
      label: overlayVisible ? 'Ocultar letras' : 'Mostrar letras',
      click: toggleOverlay,
    },
    { type: 'separator' },
    {
      // Un tester tiene que poder mandarnos el log sin ir a buscar
      // %APPDATA% a mano: es la única traza que deja la app empaquetada.
      label: 'Abrir carpeta de logs',
      click: () => {
        log.info('tray', 'el usuario abre la carpeta de logs', log.logDir());
        Promise.resolve(log.openLogFolder()).catch((err) =>
          log.warn('tray', 'no se pudo abrir la carpeta de logs', err)
        );
      },
    },
    { type: 'separator' },
    {
      label: '☕ Invitar un café (Ko-fi)',
      click: () => {
        require('electron').shell.openExternal('https://ko-fi.com/yoiberdev');
      },
    },
    {
      label: '💛 Donar en Buy Me a Coffee',
      click: () => {
        require('electron').shell.openExternal('https://buymeacoffee.com/yoiber');
      },
    },
    { type: 'separator' },
    // Entrada informativa: al reportar un fallo, lo primero que necesitamos
    // saber es qué build tiene instalada.
    { label: versionLabel, enabled: false },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(versionLabel);
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  let image = icon;

  // Sin icono el usuario no tiene forma de llegar a la app: no hay ventana en
  // la barra de tareas y el overlay puede estar oculto. No es motivo para
  // caerse, pero sí para dejarlo escrito.
  if (icon.isEmpty()) {
    log.warn('tray', 'no se pudo cargar el icono de bandeja, se usa uno vacío', iconPath);
    image = nativeImage.createEmpty();
  }

  const tray = new Tray(image);
  ctx.tray = tray;

  // Click izquierdo: popover estilo Herd (require perezoso: windows.js también
  // importa de este módulo).
  tray.on('click', () => require('./windows').togglePopover());

  // El click derecho en Windows abre el menú contextual vía setContextMenu,
  // pero en algunos equipos no aparece salvo que lo lancemos explícitamente.
  tray.on('right-click', () => {
    tray.popUpContextMenu();
  });

  rebuildTrayMenu();
  log.info('tray', 'icono de bandeja creado');
}

module.exports = { createTray, rebuildTrayMenu };
