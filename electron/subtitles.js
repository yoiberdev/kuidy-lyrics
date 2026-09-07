// Sub-líneas para la letra: lectura romaji para canciones en japonés y
// traducción al idioma del usuario para el resto. Todo corre en el proceso
// main, una vez por canción, después de emitir la letra principal (nunca la
// retrasa), y el resultado se cachea junto a la letra: el romaji cuesta cargar
// un diccionario de 17MB y la traducción es una petición a Google, así que
// ninguna de las dos debería repetirse al volver a una canción ya escuchada.

const log = require('./log');
const { cacheGet, cacheSet, subsKey } = require('./lyrics');

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

const TRANSLATE_TIMEOUT_MS = 15000;

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
      log.error('subs', 'no se pudo iniciar kuroshiro (romaji)', err);
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

// google-translate-api-x no expone AbortController propio; el signal llega a su
// fetch por requestOptions, pero la carrera es la garantía de que la promesa no
// se queda colgada para siempre si la librería lo ignora. Va un segundo por
// detrás para que gane el abort, que además cierra el socket.
function withTimeout(promise, ms, what) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: sin respuesta en ${ms / 1000}s`)), ms);
  });
  // El temporizador se limpia pase lo que pase: no queremos que quede vivo
  // cuando la traducción sí ha contestado.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// El idioma sale del locale de Windows si el usuario no eligió ninguno, así que
// puede llegar cualquier cosa. Google no conoce todos los códigos base: el chino
// solo existe como zh-CN/zh-TW, y algunos idiomas usan el código antiguo.
const LANG_ALIASES = { zh: 'zh-CN', jv: 'jw', fil: 'tl', nb: 'no', nn: 'no', in: 'id' };

function resolveLang(translate, lang) {
  const wanted = String(lang || '')
    .trim()
    .toLowerCase();
  if (!wanted) return null;
  const base = wanted.split('-')[0];
  const candidates = [wanted, LANG_ALIASES[wanted], base, LANG_ALIASES[base]];
  for (const c of candidates) {
    if (!c) continue;
    const code = typeof translate.getCode === 'function' ? translate.getCode(c) : c;
    if (code) return code;
  }
  return null;
}

async function translationSubs(lines, lang) {
  const translate = interopRequire('google-translate-api-x');
  const target = resolveLang(translate, lang);
  if (!target) {
    log.warn('subs', 'idioma de subtítulos no soportado por el traductor', { lang });
    return null;
  }

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
  const results = await withTimeout(
    translate(nonEmpty, {
      to: target,
      forceBatch: true,
      requestOptions: { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) },
    }),
    TRANSLATE_TIMEOUT_MS + 1000,
    'traducción'
  );
  const list = Array.isArray(results) ? results : [results];

  // Si la canción ya está mayoritariamente en el idioma del usuario no hay nada
  // que subtitular. Se comparan códigos base: Google devuelve 'zh-CN' donde la
  // preferencia dice 'zh'.
  const targetBase = target.split('-')[0];
  const sameLang = list.filter(
    (r) => String(r?.from?.language?.iso || '').split('-')[0] === targetBase
  ).length;
  if (sameLang > list.length / 2) return null;

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
// kind es el tipo de sub-línea ('romaji' | 'translation'), no el idioma.
// allowTranslation en false significa que ni un carácter de la letra puede salir
// hacia Google: el romaji es local (kuromoji) y siempre está permitido.
async function generateSubs(lines, { lang, trackId, allowTranslation } = {}) {
  if (!lines || lines.length === 0) return null;

  const joined = lines.map((l) => l.text || '').join('\n');
  const kind = HAS_KANA.test(joined) ? 'romaji' : 'translation';
  if (kind === 'translation' && !allowTranslation) return null;

  // Último recurso: el llamante siempre pasa el idioma de config.getSubsLang().
  const target = String(lang || '').trim() || 'es';
  const key = subsKey(trackId, kind, target);
  const cached = cacheGet(key);
  // null cacheado es una respuesta: "ya lo miramos y aquí no hay sub-líneas".
  if (cached !== undefined) {
    return cached && Array.isArray(cached.subs)
      ? { kind: cached.kind, subs: cached.subs.slice() }
      : null;
  }

  let result = null;
  try {
    if (kind === 'romaji') {
      const subs = await romajiSubs(lines);
      result = subs && subs.some(Boolean) ? { kind, subs } : null;
    } else {
      const subs = await translationSubs(lines, target);
      result = subs ? { kind, subs } : null;
    }
  } catch (err) {
    // Un fallo puntual (red, Google cerrando el grifo) no se cachea: sin
    // sub-líneas la letra se sigue viendo y la próxima vez se reintenta.
    log.warn('subs', `no se pudieron generar las sub-líneas (${kind})`, err);
    return null;
  }

  cacheSet(key, result);
  return result;
}

module.exports = { generateSubs };
