// Durchsucht den Musikordner und liest Tags aus Audiodateien.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { ART_SUBDIR, IMAGE_FILE } from './artnames.js';
import { AUDIO_EXTENSIONS } from './formats.js';
import { pLimit, yearFrom } from './util.js';

/** Systemordner von NAS-Herstellern, Papierkörbe und versteckte Ordner überspringen. */
const IGNORED = /^(\.|@|#|\$)|^(lost\+found|system volume information|recycle(d|r)?|papierkorb)$/i;

/**
 * @returns {{ audio: Array, imagesByDir: Map<string, Array>, artSubdirs: Map<string, string[]> }}
 */
export async function walkMusic(root, log) {
  const audio = [];
  const imagesByDir = new Map();
  const artSubdirs = new Map();
  const visited = new Set();
  const stack = [''];

  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    try {
      const real = await fsp.realpath(abs);
      if (visited.has(real)) continue;
      visited.add(real);
    } catch {
      continue;
    }
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      log?.warn(`Ordner nicht lesbar: ${rel || '/'} (${err.code ?? err.message})`);
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (IGNORED.test(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        try {
          const st = await fsp.stat(path.join(abs, name));
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        stack.push(childRel);
        if (ART_SUBDIR.test(name)) {
          if (!artSubdirs.has(rel)) artSubdirs.set(rel, []);
          artSubdirs.get(rel).push(childRel);
        }
        continue;
      }
      if (!isFile) continue;
      const ext = path.extname(name).toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext)) {
        audio.push({ rel: childRel, dir: rel, name, ext, abs: path.join(abs, name) });
      } else if (IMAGE_FILE.test(name)) {
        if (!imagesByDir.has(rel)) imagesByDir.set(rel, []);
        imagesByDir.get(rel).push({ name, rel: childRel, abs: path.join(abs, name) });
      }
    }
  }
  return { audio, imagesByDir, artSubdirs };
}

/** Ergänzt mtime und Größe (parallel, aber begrenzt – schont Festplatten im NAS). */
export async function statEntries(entries, concurrency = 16) {
  const limit = pLimit(concurrency);
  await Promise.all(
    entries.map((e) =>
      limit(async () => {
        try {
          const st = await fsp.stat(e.abs);
          e.mtime = Math.round(st.mtimeMs);
          e.size = st.size;
        } catch {
          e.missing = true;
        }
      })
    )
  );
  return entries.filter((e) => !e.missing);
}

const splitGenres = (list) =>
  [...new Set((list ?? []).flatMap((g) => String(g).split(/\s*[;|\u0000]\s*/)).map((g) => g.trim()).filter(Boolean))];

/** Liest Tags und technische Daten einer Audiodatei. */
export async function readTags(abs) {
  const meta = await parseFile(abs, { duration: false, skipCovers: true });
  const c = meta.common ?? {};
  const f = meta.format ?? {};
  return {
    tags: {
      title: c.title?.trim() || null,
      artist: c.artist?.trim() || (c.artists?.length ? c.artists.join(', ') : null),
      albumartist: c.albumartist?.trim() || null,
      album: c.album?.trim() || null,
      year: c.year ?? yearFrom(c.date) ?? yearFrom(c.originaldate) ?? null,
      genre: splitGenres(c.genre),
      trackNo: c.track?.no ?? null,
      trackOf: c.track?.of ?? null,
      discNo: c.disk?.no ?? null,
      discOf: c.disk?.of ?? null,
      compilation: !!c.compilation,
      mbAlbumId: c.musicbrainz_albumid ?? null,
      mbReleaseGroupId: c.musicbrainz_releasegroupid ?? null,
      label: c.label?.[0] ?? null
    },
    format: {
      container: f.container ?? null,
      codec: f.codec ?? null,
      lossless: f.lossless ?? null,
      sampleRate: f.sampleRate ?? null,
      bitsPerSample: f.bitsPerSample ?? null,
      bitrate: f.bitrate ?? null,
      channels: f.numberOfChannels ?? null,
      duration: f.duration ?? null
    }
  };
}

