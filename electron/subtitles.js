// Sub-líneas para la letra: lectura romaji para canciones en japonés y
// traducción al español para el resto. Todo corre en el proceso main, una vez
// por canción, después de emitir la letra principal (nunca la retrasa).

// kuroshiro publica builds UMD: según la versión el constructor llega como
// export directo o bajo .default, de ahí el patrón defensivo.
function interopRequire(name) {
  const mod = require(name);
  return mod && mod.default ? mod.default : mod;
}

// Kana (hiragana + katakana) delata japonés; el rango CJK solo no basta
// porque también lo usan canciones en chino.
const HAS_KANA = /[぀-ヿ]/;
const HAS_JAPANESE = /[぀-ヿ一-鿿]/;

// El init de kuroshiro carga el diccionario de kuromoji (~17MB, 1-2s). Se hace
// una sola vez y solo cuando aparece la primera canción en japonés.
let kuroshiroPromise = null;
function getKuroshiro() {
  if (!kuroshiroPromise) {
    kuroshiroPromise = (async () => {
      const Kuroshiro = interopRequire('kuroshiro');
      const KuromojiAnalyzer = interopRequire('kuroshiro-analyzer-kuromoji');
      const k = new Kuroshiro();
      await k.init(new KuromojiAnalyzer());
      return k;
    })();
    kuroshiroPromise.catch((err) => {
      console.error('[subs] kuroshiro init failed:', err.message);
      kuroshiroPromise = null;
    });
  }
  return kuroshiroPromise;
}

async function romajiSubs(lines) {
  const k = await getKuroshiro();
  return Promise.all(
    lines.map(async (line) => {
      const text = line.text || '';
      if (!HAS_JAPANESE.test(text)) return null;
      try {
        const romaji = await k.convert(text, {
          to: 'romaji',
          mode: 'spaced',
          romajiSystem: 'hepburn',
        });
        return romaji && romaji.trim() ? romaji.trim() : null;
      } catch {
        return null;
      }
    })
  );
}

async function spanishSubs(lines) {
  const translate = interopRequire('google-translate-api-x');
  const texts = lines.map((l) => l.text || '');
  const nonEmptyIdx = [];
  const nonEmpty = [];
  texts.forEach((t, i) => {
    if (t.trim()) {
      nonEmptyIdx.push(i);
      nonEmpty.push(t);
    }
  });
  if (nonEmpty.length === 0) return null;

  // Una sola petición por canción: el array entra y sale con la misma forma.
  const results = await translate(nonEmpty, { to: 'es', forceBatch: true });
  const list = Array.isArray(results) ? results : [results];

  // Si la canción ya está mayoritariamente en español no hay nada que subtitular.
  const esCount = list.filter((r) => r?.from?.language?.iso === 'es').length;
  if (esCount > list.length / 2) return null;

  const subs = new Array(texts.length).fill(null);
  list.forEach((r, j) => {
    const translated = r?.text?.trim();
    if (!translated) return;
    // Descarta traducciones idénticas al original (nombres, interjecciones...)
    if (translated.toLowerCase() === nonEmpty[j].trim().toLowerCase()) return;
    subs[nonEmptyIdx[j]] = translated;
  });
  return subs.some(Boolean) ? subs : null;
}

// Devuelve { kind, subs } con subs alineado 1:1 con lines, o null si no aplica.
async function generateSubs(lines) {
  if (!lines || lines.length === 0) return null;
  const joined = lines.map((l) => l.text || '').join('\n');
  try {
    if (HAS_KANA.test(joined)) {
      return { kind: 'romaji', subs: await romajiSubs(lines) };
    }
    const subs = await spanishSubs(lines);
    return subs ? { kind: 'es', subs } : null;
  } catch (err) {
    console.error('[subs] error:', err.message);
    return null;
  }
}

module.exports = { generateSubs };
