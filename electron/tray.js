const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const ctx = require('./context');

function rebuildTrayMenu() {
  const { tray, mainWindow } = ctx;
  if (!tray) return;
  const overlayVisible = !!(mainWindow && mainWindow.isVisible());
  const menu = Menu.buildFromTemplate([
    {
      label: overlayVisible ? 'Ocultar letras' : 'Mostrar letras',
      click: () => {
        const w = ctx.mainWindow;
        if (!w) return;
        if (w.isVisible()) w.hide();
        else w.showInactive();
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
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  ctx.tray = tray;
  tray.setToolTip('Kuidy Lyrics');

  // Click izquierdo: popover estilo Herd (require perezoso: windows.js también
  // importa de este módulo).
  tray.on('click', () => require('./windows').togglePopover());

  // El click derecho en Windows abre el menú contextual vía setContextMenu,
  // pero en algunos equipos no aparece salvo que lo lancemos explícitamente.
  tray.on('right-click', () => {
    tray.popUpContextMenu();
  });

  rebuildTrayMenu();
}

module.exports = { createTray, rebuildTrayMenu };
