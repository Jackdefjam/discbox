// Zentraler Zustand: Albumliste, Filter, Sortierung, Auswahl, Einstellungen.

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
    // Ansicht: 'all' oder 'favorites' (Start laut Einstellung)
    this.collection = this.settings.startView === 'all' ? 'all' : 'favorites';
    this.details = new Map();
    this.status = null;
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
    this.collection = collection;
    this.#rebuild(this.current?.id);
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

  #rebuild(keepId) {
    const terms = this.query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
    let list = this.all;
    if (this.collection === 'favorites') list = list.filter((a) => a.favorite);
    if (this.settings.completeOnly) list = list.filter(isComplete);
    if (terms.length) list = list.filter((a) => terms.every((t) => a._search.includes(t)));
    if (this.genre) list = list.filter((a) => a.genres?.includes(this.genre));
    const sort = SORTS[this.settings.sort] ?? SORTS.artist;
    const group = this.shelfGrouping;
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
    if (this.groups) return this.groups.map((g) => ({ letter: g.title, index: g.start }));
    const sort = SORTS[this.settings.sort];
    if (!sort?.letter) return [];
    const map = new Map();
    this.view.forEach((a, i) => {
      const l = letterOf(sort.letter(a));
      if (!map.has(l)) map.set(l, i);
    });
    return [...map.entries()].map(([letter, index]) => ({ letter, index }));
  }

  letterAt(i) {
    if (this.groups) return this.groups[this.groupIndexOf(i)]?.title ?? null;
    const sort = SORTS[this.settings.sort];
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
      // Album ist ausgefiltert: Filter zurücksetzen
      this.query = '';
      this.genre = '';
      this.collection = 'all';
      const album = this.all.find((a) => a.id === id);
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
    const promise = api.album(id).then(
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
