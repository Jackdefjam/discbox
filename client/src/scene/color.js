// Kleine Farbhelfer für generierte Texturen und die Oberfläche.

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r, g, b) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const readableOn = (hex) => (luminance(hex) > 0.36 ? '#121216' : '#ffffff');

/** Stabile Ersatzfarbe für Alben ohne Cover. */
export function albumHashColor(album) {
  const h = hashString(`${album.artist}|${album.title}`);
  return hslToHex(h % 360, 45 + (h >> 9) % 25, 30 + (h >> 17) % 14);
}

/** Bestimmt eine kräftige, aber nicht grelle Leitfarbe aus einem Bild. */
export function dominantColor(image) {
  try {
    const size = 24;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      const max = Math.max(R, G, B);
      const min = Math.min(R, G, B);
      const sat = max === 0 ? 0 : (max - min) / max;
      const val = max / 255;
      const weight = 0.08 + sat * sat * 2.2 * (0.25 + val);
      r += R * weight;
      g += G * weight;
      b += B * weight;
      w += weight;
    }
    if (!w) return null;
    let hex = rgbToHex(r / w, g / w, b / w);
    // Helligkeit in einen brauchbaren Bereich ziehen
    const lum = luminance(hex);
    if (lum > 0.45) hex = mixHex(hex, '#000000', Math.min(0.55, (lum - 0.45) * 1.4));
    if (lum < 0.03) hex = mixHex(hex, '#808080', 0.25);
    return hex;
  } catch {
    return null;
  }
}
