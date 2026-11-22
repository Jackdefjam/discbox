// Hält die Bibliothek im Speicher, scannt inkrementell und verbindet Tags, Cover und Online-Funde.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { findEmbeddedArt, findFolderArt, KINDS, pruneArtCache, pruneEmbedded, renderArt } from './art.js';
import { groupTracks } from './grouping.js';
import { OnlineCovers } from './online.js';
import { readTags, statEntries, walkMusic } from './scanner.js';
import { pLimit, readJson, sleep, writeJsonAtomic } from './util.js';

const SCHEMA = 2;

export class Library extends EventEmitter {
  constructor({ config, log, fetchImpl }) {
    super();
    this.config = config;
    this.log = log;
    this.file = path.join(config.dataDir, 'library.json');
    this.overridesFile = path.join(config.dataDir, 'overrides.json');
    this.overrides = {}; // eigene Festlegungen je Album (z. B. Hüllenart), überstehen jeden Scan
    this.files = {};
    this.embedded = {};
    this.albums = [];
    this.byId = new Map();
    this.tracks = new Map();
    this.version = 0;
    this.scannedAt = null;
    this.scan_ = { running: false, phase: 'idle', done: 0, total: 0, startedAt: null, finishedAt: null, error: null, stats: null };
    this.online = new OnlineCovers({
      dataDir: config.dataDir,
      contact: config.contact,
      log,
      fetchImpl,
      enabled: config.onlineCovers,
      packaging: config.onlinePackaging,
      onResult: (id) => this.#applyOnline(id)
    });
  }

  async init() {
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    await this.online.load();
    this.overrides = await readJson(this.overridesFile, {});
    const saved = await readJson(this.file, null);
    if (saved?.schema === SCHEMA) {
      this.files = saved.files ?? {};
      this.embedded = saved.embedded ?? {};
      this.albums = saved.albums ?? [];
      this.version = saved.version ?? 0;
      this.scannedAt = saved.scannedAt ?? null;
      this.#index();
      this.log.info(`Bibliothek geladen: ${this.albums.length} Alben, ${this.tracks.size} Titel`);
    }
  }

  #index() {
    this.byId = new Map(this.albums.map((a) => [a.id, a]));
    this.tracks = new Map();
    for (const a of this.albums) for (const t of a.tracks) this.tracks.set(t.id, { album: a, track: t });
  }

  async save() {
    await writeJsonAtomic(this.file, {
      schema: SCHEMA,
      version: this.version,
      scannedAt: this.scannedAt,
      files: this.files,
      embedded: this.embedded,
      albums: this.albums
    });
  }

  get scanState() {
    return { ...this.scan_ };
  }

  /** Startet einen Scan im Hintergrund. full = alle Tags neu lesen. */
  scan({ full = false } = {}) {
    if (this.scan_.running) return false;
    this.#scan({ full }).catch((err) => {
      this.log.error('Scan fehlgeschlagen:', err);
      Object.assign(this.scan_, { running: false, phase: 'error', error: err.message, finishedAt: Date.now() });
      this.emit('change');
    });
    return true;
  }

  async #scan({ full }) {
    const { musicDir } = this.config;
    const t0 = Date.now();
    Object.assign(this.scan_, { running: true, phase: 'walk', done: 0, total: 0, startedAt: t0, error: null, stats: null });
    this.emit('change');

    if (!fs.existsSync(musicDir)) {
      throw new Error(`Musikordner ${musicDir} existiert nicht. Ist der Ordner im Container eingebunden?`);
    }
    this.log.info(`Scan startet (${full ? 'vollständig' : 'inkrementell'}): ${musicDir}`);

    // 1) Dateien finden
    const { audio, imagesByDir, artSubdirs } = await walkMusic(musicDir, this.log);
    const imageEntries = [...imagesByDir.values()].flat();
    const stated = await statEntries([...audio, ...imageEntries]);
    const statMap = new Map(stated.map((e) => [e.rel, e]));
    const audioFiles = audio.filter((a) => statMap.has(a.rel));

    // 2) Tags lesen (nur neue oder geänderte Dateien)
    this.scan_.phase = 'tags';
    this.scan_.total = audioFiles.length;
    const nextFiles = {};
    let added = 0;
    let changed = 0;
    let failed = 0;
    const limit = pLimit(this.config.scanConcurrency);
    await Promise.all(
      audioFiles.map((f) =>
        limit(async () => {
          const prev = this.files[f.rel];
          if (!full && prev && prev.mtime === f.mtime && prev.size === f.size) {
            nextFiles[f.rel] = prev;
          } else {
            let entry;
            try {
              entry = await readTags(f.abs);
            } catch (err) {
              failed++;
              this.log.debug(`Tags nicht lesbar: ${f.rel} (${err.message})`);
              entry = { tags: {}, format: {}, error: err.message };
            }
            nextFiles[f.rel] = { mtime: f.mtime, size: f.size, ...entry };
            if (prev) changed++;
            else added++;
          }
          this.scan_.done++;
        })
      )
    );
    const removed = Object.keys(this.files).filter((rel) => !nextFiles[rel]).length;

    // 3) Alben bilden
    this.scan_.phase = 'group';
    const albums = groupTracks(
      audioFiles.map((f) => ({ rel: f.rel, dir: f.dir, name: f.name, ext: f.ext, mtime: f.mtime, size: f.size, ...nextFiles[f.rel] }))
    );

    // 4) Bilder zuordnen
    this.scan_.phase = 'art';
    this.scan_.done = 0;
    this.scan_.total = albums.length;
    const ctx = { musicDir, dataDir: this.config.dataDir, embeddedCache: this.embedded, log: this.log };
    const statOf = (img) => statMap.get(img.rel);
    const artLimit = pLimit(Math.max(2, this.config.scanConcurrency));
    await Promise.all(
      albums.map((album) =>
        artLimit(async () => {
          const folder = findFolderArt(album, imagesByDir, artSubdirs, statOf);
          album.localArt = { front: folder.front, back: folder.back, disc: folder.disc };
          if (!folder.front || !folder.back || !folder.disc) {
            const emb = await findEmbeddedArt(album, ctx);
            for (const k of KINDS) album.localArt[k] ??= emb[k] ?? null;
          }
          album.gallery = folder.gallery;
          this.scan_.done++;
        })
      )
    );
    for (const album of albums) this.#mergeArt(album);

    // 5) Übernehmen
    albums.sort((a, b) => a.artist.localeCompare(b.artist, 'de') || (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title, 'de'));
    this.files = nextFiles;
    this.albums = albums;
    this.#index();
    this.version++;
    this.scannedAt = Date.now();
    this.scan_.phase = 'save';
    const validIds = new Set(albums.map((a) => a.id));
    await pruneEmbedded(this.config.dataDir, this.embedded, new Set(albums.map((a) => a.tracks[0]?.rel)));
    await this.save();
    await pruneArtCache(this.config.dataDir, validIds);
    await this.online.prune(validIds);

    const stats = { albums: albums.length, tracks: audioFiles.length, added, changed, removed, failed, ms: Date.now() - t0 };
    Object.assign(this.scan_, { running: false, phase: 'idle', finishedAt: Date.now(), stats });
    this.log.info(
      `Scan fertig in ${(stats.ms / 1000).toFixed(1)} s: ${stats.albums} Alben, ${stats.tracks} Titel ` +
        `(neu ${added}, geändert ${changed}, entfernt ${removed}${failed ? `, unlesbar ${failed}` : ''})`
    );
    this.emit('change');

    // 6) Fehlende Cover online suchen
    for (const album of albums) {
      const missing = ['front', 'back'].filter((k) => !album.localArt[k]);
      if (this.online.shouldLookup(album, missing)) this.online.enqueue(album);
    }

    // 7) Vorschaubilder im Hintergrund vorbereiten (erstes Durchblättern bleibt flüssig)
    this.#warmArt().catch((err) => this.log.debug('Vorschaubilder:', err.message));
  }

  async #warmArt() {
    if (this.warming) return;
    this.warming = true;
    const t0 = Date.now();
    let made = 0;
    try {
      for (const album of [...this.albums]) {
        if (this.scan_.running) break;
        const ref = album.art?.front;
        if (!ref) continue;
        try {
          const before = Date.now();
          await renderArt({ albumId: album.id, kind: 'front', ref, size: 'sm', musicDir: this.config.musicDir, dataDir: this.config.dataDir });
          if (Date.now() - before > 5) {
            made++;
            await sleep(15); // NAS nicht auslasten
          }
        } catch {
          /* defekte Bilder überspringen */
        }
      }
      if (made) this.log.info(`${made} Vorschaubilder vorbereitet (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } finally {
      this.warming = false;
    }
  }

  /** Lokale Bilder haben Vorrang, Online-Funde füllen Lücken. */
  #mergeArt(album) {
    const online = this.online.artFor(album.id);
    album.packaging = this.online.packagingOf(album.id);
    album.art = {};
    for (const k of KINDS) {
      const ref = album.localArt?.[k] ?? online[k] ?? null;
      if (ref) album.art[k] = ref;
    }
  }

  #applyOnline(albumId) {
    const album = this.byId.get(albumId);
    if (!album) return;
    const sig = () => KINDS.map((k) => album.art?.[k]?.v ?? '').join('|') + `|${album.packaging ?? ''}`;
    const before = sig();
    this.#mergeArt(album);
    const after = sig();
    if (before !== after) {
      this.version++;
      this.#saveSoon();
      this.emit('change');
    }
  }

  #saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save().catch((e) => this.log.warn('Speichern fehlgeschlagen:', e.message)), 3000);
  }

  /** Online-Suche für ein Album erzwingen (optional mit fester MusicBrainz-Release-ID). */
  lookupOnline(albumId, mbid) {
    const album = this.byId.get(albumId);
    if (!album) return false;
    this.online.enqueue(album, { force: true, mbid });
    return true;
  }

  /** Eigene Angaben je Album ändern (Werte null/undefined entfernen den Eintrag). */
  async #patchOverrides(ids, patch) {
    let changed = 0;
    for (const id of ids) {
      if (!this.byId.has(id)) continue;
      const o = { ...(this.overrides[id] ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) delete o[k];
        else o[k] = v;
      }
      if (Object.keys(o).length) this.overrides[id] = o;
      else delete this.overrides[id];
      changed++;
    }
    if (!changed) return 0;
    await writeJsonAtomic(this.overridesFile, this.overrides);
    this.version++;
    this.emit('change');
    return changed;
  }

  /** Hüllenart für ein Album festlegen ('auto' entfernt die Festlegung). */
  async setCaseVariant(albumId, variant) {
    return (await this.#patchOverrides([albumId], { case: !variant || variant === 'auto' ? null : variant })) > 0;
  }

  /** Favoriten setzen oder entfernen (einzeln oder viele auf einmal). Liefert die Anzahl. */
  async setFavorite(albumIds, favorite) {
    const known = albumIds.filter((id) => this.byId.has(id));
    if (!known.length) return -1;
    const ids = known.filter((id) => !!this.overrides[id]?.fav !== favorite);
    return ids.length ? this.#patchOverrides(ids, { fav: favorite ? Date.now() : null }) : 0;
  }

  // ---------- Ausgabe für die API ----------

  summary(a) {
    return {
      id: a.id,
      title: a.title,
      artist: a.artist,
      compilation: a.compilation,
      year: a.year,
      genres: a.genres,
      discs: a.discs,
      trackCount: a.trackCount,
      duration: a.duration,
      format: a.format,
      addedAt: a.addedAt,
      art: Object.fromEntries(KINDS.map((k) => [k, a.art?.[k]?.v ?? null])),
      gallery: a.gallery?.length ?? 0,
      caseVariant: this.overrides[a.id]?.case ?? null,
      favorite: this.overrides[a.id]?.fav ?? null,
      packaging: a.packaging ?? null
    };
  }

  detail(a) {
    return {
      ...this.summary(a),
      folder: a.baseDir,
      label: a.label,
      mbid: a.mbid,
      artSources: Object.fromEntries(KINDS.map((k) => [k, a.art?.[k]?.src ?? null])),
      galleryNames: (a.gallery ?? []).map((g) => g.name),
      online: this.online.info(a.id),
      tracks: a.tracks.map((t) => ({
        id: t.id,
        disc: t.disc,
        no: t.no,
        title: t.title,
        artist: t.artist && t.artist !== a.artist ? t.artist : null,
        duration: t.duration,
        codec: t.codec,
        lossless: t.lossless,
        bitrate: t.bitrate,
        sampleRate: t.sampleRate,
        bitsPerSample: t.bitsPerSample,
        mime: t.mime,
        transcode: t.transcode
      }))
    };
  }

  status() {
    const withFront = this.albums.filter((a) => a.art?.front).length;
    const withBack = this.albums.filter((a) => a.art?.back).length;
    return {
      version: this.version,
      albums: this.albums.length,
      tracks: this.tracks.size,
      scannedAt: this.scannedAt,
      scan: this.scanState,
      covers: { front: withFront, back: withBack },
      online: { enabled: this.online.enabled, pending: this.online.pending }
    };
  }
}
