// Lädt Bilder als Texturen (dekodiert im Hintergrund), priorisiert nach Sichtbarkeit und
// gibt ungenutzte Texturen wieder frei.

import * as THREE from 'three';
import { dominantColor } from './color.js';

// ImageBitmap dekodiert im Hintergrund. Ältere Safari/Firefox-Versionen haben damit Fehler
// (wie three.js' GLTFLoader) – dort und mit ?compat in der Adresse wird der klassische Weg genutzt.
function bitmapSupported() {
  if (typeof createImageBitmap !== 'function' || typeof ImageBitmap === 'undefined') return false;
  if (new URLSearchParams(location.search).has('compat')) return false;
  const ua = navigator.userAgent;
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  const safariVersion = safari ? Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0) : 99;
  const firefoxVersion = ua.includes('Firefox') ? Number(ua.match(/Firefox\/(\d+)\./)?.[1] ?? 0) : 999;
  return safariVersion >= 17 && firefoxVersion >= 98;
}
const canBitmap = bitmapSupported();

export class TextureStore {
  constructor(renderer, { maxEntries = 220, concurrency = 6 } = {}) {
    this.maxEntries = maxEntries;
    this.concurrency = concurrency;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.entries = new Map();
    this.queue = [];
    this.active = 0;
    this.ready = []; // fertig dekodiert, wartet auf Upload-Budget
    this.perFrame = 3;
    this.useBitmap = canBitmap;
    this.slowLoads = 0;
    this.bitmapLoader = new THREE.ImageBitmapLoader();
    this.bitmapLoader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    this.imageLoader = new THREE.ImageLoader();
  }

  /** Lädt eine URL; niedrigere priority = früher. Liefert Promise<entry>. */
  load(url, priority = 10) {
    let entry = this.entries.get(url);
    if (entry) {
      entry.last = performance.now();
      if (entry.pending && priority < entry.pending.priority) {
        entry.pending.priority = priority;
        this.queue.sort((a, b) => a.priority - b.priority);
      }
      return entry.promise;
    }
    entry = { key: url, texture: null, image: null, refs: 0, last: performance.now(), color: undefined, flipped: false };
    entry.promise = new Promise((resolve, reject) => {
      entry.pending = { url, priority, resolve, reject, entry };
      this.queue.push(entry.pending);
      this.queue.sort((a, b) => a.priority - b.priority);
    });
    entry.promise.catch(() => {});
    this.entries.set(url, entry);
    this.#pump();
    return entry.promise;
  }

  #pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      const bitmap = this.useBitmap;
      const started = performance.now();
      (bitmap ? this.bitmapLoader : this.imageLoader).load(
        job.url,
        (image) => {
          this.active--;
          // Dekodieren im Hintergrund extrem langsam (manche TV-Browser)? Dann klassisch laden.
          if (bitmap && performance.now() - started > 8000 && ++this.slowLoads >= 3 && this.useBitmap) {
            this.useBitmap = false;
            console.info('discbox: ImageBitmap ist hier sehr langsam – wechsle auf klassisches Laden.');
          }
          const e = job.entry;
          e.pending = null;
          e.flipped = bitmap;
          const tex = new THREE.Texture(image);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = this.anisotropy;
          tex.flipY = !bitmap;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.needsUpdate = true;
          e.texture = tex;
          e.image = image;
          e.width = image.width;
          e.height = image.height;
          // Nicht sofort übergeben: tick() verteilt die GPU-Uploads auf mehrere Frames
          this.ready.push(job);
          this.#pump();
        },
        undefined,
        (err) => {
          this.active--;
          this.entries.delete(job.url);
          job.reject(err ?? new Error(`Bild nicht ladbar: ${job.url}`));
          this.#pump();
        }
      );
    }
  }

  /** Pro Frame aufrufen: gibt höchstens perFrame neue Texturen frei (wichtigste zuerst). */
  tick() {
    if (!this.ready.length) return;
    this.ready.sort((a, b) => a.priority - b.priority);
    const n = Math.min(this.perFrame, this.ready.length);
    for (const job of this.ready.splice(0, n)) job.resolve(job.entry);
    this.#evict();
  }

  /** Canvas-Textur, über einen Schlüssel zwischengespeichert. */
  generated(key, draw) {
    let entry = this.entries.get(key);
    if (entry) {
      entry.last = performance.now();
      return entry;
    }
    const canvas = draw();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    entry = { key, texture: tex, image: canvas, width: canvas.width, height: canvas.height, refs: 0, last: performance.now(), generated: true, flipped: false };
    entry.promise = Promise.resolve(entry);
    this.entries.set(key, entry);
    this.#evict();
    return entry;
  }

  colorOf(entry) {
    if (entry.color === undefined) entry.color = entry.image ? dominantColor(entry.image) : null;
    return entry.color;
  }

  acquire(entry) {
    if (!entry) return;
    entry.refs++;
    entry.last = performance.now();
  }

  release(entry) {
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
  }

  #evict() {
    if (this.entries.size <= this.maxEntries) return;
    const waiting = new Set(this.ready.map((j) => j.entry));
    const free = [...this.entries.values()].filter((e) => e.refs === 0 && e.texture && !waiting.has(e)).sort((a, b) => a.last - b.last);
    let over = this.entries.size - this.maxEntries;
    for (const e of free) {
      if (over-- <= 0) break;
      e.texture.dispose();
      if (e.image?.close) e.image.close();
      this.entries.delete(e.key);
    }
  }
}
