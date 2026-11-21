// Fasst eingelesene Titel zu Alben zusammen.
// Reine Funktionen ohne Dateizugriff – dadurch gut testbar.

import path from 'node:path';
import { codecLabel, formatSummary, mimeForExt, needsTranscode } from './formats.js';
import { frequencySorted, mostCommon, norm, sha1 } from './util.js';

export const VARIOUS = 'Various Artists';

const DISC_DIR = /^(?:cd|disc|disk|disco|disque)\s*[-_.]?\s*(\d{1,2})(?![\d])(?:\b|$)/i;
const DISC_SUFFIX =
  /^(.+?)[\s._-]*[([{]?\s*(?:cd|disc|disk)\s*[-_.]?\s*(\d{1,2})(?:\s*(?:of|von|\/)\s*\d{1,2})?\s*[)\]}]?$/i;

const GENERIC_PARENT =
  /^(compilations?|sampler|samplers|various|various artists|va|diverse|verschiedene|music|musik|mp3s?|flac|alben|albums|cds?|audio|soundtracks?|ost|incoming|downloads?)$/i;

/** Erkennt Disc-Ordner wie „CD1“, „Disc 2“ oder „Album (CD 2)“. */
export function discFromDirName(name) {
  let m = name.match(DISC_DIR);
  if (m) return { disc: Number(m[1]), stem: null };
  m = name.match(DISC_SUFFIX);
  if (m && m[1].trim().length > 1) return { disc: Number(m[2]), stem: m[1].trim() };
  return null;
}

/** Entfernt Zusätze wie „(Disc 1)“ oder „[CD2]“ aus Albumtiteln. */
export function stripDiscSuffix(title) {
  if (!title) return title;
  const m = String(title).match(DISC_SUFFIX);
  return m && m[1].trim().length > 1 ? m[1].trim().replace(/[\s\-–:,]+$/, '') : title;
}

/** Liest „Künstler - Album“, „2019 - Album“, „Album (2019)“ aus einem Ordnernamen. */
export function parseFolderName(name) {
  let s = String(name ?? '').trim();
  const out = { artist: null, album: null, year: null };
  // Anhängsel wie [FLAC], [320], (Remastered 2009) bleiben im Titel, nur reine Format-Klammern weg
  s = s.replace(/\s*[[(](flac|mp3|320|v0|24bit|16bit|cd|web|vinyl|lossless|cbr|vbr)[^\])]*[\])]\s*$/i, '').trim();
  let m = s.match(/^(.*?)[\s._-]*[([](1[89]\d\d|20\d\d)[)\]]$/);
  if (m) {
    out.year = Number(m[2]);
    s = m[1].trim();
  }
  m = s.match(/^(1[89]\d\d|20\d\d)\s*[-–.]\s*(.+)$/);
  if (m) {
    out.year ??= Number(m[1]);
    s = m[2].trim();
  }
  m = s.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (m) {
    out.artist = m[1].trim();
    s = m[2].trim();
    const y = s.match(/^(1[89]\d\d|20\d\d)\s*[-–]\s*(.+)$/);
    if (y) {
      out.year ??= Number(y[1]);
      s = y[2].trim();
    }
  }
  out.album = s || null;
  return out;
}

/** Titel aus einem Dateinamen wie „03 - Künstler - Titel.flac“. */
export function titleFromFileName(fileName, artist) {
  let s = fileName.replace(/\.[^.]+$/, '');
  s = s.replace(/^\s*\d{1,3}[\s._-]+(?=\D)/, '');
  if (artist) {
    const a = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`^${a}\\s*[-–]\\s*`, 'i'), '');
  }
  return s.trim() || fileName;
}

const trackNoFromFileName = (fileName) => {
  const m = fileName.match(/^\s*(\d{1,3})(?=[\s._-])/);
  return m ? Number(m[1]) : null;
};

const posixDirname = (p) => {
  const d = path.posix.dirname(p);
  return d === '.' ? '' : d;
};

/**
 * @param {Array} files Einträge { rel, dir, name, ext, mtime, size, tags, format }
 * @returns {Array} Alben (ohne Bilder)
 */
export function groupTracks(files) {
  const byDir = new Map();
  for (const f of files) {
    if (!byDir.has(f.dir)) byDir.set(f.dir, []);
    byDir.get(f.dir).push(f);
  }

  const groups = new Map();
  for (const [dir, list] of byDir) {
    const name = dir ? path.posix.basename(dir) : '';
    const parent = posixDirname(dir);
    const discInfo = dir ? discFromDirName(name) : null;
    let baseDir = dir;
    let dirDisc = null;
    if (discInfo) {
      dirDisc = discInfo.disc;
      baseDir = discInfo.stem ? (parent ? `${parent}/${discInfo.stem}` : discInfo.stem) : parent;
    }

    // Innerhalb des Ordners nach Albumtitel aufteilen
    const byAlbum = new Map();
    for (const f of list) {
      const key = norm(stripDiscSuffix(f.tags?.album ?? ''));
      if (!byAlbum.has(key)) byAlbum.set(key, []);
      byAlbum.get(key).push(f);
    }
    const shared = [...byAlbum.keys()].filter(Boolean).length > 1;

    for (const [albumKey, albumFiles] of byAlbum) {
      let key = `${baseDir}\u0000${albumKey}`;
      if (shared) {
        const who = norm(mostCommon(albumFiles.map((f) => f.tags?.albumartist || f.tags?.artist)) ?? '');
        key += `\u0000${who}`;
      }
      if (!groups.has(key)) groups.set(key, { baseDir, dirs: new Set(), files: [], shared: false });
      const g = groups.get(key);
      g.shared ||= shared;
      g.dirs.add(dir);
      for (const f of albumFiles) g.files.push({ ...f, dirDisc });
    }
  }

  return [...groups.values()].map(buildAlbum);
}

function buildAlbum(g) {
  const files = g.files;
  const tags = files.map((f) => f.tags ?? {});
  const folder = parseFolderName(g.baseDir ? path.posix.basename(g.baseDir) : '');
  const parentName = g.baseDir ? path.posix.basename(posixDirname(g.baseDir)) : '';

  // Discs
  const discOf = (f) => f.tags?.discNo || f.dirDisc || 1;
  const discNumbers = new Set(files.map(discOf));

  // Titel
  const rawTitles = tags.map((t) => t.album).filter(Boolean);
  const multi = discNumbers.size > 1 || new Set(rawTitles).size > 1;
  let title = mostCommon(multi ? rawTitles.map(stripDiscSuffix) : rawTitles);
  if (!title) title = folder.album || (g.baseDir ? path.posix.basename(g.baseDir) : 'Unbekanntes Album');

  // Künstler
  const albumArtists = tags.map((t) => t.albumartist).filter(Boolean);
  const trackArtists = tags.map((t) => t.artist).filter(Boolean);
  const compilationVotes = tags.filter((t) => t.compilation).length;
  let artist = mostCommon(albumArtists);
  let compilation = false;
  if (!artist) {
    const distinct = frequencySorted(trackArtists);
    const top = distinct[0];
    const topShare = top ? trackArtists.filter((a) => a === top).length / files.length : 0;
    if (compilationVotes > files.length / 2 || (distinct.length > 2 && topShare < 0.6)) {
      artist = VARIOUS;
      compilation = true;
    } else if (top) {
      artist = top;
    }
  }
  if (!artist && folder.artist) artist = folder.artist;
  if (!artist && parentName && !GENERIC_PARENT.test(parentName)) artist = parentName;
  if (!artist) artist = 'Unbekannter Künstler';
  if (/^(various( artists)?|va|verschiedene( interpreten)?|diverse)$/i.test(artist)) {
    artist = VARIOUS;
    compilation = true;
  }
  if (compilationVotes > files.length / 2) compilation = true;

  // Jahr, Genres
  const year = mostCommon(tags.map((t) => t.year).filter(Boolean)) ?? folder.year ?? null;
  const genres = frequencySorted(tags.flatMap((t) => t.genre ?? [])).slice(0, 3);

  // Titel sortieren und aufbereiten
  const tracks = files
    .map((f, i) => {
      const t = f.tags ?? {};
      const fmt = f.format ?? {};
      const codec = codecLabel(f.ext, fmt);
      return {
        id: sha1(f.rel, 16),
        rel: f.rel,
        disc: discOf(f),
        no: t.trackNo || trackNoFromFileName(f.name) || null,
        title: t.title || titleFromFileName(f.name, t.artist || artist),
        artist: t.artist || null,
        duration: fmt.duration ? Math.round(fmt.duration * 10) / 10 : null,
        codec,
        lossless: !!fmt.lossless || ['FLAC', 'ALAC', 'WAV', 'AIFF', 'APE', 'WavPack'].includes(codec),
        bitrate: fmt.bitrate ? Math.round(fmt.bitrate) : null,
        sampleRate: fmt.sampleRate ?? null,
        bitsPerSample: fmt.bitsPerSample ?? null,
        channels: fmt.channels ?? null,
        mime: mimeForExt(f.ext),
        transcode: needsTranscode(f.ext, fmt),
        size: f.size,
        mtime: f.mtime,
        _name: f.name,
        _i: i
      };
    })
    .sort(
      (a, b) =>
        a.disc - b.disc ||
        (a.no ?? 9999) - (b.no ?? 9999) ||
        a._name.localeCompare(b._name, 'de', { numeric: true })
    );
  // Fehlende Nummern auffüllen
  const perDisc = new Map();
  for (const t of tracks) {
    const n = (perDisc.get(t.disc) ?? 0) + 1;
    perDisc.set(t.disc, n);
    if (!t.no) t.no = n;
    delete t._name;
    delete t._i;
  }

  const duration = Math.round(tracks.reduce((s, t) => s + (t.duration ?? 0), 0));
  const id = sha1(`${g.baseDir}|${norm(title)}${g.shared ? `|${norm(artist)}` : ''}`, 12);
  const addedAt = Math.min(...files.map((f) => f.mtime || Date.now()));

  return {
    id,
    title,
    artist,
    compilation,
    year,
    genres,
    discs: Math.max(...discNumbers),
    trackCount: tracks.length,
    duration,
    format: formatSummary(tracks),
    addedAt,
    baseDir: g.baseDir,
    dirs: [...g.dirs].sort(),
    sharedDir: g.shared,
    mbid: mostCommon(tags.map((t) => t.mbAlbumId).filter(Boolean)) ?? null,
    mbReleaseGroupId: mostCommon(tags.map((t) => t.mbReleaseGroupId).filter(Boolean)) ?? null,
    label: mostCommon(tags.map((t) => t.label).filter(Boolean)) ?? null,
    tracks
  };
}
