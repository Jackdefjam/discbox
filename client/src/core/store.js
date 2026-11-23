// Zentraler Zustand: Albumliste, Ansichten (Alle, Favoriten, Zuletzt gehört, Wiedergabelisten),
// Filter, Sortierung, Auswahl, Einstellungen.

import { api } from './api.js';
import { Emitter } from './emitter.js';

const SETTINGS_KEY = 'discbox.settings.v1';

export const DEFAULT_SETTINGS = {
  layout: 'coverflow',
  theme: 'studio',
  sort: 'artist',
  quality: 'auto',
  reflections: true,
  particles: true,
  reduceMotion: false,
  idleMinutes: 0,
  spineDirection: 'down',
  tray: 'black',
  startView: 'favorites',
  shelfGroup: 'genre',
  deck: true,
  deckDisc: 'cd',
  history: true,
  completeOnly: false,
  volume: 0.85,
  lastAlbumId: null
};

const ARTICLES = /^(the|die|der|das|a|an|les|le|la|el|los|il)\s+/i;
export const sortName = (s) =>
  String(s ?? '')
    .replace(ARTICLES, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .toLocaleLowerCase('de');

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export const SORTS = {
  artist: {
    label: 'Künstler',
    cmp: (a, b) => collator.compare(a._sa, b._sa) || (a.year ?? 0) - (b.year ?? 0) || collator.compare(a._st, b._st),
    letter: (a) => a._sa
  },
  title: {
    label: 'Albumtitel',
    cmp: (a, b) => collator.compare(a._st, b._st) || collator.compare(a._sa, b._sa),
    letter: (a) => a._st
  },
  'year-desc': {
    label: 'Jahr (neueste zuerst)',
    cmp: (a, b) => (b.year ?? 0) - (a.year ?? 0) || collator.compare(a._sa, b._sa),
    letter: null
  },
  'year-asc': {
    label: 'Jahr (älteste zuerst)',
    cmp: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || collator.compare(a._sa, b._sa),
    letter: null
  },
  added: {
    label: 'Zuletzt hinzugefügt',
    cmp: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0),
    letter: null
  }
};

/** Einteilungen der Regalwand: Schlüssel (für die Reihenfolge) und Beschriftung je Album. */
export const SHELF_GROUPS = {
  genre: {
    label: 'Genre',
    key: (a) => (a.genres?.[0] ? `a${a.genres[0].toLocaleLowerCase('de')}` : 'z'),
    title: (a) => a.genres?.[0] ?? 'Ohne Genre'
  },
  decade: {
    label: 'Jahrzehnt',
    key: (a) => (a.year ? `a${Math.floor(a.year / 10) * 10}` : 'z'),
    title: (a) => (a.year ? `${Math.floor(a.year / 10) * 10}er` : 'Ohne Jahr')
  },
  letter: {
    label: 'Künstler A–Z',
    key: (a) => (letterOf(a._sa) === '#' ? 'z' : `a${letterOf(a._sa)}`),
    title: (a) => letterOf(a._sa)
  },
  none: { label: 'Ohne Einteilung', key: () => 'a', title: () => 'Alle Alben' }
};

export const isComplete = (a) => !!(a.art?.front && a.art?.back);

/** Ansichten der oberen Umschaltleiste (Reihenfolge für Taste V und 1–4). */
export const VIEWS = {
  all: { label: 'Alle Alben', short: 'Alle' },
  favorites: { label: 'Favoriten', short: 'Favoriten' },
  recent: { label: 'Zuletzt gehört', short: 'Zuletzt' },
  playlists: { label: 'Wiedergabelisten', short: 'Listen' }
};
export const VIEW_ORDER = ['all', 'favorites', 'recent', 'playlists'];

const DAY = 86_400_000;
export const RECENT_TITLES = ['Heute', 'Gestern', 'Letzte 7 Tage', 'Letzte 30 Tage', 'Früher'];

/** Zeitabschnitt für „Zuletzt gehört“: 0 = heute … 4 = früher (nach Kalendertagen in Ortszeit). */
export function recentBucket(t, now = Date.now()) {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayStart = (back) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
  if (t >= today) return 0;
  if (t >= dayStart(1)) return 1;
  if (t >= dayStart(6)) return 2;
  if (t >= dayStart(29)) return 3;
  return 4;
}

/** „vor 5 Min.“, „gestern, 18:40“, „Montag, 9:12“, „am 3. November“ … */
export function relativeTime(t, now = Date.now()) {
  if (!t) return '';
  const d = now - t;
  if (d < 60_000) return 'gerade eben';
  if (d < 3_600_000) return `vor ${Math.round(d / 60_000)} Min.`;
  const date = new Date(t);
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const b = recentBucket(t, now);
  if (b === 0) return d < 6 * 3_600_000 ? `vor ${Math.round(d / 3_600_000)} Std.` : `heute, ${time}`;
  if (b === 1) return `gestern, ${time}`;
  if (b === 2) return `${date.toLocaleDateString('de-DE', { weekday: 'long' })}, ${time}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `am ${date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

/** Abschnitte der Ansicht „Zuletzt gehört“ (auch im Coverflow für die Sprungleiste). */
function recentGrouping(now) {
  return {
    key: (a) => `a${recentBucket(a.lastPlayed, now)}`,
    title: (a) => RECENT_TITLES[recentBucket(a.lastPlayed, now)]
  };
}
const RECENT_SORT = { cmp: (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0), letter: null };
const PLAYLIST_SORT = { cmp: (a, b) => collator.compare(a._st, b._st) || (a.created ?? 0) - (b.created ?? 0), letter: (a) => a._st };
const PLAYLIST_GROUP = { key: () => 'a', title: () => 'Wiedergabelisten' };

/** Wiedergabeliste als „Album“ für Karussell und Regal (eine selbst gebrannte CD). */
export function playlistAlbum(p) {
  const a = {
    id: `pl:${p.id}`,
    kind: 'playlist',
    playlistId: p.id,
    title: p.name,
    artist: 'Wiedergabeliste',
    trackCount: p.count,
    duration: p.duration,
    albums: p.albums ?? [],
    albumCount: p.albumCount ?? (p.albums ?? []).length,
    preview: p.preview ?? [],
    missing: p.missing ?? 0,
    created: p.created,
    updated: p.updated,
    discs: 1,
    year: null,
    genres: [],
    art: {}
  };
  a._sa = sortName(a.title);
  a._st = a._sa;
  // Suche findet Listen auch über enthaltene Titel, Interpreten und Alben
  a._search = `${p.name} ${a.preview.map((t) => `${t.title} ${t.artist} ${t.album ?? ''}`).join(' ')}`.toLocaleLowerCase('de');
  return a;
}

/** Vollständige Liste (mit Titeln) im Format der Album-Details; Nummern = Position in der Liste. */
export function playlistDetail(p) {
  return {
    ...playlistAlbum(p),
    tracks: (p.tracks ?? []).map((t, i) => ({ ...t, no: i + 1, disc: 1 }))
  };
}

export const letterOf = (s) => {
  const c = String(s ?? '').charAt(0).toLocaleUpperCase('de');
  if (!c) return '#';
  const plain = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /[A-Z]/.test(plain) ? plain : '#';
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class Store extends Emitter {
  constructor() {
    super();
    this.all = [];
    this.view = [];
    this.index = 0;
    this.mode = 'browse';
    this.query = '';
    this.genre = '';
    this.version = -1;
    this.settings = loadSettings();
    // Ansicht: 'all', 'favorites', 'recent' oder 'playlists' (Start laut Einstellung)
    this.collection = VIEW_ORDER.includes(this.settings.startView) ? this.settings.startView : 'favorites';
    this.details = new Map();
    this.status = null;
    this.byId = new Map();
    this.playlists = []; // Wiedergabelisten als Pseudo-Alben (id „pl:…“)
    this.playlistsLoaded = false;
    this.plays = new Map(); // Album-ID → { n, last }
    this.historyEvents = 0;
  }

  get current() {
    return this.view[this.index] ?? null;
  }

  setAlbums(albums, version) {
    const keepId = this.current?.id ?? this.settings.lastAlbumId;
    for (const a of albums) {
      a._sa = sortName(a.artist);
      a._st = sortName(a.title);
      a._search = `${a.artist} ${a.title} ${a.year ?? ''} ${(a.genres ?? []).join(' ')}`.toLocaleLowerCase('de');
    }
    this.all = albums;
    this.byId = new Map(albums.map((a) => [a.id, a]));
    this.#applyPlays();
    this.version = version;
    // Geänderte Alben: zwischengespeicherte Details verwerfen
    for (const a of albums) {
      const d = this.details.get(a.id);
      if (d && (d.trackCount !== a.trackCount || JSON.stringify(d.art) !== JSON.stringify(a.art))) this.details.delete(a.id);
    }
    this.#rebuild(keepId);
  }

  get genres() {
    const counts = new Map();
    for (const a of this.all) for (const g of a.genres ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => collator.compare(a[0], b[0])).map(([g, n]) => ({ genre: g, count: n }));
  }

  setQuery(q) {
    this.query = q;
    this.#rebuild(this.current?.id);
  }

  setGenre(g) {
    this.genre = g;
    this.#rebuild(this.current?.id);
  }

  setSort(sort) {
    this.updateSettings({ sort });
    this.#rebuild(this.current?.id);
  }

  setCollection(collection) {
    if (this.collection === collection) return;
    // Auswahl mitnehmen, wenn sie auch in der neuen Ansicht vorkommt – sonst vorne anfangen
    const keep = this.current?.id;
    this.collection = collection;
    this.index = 0;
    this.#rebuild(keep);
    this.emit('filters');
  }

  setCompleteOnly(on) {
    this.updateSettings({ completeOnly: on });
    this.#rebuild(this.current?.id);
    this.emit('filters');
  }

  get favoriteCount() {
    return this.all.filter((a) => a.favorite).length;
  }

  /** Album oder Wiedergabeliste nach ID. */
  albumById(id) {
    if (typeof id === 'string' && id.startsWith('pl:')) return this.playlists.find((p) => p.id === id) ?? null;
    return this.byId.get(id) ?? null;
  }

  // ---------- Hörverlauf ----------

  #applyPlays() {
    for (const a of this.all) {
      const s = this.plays.get(a.id);
      a.plays = s?.n ?? 0;
      a.lastPlayed = s?.last ?? 0;
    }
  }

  get playedCount() {
    return this.plays.size;
  }

  /** Zähler vom Server übernehmen ({ albums: { id: { n, last } }, events }). */
  setHistory(h) {
    this.plays = new Map(Object.entries(h?.albums ?? {}));
    this.historyEvents = h?.events ?? 0;
    this.#applyPlays();
    if (this.collection === 'recent') this.#rebuild(this.current?.id);
    this.emit('filters');
  }

  /** Eine neue Wiedergabe ({ albumId, n, last }); sortiert „Zuletzt gehört“ nur neu, wenn sich die Reihenfolge ändert. */
  notePlay(stat) {
    if (!stat?.albumId) return;
    this.plays.set(stat.albumId, { n: stat.n, last: stat.last });
    this.historyEvents++;
    const a = this.byId.get(stat.albumId);
    if (a) {
      a.plays = stat.n;
      a.lastPlayed = stat.last;
    }
    const first = this.view[0];
    if (this.collection === 'recent' && (first?.id !== stat.albumId || first._g !== 'a0')) this.#rebuild(this.current?.id);
    this.emit('plays', stat.albumId);
    this.emit('filters');
  }

  // ---------- Wiedergabelisten ----------

  /** Übersicht vom Server (Liste von Zusammenfassungen). */
  setPlaylists(list) {
    this.playlistsLoaded = true;
    this.playlists = list.map(playlistAlbum);
    for (const p of this.playlists) {
      const d = this.details.get(p.id);
      if (d && !(d instanceof Promise) && d.updated !== p.updated) this.details.delete(p.id);
    }
    if (this.collection === 'playlists') this.#rebuild(this.current?.id);
    this.emit('playlists');
    this.emit('filters');
  }

  /** Eine geänderte oder neue Liste (vollständig mit Titeln, wie vom Server geliefert). */
  upsertPlaylist(full) {
    const detail = playlistDetail(full);
    const summary = playlistAlbum(full);
    const i = this.playlists.findIndex((p) => p.id === summary.id);
    if (i >= 0) this.playlists[i] = summary;
    else this.playlists.push(summary);
    this.details.set(summary.id, detail);
    if (this.collection === 'playlists') this.#rebuild(this.current?.id);
    this.emit('playlists');
    this.emit('detail', detail);
    this.emit('filters');
    return summary;
  }

  removePlaylist(id) {
    const plId = id.startsWith('pl:') ? id : `pl:${id}`;
    this.playlists = this.playlists.filter((p) => p.id !== plId);
    this.details.delete(plId);
    if (this.collection === 'playlists') this.#rebuild(this.current?.id);
    this.emit('playlists');
    this.emit('filters');
  }

  /** Alben mit Front- und Rückseite (eigene, eingebettete oder online gefundene Bilder). */
  get completeAlbums() {
    return this.all.filter(isComplete);
  }

  /** Favoriten lokal setzen (Server wird vom Aufrufer informiert). */
  markFavorite(ids, favorite) {
    const set = new Set(ids);
    for (const a of this.all) if (set.has(a.id)) a.favorite = favorite ? Date.now() : null;
    const keep = this.current?.id;
    const keepIndex = this.index;
    this.#rebuild(keep);
    // Aus den Favoriten entfernt: an derselben Stelle weitermachen statt zum Anfang zu springen
    if (this.current?.id !== keep && this.view.length) this.select(Math.min(keepIndex, this.view.length - 1), { force: true });
    this.emit('filters');
  }

  /** Sortierung der aktuellen Ansicht (Listen alphabetisch, „Zuletzt gehört“ nach Zeit). */
  get activeSort() {
    if (this.collection === 'playlists') return PLAYLIST_SORT;
    if (this.collection === 'recent') return RECENT_SORT;
    return SORTS[this.settings.sort] ?? SORTS.artist;
  }

  #rebuild(keepId) {
    const terms = this.query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
    const c = this.collection;
    let list = this.all;
    let group = this.shelfGrouping;
    if (c === 'playlists') {
      list = this.playlists;
      group = this.settings.layout === 'shelf' ? PLAYLIST_GROUP : null;
    } else {
      if (c === 'favorites') list = list.filter((a) => a.favorite);
      if (c === 'recent') {
        list = list.filter((a) => a.lastPlayed);
        group = recentGrouping(Date.now());
      }
      if (this.settings.completeOnly) list = list.filter(isComplete);
      if (this.genre) list = list.filter((a) => a.genres?.includes(this.genre));
    }
    if (terms.length) list = list.filter((a) => terms.every((t) => a._search.includes(t)));
    const sort = this.activeSort;
    if (group) {
      // Regalwand: erst nach Abschnitt (Genre, Jahrzehnt …), darin nach der gewählten Sortierung
      for (const a of list) a._g = group.key(a);
      this.view = [...list].sort((a, b) => collator.compare(a._g, b._g) || sort.cmp(a, b));
      this.groups = [];
      this.view.forEach((a, i) => {
        const last = this.groups[this.groups.length - 1];
        if (last && last.key === a._g) last.end = i;
        else this.groups.push({ key: a._g, title: group.title(a), start: i, end: i });
      });
    } else {
      this.view = [...list].sort(sort.cmp);
      this.groups = null;
    }
    const idx = keepId ? this.view.findIndex((a) => a.id === keepId) : -1;
    this.index = idx >= 0 ? idx : Math.min(this.index, Math.max(0, this.view.length - 1));
    if (!this.view.length) this.index = 0;
    this.emit('view');
    this.emit('index', this.index, { jump: true });
  }

  /** Zeigt die Sprungleiste Abschnitte (lange Beschriftungen) statt Buchstaben? */
  get railShowsGroups() {
    if (!this.groups) return false;
    if (this.collection === 'recent') return true;
    if (this.collection === 'playlists') return this.groups.length > 1;
    return this.settings.shelfGroup !== 'letter';
  }

  /** Aktive Einteilung der Regalwand (nur in der Anordnung „Regal“). */
  get shelfGrouping() {
    if (this.settings.layout !== 'shelf') return null;
    return SHELF_GROUPS[this.settings.shelfGroup] ?? SHELF_GROUPS.genre;
  }

  groupIndexOf(i) {
    if (!this.groups) return -1;
    let lo = 0;
    let hi = this.groups.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.groups[mid].start <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Buchstaben-Leiste: erster Index je Buchstabe (bei der Regalwand: je Abschnitt). */
  letters() {
    if (this.groups && !(this.collection === 'playlists' && this.groups.length < 2)) {
      return this.groups.map((g) => ({ letter: g.title, index: g.start }));
    }
    const sort = this.activeSort;
    if (!sort?.letter) return [];
    const map = new Map();
    this.view.forEach((a, i) => {
      const l = letterOf(sort.letter(a));
      if (!map.has(l)) map.set(l, i);
    });
    return [...map.entries()].map(([letter, index]) => ({ letter, index }));
  }

  letterAt(i) {
    if (this.groups && !(this.collection === 'playlists' && this.groups.length < 2)) {
      return this.groups[this.groupIndexOf(i)]?.title ?? null;
    }
    const sort = this.activeSort;
    return sort?.letter && this.view[i] ? letterOf(sort.letter(this.view[i])) : null;
  }

  select(i, opts = {}) {
    if (!this.view.length) return;
    const n = this.view.length;
    const next = opts.wrap ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    if (next === this.index && !opts.force) return;
    this.index = next;
    this.settings.lastAlbumId = this.current?.id ?? null;
    this.#persistSoon();
    this.emit('index', this.index, opts);
  }

  step(delta, opts) {
    this.select(this.index + delta, opts);
  }

  selectId(id, opts) {
    let i = this.view.findIndex((a) => a.id === id);
    if (i < 0) {
      // Album ist ausgefiltert: Filter zurücksetzen (Wiedergabelisten stehen in ihrer eigenen Ansicht)
      this.query = '';
      this.genre = '';
      this.collection = String(id).startsWith('pl:') ? 'playlists' : 'all';
      const album = this.byId.get(id);
      if (album && !isComplete(album)) this.settings.completeOnly = false;
      this.#rebuild(id);
      this.emit('filters');
      i = this.view.findIndex((a) => a.id === id);
    }
    if (i >= 0) this.select(i, { ...opts, force: true });
  }

  jumpLetter(direction) {
    const letters = this.letters();
    if (!letters.length) return this.step(direction * 10);
    const cur = this.letterAt(this.index);
    const pos = letters.findIndex((l) => l.letter === cur);
    const target = letters[Math.max(0, Math.min(letters.length - 1, pos + direction))];
    if (target) this.select(target.index, { jump: true });
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit('mode', mode);
  }

  updateSettings(patch) {
    const regroup = ('layout' in patch && patch.layout !== this.settings.layout) || ('shelfGroup' in patch && patch.shelfGroup !== this.settings.shelfGroup);
    Object.assign(this.settings, patch);
    this.#persistSoon();
    this.emit('settings', patch);
    if (regroup && this.all.length) this.#rebuild(this.current?.id);
  }

  #persistSoon() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      } catch {
        /* privater Modus o. ä. */
      }
    }, 400);
  }

  async detail(id) {
    if (this.details.has(id)) return this.details.get(id);
    const load = String(id).startsWith('pl:') ? api.playlist(id.slice(3)).then(playlistDetail) : api.album(id);
    const promise = load.then(
      (d) => {
        this.details.set(id, d);
        this.emit('detail', d);
        return d;
      },
      (err) => {
        this.details.delete(id);
        throw err;
      }
    );
    this.details.set(id, promise);
    return promise;
  }

  /** Details nur, wenn schon geladen (kein Promise). */
  cachedDetail(id) {
    const d = this.details.get(id);
    return d && !(d instanceof Promise) ? d : null;
  }
}
