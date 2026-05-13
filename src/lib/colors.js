// Extractor de colores dominantes de una imagen (vanilla, sin librerías).
// Devuelve una paleta { vibrant, muted, accent, contrast } como hex.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function adjustLightness(r, g, b, targetL) {
  const { h, s } = rgbToHsl(r, g, b);
  return hslToRgb(h / 360, s, targetL);
}

function hslToRgb(h, s, l) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

export async function extractPalette(url) {
  if (!url) return null;
  try {
    const img = await loadImage(url);
    const W = 64;
    const H = 64;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const buckets = new Map();
    const QUANT = 24;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue;
      const key = `${Math.round(r / QUANT)}-${Math.round(g / QUANT)}-${Math.round(b / QUANT)}`;
      const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count += 1;
      entry.r += r;
      entry.g += g;
      entry.b += b;
      buckets.set(key, entry);
    }

    const sorted = [...buckets.values()]
      .map((bk) => ({
        count: bk.count,
        r: bk.r / bk.count,
        g: bk.g / bk.count,
        b: bk.b / bk.count,
      }))
      .sort((a, b) => b.count - a.count);

    if (sorted.length === 0) return null;

    // Prefer vivid colors for "vibrant"
    const vibrantCandidate = sorted.find((c) => {
      const { s, l } = rgbToHsl(c.r, c.g, c.b);
      return s > 0.35 && l > 0.25 && l < 0.78;
    }) || sorted[0];

    // Muted = next dominant that's different enough in hue
    const vibHsl = rgbToHsl(vibrantCandidate.r, vibrantCandidate.g, vibrantCandidate.b);
    const mutedCandidate =
      sorted.find((c) => {
        if (c === vibrantCandidate) return false;
        const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
        const dh = Math.min(Math.abs(h - vibHsl.h), 360 - Math.abs(h - vibHsl.h));
        return dh > 25 && s > 0.15 && l > 0.15 && l < 0.85;
      }) || sorted[1] || vibrantCandidate;

    // Build "accent" version that's vivid and bright enough for glow
    const brightened = adjustLightness(vibrantCandidate.r, vibrantCandidate.g, vibrantCandidate.b, 0.62);

    return {
      vibrant: rgbToHex(vibrantCandidate.r, vibrantCandidate.g, vibrantCandidate.b),
      muted: rgbToHex(mutedCandidate.r, mutedCandidate.g, mutedCandidate.b),
      accent: rgbToHex(brightened.r, brightened.g, brightened.b),
      vibrantRgb: `${Math.round(vibrantCandidate.r)},${Math.round(vibrantCandidate.g)},${Math.round(vibrantCandidate.b)}`,
      mutedRgb: `${Math.round(mutedCandidate.r)},${Math.round(mutedCandidate.g)},${Math.round(mutedCandidate.b)}`,
      accentRgb: `${Math.round(brightened.r)},${Math.round(brightened.g)},${Math.round(brightened.b)}`,
    };
  } catch (err) {
    console.warn('[colors] extraction failed:', err);
    return null;
  }
}
