// Cover-Bilder finden (Ordner, eingebettet), ausliefern und in passenden Größen zwischenspeichern.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import { pickFolderArt } from './artnames.js';
import { sha1 } from './util.js';

sharp.cache(false);
sharp.concurrency(2);

export const KINDS = ['front', 'back', 'disc'];
export const SIZES = { sm: 420, md: 900, lg: 1600 };

const extForMime = (mime) =>
  /png/i.test(mime) ? '.png' : /webp/i.test(mime) ? '.webp' : /gif/i.test(mime) ? '.gif' : '.jpg';

/**
 * Sucht Bilder im Albumordner (und Unterordnern wie „Scans“).
 * @returns {{ front, back, disc, gallery }} jeweils ArtRefs { src, root, rel, v }
 */
export function findFolderArt(album, imagesByDir, artSubdirs, statOf) {
  const result = { front: null, back: null, disc: null, gallery: [] };
  if (album.sharedDir) return result;

  const mainDirs = new Set(album.dirs);
  // Bei CD1/CD2-Ordnern liegen die Cover oft im übergeordneten Albumordner
  if (album.baseDir != null && imagesByDir.has(album.baseDir)) mainDirs.add(album.baseDir);
  const candidates = [];
  const seen = new Set();
  const add = (img, depth) => {
    if (seen.has(img.rel)) return;
    seen.add(img.rel);
    const st = statOf(img);
    candidates.push({ ...img, depth, size: st?.size ?? 0, mtime: st?.mtime ?? 0 });
  };
  for (const d of mainDirs) for (const img of imagesByDir.get(d) ?? []) add(img, 0);
  const subParents = new Set([...mainDirs, album.baseDir]);
  for (const d of subParents) {
    for (const sub of artSubdirs.get(d) ?? []) for (const img of imagesByDir.get(sub) ?? []) add(img, 1);
  }
  if (!candidates.length) return result;

  const picked = pickFolderArt(candidates);
  const ref = (img) => ({ src: 'folder', root: 'music', rel: img.rel, v: sha1(`${img.rel}:${img.mtime}:${img.size}`, 10) });
  for (const kind of ['front', 'back', 'disc']) if (picked[kind]) result[kind] = ref(picked[kind]);
  result.gallery = [picked.front, picked.back, ...picked.others].filter(Boolean).map(ref).map((r, i) => ({ ...r, name: path.posix.basename(r.rel), n: i }));
  return result;
}

/** Liest eingebettete Bilder aus dem ersten Titel (Ergebnis wird je Datei zwischengespeichert). */
export async function findEmbeddedArt(album, ctx) {
  const first = album.tracks[0];
  if (!first) return {};
  const sig = `${first.mtime}:${first.size}`;
  const cached = ctx.embeddedCache[first.rel];
  if (cached && cached.sig === sig) return cached.art;

  const art = {};
  try {
    const meta = await parseFile(path.join(ctx.musicDir, first.rel), { duration: false, skipCovers: false });
    const pics = meta.common.picture ?? [];
    const byType = (re) => pics.find((p) => re.test(p.type ?? ''));
    const picks = {
      front:
        byType(/front/i) ??
        pics.find((p) => !/back|media|leaflet|artist|band|logo|illustration|lead|conductor|composer|lyricist|recording|performance|screen|fish|icon/i.test(p.type ?? '')) ??
        null,
      back: byType(/back/i) ?? null,
      disc: byType(/media/i) ?? null
    };
    const base = sha1(first.rel, 16);
    for (const kind of KINDS) {
      const pic = picks[kind];
      if (!pic?.data?.length) continue;
      const rel = `art/embedded/${base}-${kind}${extForMime(pic.format)}`;
      await fsp.mkdir(path.join(ctx.dataDir, 'art/embedded'), { recursive: true });
      await fsp.writeFile(path.join(ctx.dataDir, rel), pic.data);
      art[kind] = { src: 'embedded', root: 'data', rel, v: sha1(`${sig}:${kind}:${pic.data.length}`, 10) };
    }
  } catch (err) {
    ctx.log?.debug(`Keine eingebetteten Bilder lesbar in ${first.rel}: ${err.message}`);
  }
  ctx.embeddedCache[first.rel] = { sig, art };
  return art;
}

const inflight = new Map();

/**
 * Liefert den Pfad zu einer skalierten Version (wird bei Bedarf erzeugt).
 * Disc-Bilder bleiben PNG (Transparenz), alles andere wird JPEG.
 */
export async function renderArt({ albumId, kind, ref, size, musicDir, dataDir }) {
  const px = SIZES[size] ?? SIZES.md;
  const png = kind === 'disc';
  const ext = png ? 'png' : 'jpg';
  const dir = path.join(dataDir, 'cache', 'art', albumId);
  const prefix = `${kind}-${size}-`;
  const file = path.join(dir, `${prefix}${ref.v}.${ext}`);
  if (fs.existsSync(file)) return { file, type: png ? 'image/png' : 'image/jpeg' };

  if (!inflight.has(file)) {
    const job = (async () => {
      const src = ref.root === 'music' ? path.join(musicDir, ref.rel) : path.join(dataDir, ref.rel);
      await fsp.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      let img = sharp(src, { failOn: 'none', limitInputPixels: 268402689 })
        .rotate()
        .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true });
      img = png ? img.png({ compressionLevel: 8 }) : img.flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true });
      await img.toFile(tmp);
      await fsp.rename(tmp, file);
      // Veraltete Versionen derselben Größe entfernen
      for (const f of await fsp.readdir(dir)) {
        if (f.startsWith(prefix) && !f.startsWith(`${prefix}${ref.v}.`)) await fsp.rm(path.join(dir, f), { force: true });
      }
    })().finally(() => inflight.delete(file));
    inflight.set(file, job);
  }
  await inflight.get(file);
  return { file, type: png ? 'image/png' : 'image/jpeg' };
}

/** Entfernt zwischengespeicherte Bilder von Alben, die es nicht mehr gibt. */
export async function pruneArtCache(dataDir, validAlbumIds) {
  const dir = path.join(dataDir, 'cache', 'art');
  let removed = 0;
  try {
    for (const id of await fsp.readdir(dir)) {
      if (!validAlbumIds.has(id)) {
        await fsp.rm(path.join(dir, id), { recursive: true, force: true });
        removed++;
      }
    }
  } catch {
    /* noch kein Cache */
  }
  return removed;
}

/** Entfernt extrahierte eingebettete Bilder, die zu keinem Titel mehr gehören. */
export async function pruneEmbedded(dataDir, embeddedCache, validTrackRels) {
  for (const rel of Object.keys(embeddedCache)) {
    if (validTrackRels.has(rel)) continue;
    for (const ref of Object.values(embeddedCache[rel].art ?? {})) {
      await fsp.rm(path.join(dataDir, ref.rel), { force: true }).catch(() => {});
    }
    delete embeddedCache[rel];
  }
}
