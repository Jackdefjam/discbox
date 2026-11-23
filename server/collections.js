// Wiedergabelisten und Hörverlauf, gespeichert in collections.json im Datenordner.
//
// Listen merken sich je Titel einen kleinen Schnappschuss (Titel, Interpret, Album). Verschwindet ein
// Titel aus der Bibliothek (Datei verschoben oder gelöscht), bleibt er in der Liste sichtbar,
// wird aber als nicht verfügbar markiert und beim Abspielen übersprungen.
//
// Der Verlauf hält die letzten Wiedergaben als Ereignisse (für „Zuletzt gehört“) und zählt außerdem
// dauerhaft je Album und Titel mit (für die Statistik).

import crypto from 'node:crypto';
import path from 'node:path';
import { readJson, throttleAsync, writeJsonAtomic } from './util.js';

const MAX_EVENTS = 2000;
const MAX_NAME = 80;
const MAX_ITEMS = 5000;
const REPEAT_WINDOW = 60_000; // gleicher Titel innerhalb einer Minute zählt nur einmal

export class CollectionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const cleanName = (name) => {
  const n = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) throw new CollectionError(400, 'Bitte einen Namen angeben.');
  if (n.length > MAX_NAME) throw new CollectionError(400, `Der Name ist zu lang (höchstens ${MAX_NAME} Zeichen).`);
  return n;
};

const idList = (ids) => {
  if (ids == null) return [];
  if (!Array.isArray(ids)) throw new CollectionError(400, 'trackIds muss eine Liste sein.');
  return ids.map(String).slice(0, MAX_ITEMS);
};

export class Collections {
  constructor({ config, log, library }) {
    this.file = path.join(config.dataDir, 'collections.json');
    this.log = log;
    this.library = library;
    this.state = Collections.empty();
    this.save = throttleAsync(() => writeJsonAtomic(this.file, this.state), 1500);
  }

  static empty() {
    return { version: 1, playlists: [], history: [], albumPlays: {}, trackPlays: {} };
  }

  async init() {
    const s = await readJson(this.file, null);
    if (s && typeof s === 'object') {
      this.state = {
        ...Collections.empty(),
        ...s,
        playlists: Array.isArray(s.playlists) ? s.playlists : [],
        history: Array.isArray(s.history) ? s.history : [],
        albumPlays: s.albumPlays && typeof s.albumPlays === 'object' ? s.albumPlays : {},
        trackPlays: s.trackPlays && typeof s.trackPlays === 'object' ? s.trackPlays : {}
      };
    }
    this.log?.info?.(`Wiedergabelisten: ${this.state.playlists.length}, Verlauf: ${this.state.history.length} Einträge`);
  }

  // ---------- Wiedergabelisten ----------

  #find(id) {
    const p = this.state.playlists.find((x) => x.id === id);
    if (!p) throw new CollectionError(404, 'Wiedergabeliste nicht gefunden.');
    return p;
  }

  #snapshot(trackId) {
    const hit = this.library.tracks.get(trackId);
    if (!hit) return null;
    return { id: trackId, t: hit.track.title, a: hit.track.artist || hit.album.artist, al: hit.album.title };
  }

  #summary(p) {
    let duration = 0;
    let missing = 0;
    const albumSet = new Set();
    const preview = [];
    for (const it of p.items) {
      const hit = this.library.tracks.get(it.id);
      if (hit) {
        duration += hit.track.duration || 0;
        albumSet.add(hit.album.id);
      } else missing++;
      if (preview.length < 20) {
        preview.push({
          title: hit?.track.title ?? it.t ?? 'Unbekannter Titel',
          artist: (hit ? hit.track.artist || hit.album.artist : it.a) ?? '',
          album: (hit ? hit.album.title : it.al) ?? ''
        });
      }
    }
    const albums = [...albumSet];
    // albums: die ersten vier für das Cover-Mosaik, albumCount: wie viele verschiedene insgesamt
    return {
      id: p.id,
      name: p.name,
      created: p.created,
      updated: p.updated,
      count: p.items.length,
      duration,
      missing,
      albums: albums.slice(0, 4),
      albumCount: albums.length,
      preview
    };
  }

  #item(it) {
    const hit = this.library.tracks.get(it.id);
    if (!hit) return { id: it.id, title: it.t ?? 'Unbekannter Titel', artist: it.a ?? null, albumTitle: it.al ?? null, available: false };
    const { track: t, album: a } = hit;
    return {
      id: t.id,
      disc: t.disc,
      no: t.no,
      title: t.title,
      artist: t.artist || a.artist,
      duration: t.duration,
      codec: t.codec,
      lossless: t.lossless,
      bitrate: t.bitrate,
      sampleRate: t.sampleRate,
      bitsPerSample: t.bitsPerSample,
      mime: t.mime,
      transcode: t.transcode,
      albumId: a.id,
      albumTitle: a.title,
      albumArtist: a.artist,
      available: true
    };
  }

  list() {
    return this.state.playlists.map((p) => this.#summary(p)).sort((a, b) => b.updated - a.updated);
  }

  get(id) {
    const p = this.#find(id);
    return { ...this.#summary(p), tracks: p.items.map((it) => this.#item(it)) };
  }

  create(name, trackIds) {
    const now = Date.now();
    const p = { id: `p${crypto.randomBytes(6).toString('hex')}`, name: cleanName(name), created: now, updated: now, items: [] };
    const { added } = this.#addTo(p, idList(trackIds));
    this.state.playlists.push(p);
    this.save();
    return { playlist: this.get(p.id), added };
  }

  rename(id, name) {
    const p = this.#find(id);
    p.name = cleanName(name);
    p.updated = Date.now();
    this.save();
    return this.get(id);
  }

  #addTo(p, ids) {
    const have = new Set(p.items.map((it) => it.id));
    let added = 0;
    let skipped = 0;
    for (const id of ids) {
      if (have.has(id) || p.items.length >= MAX_ITEMS) {
        skipped++;
        continue;
      }
      const snap = this.#snapshot(id);
      if (!snap) {
        skipped++;
        continue;
      }
      p.items.push(snap);
      have.add(id);
      added++;
    }
    return { added, skipped };
  }

  /** Titel anhängen (bereits enthaltene und unbekannte werden übersprungen). */
  add(id, trackIds) {
    const p = this.#find(id);
    const result = this.#addTo(p, idList(trackIds));
    if (result.added) {
      p.updated = Date.now();
      this.save();
    }
    return { playlist: this.get(id), ...result };
  }

  /** Reihenfolge und Inhalt neu setzen (zum Sortieren und Entfernen). */
  setTracks(id, trackIds) {
    const p = this.#find(id);
    const old = new Map(p.items.map((it) => [it.id, it]));
    const seen = new Set();
    const items = [];
    for (const tid of idList(trackIds)) {
      if (seen.has(tid)) continue;
      const it = old.get(tid) ?? this.#snapshot(tid);
      if (!it) continue;
      // Schnappschuss auffrischen, solange der Titel noch da ist
      items.push(this.#snapshot(tid) ?? it);
      seen.add(tid);
    }
    p.items = items;
    p.updated = Date.now();
    this.save();
    return this.get(id);
  }

  remove(id) {
    const before = this.state.playlists.length;
    this.state.playlists = this.state.playlists.filter((p) => p.id !== id);
    if (this.state.playlists.length === before) throw new CollectionError(404, 'Wiedergabeliste nicht gefunden.');
    this.save();
  }

  // ---------- Hörverlauf ----------

  /** Eine Wiedergabe merken. Liefert die neuen Zähler des Albums oder null bei unbekanntem Titel. */
  record(trackId, at = Date.now()) {
    const hit = this.library.tracks.get(String(trackId));
    if (!hit) return null;
    const albumId = hit.album.id;
    const h = this.state.history;
    const last = h[h.length - 1];
    if (last && last.t === hit.track.id && at - last.at < REPEAT_WINDOW) return { albumId, ...this.state.albumPlays[albumId] };
    h.push({ t: hit.track.id, a: albumId, at });
    if (h.length > MAX_EVENTS) h.splice(0, h.length - MAX_EVENTS);
    const bump = (map, key) => {
      const s = map[key] ?? { n: 0, last: 0 };
      s.n += 1;
      s.last = Math.max(s.last, at);
      map[key] = s;
      return s;
    };
    const album = bump(this.state.albumPlays, albumId);
    bump(this.state.trackPlays, hit.track.id);
    this.save();
    return { albumId, ...album };
  }

  history({ limit = 100 } = {}) {
    const n = Math.max(0, Math.min(Math.floor(limit) || 0, MAX_EVENTS));
    const recent = (n ? this.state.history.slice(-n) : [])
      .reverse()
      .map((e) => {
        const hit = this.library.tracks.get(e.t);
        return {
          trackId: e.t,
          albumId: e.a,
          at: e.at,
          title: hit?.track.title ?? null,
          artist: hit ? hit.track.artist || hit.album.artist : null,
          albumTitle: hit?.album.title ?? null
        };
      });
    return { albums: this.state.albumPlays, tracks: this.state.trackPlays, events: this.state.history.length, recent };
  }

  clearHistory() {
    this.state.history = [];
    this.state.albumPlays = {};
    this.state.trackPlays = {};
    this.save();
  }
}
