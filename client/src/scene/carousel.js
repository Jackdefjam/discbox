// Ordnet die Hüllen an, bindet Alben an wiederverwendbare 3D-Hüllen (Pool), lädt Texturen nach
// Sichtbarkeit und steuert die Detailansicht (herausnehmen, drehen, umdrehen, öffnen).

import * as THREE from 'three';
import { artUrl } from '../core/api.js';
import { drawBack, drawDisc, drawFrontPlaceholder, drawInlay, drawSpine } from './artgen.js';
import { albumHashColor } from './color.js';
import { CASE, CASE_D, CASE_H, CASE_W, JewelCase } from './jewelcase.js';
import { LAYOUTS } from './layouts.js';

const BACK_ASPECT = CASE.BACK_W / CASE.BACK_H; // 1.17
const SCAN_WITH_SPINES = 1.23; // 151 × 118 mm ≈ 1.28
const SPINE_FRAC = CASE.SPINE / (CASE.BACK_W + 2 * CASE.SPINE);

const pose = { x: 0, y: 0, z: 0, yaw: 0 };
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const eul = new THREE.Euler();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);
const damp = (cur, goal, rate, dt) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));

function cropTexture(entry, targetAspect) {
  const tex = entry.texture.clone();
  const a = entry.width / entry.height;
  if (a > targetAspect) {
    tex.repeat.set(targetAspect / a, 1);
    tex.offset.set((1 - targetAspect / a) / 2, 0);
  } else if (a < targetAspect) {
    tex.repeat.set(1, a / targetAspect);
    tex.offset.set(0, (1 - a / targetAspect) / 2);
  }
  return tex;
}

class Slot {
  constructor(carousel) {
    this.c = carousel;
    this.case = new JewelCase(carousel.factory);
    this.body = this.case.group;
    this.shadow = new THREE.Mesh(carousel.factory.geo.shadow, carousel.factory.shadowMat.clone());
    this.shadow.renderOrder = 1;
    carousel.scene.add(this.body, this.shadow);
    this.index = -1;
    this.album = null;
    this.held = new Map(); // Rolle → Texture-Eintrag
    this.clones = new Map(); // Rolle → geklonte Textur (eigene UV-Transformation)
    this.token = 0;
    this.reset();
  }

  reset() {
    this.e = 0;
    this.lid = 0;
    this.lidGoal = 0;
    this.flip = 0;
    this.flipGoal = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.spin = 0;
    this.case.setLid(0);
  }

  #hold(role, entry, texture) {
    const prev = this.held.get(role);
    if (prev !== entry) {
      this.c.textures.release(prev);
      if (entry) this.c.textures.acquire(entry);
      if (entry) this.held.set(role, entry);
      else this.held.delete(role);
    }
    const prevClone = this.clones.get(role);
    if (prevClone && prevClone !== texture) prevClone.dispose();
    if (texture && entry && texture !== entry.texture) this.clones.set(role, texture);
    else this.clones.delete(role);
  }

  #set(role, material, entry, texture, fallbackColor) {
    this.#hold(role, entry, texture);
    JewelCase.apply(material, texture ?? null, fallbackColor);
  }

  bind(album, index) {
    this.unbind();
    this.album = album;
    this.index = index;
    this.token++;
    this.color = albumHashColor(album);
    this.colorFromCover = false;
    this.frontSize = null;
    this.backState = null;
    this.spineFromScan = false;
    this.interiorKey = null;
    this.detail = null;
    this.body.visible = true;
    this.shadow.visible = true;
    const k = this.case;
    k.setTray(this.c.settings.tray);
    k.setEdgesVisible(this.c.edgesVisible);
    JewelCase.apply(k.frontMat, null, this.color);
    JewelCase.apply(k.backMat, null, '#1b1b20');
    JewelCase.apply(k.inlayMat, null, '#ece7dc');
    JewelCase.apply(k.discMat, null, '#c9ced6');
    this.#applySpines();
    if (!album.art?.front) {
      const entry = this.c.textures.generated(`front:${album.id}`, () => drawFrontPlaceholder(album));
      this.#set('front', k.frontMat, entry, entry.texture);
      this.frontSize = 'gen';
    }
  }

  unbind() {
    for (const role of [...this.held.keys()]) this.#hold(role, null, null);
    for (const t of this.clones.values()) t.dispose();
    this.clones.clear();
    this.album = null;
    this.index = -1;
    this.body.visible = false;
    this.shadow.visible = false;
    this.reset();
  }

  #applySpines() {
    if (this.spineFromScan) return;
    const a = this.album;
    const dir = this.c.settings.spineDirection;
    const entry = this.c.textures.generated(`spine:${a.id}:${this.color}:${dir}`, () => drawSpine(a, this.color, dir));
    this.#set('spineH', this.case.spineHingeMat, entry, entry.texture);
    this.#set('spineO', this.case.spineOtherMat, entry, entry.texture);
  }

  /** Frontcover in gewünschter Größe sicherstellen (sm → md → lg). */
  wantFront(size, priority) {
    const a = this.album;
    if (!a?.art?.front || this.frontSize === size || this.frontPending === size) return;
    const order = { sm: 0, md: 1, lg: 2 };
    if (this.frontSize && order[this.frontSize] > order[size]) return; // nie verschlechtern
    const url = artUrl(a, 'front', size);
    const token = this.token;
    this.frontPending = size;
    this.c.textures
      .load(url, priority)
      .then((entry) => {
        if (token !== this.token) return;
        this.frontPending = null;
        if (this.frontSize && order[this.frontSize] > order[size]) return;
        this.#set('front', this.case.frontMat, entry, cropTexture(entry, 1));
        this.frontSize = size;
        this.frontEntry = entry;
        const color = this.c.textures.colorOf(entry);
        if (color && !this.colorFromCover) {
          this.colorFromCover = true;
          this.color = color;
          this.#applySpines();
          if (this.backState === 'gen') this.backState = null;
          if (this.interiorKey) this.interiorKey = null;
          this.c.onSlotColor(this);
        }
      })
      .catch(() => {
        if (token !== this.token) return;
        this.frontPending = null;
        const entry = this.c.textures.generated(`front:${a.id}`, () => drawFrontPlaceholder(a));
        this.#set('front', this.case.frontMat, entry, entry.texture);
        this.frontSize = 'gen';
      });
  }

  /** Rückseite: Scan (ggf. mit Rücken) oder generiert mit Titelliste. */
  wantBack(priority) {
    const a = this.album;
    if (!a) return;
    if (a.art?.back) {
      if (this.backState) return;
      this.backState = 'loading';
      const token = this.token;
      this.c.textures
        .load(artUrl(a, 'back', 'md'), priority)
        .then((entry) => {
          if (token !== this.token) return;
          this.backState = 'scan';
          const aspect = entry.width / entry.height;
          if (aspect >= SCAN_WITH_SPINES) {
            const back = entry.texture.clone();
            back.repeat.set(1 - 2 * SPINE_FRAC, 1);
            back.offset.set(SPINE_FRAC, 0);
            this.#set('back', this.case.backMat, entry, back);
            const hinge = entry.texture.clone();
            hinge.repeat.set(SPINE_FRAC, 1);
            hinge.offset.set(1 - SPINE_FRAC, 0);
            const other = entry.texture.clone();
            other.repeat.set(SPINE_FRAC, 1);
            other.offset.set(0, 0);
            this.spineFromScan = true;
            this.#set('spineH', this.case.spineHingeMat, entry, hinge);
            this.#set('spineO', this.case.spineOtherMat, entry, other);
          } else {
            this.#set('back', this.case.backMat, entry, cropTexture(entry, BACK_ASPECT));
          }
        })
        .catch(() => {
          if (token === this.token) this.backState = 'failed';
        });
      return;
    }
    const detail = this.detail ?? this.c.cachedDetail(a.id);
    const key = `back:${a.id}:${this.color}:${detail ? 1 : 0}`;
    if (this.backState === key) return;
    const entry = this.c.textures.generated(key, () => drawBack(a, detail, this.color));
    this.#set('back', this.case.backMat, entry, entry.texture);
    this.backState = key;
  }

  /** Booklet-Innenseite und CD (nur nötig, wenn die Hülle geöffnet wird). */
  wantInterior(priority) {
    const a = this.album;
    if (!a) return;
    const detail = this.detail ?? this.c.cachedDetail(a.id);
    const frontReady = !!this.frontEntry;
    const key = `${this.color}:${detail ? 1 : 0}:${frontReady ? 1 : 0}`;
    if (this.interiorKey === key) return;
    this.interiorKey = key;
    const inlay = this.c.textures.generated(`inlay:${a.id}:${this.color}:${detail ? 1 : 0}`, () => drawInlay(a, detail, this.color));
    this.#set('inlay', this.case.inlayMat, inlay, inlay.texture);
    if (a.art?.disc) {
      const token = this.token;
      this.c.textures
        .load(artUrl(a, 'disc', 'md'), priority)
        .then((entry) => {
          if (token === this.token) this.#set('disc', this.case.discMat, entry, entry.texture);
        })
        .catch(() => {});
    } else {
      const fe = this.frontEntry;
      const disc = this.c.textures.generated(`disc:${a.id}:${this.color}:${frontReady ? 1 : 0}`, () =>
        drawDisc(a, this.color, fe?.image ?? null, fe?.flipped)
      );
      this.#set('disc', this.case.discMat, disc, disc.texture);
    }
  }

  setDetail(detail) {
    this.detail = detail;
    if (this.backState?.startsWith?.('back:')) this.backState = null;
    this.interiorKey = null;
  }
}

export class Carousel {
  constructor({ stage, store, textures, factory, player }) {
    this.stage = stage;
    this.scene = stage.scene;
    this.store = store;
    this.textures = textures;
    this.factory = factory;
    this.player = player;
    this.settings = store.settings;
    this.slots = [];
    this.free = [];
    this.bound = new Map();
    this.pos = store.index;
    this.target = store.index;
    this.dragging = false;
    this.layout = LAYOUTS[store.settings.layout] ?? LAYOUTS.coverflow;
    this.edgesVisible = true;
    this.lowWindow = false;
    this.panel = { side: 'right', frac: 0 };
    this.raycaster = new THREE.Raycaster();
    this.onColor = () => {};
    stage.setCameraPreset(this.layout.camera, true);
  }

  cachedDetail(id) {
    return this.store.cachedDetail(id);
  }

  onSlotColor(slot) {
    if (slot.index === this.store.index) this.onColor(slot.color, slot.album);
  }

  /** Aktuelle Leitfarbe der Auswahl (für Hintergrund und Oberfläche). */
  currentColor() {
    const slot = this.bound.get(this.store.index);
    return slot ? slot.color : null;
  }

  setLayout(id) {
    this.layout = LAYOUTS[id] ?? LAYOUTS.coverflow;
    this.stage.setCameraPreset(this.layout.camera);
  }

  setQualityFlags({ edges, lowWindow }) {
    this.edgesVisible = edges;
    this.lowWindow = lowWindow;
    for (const s of this.bound.values()) s.case.setEdgesVisible(edges);
  }

  refreshAppearance() {
    for (const s of this.bound.values()) {
      s.case.setTray(this.settings.tray);
      if (!s.spineFromScan) s.bind(s.album, s.index);
    }
  }

  /** Albumliste hat sich geändert (Filter, Sortierung, Rescan). Unveränderte Hüllen bleiben stehen. */
  rebuild() {
    const view = this.store.view;
    const sig = (a) => `${a.id}|${a.art?.front}|${a.art?.back}|${a.art?.disc}|${a.trackCount}`;
    for (const [i, s] of this.bound) {
      const a = view[i];
      if (a && s.album && sig(a) === sig(s.album)) {
        s.album = a;
        continue;
      }
      s.unbind();
      this.bound.delete(i);
      this.free.push(s);
    }
    if (Math.abs(this.pos - this.store.index) > 0.5) this.pos = this.store.index;
    this.target = this.store.index;
  }

  setIndex(i, { jump = false, fromDrag = false } = {}) {
    this.target = i;
    if (fromDrag) return;
    const W = this.windowSize();
    if (jump && Math.abs(i - this.pos) > W) this.pos = i - Math.sign(i - this.pos) * W * 0.6;
    else if (Math.abs(i - this.pos) > 40) this.pos = i - Math.sign(i - this.pos) * 12;
  }

  windowSize() {
    return this.lowWindow ? this.layout.lowWindow : this.layout.window;
  }

  // ---------- Ziehen ----------
  dragStart() {
    this.dragging = true;
    this.dragVel = 0;
  }

  dragBy(items) {
    const n = this.store.view.length;
    const next = Math.max(-0.45, Math.min(n - 0.55, this.pos + items));
    this.dragVel = items;
    this.pos = next;
    this.store.select(Math.round(this.pos), { fromDrag: true });
  }

  dragEnd(velocityItemsPerSec) {
    this.dragging = false;
    const n = this.store.view.length;
    const goal = Math.max(0, Math.min(n - 1, Math.round(this.pos + velocityItemsPerSec * 0.22)));
    this.store.select(goal, { fromDrag: true, force: true });
    this.target = goal;
  }

  // ---------- Detailansicht ----------
  get inspected() {
    return this.store.mode === 'inspect' ? this.bound.get(this.store.index) ?? null : null;
  }

  flip() {
    const s = this.inspected;
    if (s) s.flipGoal += Math.PI;
  }

  toggleLid(force) {
    const s = this.inspected;
    if (!s) return false;
    s.lidGoal = force ?? (s.lidGoal > 0.5 ? 0 : 1);
    if (s.lidGoal > 0.5 && Math.cos(s.flipGoal) < 0) s.flipGoal += Math.PI; // zum Öffnen nach vorne drehen
    return s.lidGoal > 0.5;
  }

  isLidOpen() {
    return (this.inspected?.lidGoal ?? 0) > 0.5;
  }

  rotateBy(dx, dy) {
    const s = this.inspected;
    if (!s) return;
    s.yaw += dx;
    s.pitch = Math.max(-0.9, Math.min(0.9, s.pitch + dy));
    s.yawVel = dx;
    s.pitchVel = dy;
  }

  resetView() {
    const s = this.inspected;
    if (!s) return;
    s.yaw = 0;
    s.pitch = 0;
    s.flipGoal = Math.round(s.flipGoal / (2 * Math.PI)) * 2 * Math.PI;
  }

  setDetail(detail) {
    for (const s of this.bound.values()) if (s.album?.id === detail.id) s.setDetail(detail);
  }

  /** Welche Hülle liegt unter dem Mauszeiger? */
  pick(ndc) {
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const picks = [];
    for (const s of this.bound.values()) {
      s.case.pick.updateWorldMatrix(true, false);
      picks.push(s.case.pick);
    }
    const hit = this.raycaster.intersectObjects(picks, false)[0];
    if (!hit) return null;
    for (const s of this.bound.values()) if (s.case.pick === hit.object) return s;
    return null;
  }

  // ---------- Pro Frame ----------
  update(dt, time, { reduceMotion = false } = {}) {
    const view = this.store.view;
    const n = view.length;
    if (!this.dragging) {
      const rate = reduceMotion ? 30 : 9;
      this.pos = damp(this.pos, this.target, rate, dt);
      if (Math.abs(this.pos - this.target) < 0.0005) this.pos = this.target;
    }

    // Sichtfenster binden
    const W = this.windowSize();
    const lo = Math.max(0, Math.floor(this.pos) - W);
    const hi = Math.min(n - 1, Math.ceil(this.pos) + W);
    for (const [i, slot] of this.bound) {
      if (i < lo || i > hi || view[i] !== slot.album) {
        slot.unbind();
        this.bound.delete(i);
        this.free.push(slot);
      }
    }
    for (let i = lo; i <= hi; i++) {
      if (this.bound.has(i)) continue;
      const slot = this.free.pop() ?? this.#newSlot();
      slot.bind(view[i], i);
      this.bound.set(i, slot);
      if (i === this.store.index) this.onSlotColor(slot);
    }

    const inspectIndex = this.store.mode === 'inspect' ? this.store.index : -1;
    // In der Detailansicht rücken die übrigen Hüllen etwas zur Seite und nach hinten
    this.ib = damp(this.ib ?? 0, inspectIndex >= 0 ? 1 : 0, reduceMotion ? 30 : 4, dt);
    const cam = this.stage.camera;
    cam.updateMatrixWorld();
    cam.getWorldDirection(fwd);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    const playingAlbum = this.player?.playing ? this.player.current?.album?.id : null;

    for (const [i, s] of this.bound) {
      const d = i - this.pos;
      this.layout.pose(d, pose);
      if (this.ib > 0.001 && i !== inspectIndex) {
        pose.x += Math.sign(d) * this.ib * 0.55;
        pose.z -= this.ib * 1.1;
      }
      vA.set(pose.x, pose.y + CASE_H / 2 + 0.002, pose.z);
      qA.setFromAxisAngle(yAxis, pose.yaw);

      // Detailansicht überblenden
      s.e = damp(s.e, i === inspectIndex ? 1 : 0, reduceMotion ? 30 : 7, dt);
      if (s.e < 0.002 && i !== inspectIndex) {
        if (s.lid !== 0 || s.flipGoal !== 0 || s.yaw !== 0) s.reset();
        s.e = 0;
      }
      if (s.e > 0.001) {
        s.lid = damp(s.lid, s.lidGoal, reduceMotion ? 30 : 5, dt);
        s.flip = damp(s.flip, s.flipGoal, reduceMotion ? 30 : 6, dt);
        if (!this.rotating) {
          s.yaw += s.yawVel;
          s.pitch = Math.max(-0.9, Math.min(0.9, s.pitch + s.pitchVel));
          s.yawVel *= Math.exp(-dt * 5);
          s.pitchVel *= Math.exp(-dt * 5);
        }
        s.case.setLid(ease(Math.min(1, s.lid)));
        this.#inspectPose(s, time, reduceMotion, vB, qB);
        const k = ease(s.e);
        vA.lerp(vB, k);
        qA.slerp(qB, k);
      }
      s.body.position.copy(vA);
      s.body.quaternion.copy(qA);

      // Bodenschatten
      s.shadow.position.set(vA.x, 0.003, vA.z);
      eul.setFromQuaternion(qA, 'YXZ');
      s.shadow.rotation.set(-Math.PI / 2, eul.y, 0, 'YXZ');
      s.shadow.scale.set(CASE_W * 1.25, CASE_D * 7, 1);
      s.shadow.material.opacity = 0.7 * (1 - s.e) * Math.max(0, 1 - Math.abs(d) / (W + 1));

      // CD dreht sich, wenn dieses Album läuft
      if (s.lid > 0.05 && playingAlbum && s.album.id === playingAlbum) {
        s.spin += dt * 4.2;
        s.case.disc.rotation.z = -s.spin;
      }

      // Texturen nach Bedarf
      const ad = Math.abs(d);
      s.wantFront(s.e > 0.2 ? 'lg' : ad < 1.6 ? 'md' : 'sm', ad);
      if (s.e > 0.05 || (this.layout.id === 'shelf' && s.album.art?.back) || (ad < 2.5 && s.album.art?.back)) {
        s.wantBack(ad + 3);
      }
      if (s.e > 0.05) s.wantInterior(1);
    }
  }

  #inspectPose(s, time, reduceMotion, outPos, outQuat) {
    const cam = this.stage.camera;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const tan = Math.tan(vFov / 2);
    const side = this.panel.side;
    const frac = this.panel.frac;
    const top = this.panel.top ?? 0;
    const lid = ease(Math.min(1, s.lid));
    let dist = (CASE_H / 0.6 / (2 * tan)) * (1 + lid * 0.22);
    const usableW = 2 * tan * dist * cam.aspect * (side === 'right' ? 1 - frac : 1);
    const needW = CASE_W * (1.35 + lid * 0.8);
    if (usableW < needW) dist *= needW / usableW;
    const freeH = 1 - top - (side === 'bottom' ? frac : 0);
    const usableH = 2 * tan * dist * freeH;
    if (usableH < CASE_H * 1.3) dist *= (CASE_H * 1.3) / usableH;
    const visW = 2 * tan * dist * cam.aspect;
    const visH = 2 * tan * dist;
    let sx = side === 'right' ? (-frac * visW) / 2 : 0;
    let sy = ((side === 'bottom' ? frac : 0) - top) / 2 * visH;
    sx += lid * CASE_W * 0.36;
    outPos.copy(cam.position).addScaledVector(fwd, dist).addScaledVector(right, sx).addScaledVector(up, sy + 0.01);
    const sway = reduceMotion || this.rotating ? 0 : Math.sin(time * 0.6) * 0.07 * (1 - lid);
    eul.set(s.pitch + lid * 0.12, s.yaw + s.flip + sway + lid * 0.42, 0, 'XYZ');
    outQuat.copy(cam.quaternion).multiply(qC.setFromEuler(eul));
    return outPos;
  }

  #newSlot() {
    const s = new Slot(this);
    this.slots.push(s);
    return s;
  }
}
