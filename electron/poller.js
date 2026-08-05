const spotify = require('./spotify');
const lyrics = require('./lyrics');
const { generateSubs } = require('./subtitles');
const ctx = require('./context');

const POLL_ACTIVE_MS = 2500; // reproduciendo y con alguna ventana visible
const POLL_PAUSED_MS = 5000; // música en pausa
const POLL_HIDDEN_MS = 10000; // overlay oculto y popover cerrado

let pollActive = false;
let pollLoop = null;
let pollTimer = null;
let lastTrackId = null;
let currentLyrics = null;
let isFetchingLyrics = false;

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

// Se lanza sin await al detectar cambio de pista: la descarga de la letra no
// debe bloquear los ticks de progreso. Los guards de lastTrackId cubren la
// carrera si la pista vuelve a cambiar antes de que responda lrclib.
async function fetchLyricsForTrack(item, trackId) {
  try {
    const fetched = await lyrics.fetchLyrics({
      track: item.name,
      artist: item.artists[0]?.name ?? '',
      album: item.album?.name ?? '',
      durationSec: Math.round(item.duration_ms / 1000),
    });
    if (lastTrackId !== trackId) return;
    currentLyrics = fetched;
    isFetchingLyrics = false;
    broadcastLyrics({ lyrics: fetched, loadingLyrics: false });

    // Sub-líneas (romaji / traducción) en segundo plano: la letra principal ya
    // se emitió; cuando lleguen, se reemite la letra con `sub` en cada línea.
    if (fetched.synced && fetched.lines?.length > 0) {
      const result = await generateSubs(fetched.lines);
      if (result && result.subs && lastTrackId === trackId) {
        currentLyrics = {
          ...fetched,
          subKind: result.kind,
          lines: fetched.lines.map((l, i) => ({ ...l, sub: result.subs[i] || null })),
        };
        broadcastLyrics({ lyrics: currentLyrics, loadingLyrics: false });
      }
    }
  } catch (err) {
    if (lastTrackId === trackId) {
      isFetchingLyrics = false;
      currentLyrics = { synced: false, plain: null, lines: [], error: err.message };
      broadcastLyrics({ lyrics: currentLyrics, loadingLyrics: false });
    }
  }
}

async function pollTick() {
  try {
    const playing = await spotify.getCurrentlyPlaying();

    if (!playing || !playing.item) {
      broadcastPlayback({ playing: false });
      if (lastTrackId !== null) {
        lastTrackId = null;
        currentLyrics = null;
        isFetchingLyrics = false;
        broadcastLyrics({ lyrics: null, loadingLyrics: false });
      }
      return;
    }

    const trackId = playing.item.id;
    broadcastPlayback({
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
    });

    if (trackId !== lastTrackId) {
      lastTrackId = trackId;
      currentLyrics = null;
      isFetchingLyrics = true;
      broadcastLyrics({ lyrics: null, loadingLyrics: true });
      fetchLyricsForTrack(playing.item, trackId);
    }
  } catch (err) {
    console.error('[poll] error:', err.message);

    // Refresh token revocado: cerrar sesión y parar el polling en vez de
    // reintentar (y fallar) indefinidamente.
    if (err.authRevoked) {
      spotify.logout();
      stopPolling();
      broadcastPlayback({ playing: false });
      broadcastLyrics({ lyrics: null, loadingLyrics: false });
      require('./windows').sendPopoverState();
      return;
    }

    const { mainWindow, popoverWindow } = ctx;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playback:error', { message: err.message });
    }
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send('playback:error', { message: err.message });
    }
  }
}

// setTimeout recursivo en vez de setInterval: un tick lento (red) nunca se
// solapa con el siguiente, y el intervalo se adapta al estado de la app.
function startPolling() {
  stopPolling();
  pollActive = true;
  pollLoop = async () => {
    if (!pollActive) return;
    pollTimer = null;
    await pollTick();
    if (!pollActive) return;
    pollTimer = setTimeout(pollLoop, currentPollDelay());
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
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  lastTrackId = null;
  currentLyrics = null;
  isFetchingLyrics = false;
}

module.exports = { startPolling, stopPolling, pokePolling, broadcastPlayback, broadcastLyrics };
