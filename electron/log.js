// Log a fichero. Empaquetada, la app corre como binario GUI de Windows: no hay
// consola adjunta y todo lo que va a console.* se pierde. Sin esto, un beta
// tester que dice "no me funciona" no deja ningún rastro que podamos leer.
//
// El fichero vive en %APPDATA%\kuidy-lyrics\logs\main.log y se puede abrir
// desde la bandeja. Como está pensado para que el tester nos lo mande, todo lo
// que huela a credencial se redacta antes de escribir.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const MAX_BYTES = 512 * 1024; // al pasarse, main.log pasa a main.log.1 y se empieza de cero

function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function logPath() {
  return path.join(logDir(), 'main.log');
}

let dirReady = false;
function ensureDir() {
  if (dirReady) return true;
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    dirReady = true;
  } catch {
    dirReady = false;
  }
  return dirReady;
}

function rotateIfNeeded() {
  try {
    if (fs.statSync(logPath()).size > MAX_BYTES) {
      fs.renameSync(logPath(), `${logPath()}.1`);
    }
  } catch {
    // no existe todavía, o no se puede rotar: da igual, seguimos escribiendo
  }
}

// Los tokens de Spotify y el Client ID no deben acabar en un fichero que el
// usuario nos va a enviar por chat. El refresh token es especialmente sensible:
// da acceso a la cuenta hasta que se revoque.
const SECRET_PATTERNS = [
  [/(access_token|refresh_token|code_verifier|client_secret)["'\s:=]+[A-Za-z0-9._~+/-]+/gi, '$1=<redactado>'],
  [/(client_id|code)=([A-Za-z0-9._~+/-]{8,})/gi, '$1=<redactado>'],
  [/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer <redactado>'],
];

function redact(text) {
  let out = String(text);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function format(level, scope, msg, extra) {
  const ts = new Date().toISOString();
  let line = `${ts} ${level.padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    let detail;
    if (extra instanceof Error) detail = extra.stack || extra.message;
    else if (typeof extra === 'string') detail = extra;
    else {
      try {
        detail = JSON.stringify(extra);
      } catch {
        detail = String(extra);
      }
    }
    line += ` :: ${detail}`;
  }
  return redact(line) + '\n';
}

function write(level, scope, msg, extra) {
  const line = format(level, scope, msg, extra);
  // En desarrollo seguimos viéndolo en la terminal, que es más cómodo.
  if (process.env.NODE_ENV === 'development') process.stdout.write(line);
  if (!ensureDir()) return;
  try {
    rotateIfNeeded();
    fs.appendFileSync(logPath(), line, 'utf8');
  } catch {
    // Si no podemos escribir el log, no hay nada mejor que hacer: perder una
    // línea nunca debe tumbar la app.
  }
}

const info = (scope, msg, extra) => write('INFO', scope, msg, extra);
const warn = (scope, msg, extra) => write('WARN', scope, msg, extra);
const error = (scope, msg, extra) => write('ERROR', scope, msg, extra);

function openLogFolder() {
  ensureDir();
  return shell.openPath(logDir());
}

// Se llama una vez al arrancar para que cada sesión sea identificable en el
// fichero: sin esto, un log de varias semanas es ilegible.
function logStartup() {
  write('INFO', 'app', '─'.repeat(60));
  write('INFO', 'app', 'Kuidy Lyrics arranca', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    packaged: app.isPackaged,
    locale: app.getLocale(),
  });
}

module.exports = { info, warn, error, logStartup, logPath, logDir, openLogFolder, redact };
