const spotify = require('./spotify');
const lyrics = require('./lyrics');
const { generateSubs } = require('./subtitles');
const { loadConfig, getSubsLang } = require('./config');
const log = require('./log');
const ctx = require('./context');

const POLL_ACTIVE_MS = 2500; // reproduciendo y con alguna ventana visible
const POLL_PAUSED_MS = 5000; // música en pausa
const POLL_HIDDEN_MS = 10000; // overlay oculto y popover cerrado

// Backoff ante errores consecutivos. Sin esto, quedarse sin red o tener un 403
// permanente son 24 peticiones fallidas por minuto para siempre.
const ERROR_BACKOFF_MS = [2500, 5000, 10000, 20000, 40000, 60000];
// Spotify puede pedir esperas largas en un 429; acotamos para no dejar la app
// muda media hora ni reintentar en bucle si llega un valor absurdo.
const RETRY_AFTER_MIN_MS = 1000;
const RETRY_AFTER_MAX_MS = 5 * 60 * 1000;
// Reintentos de la letra cuando falla el servicio (no cuando no existe letra).
const LYRICS_RETRY_MS = [2000, 6000, 15000];

let pollActive = false;
let pollLoop = null;
let pollTimer = null;
let lastTrackId = null;
let currentLyrics = null;
let consecutiveErrors = 0;
let retryAfterMs = 0;
let lastErrorCode = null;

// Generación del ciclo de polling. stopPolling() la incrementa, así que todo lo
// que estaba en vuelo (un tick, una descarga de letra, una traducción) puede
// comprobar si sigue vigente antes de emitir. Sin esto, cerrar sesión con un
// tick a medias repuebla el overlay con la canción de la cuenta que se acaba de
// desconectar.
let generation = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isLive(gen) {
  return pollActive && gen === generation;
}

function broadcastPlayback(payload) {
  ctx.lastPlaybackPayload = payload;
  const { mainWindow, popoverWindow } = ctx;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('playback:update', payload);
  }
  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.webContents.send('playback:update', payload);
  }
}

// La letra viaja por un canal aparte y solo cuando cambia: puede ser un array
// de cientos de líneas y no tiene sentido reserializarla por IPC en cada tick.
function broadcastLyrics(payload) {
  ctx.lastLyricsPayload = payload;
  const { mainWindow } = ctx;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lyrics:update', payload);
  }
}

// Textos de los errores de reproducción. El renderer solo pinta: nunca sale de
// aquí un mensaje crudo de la API ("Spotify API 403" no le dice nada a nadie).
const ERROR_TEXTS = {
  auth: {
    message: 'Tu sesión de Spotify caducó',
    hint: 'Vuelve a conectar desde el icono de la bandeja.',
  },
  forbidden: {
    message: 'Tu cuenta no está autorizada en esta app de Spotify',
    hint: 'Añade tu email en el dashboard de Spotify, en Settings > User Management.',
  },
  ratelimit: {
    message: 'Spotify nos está limitando',
    hint: 'Reintentando en unos segundos.',
  },
  network: {
    message: 'Sin conexión con Spotify',
    hint: 'Reintentando...',
  },
  server: {
    message: 'Spotify está teniendo problemas',
    hint: 'Reintentando...',
  },
  unknown: {
    message: 'No pudimos leer lo que suena en Spotify',
    hint: 'Reintentando...',
  },
};

function broadcastPlaybackError(payload) {
  const { mainWindow, popoverWindow } = ctx;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('playback:error', payload);
  }
  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.webContents.send('playback:error', payload);
  }
}

function sendError(code) {
  const texts = ERROR_TEXTS[code] || ERROR_TEXTS.unknown;
  broadcastPlaybackError({ code: code || 'unknown', message: texts.message, hint: texts.hint });
}

// code: null es la señal de "ya no hay error, quita el aviso". Solo se emite si
// antes hubo uno, para no mandar limpiezas cada 2,5 s.
function clearError() {
  if (lastErrorCode === null) return;
  lastErrorCode = null;
  broadcastPlaybackError({ code: null, message: '', hint: '' });
}

function currentPollDelay() {
  const { mainWindow, popoverWindow, lastPlaybackPayload } = ctx;
  const overlayVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const popoverVisible = !!(
    popoverWindow &&
    !popoverWindow.isDestroyed() &&
    popoverWindow.isVisible()
  );
  if (!overlayVisible && !popoverVisible) return POLL_HIDDEN_MS;
  if (lastPlaybackPayload.playing && !lastPlaybackPayload.isPlaying) return POLL_PAUSED_MS;
  return POLL_ACTIVE_MS;
}

function nextPollDelay() {
  if (consecutiveErrors === 0) return currentPollDelay();
  if (retryAfterMs > 0) {
    return Math.min(Math.max(retryAfterMs, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS);
  }
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_MS.length - 1);
  return ERROR_BACKOFF_MS[idx];
}

// Anuncios y podcasts no tienen letra, y el renderer necesita poder decir
// "Anuncio de Spotify" en vez de "no se está reproduciendo nada".
function playbackKind(playing) {
  const raw = playing.currently_playing_type || playing.item?.type || '';
  if (raw === 'track' || raw === 'episode' || raw === 'ad') return raw;
  return 'unknown';
}

// Los episodios llegan con show/images en vez de artists/album; sin esto,
// poner un podcast reventaba el tick al hacer item.artists.map.
function describeItem(item) {
  const artists = Array.isArray(item.artists)
    ? item.artists.map((a) => a.name)
    : item.show?.name
      ? [item.show.name]
      : [];
  return {
    artists,
    album: item.album?.name ?? item.show?.name ?? '',
    albumArt: item.album?.images?.[0]?.url ?? item.images?.[0]?.url ?? null,
  };
}

// Se lanza sin await al detectar cambio de pista: la descarga de la letra no
// debe bloquear los ticks de progreso. Los guards de lastTrackId y de la
// generación cubren la carrera si la pista cambia (o se cierra sesión) antes de
// que responda lrclib.
async function fetchLyricsForTrack(item, trackId, gen) {
  const stillMine = () => isLive(gen) && lastTrackId === trackId;
  const meta = describeItem(item);

  let fetched = null;
  for (let attempt = 0; attempt <= LYRICS_RETRY_MS.length; attempt++) {
    try {
      fetched = await lyrics.fetchLyrics({
        track: item.name,
        artist: meta.artists[0] ?? '',
        album: meta.album,
        durationSec: Math.round((item.duration_ms || 0) / 1000),
        trackId,
      });
    } catch (err) {
      // fetchLyrics no debería lanzar (devuelve errorKind), pero si lo hace lo
      // tratamos como fallo del servicio y no como "no hay letra".
      log.error('lyrics', 'fetchLyrics lanzó una excepción', err);
      fetched = { synced: false, plain: null, lines: [], errorKind: 'network' };
    }
    if (!stillMine()) return;

    // notFound = lrclib respondió y esa canción no tiene letra: reintentar no
    // va a cambiar la respuesta. errorKind = el servicio falló: ahí sí.
    if (!fetched?.errorKind || attempt === LYRICS_RETRY_MS.length) break;
    log.warn('lyrics', 'fallo al descargar la letra, reintentando', {
      kind: fetched.errorKind,
      attempt: attempt + 1,
    });
    await sleep(LYRICS_RETRY_MS[attempt]);
    if (!stillMine()) return;
  }

  currentLyrics = fetched;
  broadcastLyrics({ lyrics: fetched, loadingLyrics: false });
  if (!fetched.synced || !fetched.lines?.length) return;

  // Sub-líneas (romaji / traducción) en segundo plano: la letra principal ya
  // se emitió; cuando lleguen, se reemite la letra con `sub` en cada línea.
  // El romaji es offline, pero traducir manda la letra entera a Google: eso
  // solo puede pasar si el usuario tiene las sub-líneas encendidas y ha dado
  // su consentimiento explícito.
  try {
    const cfg = loadConfig();
    const result = await generateSubs(fetched.lines, {
      lang: getSubsLang(),
      trackId,
      allowTranslation: !!(cfg.showSubs && cfg.translateConsent),
    });
    if (result?.subs && stillMine()) {
      currentLyrics = {
        ...fetched,
        subKind: result.kind,
        lines: fetched.lines.map((l, i) => ({ ...l, sub: result.subs[i] || null })),
      };
      broadcastLyrics({ lyrics: currentLyrics, loadingLyrics: false });
    }
  } catch (err) {
    // Sin sub-líneas la letra se sigue viendo; no vale la pena molestar al usuario.
    log.warn('subs', 'no se pudieron generar las sub-líneas', err);
  }
}

// La sesión ya no sirve (refresh token revocado). Aquí sí se limpia la letra:
// no es un tick que falla, es que hemos dejado de estar conectados.
function handleRevokedSession() {
  log.warn('poll', 'sesión revocada por Spotify: cerrando sesión local');
  spotify.logout();
  stopPolling();
  broadcastPlayback({ playing: false, kind: 'unknown' });
  broadcastLyrics({ lyrics: null, loadingLyrics: false });
  lastErrorCode = 'auth';
  sendError('auth');
  // require perezoso: ipc.js y windows.js nos importan a nosotros, así que solo
  // se pueden resolver ya en caliente, nunca en la cabecera del módulo.
  require('./windows').sendPopoverState();
  // Y si ipc.js expone el emisor de 'status:changed', las dos ventanas se
  // enteran de que ya no hay sesión sin esperar a que alguien pulse algo.
  require('./ipc').emitStatus();
}

async function pollTick() {
  const gen = generation;
  try {
    const playing = await spotify.getCurrentlyPlaying();
    if (!isLive(gen)) return;

    // Tick bueno: se acabó el backoff y el renderer puede quitar el aviso.
    if (consecutiveErrors > 0) {
      log.info('poll', `reproducción recuperada tras ${consecutiveErrors} intento(s) fallido(s)`);
      consecutiveErrors = 0;
      retryAfterMs = 0;
    }
    clearError();

    // 204 o sin item: el dispositivo está inactivo, o suena un anuncio sin
    // metadatos. Conservamos lastTrackId y la letra en memoria para que
    // reanudar la misma canción no cueste una descarga entera otra vez.
    if (!playing || !playing.item) {
      broadcastPlayback({ playing: false, kind: playing ? playbackKind(playing) : 'unknown' });
      return;
    }

    const kind = playbackKind(playing);
    const item = playing.item;
    // Los archivos locales llegan sin id; el uri (spotify:local:...) distingue
    // igual de bien si la pista cambió.
    const trackId = item.id || item.uri || `local:${item.name}`;
    const meta = describeItem(item);

    broadcastPlayback({
      playing: true,
      kind,
      isPlaying: playing.is_playing,
      progressMs: playing.progress_ms,
      durationMs: item.duration_ms ?? 0,
      track: {
        id: trackId,
        name: item.name,
        artists: meta.artists,
        album: meta.album,
        albumArt: meta.albumArt,
      },
    });

    if (kind === 'track') {
      if (trackId !== lastTrackId) {
        lastTrackId = trackId;
        currentLyrics = null;
        broadcastLyrics({ lyrics: null, loadingLyrics: true });
        fetchLyricsForTrack(item, trackId, gen);
      }
    } else if (kind === 'episode') {
      // Un podcast es un cambio de pista real: la letra de la canción anterior
      // ya no pinta nada. Pero no hay nada que buscar en lrclib.
      if (trackId !== lastTrackId) {
        lastTrackId = trackId;
        currentLyrics = null;
        broadcastLyrics({ lyrics: null, loadingLyrics: false });
      }
    }
    // 'ad' / 'unknown' con item: no buscamos letra y dejamos intacta la de la
    // canción, que volverá en cuanto termine el anuncio.
  } catch (err) {
    if (!isLive(gen)) return;

    if (err.authRevoked) {
      handleRevokedSession();
      return;
    }

    consecutiveErrors += 1;
    retryAfterMs = Number(err.retryAfterMs) > 0 ? Number(err.retryAfterMs) : 0;
    const code = ERROR_TEXTS[err.kind] ? err.kind : 'unknown';
    // Un fallo se registra al empezar y cada vez que cambia de naturaleza: con
    // el backoff activo, escribir cada tick llenaría el log de líneas iguales.
    if (consecutiveErrors === 1 || code !== lastErrorCode) {
      log.warn('poll', `error al consultar la reproducción (${code})`, err);
    }
    lastErrorCode = code;
    sendError(code);

    // La letra que ya estaba se queda: un error de red no debe vaciar el
    // overlay de la canción que el usuario está escuchando.
  }
}

// setTimeout recursivo en vez de setInterval: un tick lento (red) nunca se
// solapa con el siguiente, y el intervalo se adapta al estado de la app.
function startPolling() {
  stopPolling();
  pollActive = true;
  // Arrancar el ciclo (login, reconexión) deja la pantalla limpia: un aviso de
  // error de la sesión anterior ya no describe nada.
  broadcastPlaybackError({ code: null, message: '', hint: '' });
  const gen = generation;
  pollLoop = async () => {
    if (!isLive(gen)) return;
    pollTimer = null;
    await pollTick();
    if (!isLive(gen)) return;
    pollTimer = setTimeout(pollLoop, nextPollDelay());
  };
  pollLoop();
}

// Adelanta el siguiente tick (p. ej. al volver a mostrar una ventana tras el
// intervalo lento de "oculto"). Solo entre ticks: pollTimer no existe mientras
// hay uno en vuelo.
function pokePolling() {
  if (pollActive && pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollLoop, 0);
  }
}

function stopPolling() {
  pollActive = false;
  generation += 1; // invalida ticks, descargas de letra y traducciones en vuelo
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  lastTrackId = null;
  currentLyrics = null;
  consecutiveErrors = 0;
  retryAfterMs = 0;
  lastErrorCode = null;
}

module.exports = { startPolling, stopPolling, pokePolling, broadcastPlayback, broadcastLyrics };
