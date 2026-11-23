// Wiedergabelisten als selbst gebrannte CD („Mixtape“): Collage aus den Covern mit beschriftetem
// Kreppband, handgeschriebene Rücken und Titelliste auf Linienpapier, CD-R mit Edding-Schrift.
// Alles auf Canvas, in denselben Formaten wie die gedruckten Teile echter Alben (artgen.js).

import { artUrl } from '../core/api.js';
import { FONT_TEXT, drawFrontPlaceholder, ellipsize, fmtTime, wrap } from './artgen.js';
import { albumHashColor, hashString, mixHex } from './color.js';

export const FONT_HAND = '"Caveat Variable", Caveat, "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

const PAPER = '#f2ede2';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Zufallszahlen, die für dieselbe Liste immer gleich ausfallen (Bänder, Schräglage …). */
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

/** Stiftfarbe je Liste: meist schwarz, manchmal blau, rot oder grün. */
export function inkFor(pl) {
  const h = hashString(pl.id) % 20;
  if (h < 11) return '#1c2029';
  if (h < 16) return '#1f3c8f';
  if (h < 18) return '#9e2328';
  return '#1c5a38';
}

function fmtLong(sec) {
  if (!sec) return '';
  if (sec < 60) return `${Math.round(sec)} Sek.`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m} Min.`;
}

const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/** Papier mit leichter Körnung und Fasern. */
function paper(ctx, w, h, base, seed) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(seed);
  ctx.save();
  for (let i = 0; i < (w * h) / 900; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.06;
    ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#7a6f5c';
    ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < (w * h) / 12000; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.05;
    ctx.strokeStyle = '#8c806a';
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI;
    const l = 6 + rand() * 14;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rand() * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();
}

/** Bild formatfüllend in ein Rechteck (Ausschnitt mittig); flipped = Bitmap liegt kopfüber vor. */
function drawCover(ctx, image, flipped, x, y, w, h) {
  const iw = image.width;
  const ih = image.height;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (flipped) {
    ctx.translate(0, y * 2 + h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

/** Bereiche der Collage für 1–4 Cover. */
function mosaicCells(n, x, y, w, h, gap) {
  const hw = (w - gap) / 2;
  const hh = (h - gap) / 2;
  if (n <= 1) return [[x, y, w, h]];
  if (n === 2) return [[x, y, hw, h], [x + hw + gap, y, hw, h]];
  if (n === 3) return [[x, y, hw, h], [x + hw + gap, y, hw, hh], [x + hw + gap, y + hh + gap, hw, hh]];
  return [[x, y, hw, hh], [x + hw + gap, y, hw, hh], [x, y + hh + gap, hw, hh], [x + hw + gap, y + hh + gap, hw, hh]];
}

/** Kreppband-Streifen mit gerissenen Enden (Mittelpunkt cx/cy, gedreht um angle). */
function tape(ctx, cx, cy, w, h, angle, seed) {
  const rand = rng(seed);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  const teeth = 9;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? 7 + rand() * 6 : -2 + rand() * 4), -h / 2 + (h * i) / teeth);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? -7 - rand() * 6 : 2 - rand() * 4), -h / 2 + (h * i) / teeth);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, 'rgba(241,232,206,0.96)');
  g.addColorStop(0.5, 'rgba(236,226,198,0.95)');
  g.addColorStop(1, 'rgba(226,214,184,0.96)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // Längsfasern des Kreppbands
  ctx.clip();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#a99a74';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = -h / 2 + rand() * h;
    ctx.beginPath();
    ctx.moveTo(-w / 2 - 10, y);
    ctx.lineTo(w / 2 + 10, y + (rand() - 0.5) * 4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Handschrift auf eine Breite einpassen (Schriftgröße schrittweise verkleinern). */
function fitHand(ctx, text, weight, maxWidth, start, min) {
  let size = start;
  ctx.font = `${weight} ${size}px ${FONT_HAND}`;
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 3;
    ctx.font = `${weight} ${size}px ${FONT_HAND}`;
  }
  return size;
}

/** Leicht gewellter Strich (Unterstreichung mit dem Stift). */
function scribble(ctx, x0, y0, x1, color, width, seed) {
  const rand = rng(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    ctx.quadraticCurveTo(x - (x1 - x0) / steps / 2, y0 + (rand() - 0.5) * width * 2.2, x, y0 + (rand() - 0.5) * width * 1.2);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- Cover der Alben laden ----------

/**
 * Bilder für die Collage: bis zu vier Frontcover (fehlende als erzeugte Ersatzcover).
 * Liefert [{ image, flipped } | { color }] in der Reihenfolge von pl.albums.
 */
export async function loadMixTiles(textures, albumById, pl, priority = 6) {
  const ids = (pl.albums ?? []).slice(0, 4);
  return Promise.all(
    ids.map(async (id) => {
      const album = albumById(id);
      if (!album) return { color: '#6b7280' };
      if (album.art?.front) {
        try {
          const entry = await textures.load(artUrl(album, 'front', 'sm'), priority);
          if (entry.image?.width > 0) return { image: entry.image, flipped: entry.flipped };
        } catch {
          /* Ersatzcover */
        }
      }
      const entry = textures.generated(`front:${album.id}`, () => drawFrontPlaceholder(album));
      return { image: entry.image, flipped: false };
    })
  );
}

/** Platzhalter, solange die Cover laden: farbige Felder in den Albumfarben. */
export function pendingTiles(albumById, pl) {
  return (pl.albums ?? []).slice(0, 4).map((id) => {
    const a = albumById(id);
    return { color: a ? albumHashColor(a) : '#6b7280' };
  });
}

// ---------- Front (Einleger vorne, quadratisch) ----------

export function drawMixtapeFront(pl, tiles = [], size = 1024) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const seed = hashString(pl.id);
  const ink = inkFor(pl);
  paper(ctx, size, size, PAPER, seed);

  const n = Math.min(4, tiles.length);
  const m = size * 0.035;
  if (n) {
    const cells = mosaicCells(n, m, m, size - 2 * m, size - 2 * m, size * 0.014);
    cells.forEach(([x, y, w, h], i) => {
      const t = tiles[i];
      if (t?.image) drawCover(ctx, t.image, t.flipped, x, y, w, h);
      else {
        ctx.fillStyle = t?.color ?? '#6b7280';
        ctx.fillRect(x, y, w, h);
      }
    });
    // Gedruckt auf Papier: leicht matt, Ränder etwas dunkler
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    const v = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, size, size);
  } else {
    // Leere Liste: nur Papier mit ein paar Kritzeleien
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const rand = rng(seed + 3);
    for (let i = 0; i < 5; i++) {
      const x = size * (0.15 + rand() * 0.7);
      const y = size * (0.12 + rand() * 0.3);
      const r = 14 + rand() * 16;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? r * 0.45 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Beschriftetes Kreppband
  const rand = rng(seed + 11);
  const angle = (-2.6 + rand() * 2) * (Math.PI / 180);
  const tw = size * 0.86;
  ctx.textBaseline = 'alphabetic';
  let fs = fitHand(ctx, pl.title, 700, tw - 90, size * 0.13, size * 0.075);
  ctx.font = `700 ${fs}px ${FONT_HAND}`;
  let lines = wrap(ctx, pl.title, tw - 90, 2);
  if (lines.length > 1) {
    fs = Math.min(fs, size * 0.1);
    ctx.font = `700 ${fs}px ${FONT_HAND}`;
    lines = wrap(ctx, pl.title, tw - 90, 2);
  }
  const sub = [pl.trackCount ? `${pl.trackCount} Titel` : 'noch leer', fmtLong(pl.duration)].filter(Boolean).join(' · ');
  const subFs = size * 0.045;
  const lh = fs * 0.95;
  const th = lh * lines.length + subFs * 1.6 + 34;
  const cy = n ? size * 0.76 : size * 0.6;
  tape(ctx, size / 2, cy, tw, th, angle, seed + 5);
  ctx.save();
  ctx.translate(size / 2, cy);
  ctx.rotate(angle);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = `700 ${fs}px ${FONT_HAND}`;
  const top = -th / 2 + 14 + lh * 0.82;
  lines.forEach((l, i) => ctx.fillText(l, 0, top + i * lh));
  ctx.font = `500 ${subFs}px ${FONT_HAND}`;
  ctx.globalAlpha = 0.8;
  ctx.textAlign = 'right';
  ctx.fillText(sub, tw / 2 - 44, th / 2 - 18);
  ctx.restore();
  return c;
}

// ---------- Rücken (Papierstreifen, beschriftet) ----------

export function drawMixtapeSpine(pl, direction = 'down', widthMM = 6.5) {
  const w = Math.min(360, Math.round((96 * widthMM) / 6.5));
  const h = 1744;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const ink = inkFor(pl);
  paper(ctx, w, h, '#f4efe4', hashString(`${pl.id}s`));
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.2, 'rgba(0,0,0,0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (direction === 'up') {
    ctx.translate(w / 2, h);
    ctx.rotate(-Math.PI / 2);
  } else {
    ctx.translate(w / 2, 0);
    ctx.rotate(Math.PI / 2);
  }
  // x entlang des Rückens, y quer (0 = Mitte)
  const pad = 80;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  const countText = pl.trackCount ? `${pl.trackCount} Titel` : '';
  const k = Math.min(2.1, w / 96);
  ctx.font = `500 ${Math.round(40 * Math.min(k, 1.5))}px ${FONT_HAND}`;
  const cw = countText ? ctx.measureText(countText).width + 50 : 0;
  // kleiner Stern vor dem Namen
  ctx.save();
  ctx.translate(pad + 14, 2);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = (i % 2 ? 7 : 17) * Math.min(k, 1.4);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const nameX = pad + 50;
  const size = fitHand(ctx, pl.title, 700, h - nameX - pad - cw, Math.round(78 * k), 40);
  ctx.font = `700 ${size}px ${FONT_HAND}`;
  ctx.fillText(ellipsize(ctx, pl.title, h - nameX - pad - cw), nameX, 4);
  if (countText) {
    ctx.font = `500 ${Math.round(40 * Math.min(k, 1.5))}px ${FONT_HAND}`;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.75;
    ctx.fillText(countText, h - pad, 4);
  }
  ctx.restore();
  return c;
}

// ---------- Rückseite (Titelliste auf Linienpapier) ----------

function listRows(pl, detail) {
  if (detail?.tracks) {
    return detail.tracks.map((t, i) => ({
      no: i + 1,
      title: t.title,
      artist: t.artist ?? '',
      time: t.duration ? fmtTime(t.duration) : '',
      gone: t.available === false
    }));
  }
  return (pl.preview ?? []).map((t, i) => ({ no: i + 1, title: t.title, artist: t.artist ?? '', time: '', gone: false }));
}

export function drawMixtapeBack(pl, detail, aspect = 1380 / 1180) {
  const w = Math.round(1180 * aspect);
  const h = 1180;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const ink = inkFor(pl);
  const seed = hashString(`${pl.id}b`);
  paper(ctx, w, h, '#fbf9f1', seed);

  // Linien und roter Rand wie im Schulheft
  const rule = 50;
  const firstRule = 196;
  ctx.strokeStyle = 'rgba(70,130,205,0.32)';
  ctx.lineWidth = 2;
  for (let y = firstRule; y < h - 40; y += rule) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const marginX = 128;
  ctx.strokeStyle = 'rgba(214,64,64,0.5)';
  ctx.beginPath();
  ctx.moveTo(marginX, 0);
  ctx.lineTo(marginX, h);
  ctx.stroke();

  // Titel, unterstrichen
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  const tsize = fitHand(ctx, pl.title, 700, w - marginX - 120, 96, 54);
  ctx.font = `700 ${tsize}px ${FONT_HAND}`;
  const title = ellipsize(ctx, pl.title, w - marginX - 120);
  ctx.fillText(title, marginX + 30, 124);
  scribble(ctx, marginX + 24, 146, marginX + 40 + ctx.measureText(title).width, ink, 5, seed);

  // Titelliste
  const rows = listRows(pl, detail);
  const perColMax = Math.floor((h - 120 - firstRule) / rule);
  const cols = rows.length > perColMax ? 2 : 1;
  const capacity = perColMax * cols;
  const shown = rows.length > capacity ? rows.slice(0, capacity - 1) : rows;
  const more = rows.length - shown.length;
  const colW = (w - marginX - 60 - (cols - 1) * 40) / cols;
  // Kräftig genug, dass die Schrift auch auf der kleinen Hülle lesbar bleibt
  const fs = cols > 1 ? 36 : 42;
  shown.forEach((r, i) => {
    const col = Math.floor(i / perColMax);
    const x = marginX + 22 + col * (colW + 40);
    const y = firstRule + (i % perColMax) * rule + rule - 10;
    ctx.globalAlpha = r.gone ? 0.45 : 1;
    ctx.font = `700 ${fs}px ${FONT_HAND}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.no}.`, x + fs * 1.15, y);
    ctx.textAlign = 'left';
    const timeW = r.time ? 86 : 0;
    const text = r.artist ? `${r.title} – ${r.artist}` : r.title;
    ctx.font = `600 ${fs}px ${FONT_HAND}`;
    const shownText = ellipsize(ctx, text, colW - fs * 1.6 - timeW - 12);
    ctx.fillText(shownText, x + fs * 1.5, y);
    if (r.gone) {
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + fs * 1.4, y - fs * 0.28);
      ctx.lineTo(x + fs * 1.6 + ctx.measureText(shownText).width, y - fs * 0.32);
      ctx.stroke();
      ctx.restore();
    }
    if (r.time) {
      ctx.textAlign = 'right';
      ctx.globalAlpha *= 0.7;
      ctx.fillText(r.time, x + colW - 8, y);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  });
  if (more > 0) {
    const i = shown.length;
    const col = Math.floor(i / perColMax);
    ctx.font = `600 ${fs}px ${FONT_HAND}`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(`… und ${more} weitere`, marginX + 22 + col * (colW + 40) + fs * 1.5, firstRule + (i % perColMax) * rule + rule - 10);
    ctx.globalAlpha = 1;
  }
  if (!rows.length) {
    ctx.font = `600 44px ${FONT_HAND}`;
    ctx.globalAlpha = 0.6;
    ctx.fillText('(noch leer – Titel über ＋ hinzufügen)', marginX + 40, firstRule + rule * 2 - 10);
    ctx.globalAlpha = 1;
  }

  // Fußzeile
  ctx.font = `600 38px ${FONT_HAND}`;
  ctx.globalAlpha = 0.8;
  const info = [pl.trackCount ? `${pl.trackCount} Titel` : null, fmtLong(pl.duration)].filter(Boolean).join(' · ');
  ctx.fillText(info, marginX + 30, h - 44);
  ctx.textAlign = 'right';
  ctx.fillText(`gemischt ${fmtDate(pl.created)}`, w - 60, h - 44);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  return c;
}

// ---------- Booklet innen (aus welchen Alben die Titel stammen) ----------

export function drawMixtapeInlay(pl, detail, size = 1024) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const ink = inkFor(pl);
  const seed = hashString(`${pl.id}i`);
  paper(ctx, size, size, PAPER, seed);
  const pad = 96;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 64px ${FONT_HAND}`;
  ctx.fillText('Aus diesen Alben:', pad, pad + 40);
  scribble(ctx, pad - 4, pad + 62, pad + ctx.measureText('Aus diesen Alben:').width + 6, ink, 4, seed);

  // Alben mit Anzahl der Titel daraus
  const albums = new Map();
  for (const t of detail?.tracks ?? []) {
    if (!t.albumTitle) continue;
    const key = `${t.albumArtist ?? t.artist ?? ''}|${t.albumTitle}`;
    const e = albums.get(key) ?? { artist: t.albumArtist ?? t.artist ?? '', title: t.albumTitle, n: 0 };
    e.n++;
    albums.set(key, e);
  }
  const list = [...albums.values()].sort((a, b) => b.n - a.n);
  const lh = 62;
  const maxRows = Math.floor((size - pad * 2 - 170) / lh);
  ctx.font = `600 46px ${FONT_HAND}`;
  list.slice(0, maxRows).forEach((a, i) => {
    const y = pad + 150 + i * lh;
    const text = `${a.artist ? `${a.artist} – ` : ''}${a.title}`;
    ctx.fillText(`•  ${ellipsize(ctx, text, size - pad * 2 - 90)}`, pad, y);
    ctx.globalAlpha = 0.65;
    ctx.textAlign = 'right';
    ctx.fillText(`${a.n}×`, size - pad, y);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  });
  if (list.length > maxRows) {
    ctx.globalAlpha = 0.7;
    ctx.fillText(`… und ${list.length - maxRows} weitere`, pad, pad + 150 + maxRows * lh);
    ctx.globalAlpha = 1;
  }
  if (!list.length) {
    ctx.globalAlpha = 0.6;
    ctx.fillText(detail ? 'Noch keine Titel.' : '…', pad, pad + 150);
    ctx.globalAlpha = 1;
  }

  // CD-Kritzelei unten rechts
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.7;
  const cx = size - pad - 60;
  const cy = size - pad - 40;
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 40, -2.4, -1.3);
  ctx.stroke();
  ctx.restore();
  ctx.font = `600 38px ${FONT_HAND}`;
  ctx.globalAlpha = 0.75;
  ctx.fillText(`gemischt mit discbox · ${fmtDate(pl.created)}`, pad, size - pad + 10);
  ctx.globalAlpha = 1;
  return c;
}

// ---------- CD-R mit Stiftbeschriftung ----------

function ringText(ctx, text, radius, startAngle, fontSize) {
  ctx.save();
  ctx.font = `600 ${fontSize}px ${FONT_TEXT}`;
  let a = startAngle;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    ctx.save();
    ctx.rotate(a + cw / radius / 2);
    ctx.fillText(ch, -cw / 2, -radius);
    ctx.restore();
    a += (cw + fontSize * 0.08) / radius;
  }
  ctx.restore();
}

export function drawMixtapeDisc(pl, size = 1024) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = size / 2;
  const mm = R / 60;
  const ink = inkFor(pl);
  const seed = hashString(`${pl.id}d`);
  ctx.translate(R, R);

  // Silberne Oberseite eines Rohlings
  let base;
  if (ctx.createConicGradient) {
    base = ctx.createConicGradient(0.9, 0, 0);
    const stops = ['#cfd3d9', '#aeb4be', '#e2e5e9', '#bcc2cb', '#d6d9de', '#a9b0ba', '#cfd3d9'];
    stops.forEach((s, i) => base.addColorStop(i / (stops.length - 1), s));
  } else {
    base = ctx.createRadialGradient(0, 0, 10, 0, 0, R);
    base.addColorStop(0, '#dadde2');
    base.addColorStop(1, '#adb3bd');
  }
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  // feine Ringe
  const rand = rng(seed);
  ctx.lineWidth = 1;
  for (let r = 24 * mm; r < 59 * mm; r += 3 + rand() * 5) {
    ctx.strokeStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '120,128,140'},${0.05 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // durchsichtiger Innenring und Stapelring
  ctx.fillStyle = 'rgba(225,230,236,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, 16.5 * mm, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,156,166,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 19.5 * mm, 0, Math.PI * 2);
  ctx.stroke();
  // Aufdruck des Rohlings
  ctx.fillStyle = 'rgba(90,96,108,0.75)';
  ringText(ctx, 'CD-R · 80 MIN · 700 MB · RECORDABLE', 23.5 * mm, -1.1, 17);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (const r of [16.5, 58.8]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * mm, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Edding-Beschriftung: Name über dem Loch, Datum darunter
  ctx.save();
  ctx.rotate((-5 + rand() * 4) * (Math.PI / 180));
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const maxW = 78 * mm;
  let fs = fitHand(ctx, pl.title, 700, maxW, 110, 50);
  ctx.font = `700 ${fs}px ${FONT_HAND}`;
  let lines = wrap(ctx, pl.title, maxW, 2);
  if (lines.length > 1) {
    fs = Math.min(fs, 72);
    ctx.font = `700 ${fs}px ${FONT_HAND}`;
    lines = wrap(ctx, pl.title, 70 * mm, 2);
  }
  const lh = fs * 0.92;
  const baseY = -27 * mm;
  lines.forEach((l, i) => ctx.fillText(l, 0, baseY - (lines.length - 1 - i) * lh));
  const w0 = Math.max(...lines.map((l) => ctx.measureText(l).width));
  scribble(ctx, -w0 / 2, baseY + 16, w0 / 2, ink, 5, seed);
  ctx.font = `600 54px ${FONT_HAND}`;
  ctx.globalAlpha = 0.85;
  const sub = [fmtDate(pl.created), pl.trackCount ? `${pl.trackCount} Titel` : null].filter(Boolean).join('  ·  ');
  ctx.fillText(sub, 0, 37 * mm);
  ctx.restore();
  return c;
}

/** Farbe für Hintergrund und Oberfläche, falls noch keine Cover geladen sind. */
export function mixtapeColor(pl, albumById) {
  const first = (pl.albums ?? []).map((id) => albumById(id)).find(Boolean);
  return first ? albumHashColor(first) : mixHex('#8a7d64', '#6b7280', 0.5);
}
