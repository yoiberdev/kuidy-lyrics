// Letras desde lrclib.net (gratis, sin auth, soporta letras sincronizadas LRC).
// https://lrclib.net/docs
//
// Este módulo es además el dueño de la caché en disco que comparte con
// subtitles.js: la letra y sus sub-líneas se piden por la misma canción y
// caducan a la vez, así que viven en el mismo fichero y hay un solo sitio que
// tocar cuando algo va mal.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('./log');

// ---------- Caché en disco ----------
// Saltar a otra canción y volver no debe costar ni una petición: lrclib es un
// servicio gratuito mantenido por una persona, y las sub-líneas cuestan o una
// llamada a Google o 1-2 s de diccionario de kuromoji.

const CACHE_VERSION = 1;
const CACHE_MAX_ENTRIES = 300;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
// lrclib es colaborativo: una canción sin letra hoy puede tenerla la semana que
// viene. El "no hay letra" se recuerda mucho menos tiempo que la letra.
const NOT_FOUND_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Escritura perezosa: se agrupan los cambios de varios cambios de canción en un
// solo write en vez de machacar el disco en cada acierto.
const WRITE_DELAY_MS = 5000;
// Refrescar el "último uso" en cada acierto obligaría a reescribir el fichero
// constantemente; solo se anota cuando ya está rancio.
const USE_REFRESH_MS = 60 * 60 * 1000;

function cacheDir() {
  return path.join(app.getPath('userData'), 'cache');
}

function cachePath() {
  return path.join(cacheDir(), 'lyrics.json');
}

let store = null; // Map clave -> { t: creada, u: último uso, ttl, d: dato }
let dirty = false;
let writeTimer = null;

function loadStore() {
  if (store) return store;
  store = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (parsed && parsed.v === CACHE_VERSION && parsed.entries) {
      const now = Date.now();
      for (const [key, e] of Object.entries(parsed.entries)) {
        if (!e || typeof e.t !== 'number') continue;
        const ttl = typeof e.ttl === 'number' ? e.ttl : CACHE_TTL_MS;
        if (now - e.t > ttl) continue; // caducada: se descarta al leer
        store.set(key, { t: e.t, u: typeof e.u === 'number' ? e.u : e.t, ttl, d: e.d ?? null });
      }
    }
  } catch {
    // No existe todavía, está corrupta o es de otra versión: se empieza de cero.
    // Perder la caché no es un error, solo cuesta volver a descargar.
  }
  return store;
}

function flushCache() {
  if (!dirty || !store) return;
  dirty = false;
  try {
    // Desalojo por antigüedad de uso: esto es una comodidad, no un archivo, y no
    // queremos que el fichero crezca sin límite en una cuenta que escucha mucho.
    if (store.size > CACHE_MAX_ENTRIES) {
      const byUse = [...store.entries()].sort((a, b) => a[1].u - b[1].u);
      for (const [key] of byUse.slice(0, store.size - CACHE_MAX_ENTRIES)) store.delete(key);
    }
    const entries = {};
    for (const [key, e] of store) entries[key] = e;
    fs.mkdirSync(cacheDir(), { recursive: true });
    // Escritura atómica: si el proceso muere a media escritura (cierre de sesión
    // de Windows, actualización), un JSON truncado se descartaría entero y el
    // usuario perdería la caché de cientos de canciones. rename sí es atómico.
    const tmp = `${cachePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: CACHE_VERSION, entries }), 'utf8');
    fs.renameSync(tmp, cachePath());
  } catch (err) {
    log.warn('lyrics', 'no se pudo guardar la caché', err);
  }
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushCache();
  }, WRITE_DELAY_MS);
  // La caché nunca es motivo para mantener vivo el proceso.
  if (writeTimer.unref) writeTimer.unref();
}

// Al cerrar puede quedar una escritura pendiente en el temporizador perezoso.
app.on('before-quit', flushCache);

// Devuelve undefined cuando no hay nada cacheado. null es un valor válido y
// distinto: significa "ya lo calculamos y esta canción no lleva sub-líneas".
function cacheGet(key) {
  if (!key) return undefined;
  const s = loadStore();
  const entry = s.get(key);
  if (!entry) return undefined;
  const now = Date.now();
  if (now - entry.t > entry.ttl) {
    s.delete(key);
    scheduleWrite();
    return undefined;
  }
  if (now - entry.u > USE_REFRESH_MS) {
    entry.u = now;
    scheduleWrite();
  }
  return entry.d;
}

function cacheSet(key, data, ttl = CACHE_TTL_MS) {
  if (!key) return;
  const now = Date.now();
  loadStore().set(key, { t: now, u: now, ttl, d: data === undefined ? null : data });
  scheduleWrite();
}

// Sin trackId no hay clave estable (dos canciones pueden llamarse igual), así
// que se devuelve null y la caché se queda al margen.
function lyricsKey(trackId) {
  return trackId ? `L:${trackId}` : null;
}

// El romaji es una lectura, no una traducción: no depende del idioma elegido
// para los subtítulos, y cambiar ese idioma no debe tirar a la basura los 1-2 s
// de kuromoji que costó generarlo.
function subsKey(trackId, kind, lang) {
  if (!trackId) return null;
  if (kind === 'romaji') return `S:${trackId}:romaji`;
  return `S:${trackId}:${kind}:${lang}`;
}

// ---------- lrclib ----------

const REQUEST_TIMEOUT_MS = 8000;

// lrclib pide identificarse; el User-Agent anterior apuntaba a un repo que no
// existe y no llevaba versión, que es justo lo que necesitan para bloquear a un
// cliente que se porte mal sin llevarse por delante a los demás.
let userAgent = null;
function ua() {
  if (!userAgent) {
    let version = '0.0.0';
    try {
      version = app.getVersion();
    } catch {
      // getVersion falla si el módulo se carga fuera de Electron (tests).
    }
    userAgent = `Kuidy Lyrics/${version} (https://github.com/yoiberdev/kuidy-lyrics)`;
  }
  return userAgent;
}

function serviceError(kind, detail) {
  const err = new Error(detail);
  err.errorKind = kind;
  return err;
}

// Devuelve el JSON, null si lrclib contesta 404 (respuesta legítima: "no está")
// o lanza un error con errorKind si el fallo es del servicio. Distinguir las dos
// cosas es lo que evita que una caída de lrclib se le presente al usuario como
// "ninguna de tus canciones tiene letra".
async function lrclibFetch(url) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'User-Agent': ua() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Timeout, DNS caído, sin red: para el usuario todo es lo mismo.
    throw serviceError('network', `lrclib inalcanzable (${err.name || 'error'})`);
  }
  if (resp.status === 404) return null;
  if (resp.ok) {
    try {
      return await resp.json();
    } catch {
      throw serviceError('server', 'lrclib devolvió una respuesta ilegible');
    }
  }
  if (resp.status === 429) throw serviceError('ratelimit', 'lrclib 429');
  // Un 4xx que no sea 404 suele ser una consulta que no le gusta (títulos con
  // caracteres raros). Se registra para poder diagnosticarlo desde el log.
  if (resp.status < 500) log.warn('lyrics', `lrclib respondió ${resp.status}`, url);
  throw serviceError('server', `lrclib ${resp.status}`);
}

async function lrclibGet({ track, artist, album, durationSec }) {
  // Endpoint /api/get: requiere coincidencia exacta de track+artist+album+duration. Si falla, hacemos search.
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });
  if (album) params.set('album_name', album);
  if (durationSec) params.set('duration', String(durationSec));
  return lrclibFetch(`https://lrclib.net/api/get?${params.toString()}`);
}

async function lrclibSearch({ track, artist }) {
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });
  const data = await lrclibFetch(`https://lrclib.net/api/search?${params.toString()}`);
  return Array.isArray(data) ? data : [];
}

function parseLRC(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lines) {
    re.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = re.exec(raw)) !== null) matches.push(m);
    if (matches.length === 0) continue;
    const lastIdx = matches[matches.length - 1].index + matches[matches.length - 1][0].length;
    const textPart = raw.slice(lastIdx).trim();
    for (const mm of matches) {
      const minutes = parseInt(mm[1], 10);
      const seconds = parseInt(mm[2], 10);
      let frac = mm[3] ? parseInt(mm[3], 10) : 0;
      // Normalize fractions: 2-digit = centiseconds, 3-digit = milliseconds
      if (mm[3] && mm[3].length === 2) frac = frac * 10;
      const time = minutes * 60_000 + seconds * 1000 + frac;
      out.push({ time, text: textPart });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// Mejor candidato de una búsqueda: sincronizada primero (los registros basura
// de lrclib —páginas scrapeadas, anotaciones— casi siempre son solo texto
// plano) y, a igualdad, la más cercana en duración a la pista real.
function pickBestCandidate(candidates, durationSec) {
  if (!candidates || candidates.length === 0) return null;
  const scored = candidates.map((c) => ({
    c,
    synced: c.syncedLyrics ? 1 : 0,
    dDiff:
      durationSec && c.duration ? Math.abs(c.duration - durationSec) : Number.MAX_SAFE_INTEGER,
  }));
  scored.sort((a, b) => b.synced - a.synced || a.dDiff - b.dDiff);
  return scored[0].c;
}

// Función y no constante: si fuera un objeto compartido, todas las respuestas
// vacías arrastrarían el mismo array `lines` y quien lo tocara lo rompería para
// el resto de la sesión.
function empty() {
  return { synced: false, plain: null, lines: [], source: 'lrclib', instrumental: false };
}

// Copia superficial para que quien reciba la letra no pueda alterar lo que
// queda guardado en la caché en memoria.
function copy(payload) {
  return { ...payload, lines: Array.isArray(payload.lines) ? payload.lines.slice() : [] };
}

async function fetchLyrics({ track, artist, album, durationSec, trackId }) {
  const key = lyricsKey(trackId);
  const cached = cacheGet(key);
  if (cached) return copy(cached);

  if (!track) return { ...empty(), notFound: true };

  let result = null;
  let failure = null;

  try {
    result = await lrclibGet({ track, artist, album, durationSec });
  } catch (err) {
    failure = err.errorKind || 'network';
  }

  // Aunque el /get exacto responda, si no trae letra sincronizada intentamos
  // encontrar algo mejor: la coincidencia exacta puede ser un registro basura.
  if (!result || !result.syncedLyrics) {
    try {
      const candidates = await lrclibSearch({ track, artist });
      const best = pickBestCandidate(candidates, durationSec);
      if (best && (best.syncedLyrics || !result)) result = best;
      // La búsqueda es la consulta más amplia de las dos: si contesta, lrclib
      // está en pie y su respuesta es definitiva aunque el /get se cayera.
      failure = null;
    } catch (err) {
      if (!result) failure = failure || err.errorKind || 'network';
    }
  }

  if (failure) {
    log.warn('lyrics', 'lrclib no respondió', { track, artist, kind: failure });
    return { ...empty(), errorKind: failure };
  }

  if (!result) {
    log.info('lyrics', 'lrclib no tiene letra para esta canción', { track, artist });
    const payload = { ...empty(), notFound: true };
    cacheSet(key, payload, NOT_FOUND_TTL_MS);
    return copy(payload);
  }

  const timed = result.syncedLyrics ? parseLRC(result.syncedLyrics) : [];
  const payload = {
    synced: timed.length > 0,
    plain: result.plainLyrics || null,
    lines: timed,
    source: 'lrclib',
    instrumental: !!result.instrumental,
  };
  // Un registro sin letra utilizable y sin marca de instrumental es, para el
  // usuario, lo mismo que un 404: hay respuesta y no hay nada que enseñar.
  const useful = payload.synced || payload.plain || payload.instrumental;
  if (!useful) payload.notFound = true;
  cacheSet(key, payload, useful ? CACHE_TTL_MS : NOT_FOUND_TTL_MS);
  return copy(payload);
}

module.exports = { fetchLyrics, parseLRC, cacheGet, cacheSet, subsKey };
