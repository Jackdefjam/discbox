// Erkennt anhand von Dateinamen, was ein Bild im Albumordner zeigt.

export const IMAGE_FILE = /\.(jpe?g|png|webp|gif|tiff?)$/i;

/** Unterordner, in denen oft Scans liegen (werden zusätzlich durchsucht). */
export const ART_SUBDIR = /^(scans?|artwork|art|covers?|images?|bilder|booklet|pics?|fotos?|photos?)$/i;

const clean = (name) =>
  name
    .replace(IMAGE_FILE, '')
    .toLowerCase()
    .replace(/\{[0-9a-f-]+\}/g, ' ')
    .replace(/[_\-.()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BACK = /\b(back|backcover|back cover|rear|rearcover|inlay|tray|traycard|tray card|hinten|ruckseite|rueckseite|rückseite)\b/;
const FRONT_STRONG = /\b(front|frontcover|cover|vorderseite|vorne)\b/;
const FOLDER = /\b(folder)\b/;
const WMP_LARGE = /\balbumart( large|large)?\b/;
const WMP_SMALL = /\balbumart ?small\b/;
const ALBUM = /^album$/;
const DISC = /\b(?:cd|disc|disk|cdart|discart)\s?\d{0,2}\b|\b(?:label|medium|media)\b/;
const BOOKLET = /\b(booklet|inside|innen|page|seite|insert|lyrics)\b/;

/**
 * Liefert { kind, score }.
 * kind: 'front' | 'back' | 'disc' | 'other'
 * score: höher = bessere Wahl innerhalb derselben Art.
 */
export function classifyImage(fileName) {
  const n = clean(fileName);
  if (BACK.test(n)) return { kind: 'back', score: /\b(back|backcover|back cover)\b/.test(n) ? 3 : 2 };
  if (BOOKLET.test(n) && !FRONT_STRONG.test(n)) return { kind: 'other', score: 0 };
  if (FRONT_STRONG.test(n)) {
    // „cd front“ ist das Frontcover, „cover“ allein ebenfalls
    return { kind: 'front', score: /^(cover|front|frontcover)$/.test(n) ? 5 : 4 };
  }
  if (FOLDER.test(n)) return { kind: 'front', score: 3 };
  if (WMP_SMALL.test(n)) return { kind: 'front', score: 0 };
  if (WMP_LARGE.test(n)) return { kind: 'front', score: 2 };
  if (ALBUM.test(n)) return { kind: 'front', score: 1 };
  if (DISC.test(n)) return { kind: 'disc', score: /^(cd|disc|cdart|discart)( ?\d+)?$/.test(n) ? 3 : 1 };
  return { kind: 'other', score: 0 };
}

/**
 * Wählt aus einer Liste von Bildern {name, size, ...} die besten Kandidaten.
 * Liefert { front, back, disc, others }.
 */
export function pickFolderArt(images) {
  const best = { front: null, back: null, disc: null };
  const others = [];
  for (const img of images) {
    const { kind, score } = classifyImage(img.name);
    if (kind === 'other') {
      others.push(img);
      continue;
    }
    const cur = best[kind];
    if (!cur || score > cur.score || (score === cur.score && (img.size ?? 0) > (cur.img.size ?? 0))) {
      if (cur) others.push(cur.img);
      best[kind] = { img, score };
    } else {
      others.push(img);
    }
  }
  // Kein eindeutiges Frontcover? Dann das größte nicht zugeordnete Bild im Albumordner nehmen,
  // ersatzweise das erste Bild aus einem Scan-Unterordner (Booklet-Seite 1 ist meist das Cover).
  if (!best.front && others.length) {
    const main = others.filter((o) => !o.depth);
    const pool = main.length ? main : others.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })).slice(0, 1);
    const pick = pool.reduce((a, b) => ((b.size ?? 0) > (a.size ?? 0) ? b : a));
    others.splice(others.indexOf(pick), 1);
    best.front = { img: pick, score: -1 };
  }
  others.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  return {
    front: best.front?.img ?? null,
    back: best.back?.img ?? null,
    disc: best.disc?.img ?? null,
    others
  };
}
