// Fehlende Front-, Back- und Disc-Bilder bei MusicBrainz / Cover Art Archive suchen.
// MusicBrainz erlaubt höchstens eine Anfrage pro Sekunde und verlangt einen aussagekräftigen User-Agent.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { VARIOUS } from './grouping.js';
import { readJson, sha1, sleep, throttleAsync, writeJsonAtomic } from './util.js';

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const DAY = 24 * 60 * 60 * 1000;
const RETRY_AFTER = { error: DAY, notfound: 30 * DAY, partial: 30 * DAY };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const extractMbid = (value) => String(value ?? '').match(UUID)?.[0]?.toLowerCase() ?? null;

const luceneEscape = (s) => String(s).replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

/** Bewertet Suchtreffer: bevorzugt CDs, passende Titelanzahl, offizielle Veröffentlichungen. */
export function rankReleases(releases, album) {
  return releases
    .filter((r) => (r.score ?? 0) >= 70)
    .map((r) => {
      let s = r.score ?? 0;
      const formats = (r.media ?? []).map((m) => m.format ?? '').join(' ');
      if (/\bcd\b/i.test(formats)) s += 15;
      const tc = r['track-count'] ?? (r.media ?? []).reduce((n, m) => n + (m['track-count'] ?? 0), 0);
      if (tc && album.trackCount) {
        if (tc === album.trackCount) s += 10;
        else if (Math.abs(tc - album.trackCount) <= 1) s += 4;
        else s -= 5;
      }
      if (r.status === 'Official') s += 5;
      if (album.year && String(r.date ?? '').startsWith(String(album.year))) s += 3;
      return { id: r.id, rgid: r['release-group']?.id ?? null, s, title: r.title };
    })
    .sort((a, b) => b.s - a.s);
}

export class OnlineCovers {
  constructor({ dataDir, contact, log, fetchImpl = globalThis.fetch, enabled = true, mbDelay = 1100, onResult }) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'online.json');
    this.log = log;
    this.fetch = fetchImpl;
    this.enabled = enabled;
    this.mbDelay = mbDelay;
    this.onResult = onResult ?? (() => {});
    this.userAgent = `discbox/1.0 ( ${contact} )`;
    this.state = {};
    this.queue = [];
    this.queued = new Set();
    this.current = null;
    this.lastMb = 0;
    this.save = throttleAsync(() => writeJsonAtomic(this.file, this.state), 2000);
  }

  async load() {
    this.state = await readJson(this.file, {});
  }

  /** ArtRefs, die online gefunden wurden. */
  artFor(albumId) {
    return this.state[albumId]?.art ?? {};
  }

  info(albumId) {
    const s = this.state[albumId];
    if (!s) return null;
    return { status: s.status, mbid: s.mbid ?? null, checkedAt: s.checkedAt ?? null, error: s.error ?? null, manualMbid: s.manualMbid ?? null };
  }

  /** Entscheidet, ob für ein Album (erneut) gesucht werden soll. */
  shouldLookup(album, missingKinds) {
    if (!this.enabled || !missingKinds.length) return false;
    const s = this.state[album.id];
    if (!s) return true;
    if (s.status === 'found') return false;
    const wait = RETRY_AFTER[s.status] ?? DAY;
    return Date.now() - (s.checkedAt ?? 0) > wait;
  }

  enqueue(album, { force = false, mbid = null, front = true } = {}) {
    if (!this.enabled && !force) return;
    if (mbid) {
      this.state[album.id] = { ...(this.state[album.id] ?? {}), manualMbid: mbid };
    }
    if (force && this.queued.has(album.id)) {
      // nach vorne holen
      this.queue = this.queue.filter((q) => q.album.id !== album.id);
      this.queued.delete(album.id);
    }
    if (this.queued.has(album.id) || this.current === album.id) return;
    this.queued.add(album.id);
    const item = { album, force };
    if (force && front) this.queue.unshift(item);
    else this.queue.push(item);
    this.#run();
  }

  get pending() {
    return this.queue.length + (this.current ? 1 : 0);
  }

  async #run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const { album, force } = this.queue.shift();
        this.queued.delete(album.id);
        this.current = album.id;
        try {
          await this.lookup(album, { force });
        } catch (err) {
          this.log?.warn(`Online-Suche fehlgeschlagen für „${album.artist} – ${album.title}“: ${err.message}`);
          this.state[album.id] = { ...(this.state[album.id] ?? {}), status: 'error', error: err.message, checkedAt: Date.now() };
          this.save();
        }
        this.current = null;
        this.onResult(album.id);
      }
    } finally {
      this.running = false;
    }
  }

  async #get(url, { mb = false, json = true } = {}) {
    if (mb) {
      const wait = this.lastMb + this.mbDelay - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastMb = Date.now();
    }
    const res = await this.fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: json ? 'application/json' : '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    if (res.status === 404) return null;
    if (res.status === 503 && mb) {
      // Rate-Limit: kurz warten und einmal wiederholen
      await sleep(3000);
      return this.#get(url, { mb, json });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${new URL(url).host}`);
    return json ? res.json() : Buffer.from(await res.arrayBuffer());
  }

  async #search(album) {
    const parts = [`release:"${luceneEscape(album.title)}"`];
    if (album.artist && album.artist !== VARIOUS) parts.push(`artist:"${luceneEscape(album.artist)}"`);
    const q = encodeURIComponent(parts.join(' AND '));
    const data = await this.#get(`${MB}/release/?query=${q}&fmt=json&limit=15`, { mb: true });
    return rankReleases(data?.releases ?? [], album);
  }

  async #download(albumId, kind, image) {
    const url = image.thumbnails?.['1200'] ?? image.thumbnails?.large ?? image.image;
    const buf = await this.#get(url.replace(/^http:/, 'https:'), { json: false });
    if (!buf?.length) return null;
    const rel = `art/online/${albumId}-${kind}.jpg`;
    await fsp.mkdir(path.join(this.dataDir, 'art/online'), { recursive: true });
    await fsp.writeFile(path.join(this.dataDir, rel), buf);
    return { src: 'online', root: 'data', rel, v: sha1(`${image.id ?? url}:${buf.length}`, 10) };
  }

  /** Sucht Bilder für ein Album und speichert das Ergebnis. */
  async lookup(album, { force = false } = {}) {
    const prev = this.state[album.id] ?? {};
    const manual = prev.manualMbid ?? null;
    let candidates = [];
    if (manual) candidates.push({ id: manual, rgid: null, s: 999 });
    else if (album.mbid) candidates.push({ id: album.mbid, rgid: album.mbReleaseGroupId, s: 999 });
    if (!manual) {
      const found = await this.#search(album);
      candidates.push(...found.filter((c) => c.id !== album.mbid));
    }
    candidates = candidates.slice(0, 6);

    // Nur laden, was lokal fehlt (eigene Bilder haben immer Vorrang)
    const local = album.localArt ?? {};
    const need = ['front', 'back', 'disc'].filter((k) => !local[k]);
    const art = force ? {} : { ...(prev.art ?? {}) };
    for (const k of Object.keys(art)) if (!need.includes(k)) delete art[k];
    let mbid = null;
    let rgid = null;
    for (const cand of candidates) {
      if (need.every((k) => art[k])) break;
      const data = await this.#get(`${CAA}/release/${cand.id}`);
      await sleep(250);
      if (!data?.images?.length) continue;
      const pick = (test) => data.images.find(test);
      const imgs = {
        front: pick((i) => i.front) ?? pick((i) => i.types?.includes('Front')),
        back: pick((i) => i.back) ?? pick((i) => i.types?.includes('Back')),
        disc: pick((i) => i.types?.includes('Medium'))
      };
      for (const kind of need) {
        if (art[kind] || !imgs[kind]) continue;
        art[kind] = await this.#download(album.id, kind, imgs[kind]);
        if (art[kind]) {
          mbid ??= cand.id;
          art[kind].mbid = cand.id;
        }
      }
      rgid ??= cand.rgid;
    }
    // Letzter Versuch fürs Frontcover: Release-Group
    if (need.includes('front') && !art.front) {
      const rg = rgid ?? candidates.find((c) => c.rgid)?.rgid ?? album.mbReleaseGroupId;
      if (rg) {
        const data = await this.#get(`${CAA}/release-group/${rg}`);
        const img = data?.images?.find((i) => i.front) ?? data?.images?.[0];
        if (img) art.front = await this.#download(album.id, 'front', img);
      }
    }
    for (const k of Object.keys(art)) if (!art[k]) delete art[k];

    const required = need.filter((k) => k !== 'disc');
    const status = required.every((k) => art[k]) && Object.keys(art).length ? 'found' : Object.keys(art).length ? 'partial' : 'notfound';
    this.state[album.id] = {
      status,
      mbid: mbid ?? candidates[0]?.id ?? null,
      manualMbid: manual,
      checkedAt: Date.now(),
      art,
      error: null
    };
    this.save();
    this.log?.info(
      `Online-Cover „${album.artist} – ${album.title}“: ${status}` +
        (Object.keys(art).length ? ` (${Object.keys(art).join(', ')})` : '')
    );
    return this.state[album.id];
  }

  /** Online-Daten von Alben entfernen, die nicht mehr existieren. */
  async prune(validIds) {
    let changed = false;
    for (const id of Object.keys(this.state)) {
      if (validIds.has(id)) continue;
      for (const ref of Object.values(this.state[id].art ?? {})) {
        await fsp.rm(path.join(this.dataDir, ref.rel), { force: true }).catch(() => {});
      }
      delete this.state[id];
      changed = true;
    }
    if (changed) this.save();
  }
}
