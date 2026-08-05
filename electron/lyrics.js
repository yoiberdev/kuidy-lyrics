// Letras desde lrclib.net (gratis, sin auth, soporta letras sincronizadas LRC).
// https://lrclib.net/docs

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

async function lrclibGet({ track, artist, album, durationSec }) {
  // Endpoint /api/get: requiere coincidencia exacta de track+artist+album+duration. Si falla, hacemos search.
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });
  if (album) params.set('album_name', album);
  if (durationSec) params.set('duration', String(durationSec));
  const url = `https://lrclib.net/api/get?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Kuidy Lyrics (https://github.com/kuidy/kuidy-lyrics)' },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`lrclib ${resp.status}`);
  return resp.json();
}

async function lrclibSearch({ track, artist }) {
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });
  const url = `https://lrclib.net/api/search?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Kuidy Lyrics (https://github.com/kuidy/kuidy-lyrics)' },
  });
  if (!resp.ok) return [];
  return resp.json();
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

async function fetchLyrics({ track, artist, album, durationSec }) {
  try {
    let result = await lrclibGet({ track, artist, album, durationSec });
    // Aunque el /get exacto responda, si no trae letra sincronizada intentamos
    // encontrar algo mejor: la coincidencia exacta puede ser un registro basura.
    if (!result || !result.syncedLyrics) {
      const candidates = await lrclibSearch({ track, artist });
      const best = pickBestCandidate(candidates, durationSec);
      if (best && (best.syncedLyrics || !result)) {
        result = best;
      }
    }
    if (!result) return { synced: false, plain: null, lines: [] };

    const synced = result.syncedLyrics ? parseLRC(result.syncedLyrics) : [];
    return {
      synced: synced.length > 0,
      plain: result.plainLyrics || null,
      lines: synced,
      source: 'lrclib',
      instrumental: !!result.instrumental,
    };
  } catch (err) {
    console.error('[lyrics] fetch error:', err.message);
    return { synced: false, plain: null, lines: [], error: err.message };
  }
}

module.exports = { fetchLyrics, parseLRC };
