const { app, dialog, globalShortcut } = require('electron');
const path = require('path');
// El .env es solo un atajo de desarrollo: el instalador ya no lo empaqueta y el
// usuario final pega su propio Client ID desde la app (ver config.getClientId).
// Spotify limita cada app a 5 cuentas, así que no hay credenciales que repartir.
if (!app.isPackaged) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const ctx = require('./context');
const log = require('./log');
const { loadConfig, getClientId } = require('./config');
const spotify = require('./spotify');
const windows = require('./windows');
const tray = require('./tray');
const poller = require('./poller');
const { registerIpc } = require('./ipc');

// Un fallo en el arranque dejaba el proceso vivo, sin ventana ni icono y
// sujetando el lock de instancia única: para el usuario "la app no abre" y cada
// relanzamiento moría en silencio. Aquí se avisa, se deja rastro y se sale.
let fatalHandled = false;
function fatal(scope, err) {
  if (fatalHandled) return;
  fatalHandled = true;
  log.error(scope, 'error fatal: la app se cierra', err);
  try {
    const detalle = (err && (err.stack || err.message)) || String(err);
    dialog.showErrorBox(
      'Kuidy Lyrics no pudo continuar',
      detalle + '\n\nEl detalle completo está en:\n' + log.logPath()
    );
  } catch {
    // Si ni siquiera se puede pintar el diálogo, al menos el log ya está escrito.
  }
  app.isQuitting = true;
  try {
    app.quit();
  } catch {
    // ignore
  }
  // Red de seguridad: si el fallo dejó el bucle de eventos en un estado en el
  // que quit() no llega a cerrar nada, el proceso seguiría reteniendo el lock.
  setTimeout(() => process.exit(1), 2000).unref();
}

// Registrar uncaughtException desactiva el diálogo de error por defecto de
// Electron, así que este handler tiene que encargarse él mismo de avisar al
// usuario: si solo logueara, el único aviso visible desaparecería.
process.on('uncaughtException', (err) => {
  fatal('main', err);
});

// Una promesa rechazada no tumba el proceso, pero sí explica fallos raros
// (peticiones a Spotify o a lrclib que nadie captura).
process.on('unhandledRejection', (reason) => {
  log.error('main', 'promesa rechazada sin capturar', reason instanceof Error ? reason : String(reason));
});

// Una sola instancia: si la app ya está corriendo (icono en la bandeja),
// un segundo arranque solo muestra el overlay de la instancia existente.
if (!app.requestSingleInstanceLock()) {
  log.info('app', 'ya hay otra instancia en marcha, este proceso se cierra');
  app.quit();
  return;
}
app.on('second-instance', () => {
  log.info('app', 'segunda instancia detectada, se muestra el overlay');
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) ctx.mainWindow.showInactive();
});

// globalShortcut.register devuelve false cuando otra aplicación ya tiene el
// atajo cogido. Ignorarlo dejaba al usuario pulsando una combinación que no
// hace nada y sin ninguna pista de por qué.
function registerShortcut(accelerator, descripcion, handler) {
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, handler);
  } catch (err) {
    log.error('shortcuts', 'fallo al registrar ' + accelerator, err);
    return false;
  }
  if (!ok) {
    log.warn(
      'shortcuts',
      accelerator + ' no está disponible (otra aplicación lo tiene registrado): ' + descripcion + ' no funcionará'
    );
  }
  return ok;
}

app
  .whenReady()
  .then(() => {
    // Tras 'ready' porque la cabecera registra app.getLocale(), que en Windows
    // no es fiable antes de ese evento y es justo el dato que explica a qué
    // idioma se generan las sub-líneas.
    log.logStartup();

    // El Client ID ya no sale de process.env a pelo: config.getClientId da
    // prioridad al que haya pegado el usuario y solo cae al .env como
    // comodidad de desarrollo o beta cerrada de <=5 cuentas.
    const { id, source } = getClientId();
    ctx.clientId = id;
    if (id) {
      spotify.setClientId(id);
      log.info('app', 'Client ID de Spotify resuelto', { source });
    } else {
      log.info('app', 'sin Client ID: el usuario tendrá que introducir el suyo');
    }

    spotify.loadTokensFromDisk();

    registerIpc();
    windows.createWindow();
    windows.createPopoverWindow();
    tray.createTray();

    registerShortcut('Control+Alt+H', 'mostrar/ocultar las letras', () => {
      const w = ctx.mainWindow;
      if (!w || w.isDestroyed()) return;
      if (w.isVisible()) w.hide();
      else w.showInactive();
    });

    registerShortcut('Control+Alt+M', 'el modo flotante', () => {
      const c = loadConfig();
      windows.applyMinimalMode(!c.minimalMode);
    });

    if (spotify.isAuthenticated()) {
      poller.startPolling();
    }

    log.info('app', 'arranque completado', { autenticado: spotify.isAuthenticated() });
  })
  .catch((err) => {
    fatal('app', err);
  });

app.on('window-all-closed', () => {
  // La app vive en la bandeja; no hacer nada aquí.
});

app.on('before-quit', () => {
  app.isQuitting = true;
  log.info('app', 'cerrando');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
