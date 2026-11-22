// Zeichnet Ersatz-Artwork auf Canvas: Frontcover ohne Bild, CD-Rücken, Rückseite mit Titelliste,
// Booklet-Innenseite und bedruckte CD. Alles im echten Jewel-Case-Seitenverhältnis.

import { albumHashColor, hashString, mixHex, readableOn } from './color.js';

export const FONT_TITLE = 'Oswald, "Arial Narrow", Impact, sans-serif';
export const FONT_TEXT = '"Inter Variable", Inter, system-ui, "Segoe UI", Roboto, Arial, sans-serif';

export const fmtTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '–:––';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Text mit Auslassungszeichen auf maximale Breite kürzen. */
export function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/** Zeilenumbruch, höchstens maxLines Zeilen. */
export function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    lines.length = maxLines - 1;
    lines.push(ellipsize(ctx, rest, maxWidth));
  }
  return lines.map((l) => ellipsize(ctx, l, maxWidth));
}

function fitFont(ctx, text, weight, family, maxWidth, start, min) {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function noise(ctx, w, h, alpha, seed) {
  let s = seed || 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < (w * h) / 260; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#fff' : '#000';
    ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
  }
  ctx.restore();
}

/** Frontcover für Alben ohne Bild. */
export function drawFrontPlaceholder(album, size = 1024) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const base = albumHashColor(album);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, mixHex(base, '#ffffff', 0.12));
  g.addColorStop(1, mixHex(base, '#000000', 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Konzentrische Ringe als Motiv
  const cx = size * 0.72;
  const cy = size * 0.3;
  ctx.save();
  for (let i = 16; i > 0; i--) {
    ctx.beginPath();
    ctx.arc(cx, cy, i * size * 0.04, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.03 + (i % 3 === 0 ? 0.05 : 0)})`;
    ctx.lineWidth = size * 0.006;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.restore();
  noise(ctx, size, size, 0.05, hashString(album.id));

  const fg = '#ffffff';
  const pad = size * 0.08;
  ctx.fillStyle = fg;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${size * 0.04}px ${FONT_TEXT}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(ellipsize(ctx, album.artist.toUpperCase(), size - pad * 2), pad, pad + size * 0.04);
  ctx.globalAlpha = 1;

  ctx.font = `700 ${size * 0.13}px ${FONT_TITLE}`;
  const lines = wrap(ctx, album.title.toUpperCase(), size - pad * 2, 3);
  const lh = size * 0.135;
  lines.forEach((l, i) => ctx.fillText(l, pad, size - pad - (lines.length - 1 - i) * lh));
  if (album.year) {
    ctx.font = `500 ${size * 0.035}px ${FONT_TEXT}`;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'right';
    ctx.fillText(String(album.year), size - pad, pad + size * 0.04);
  }
  return c;
}

/**
 * CD-Rücken (Standard 6,5 × 118 mm; Doppel-CD und Digipak breiter). Breite → Tiefe der Hülle.
 * direction: 'down' = von oben nach unten lesbar (international üblich), 'up' = von unten nach oben.
 */
export function drawSpine(album, color, direction = 'down', widthMM = 6.5) {
  const w = Math.min(360, Math.round((96 * widthMM) / 6.5));
  const h = 1744;
  const k = Math.min(2.1, w / 96); // Schrift wächst mit der Rückenbreite
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const bg = mixHex(color, '#000000', 0.38);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, mixHex(bg, '#000000', 0.25));
  g.addColorStop(0.5, bg);
  g.addColorStop(1, mixHex(bg, '#000000', 0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const fg = readableOn(bg);

  ctx.save();
  if (direction === 'up') {
    ctx.translate(w / 2, h);
    ctx.rotate(-Math.PI / 2);
  } else {
    ctx.translate(w / 2, 0);
    ctx.rotate(Math.PI / 2);
  }
  // Jetzt verläuft x entlang der Rückenlänge, y quer dazu (0 = Mitte)
  const pad = 70;
  const discs = album.discs > 1 ? `${album.discs} CD` : '';
  const yearText = [album.year, discs].filter(Boolean).join('  ·  ');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  const yearSize = Math.round(34 * Math.min(k, 1.5));
  ctx.font = `500 ${yearSize}px ${FONT_TEXT}`;
  const yearW = yearText ? ctx.measureText(yearText).width + 40 : 0;
  const avail = h - pad * 2 - yearW;
  const artist = album.artist.toUpperCase();
  const title = album.title.toUpperCase();
  const base = Math.round(50 * k);
  ctx.font = `700 ${base}px ${FONT_TITLE}`;
  const artistW = ctx.measureText(artist).width;
  ctx.font = `400 ${base}px ${FONT_TITLE}`;
  const titleW = ctx.measureText(title).width;
  const sep = 46 * k;
  const scale = Math.min(1, avail / (artistW + sep + titleW));
  const size = Math.max(30, Math.round(base * scale));
  ctx.font = `700 ${size}px ${FONT_TITLE}`;
  const a = ellipsize(ctx, artist, avail * 0.48);
  const aw = ctx.measureText(a).width;
  ctx.fillText(a, pad, 2);
  ctx.font = `400 ${size}px ${FONT_TITLE}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(ellipsize(ctx, title, avail - aw - sep), pad + aw + sep, 2);
  ctx.globalAlpha = 1;
  if (yearText) {
    ctx.font = `500 ${yearSize}px ${FONT_TEXT}`;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.75;
    ctx.fillText(yearText, h - pad, 2);
  }
  ctx.restore();
  return c;
}

function trackRows(detail) {
  const rows = [];
  const multi = (detail?.discs ?? 1) > 1;
  let disc = null;
  for (const t of detail?.tracks ?? []) {
    if (multi && t.disc !== disc) {
      disc = t.disc;
      rows.push({ header: `CD ${disc}` });
    }
    rows.push({ no: t.no, title: t.artist ? `${t.title} – ${t.artist}` : t.title, time: fmtTime(t.duration) });
  }
  return rows;
}

function barcode(ctx, x, y, w, h, seed) {
  let s = seed || 7;
  const rand = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 10, y - 10, w + 20, h + 40);
  ctx.fillStyle = '#000000';
  let cx = x;
  while (cx < x + w) {
    const bw = 1 + Math.floor(rand() * 4);
    if (rand() > 0.45) ctx.fillRect(cx, y, bw, h);
    cx += bw + 1;
  }
  ctx.font = `500 16px ${FONT_TEXT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const digits = String(seed).padStart(13, '4').slice(0, 13);
  ctx.fillText(digits.replace(/(\d)(\d{6})(\d{6})/, '$1 $2 $3'), x + w / 2, y + h + 6);
}

/** Rückseite (Tray-Card ohne Rücken, 138 × 118 mm). */
export function drawBack(album, detail, color, aspect = 1380 / 1180) {
  const w = Math.round(1180 * aspect);
  const h = 1180;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const bg = mixHex(color, '#0a0a0d', 0.62);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mixHex(bg, '#ffffff', 0.06));
  g.addColorStop(1, mixHex(bg, '#000000', 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, 0.04, hashString(`${album.id}b`));
  const fg = readableOn(bg);
  const pad = 96;

  ctx.fillStyle = fg;
  ctx.textBaseline = 'alphabetic';
  fitFont(ctx, album.title, 700, FONT_TITLE, w - pad * 2, 76, 40);
  ctx.fillText(ellipsize(ctx, album.title, w - pad * 2), pad, pad + 56);
  ctx.font = `500 30px ${FONT_TEXT}`;
  ctx.globalAlpha = 0.78;
  ctx.fillText(ellipsize(ctx, album.artist, w - pad * 2), pad, pad + 108);
  ctx.globalAlpha = 1;

  // Titelliste
  const rows = trackRows(detail);
  const top = pad + 170;
  const bottom = h - 190;
  if (rows.length) {
    const cols = rows.length > 14 ? 2 : 1;
    const perCol = Math.ceil(rows.length / cols);
    const lh = Math.max(20, Math.min(46, (bottom - top) / perCol));
    const fs = Math.round(Math.min(29, lh * 0.66));
    const colW = (w - pad * 2 - (cols - 1) * 60) / cols;
    rows.forEach((r, i) => {
      const col = Math.floor(i / perCol);
      const x = pad + col * (colW + 60);
      const y = top + (i % perCol) * lh + lh * 0.7;
      if (r.header) {
        ctx.font = `700 ${fs}px ${FONT_TEXT}`;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = mixHex(color, fg, 0.5);
        ctx.fillText(r.header, x, y);
        ctx.fillStyle = fg;
        ctx.globalAlpha = 1;
        return;
      }
      ctx.font = `600 ${fs}px ${FONT_TEXT}`;
      ctx.globalAlpha = 0.55;
      ctx.textAlign = 'left';
      ctx.fillText(String(r.no).padStart(2, '0'), x, y);
      ctx.globalAlpha = 1;
      ctx.font = `500 ${fs}px ${FONT_TEXT}`;
      const timeW = 90;
      ctx.fillText(ellipsize(ctx, r.title, colW - fs * 2.2 - timeW), x + fs * 2.1, y);
      ctx.textAlign = 'right';
      ctx.globalAlpha = 0.6;
      ctx.fillText(r.time, x + colW, y);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    });
  } else {
    ctx.font = `500 30px ${FONT_TEXT}`;
    ctx.globalAlpha = 0.55;
    ctx.fillText(`${album.trackCount} Titel · ${fmtTime(album.duration)}`, pad, top + 40);
    ctx.globalAlpha = 1;
  }

  // Fußzeile
  ctx.font = `500 24px ${FONT_TEXT}`;
  ctx.globalAlpha = 0.65;
  const info = [album.format, album.duration ? `Gesamtlaufzeit ${fmtTime(album.duration)}` : null, album.year]
    .filter(Boolean)
    .join('   ·   ');
  ctx.fillText(ellipsize(ctx, info, w - pad * 2 - 300), pad, h - pad + 10);
  ctx.globalAlpha = 0.45;
  ctx.font = `700 22px ${FONT_TEXT}`;
  ctx.fillText('DISCBOX', pad, h - pad - 30);
  ctx.globalAlpha = 1;
  barcode(ctx, w - pad - 220, h - pad - 70, 220, 64, hashString(album.id));
  return c;
}

/** Booklet-Innenseite (sichtbar, wenn die Hülle geöffnet ist). */
export function drawInlay(album, detail, color) {
  const size = 1024;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const paper = mixHex('#f4f0e6', color, 0.08);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, size, size);
  noise(ctx, size, size, 0.035, hashString(`${album.id}i`));
  const ink = '#1b1a1f';
  const pad = 84;
  ctx.fillStyle = mixHex(color, '#000000', 0.2);
  ctx.fillRect(pad, pad, 10, 120);
  ctx.fillStyle = ink;
  fitFont(ctx, album.title, 700, FONT_TITLE, size - pad * 2 - 40, 62, 34);
  ctx.fillText(ellipsize(ctx, album.title, size - pad * 2 - 40), pad + 36, pad + 56);
  ctx.font = `500 28px ${FONT_TEXT}`;
  ctx.globalAlpha = 0.7;
  ctx.fillText(ellipsize(ctx, album.artist, size - pad * 2 - 40), pad + 36, pad + 106);
  ctx.globalAlpha = 1;

  const rows = trackRows(detail);
  const top = pad + 200;
  const bottom = size - pad - 40;
  const lh = Math.max(16, Math.min(40, (bottom - top) / Math.max(rows.length, 1)));
  const fs = Math.round(Math.min(25, lh * 0.68));
  rows.forEach((r, i) => {
    const y = top + i * lh;
    if (y > bottom) return;
    if (r.header) {
      ctx.font = `700 ${fs}px ${FONT_TEXT}`;
      ctx.fillText(r.header, pad, y);
      return;
    }
    ctx.font = `600 ${fs}px ${FONT_TEXT}`;
    ctx.globalAlpha = 0.45;
    ctx.fillText(String(r.no).padStart(2, '0'), pad, y);
    ctx.globalAlpha = 1;
    ctx.font = `500 ${fs}px ${FONT_TEXT}`;
    ctx.fillText(ellipsize(ctx, r.title, size - pad * 2 - 160), pad + fs * 2.2, y);
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.55;
    ctx.fillText(r.time, size - pad, y);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  });
  ctx.font = `500 18px ${FONT_TEXT}`;
  ctx.globalAlpha = 0.45;
  ctx.fillText(`${album.year ? `℗ ${album.year} · ` : ''}${album.format ?? ''}`, pad, size - pad + 20);
  return c;
}

/**
 * Bedruckte CD. Nutzt das Frontcover als Aufdruck (wie bei vielen echten CDs).
 * image: optionales Bild (HTMLImageElement/ImageBitmap); flipped: Bild liegt kopfüber vor (ImageBitmap).
 */
export function drawDisc(album, color, image, flipped, label = '') {
  const size = 1024;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = size / 2;
  const mm = R / 60;
  ctx.translate(R, R);

  // Spiegelnde Grundfläche
  let mirror;
  if (ctx.createConicGradient) {
    mirror = ctx.createConicGradient(0.3, 0, 0);
    const stops = ['#d9dce2', '#9aa0aa', '#f1f2f5', '#b6c3d6', '#e8d8e8', '#9aa0aa', '#d9dce2'];
    stops.forEach((s, i) => mirror.addColorStop(i / (stops.length - 1), s));
  } else {
    mirror = ctx.createRadialGradient(0, 0, 10, 0, 0, R);
    mirror.addColorStop(0, '#e6e8ec');
    mirror.addColorStop(1, '#9ea4ad');
  }
  ctx.fillStyle = mirror;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  // Durchsichtiger Innenring
  ctx.fillStyle = 'rgba(225,230,236,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, 16.5 * mm, 0, Math.PI * 2);
  ctx.fill();

  // Bedruckter Bereich
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, 58.5 * mm, 0, Math.PI * 2);
  ctx.arc(0, 0, 22 * mm, 0, Math.PI * 2, true);
  ctx.clip('evenodd');
  if (image) {
    ctx.save();
    if (flipped) ctx.scale(1, -1);
    ctx.drawImage(image, -R, -R, size, size);
    ctx.restore();
    const v = ctx.createRadialGradient(0, 0, 22 * mm, 0, 0, 58.5 * mm);
    v.addColorStop(0, 'rgba(0,0,0,0.25)');
    v.addColorStop(0.25, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = v;
    ctx.fill();
  } else {
    const bg = mixHex(color, '#000000', 0.2);
    ctx.fillStyle = bg;
    ctx.fillRect(-R, -R, size, size);
    ctx.fillStyle = readableOn(bg);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, album.title.toUpperCase(), 700, FONT_TITLE, 60 * mm, 60, 26);
    ctx.fillText(ellipsize(ctx, album.title.toUpperCase(), 64 * mm), 0, 36 * mm);
    ctx.font = `500 26px ${FONT_TEXT}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(ellipsize(ctx, album.artist, 60 * mm), 0, -36 * mm);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // „CD 1“ / „CD 2“ bei Mehrfach-Alben
  if (label) {
    ctx.save();
    ctx.font = `700 34px ${FONT_TEXT}`;
    const w = ctx.measureText(label).width + 36;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect?.(-w / 2, -40 * mm, w, 52, 26) ?? ctx.rect(-w / 2, -40 * mm, w, 52);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -40 * mm + 27);
    ctx.restore();
  }

  // Feine Kanten
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  for (const r of [16.5, 22, 58.5]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * mm, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

/** Alpha-Maske der CD: außen rund, Mittelloch 15 mm. */
export function drawDiscAlpha() {
  const size = 512;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, (size / 2) * (7.5 / 60), 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function drawShadow() {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.translate(128, 64);
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-128, -128, 256, 256);
  return c;
}

/** Runder goldener Aufkleber mit Stern für Favoriten. */
export function drawFavSticker() {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r * 0.7, r * 0.6, 10, r, r, r);
  g.addColorStop(0, '#fff3b0');
  g.addColorStop(0.45, '#fbbf24');
  g.addColorStop(1, '#b45309');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(r, r, r - 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(120,53,15,0.6)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.28 : r * 0.62;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(r + Math.cos(a) * rad, r + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  return c;
}

export function drawSprite() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}
