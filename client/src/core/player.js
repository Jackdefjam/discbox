// Audio-Wiedergabe mit Warteschlange, Zufall, Wiederholen, Vorladen des nächsten Titels,
// Spulen auch bei umgewandelten Streams und Medientasten (MediaSession).
//
// Jeder Eintrag der Warteschlange ist { track, album, disc }: album ist das Album des Titels (Cover,
// Medientasten), disc das, was „im Player liegt“ – das Album selbst oder eine Wiedergabeliste.
// Nach 30 Sekunden echten Zuhörens (bei kurzen Titeln der Hälfte) meldet der Player „played“.

import { artUrl, streamUrl } from './api.js';
import { Emitter } from './emitter.js';

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class Player extends Emitter {
  constructor({ transcoding = null, volume = 0.85 } = {}) {
    super();
    this.transcoding = transcoding;
    this.a = this.#createAudio();
    this.b = this.#createAudio();
    this.queue = [];
    this.original = null;
    this.index = -1;
    this.playing = false;
    this.buffering = false;
    this.shuffle = false;
    this.repeat = 'off';
    this.offset = 0;
    this.transcoded = false;
    this.preloadFor = null;
    this.volume = volume;
    this.muted = false;
    this.#applyVolume();
    this.#mediaSession();
  }

  #createAudio() {
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('playing', () => {
      if (el !== this.a) return;
      this.playing = true;
      this.buffering = false;
      this.emit('state');
    });
    el.addEventListener('pause', () => {
      if (el !== this.a) return;
      this.playing = false;
      this.emit('state');
    });
    el.addEventListener('waiting', () => {
      if (el !== this.a) return;
      this.buffering = true;
      this.emit('state');
    });
    el.addEventListener('canplay', () => {
      if (el !== this.a || !this.buffering) return;
      this.buffering = false;
      this.emit('state');
    });
    el.addEventListener('timeupdate', () => {
      if (el !== this.a) return;
      this.#maybePreload();
      this.#positionState();
      this.#listen();
    });
    el.addEventListener('ended', () => {
      if (el === this.a) this.next(true);
    });
    el.addEventListener('error', () => {
      if (el === this.a && el.getAttribute('src')) this.#onError();
    });
    return el;
  }

  get current() {
    return this.queue[this.index] ?? null;
  }

  get time() {
    return this.offset + (this.a.currentTime || 0);
  }

  get duration() {
    const t = this.current?.track;
    if (t?.duration) return t.duration;
    return Number.isFinite(this.a.duration) ? this.a.duration : 0;
  }

  #needsTranscode(item) {
    const t = item.track;
    if (t.transcode || item.forceTranscode) return true;
    return this.a.canPlayType(t.mime) === '';
  }

  #source(item, start = 0) {
    const transcoded = this.#needsTranscode(item);
    return { url: streamUrl(item.track, { transcode: transcoded, start: transcoded ? start : 0 }), transcoded };
  }

  /** Was gerade im Player liegt: Album-Details oder Wiedergabeliste (mit Titelliste). */
  get disc() {
    return this.current?.disc ?? this.current?.album ?? null;
  }

  /** Spielt ein Album (Details mit Titelliste) ab einem Titel. */
  playAlbum(album, startIndex = 0, { shuffle = false } = {}) {
    if (!album?.tracks?.length) return;
    this.playItems(
      album.tracks.map((track) => ({ track, album })),
      startIndex,
      { shuffle, disc: album }
    );
  }

  /** Spielt beliebige Titel ({ track, album }) ab startIndex; disc = Album oder Wiedergabeliste. */
  playItems(list, startIndex = 0, { shuffle = false, disc = null } = {}) {
    if (!list?.length) return;
    const items = list.map((it) => ({ ...it, disc: disc ?? it.album }));
    startIndex = Math.max(0, Math.min(items.length - 1, startIndex));
    this.original = items;
    this.shuffle = shuffle;
    if (shuffle) {
      const first = startIndex > 0 ? items[startIndex] : items[Math.floor(Math.random() * items.length)];
      this.queue = [first, ...shuffled(items.filter((i) => i !== first))];
      this.#start(0);
    } else {
      this.queue = items;
      this.#start(startIndex);
    }
    this.emit('queue');
  }

  #start(index, startAt = 0) {
    this.index = index;
    const item = this.current;
    if (!item) return this.stop();
    // Neue Wiedergabe zählen (Fortsetzen nach dem Spulen in umgewandelten Streams nicht)
    if (!(startAt > 0 && this.listening?.item === item)) this.listening = { item, listened: 0, last: null, counted: false };
    else this.listening.last = null;
    if (startAt === 0 && this.preloadFor === item.track.id && this.b.getAttribute('src')) {
      const old = this.a;
      this.a = this.b;
      this.b = old;
      this.b.pause();
      this.b.removeAttribute('src');
      this.b.load();
      this.transcoded = this.preloadTranscoded;
      this.offset = 0;
    } else {
      const { url, transcoded } = this.#source(item, startAt);
      this.transcoded = transcoded;
      this.offset = transcoded ? startAt : 0;
      this.a.src = url;
      if (!transcoded && startAt > 0) {
        this.a.addEventListener('loadedmetadata', () => (this.a.currentTime = startAt), { once: true });
      }
    }
    this.preloadFor = null;
    this.#applyVolume();
    this.buffering = true;
    const p = this.a.play();
    if (p) {
      p.catch((err) => {
        if (err?.name === 'NotAllowedError') this.emit('blocked');
      });
    }
    this.emit('track', item);
    this.#updateSession(item);
  }

  /** Echte Hörzeit sammeln: Sprünge (Spulen) zählen nicht, Pausen auch nicht. */
  #listen() {
    const l = this.listening;
    if (!l || l.counted || l.item !== this.current) return;
    const t = this.time;
    const last = l.last;
    l.last = t;
    if (last == null || this.a.paused) return;
    const d = t - last;
    if (d > 0 && d < 1.5) l.listened += d;
    const dur = this.duration;
    const need = dur > 0 ? Math.min(30, dur * 0.5) : 30;
    if (l.listened >= need) {
      l.counted = true;
      this.emit('played', l.item);
    }
  }

  #onError() {
    const item = this.current;
    if (!item) return;
    if (!this.transcoded && this.transcoding && !item.forceTranscode) {
      item.forceTranscode = true; // Browser kann das Format doch nicht → umwandeln lassen
      return this.#start(this.index, this.time);
    }
    this.emit('error', `„${item.track.title}“ kann nicht abgespielt werden.`);
    setTimeout(() => {
      if (this.current === item) this.next(true);
    }, 1500);
  }

  #maybePreload() {
    const remaining = this.duration - this.time;
    if (!(remaining > 0 && remaining < 15)) return;
    const nextIndex = this.index + 1 < this.queue.length ? this.index + 1 : this.repeat === 'all' ? 0 : -1;
    if (this.repeat === 'one' || nextIndex < 0) return;
    const item = this.queue[nextIndex];
    if (!item || this.preloadFor === item.track.id) return;
    const { url, transcoded } = this.#source(item, 0);
    this.preloadFor = item.track.id;
    this.preloadTranscoded = transcoded;
    this.b.src = url;
    this.b.load();
  }

  toggle() {
    if (!this.current) return false;
    if (this.a.paused) {
      this.a.play().catch(() => {});
      return true;
    }
    this.a.pause();
    return false;
  }

  pause() {
    this.a.pause();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 'one') return this.#start(this.index);
    let i = this.index + 1;
    if (i >= this.queue.length) {
      if (this.repeat !== 'all') {
        this.a.pause();
        this.playing = false;
        this.emit('state');
        this.emit('finished');
        return;
      }
      i = 0;
    }
    this.#start(i);
  }

  prev() {
    if (!this.queue.length) return;
    if (this.time > 3 || this.index === 0) return this.seek(0);
    this.#start(this.index - 1);
  }

  playIndex(i) {
    if (i >= 0 && i < this.queue.length) this.#start(i);
  }

  seek(sec) {
    if (!this.current) return;
    const s = Math.max(0, Math.min(sec, Math.max(0, this.duration - 0.25)));
    if (this.transcoded) this.#start(this.index, s);
    else this.a.currentTime = s;
    this.emit('seek');
  }

  stop() {
    this.a.pause();
    this.a.removeAttribute('src');
    this.a.load();
    this.queue = [];
    this.index = -1;
    this.playing = false;
    this.emit('state');
    this.emit('track', null);
  }

  setShuffle(on) {
    if (on === this.shuffle || !this.queue.length) {
      this.shuffle = on;
      return this.emit('queue');
    }
    const cur = this.current;
    this.shuffle = on;
    if (on) {
      this.original = this.original ?? [...this.queue];
      this.queue = [cur, ...shuffled(this.queue.filter((i) => i !== cur))];
      this.index = 0;
    } else if (this.original) {
      this.queue = this.original;
      this.index = Math.max(0, this.queue.indexOf(cur));
    }
    this.preloadFor = null;
    this.emit('queue');
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.emit('queue');
    return this.repeat;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.muted = false;
    this.#applyVolume();
    this.emit('volume');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.#applyVolume();
    this.emit('volume');
  }

  #applyVolume() {
    for (const el of [this.a, this.b]) {
      el.volume = this.volume;
      el.muted = this.muted;
    }
  }

  #mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* nicht unterstützt */
      }
    };
    set('play', () => {
      if (this.current) this.a.play().catch(() => {});
    });
    set('pause', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => this.seek(d.seekTime));
    set('seekbackward', (d) => this.seek(this.time - (d.seekOffset || 10)));
    set('seekforward', (d) => this.seek(this.time + (d.seekOffset || 10)));
    this.on('state', () => {
      ms.playbackState = this.playing ? 'playing' : this.current ? 'paused' : 'none';
    });
  }

  #updateSession(item) {
    if (!('mediaSession' in navigator) || !item) return;
    const art = [];
    const sm = artUrl(item.album, 'front', 'sm');
    const md = artUrl(item.album, 'front', 'md');
    if (sm) art.push({ src: sm, sizes: '420x420', type: 'image/jpeg' });
    if (md) art.push({ src: md, sizes: '900x900', type: 'image/jpeg' });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.track.title,
        artist: item.track.artist ?? item.album.artist,
        album: item.album.title,
        artwork: art
      });
    } catch {
      /* ältere Browser */
    }
  }

  #positionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const now = performance.now();
    if (now - (this.lastPos ?? 0) < 1000) return;
    this.lastPos = now;
    const duration = this.duration;
    if (!duration) return;
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(this.time, duration), playbackRate: 1 });
    } catch {
      /* ungültige Werte ignorieren */
    }
  }
}
