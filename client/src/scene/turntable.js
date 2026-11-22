// Plattenspieler: Zarge aus Nussbaum, Aluminiumteller mit Gummimatte, Tonarm mit Gegengewicht,
// Tonarmstütze, Start/Stopp- und Drehzahltasten. Auf dem Teller liegt wahlweise eine Schallplatte
// (Rillen mit Pausen zwischen den Titeln, Label mit dem Cover) oder die CD des Albums.
// Maße in Millimetern (wie die CD-Hülle); die Gruppe wird auf Szeneneinheiten skaliert.

import * as THREE from 'three';

export const TT_SCALE = 0.01;

export const TT = {
  W: 450,
  D: 360,
  feet: 16,
  top: 74, // Oberkante der Zarge
  platter: { x: -45, z: 0, r: 152, y0: 76, h: 26 },
  mat: { r: 148, h: 3 },
  spindle: { r: 3.6, h: 15 },
  pivot: { x: 118, z: -151 }, // Abstand zur Tellerachse ≈ 222 mm (effektive Länge − Überhang)
  arm: { L: 239, drop: 24, rest: -0.06 },
  vinyl: { r: 151, t: 1.8, label: 50, outer: 146.5, inner: 60 },
  cd: { r: 60, t: 1.2, outer: 57, inner: 24 }
};

const RPM33 = (2 * Math.PI * 33.333) / 60;

/**
 * Gierwinkel des Tonarms (um die senkrechte Achse im Drehpunkt), bei dem die Nadel auf dem Radius r
 * (mm, um die Tellerachse) steht: Schnitt der Kreise um Drehpunkt (Radius = effektive Länge) und Teller.
 */
export function armAngle(r, { L = TT.arm.L, center = TT.platter, pivot = TT.pivot } = {}) {
  const dx = center.x - pivot.x;
  const dz = center.z - pivot.z;
  const d = Math.hypot(dx, dz);
  const a = (L * L - r * r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L * L - a * a));
  const mx = pivot.x + (a * dx) / d;
  const mz = pivot.z + (a * dz) / d;
  // zwei Lösungen; die vordere (größeres z) liegt über der Platte
  const s1 = [mx - (h * dz) / d, mz + (h * dx) / d];
  const s2 = [mx + (h * dz) / d, mz - (h * dx) / d];
  const s = s1[1] > s2[1] ? s1 : s2;
  return Math.atan2(s[0] - pivot.x, s[1] - pivot.z);
}

// ---------- Texturen ----------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Nussbaum-Maserung (wiederholbar). */
function walnutTexture() {
  const c = canvas(1024, 512);
  const ctx = c.getContext('2d');
  const r = rng(7);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#5b3b26');
  g.addColorStop(0.5, '#4d311f');
  g.addColorStop(1, '#5a3a25');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 260; i++) {
    const y0 = r() * 512;
    const amp = 2 + r() * 9;
    const freq = 0.002 + r() * 0.01;
    const phase = r() * 10;
    const dark = r() < 0.6;
    ctx.strokeStyle = dark ? `rgba(30,16,8,${0.08 + r() * 0.22})` : `rgba(150,100,60,${0.05 + r() * 0.12})`;
    ctx.lineWidth = 0.6 + r() * 2.4;
    ctx.beginPath();
    for (let x = -10; x <= 1034; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase * 2) * amp * 0.25;
      if (x < 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Poren
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(20,10,4,${0.15 + r() * 0.3})`;
    ctx.fillRect(r() * 1024, r() * 512, 1 + r() * 3, 0.6 + r() * 0.8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Feines Rauschen (Filzmatte, Gummi). */
function noiseTexture(base, spread, size = 256, seed = 3) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, base + (r() - 0.5) * spread));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Rillenbild der Schallplatte als schmale Textur entlang des Radius (v = 0 innen am Label,
 * v = 1 am Rand). Zwischen den Titeln liegen glatte, glänzende Pausenringe – Breite nach Laufzeit.
 * Liefert Farb- und Rauheitstextur.
 */
export function grooveTextures(durations) {
  const { label, outer, inner, r: R } = TT.vinyl;
  const H = 2048;
  const col = canvas(4, H);
  const rough = canvas(4, H);
  const c1 = col.getContext('2d');
  const c2 = rough.getContext('2d');
  const total = durations.reduce((a, b) => a + b, 0) || 1;
  // Pausen zwischen den Titeln als Radien
  const gaps = [];
  let acc = 0;
  for (let i = 0; i < durations.length - 1; i++) {
    acc += durations[i];
    gaps.push(outer - (outer - inner) * (acc / total));
  }
  for (let y = 0; y < H; y++) {
    const r = label + ((y + 0.5) / H) * (R - label);
    let shade;
    let ro;
    if (r > outer + 0.6 || r < inner - 0.6) {
      // Ein- und Auslaufrille: glatt
      shade = r > R - 0.8 ? 26 : 13;
      ro = r > R - 0.8 ? 0.5 : 0.18;
    } else if (gaps.some((g) => Math.abs(r - g) < 0.55)) {
      shade = 11;
      ro = 0.14;
    } else {
      // Musikrillen: feine Ringe
      const fine = 0.5 + 0.5 * Math.sin((r / 0.42) * Math.PI * 2);
      shade = 15 + fine * 7;
      ro = 0.34 + fine * 0.08;
    }
    c1.fillStyle = `rgb(${shade},${shade},${shade + 1})`;
    c1.fillRect(0, H - 1 - y, 4, 1);
    const rv = Math.round(ro * 255);
    c2.fillStyle = `rgb(${rv},${rv},${rv})`;
    c2.fillRect(0, H - 1 - y, 4, 1);
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const t of [map, roughnessMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, roughnessMap };
}

/** Rundes Plattenlabel: Cover (oder Albumfarbe mit Titel), Ring und Mittelloch. */
export function drawVinylLabel(album, color, image, flipped) {
  const size = 512;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = size / 2;
  ctx.translate(R, R);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    const iw = image.width;
    const ih = image.height;
    const s = Math.max(size / iw, size / ih);
    if (flipped) ctx.scale(1, -1);
    ctx.drawImage(image, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
    if (flipped) ctx.scale(1, -1);
  } else {
    ctx.fillStyle = color ?? '#c0392b';
    ctx.fillRect(-R, -R, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(size * 0.07)}px Oswald, "Arial Narrow", sans-serif`;
    ctx.fillText((album?.title ?? '').toUpperCase().slice(0, 26), 0, -R * 0.42);
    ctx.font = `500 ${Math.round(size * 0.05)}px Inter, system-ui, sans-serif`;
    ctx.fillText((album?.artist ?? '').slice(0, 30), 0, R * 0.5);
  }
  ctx.restore();
  // Glanz und Pressring
  const sheen = ctx.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.1, 0, 0, R);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#0b0b0c';
  ctx.beginPath();
  ctx.arc(0, 0, (TT.spindle.r / TT.vinyl.label) * R * 1.05, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

// ---------- Geometrie ----------

/** Kreisring mit Polarkoordinaten als UV (u = Winkel, v = Radius) – für Rillen und Drehschliff. */
function polarRing(r0, r1, segments = 160, rings = 1) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= rings; j++) {
    const r = r0 + ((r1 - r0) * j) / rings;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, -Math.sin(a) * r);
      uv.push(i / segments, j / rings);
    }
  }
  const row = segments + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function roundedRectShape(w, d, r) {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.absarc(x0 + w - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x0 + w, y0 + d - r);
  s.absarc(x0 + w - r, y0 + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y0 + d);
  s.absarc(x0 + r, y0 + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Zylinder entlang y. */
function cyl(r, h, y0, seg = 48, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg);
  g.translate(0, y0 + h / 2, 0);
  return g;
}

/** Zylinder entlang z (für Tonarmrohr, Gegengewicht). */
function cylZ(r, z0, z1, seg = 24) {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

// ---------- Plattenspieler ----------

export class Turntable {
  /**
   * caseFactory: liefert Geometrie und Materialien der CD (gleich wie in der Hülle).
   */
  constructor(caseFactory) {
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.model.scale.setScalar(TT_SCALE);
    this.group.add(this.model);
    this.caseFactory = caseFactory;
    this.#materials();
    this.#build();
    // Zustand
    this.omega = 0; // Winkelgeschwindigkeit des Tellers
    this.angle = 0;
    this.psi = this.restPsi;
    this.lift = 1;
    this.discKind = 'cd';
    this.setDiscKind('cd');
  }

  #materials() {
    const walnut = walnutTexture();
    walnut.repeat.set(1 / 500, 1 / 250);
    this.walnut = walnut;
    this.mWood = new THREE.MeshPhysicalMaterial({ map: walnut, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.3 });
    this.mAlu = new THREE.MeshPhysicalMaterial({
      color: 0xc9cdd3,
      metalness: 1,
      roughness: 0.3,
      anisotropy: 0.75 // Drehschliff: Glanz läuft rund um den Teller
    });
    this.mChrome = new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 1, roughness: 0.08 });
    this.mSilver = new THREE.MeshStandardMaterial({ color: 0xd0d3d8, metalness: 1, roughness: 0.22 });
    this.mBlack = new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3 });
    this.mRubber = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.92 });
    const felt = noiseTexture(34, 26, 256, 11);
    felt.repeat.set(1, 1);
    this.mMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: felt, roughness: 0.95 });
    // Vinyl: schwarz, leicht glänzend; die Rillen strecken die Lichter zu den typischen Streifen
    this.mVinyl = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.35,
      anisotropy: 0.5,
      envMapIntensity: 0.4
    });
    this.mVinylEdge = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: 0.25, clearcoat: 0.5 });
    this.mLabel = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    this.mCartridge = new THREE.MeshPhysicalMaterial({ color: 0x8e1b1b, roughness: 0.35, clearcoat: 0.6 });
    this.mLed = new THREE.MeshBasicMaterial({ color: 0x2a0a08 });
  }

  #mesh(geo, mat, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }

  #build() {
    const { W, D, feet, top, platter: P, mat, spindle, pivot, arm, vinyl, cd } = TT;
    const model = this.model;

    // Zarge mit Fase
    const bv = 3;
    const plinthShape = roundedRectShape(W - 2 * bv, D - 2 * bv, 14);
    const plinth = new THREE.ExtrudeGeometry(plinthShape, {
      depth: top - feet - 2 * bv,
      bevelEnabled: true,
      bevelThickness: bv,
      bevelSize: bv,
      bevelSegments: 3,
      curveSegments: 10
    });
    plinth.rotateX(-Math.PI / 2);
    plinth.translate(0, feet + bv, 0);
    model.add(this.#mesh(plinth, this.mWood, { cast: false }));

    // Füße
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - 48);
        const z = sz * (D / 2 - 48);
        const ring = this.#mesh(cyl(24, 9, feet - 9, 40), this.mSilver);
        ring.position.set(x, 0, z);
        const pad = this.#mesh(cyl(22, feet - 9, 0, 40), this.mRubber);
        pad.position.set(x, 0, z);
        model.add(ring, pad);
      }
    }

    // Tellergruppe (dreht sich)
    this.platter = new THREE.Group();
    this.platter.position.set(P.x, 0, P.z);
    model.add(this.platter);
    // Lager unter dem Teller (Schattenfuge)
    this.platter.add(this.#mesh(cyl(120, P.y0 - top, top, 64), this.mBlack, { cast: false }));
    const prof = [
      new THREE.Vector2(140, P.y0),
      new THREE.Vector2(151.2, P.y0 + 0.6),
      new THREE.Vector2(P.r, P.y0 + 2.5),
      new THREE.Vector2(P.r, P.y0 + P.h - 2.5),
      new THREE.Vector2(151, P.y0 + P.h - 0.4),
      new THREE.Vector2(mat.r - 0.5, P.y0 + P.h)
    ];
    const platterGeo = new THREE.LatheGeometry(prof, 160);
    this.platter.add(this.#mesh(platterGeo, this.mAlu));
    // Gummimatte
    const matTop = P.y0 + P.h + mat.h;
    const matGeo = new THREE.CylinderGeometry(mat.r, mat.r, mat.h, 160);
    matGeo.translate(0, P.y0 + P.h + mat.h / 2, 0);
    this.platter.add(this.#mesh(matGeo, this.mMat, { cast: false }));
    // Achse mit gerundeter Spitze
    const spindleGeo = cyl(spindle.r, spindle.h, matTop, 24);
    this.platter.add(this.#mesh(spindleGeo, this.mChrome));
    const tip = new THREE.SphereGeometry(spindle.r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    tip.translate(0, matTop + spindle.h, 0);
    this.platter.add(this.#mesh(tip, this.mChrome));
    this.matTop = matTop;

    // Schallplatte
    this.vinyl = new THREE.Group();
    this.vinyl.position.y = matTop;
    const grooves = polarRing(vinyl.label, vinyl.r, 192, 1);
    grooves.translate(0, vinyl.t, 0);
    this.vinylTop = this.#mesh(grooves, this.mVinyl);
    const edge = new THREE.CylinderGeometry(vinyl.r, vinyl.r, vinyl.t, 160, 1, true);
    edge.translate(0, vinyl.t / 2, 0);
    const labelGeo = new THREE.CircleGeometry(vinyl.label, 96);
    labelGeo.rotateX(-Math.PI / 2);
    labelGeo.translate(0, vinyl.t + 0.05, 0);
    this.labelMesh = this.#mesh(labelGeo, this.mLabel);
    this.vinyl.add(this.vinylTop, this.#mesh(edge, this.mVinylEdge), this.labelMesh);
    this.platter.add(this.vinyl);

    // CD (gleiche Geometrie wie in der Hülle)
    const g = this.caseFactory.geo;
    const f = this.caseFactory;
    this.cd = new THREE.Group();
    this.cd.position.y = matTop + cd.t / 2;
    this.cd.rotation.x = -Math.PI / 2;
    this.discMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.38, alphaMap: f.discAlpha, alphaTest: 0.5 });
    const cdTop = this.#mesh(g.discTop, this.discMat);
    cdTop.position.z = cd.t / 2;
    const cdBottom = this.#mesh(g.discBottom, f.discSilver, { cast: false });
    cdBottom.position.z = -cd.t / 2;
    this.cd.add(cdTop, cdBottom, this.#mesh(g.discEdge, f.discEdge));
    this.cd.scale.setScalar(1); // Hüllengeometrie ist bereits in mm
    this.platter.add(this.cd);

    // Bedienelemente vorne links: Start/Stopp, 33/45, Betriebsleuchte
    const bx = -W / 2 + 46;
    const bz = D / 2 - 40;
    const startRing = this.#mesh(cyl(15, 2.5, top, 48), this.mChrome);
    startRing.position.set(bx, 0, bz);
    const startCap = this.#mesh(cyl(12.5, 4.5, top, 48), this.mBlack);
    startCap.position.set(bx, 0, bz);
    model.add(startRing, startCap);
    this.speedCaps = [];
    for (const [i, dx] of [32, 52].entries()) {
      const ring = this.#mesh(cyl(7.5, 2, top, 32), this.mChrome);
      ring.position.set(bx + dx + 6, 0, bz + 2);
      const cap = this.#mesh(cyl(6, 3.2, top, 32), i === 0 ? this.mSilver : this.mBlack);
      cap.position.set(bx + dx + 6, 0, bz + 2);
      model.add(ring, cap);
      this.speedCaps.push(cap);
    }
    const led = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8), this.mLed);
    led.position.set(bx + 38, top + 0.6, bz - 16);
    model.add(led);

    // Tonarm
    const armY = matTop + vinyl.t + arm.drop; // Rohrachse über der Platte
    this.armY = armY;
    const base = new THREE.Group();
    base.position.set(pivot.x, 0, pivot.z);
    model.add(base);
    base.add(this.#mesh(cyl(32, 2.5, top, 64), this.mBlack));
    base.add(this.#mesh(cyl(15, armY - 12 - top, top + 2.5, 40), this.mSilver));
    // Liftbank (Lifthebel) seitlich am Sockel
    const cue = new THREE.Group();
    cue.position.set(-30, 0, 16);
    cue.add(this.#mesh(cyl(4, armY - 20 - top, top, 16), this.mSilver));
    const lever = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 26), this.mBlack);
    lever.position.set(0, armY - 20, 10);
    lever.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 10), this.mBlack);
    knob.position.set(0, armY - 20, 23);
    cue.add(lever, knob);
    base.add(cue);
    // Antiskating-Rad
    const skate = this.#mesh(cyl(9, 6, top + 2.5, 32), this.mBlack);
    skate.position.set(24, 0, -14);
    base.add(skate);

    // Drehachse des Arms (Gierwinkel) und Lift (Neigung)
    this.armYaw = new THREE.Group();
    this.armYaw.position.set(0, armY, 0);
    base.add(this.armYaw);
    this.armPitch = new THREE.Group();
    this.armYaw.add(this.armPitch);
    const L = arm.L;
    // Kardanlager
    const gimbal = new THREE.CylinderGeometry(12, 12, 26, 32);
    gimbal.rotateZ(Math.PI / 2);
    this.armPitch.add(this.#mesh(gimbal, this.mBlack));
    for (const sx of [-1, 1]) {
      const cap = new THREE.CylinderGeometry(8, 8, 2, 32);
      cap.rotateZ(Math.PI / 2);
      cap.translate(sx * 14, 0, 0);
      this.armPitch.add(this.#mesh(cap, this.mChrome));
    }
    // Headshell mit Kröpfung: Die Nadel sitzt genau auf der effektiven Länge L vor dem Drehpunkt,
    // das gerade Armrohr zielt dafür etwas seitlich auf den Anschluss der Headshell.
    const kink = 0.38;
    const stylusZ = 38; // Lage der Nadel in der Headshell
    const hx = Math.sin(kink) * stylusZ; // Anschluss liegt außen, die Headshell zeigt nach innen
    const hz = L - Math.cos(kink) * stylusZ;
    const tubeAngle = Math.atan2(hx, hz);
    const tubeLen = Math.hypot(hx, hz);
    const tube = new THREE.Group();
    tube.rotation.y = tubeAngle;
    tube.add(this.#mesh(cylZ(4.2, 6, tubeLen - 10), this.mSilver));
    tube.add(this.#mesh(cylZ(5, tubeLen - 12, tubeLen + 1), this.mBlack));
    // Gegengewicht auf der Verlängerung hinter dem Lager
    tube.add(this.#mesh(cylZ(3.2, -95, -6), this.mSilver));
    tube.add(this.#mesh(cylZ(17, -92, -60, 40), this.mBlack));
    tube.add(this.#mesh(cylZ(17.4, -62, -58, 40), this.mChrome));
    this.armPitch.add(tube);
    const headshell = new THREE.Group();
    headshell.position.set(hx, -4, hz);
    headshell.rotation.y = -kink;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(17, 3.5, 50), this.mBlack);
    shell.position.set(0, 0, 22);
    shell.castShadow = true;
    const fingerLift = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 3), this.mSilver);
    fingerLift.position.set(13, 1.5, 40); // Griffbügel außen
    fingerLift.rotation.z = 0.35;
    fingerLift.castShadow = true;
    const cart = new THREE.Mesh(new THREE.BoxGeometry(15, 15, 24), this.mCartridge);
    cart.position.set(0, -9.5, 30);
    cart.castShadow = true;
    const stylus = new THREE.ConeGeometry(1.2, 4, 10);
    stylus.rotateX(Math.PI);
    stylus.translate(0, -arm.drop + 4 + 2, stylusZ);
    headshell.add(shell, fingerLift, cart, this.#mesh(stylus, this.mChrome));
    this.armPitch.add(headshell);

    // Ruheposition und Tonarmstütze
    this.restPsi = arm.rest;
    const restDir = new THREE.Vector2(Math.sin(arm.rest), Math.cos(arm.rest));
    const rx = pivot.x + restDir.x * (L - 40);
    const rz = pivot.z + restDir.y * (L - 40);
    const post = this.#mesh(cyl(3.6, armY - 7 - top, top, 16), this.mSilver);
    post.position.set(rx, 0, rz);
    const clip = new THREE.TorusGeometry(6, 1.4, 8, 20, Math.PI);
    clip.rotateZ(Math.PI); // Bogen nach unten: U-förmige Ablage
    clip.rotateY(arm.rest);
    const clipMesh = this.#mesh(clip, this.mBlack);
    clipMesh.position.set(rx, armY - 2, rz);
    model.add(post, clipMesh);

  }

  /** Gierwinkel des Arms, bei dem die Nadel auf Radius r (mm) steht. */
  psiFor(r) {
    return armAngle(r);
  }

  /** 'vinyl' oder 'cd' auf den Teller legen. */
  setDiscKind(kind) {
    this.discKind = kind === 'vinyl' ? 'vinyl' : 'cd';
    this.vinyl.visible = this.discKind === 'vinyl';
    this.cd.visible = this.discKind === 'cd';
    const t = this.discKind === 'vinyl' ? TT.vinyl.t : TT.cd.t;
    this.stylusY = this.matTop + t;
    // Armhöhe an die Scheibe anpassen (Platte ist dicker als die CD)
    this.armYaw.position.y = this.stylusY + TT.arm.drop;
  }

  /** Radius der Nadel (mm) für den Fortschritt im Album (0 … 1). */
  radiusFor(progress) {
    const k = this.discKind === 'vinyl' ? TT.vinyl : TT.cd;
    return k.outer - (k.outer - k.inner) * Math.max(0, Math.min(1, progress));
  }

  /**
   * Ein Schritt der Animation.
   * state: 'play' | 'pause' | 'rest'; progress: Fortschritt im Album 0 … 1
   */
  update(dt, state, progress, { reduceMotion = false } = {}) {
    // Teller: zügig hochlaufen, langsam auslaufen
    const goal = state === 'play' ? RPM33 : 0;
    const accel = goal > this.omega ? 4.5 : 1.6;
    this.omega += Math.sign(goal - this.omega) * Math.min(Math.abs(goal - this.omega), accel * dt);
    if (reduceMotion && state !== 'play') this.omega = 0;
    this.angle = (this.angle + this.omega * dt) % (Math.PI * 2);
    this.platter.rotation.y = -this.angle; // im Uhrzeigersinn (von oben gesehen)

    // Tonarm: erst anheben, dann schwenken, dann absenken
    const psiGoal = state === 'rest' ? this.restPsi : this.psiFor(this.radiusFor(progress));
    const far = Math.abs(psiGoal - this.psi) > 0.012;
    let liftGoal = state === 'play' && !far ? 0 : 1;
    if (far && this.lift > 0.92) {
      const speed = reduceMotion ? 6 : 0.9;
      this.psi += Math.sign(psiGoal - this.psi) * Math.min(Math.abs(psiGoal - this.psi), speed * dt);
    } else if (!far) {
      this.psi += (psiGoal - this.psi) * Math.min(1, dt * 4);
    }
    if (far) liftGoal = 1;
    if (state === 'rest' && !far) liftGoal = 0; // in der Stütze ablegen
    const liftRate = reduceMotion ? 20 : liftGoal > this.lift ? 3.2 : 1.6;
    this.lift += (liftGoal - this.lift) * Math.min(1, dt * liftRate);
    this.armYaw.rotation.y = this.psi;
    // In der Stütze liegt der Arm etwas höher als auf der Platte
    const restTilt = state === 'rest' && !far ? -0.02 : 0;
    this.armPitch.rotation.x = -this.lift * 0.055 + restTilt;

    // Betriebsleuchte und Drehzahltaste
    this.mLed.color.set(state === 'play' ? 0xff3b2f : state === 'pause' ? 0x6a1a14 : 0x2a0a08);
  }

  /** Label der Schallplatte und Rillenbild setzen. */
  setVinyl(labelTexture, grooves) {
    this.mLabel.map = labelTexture ?? null;
    this.mLabel.needsUpdate = true;
    if (grooves) {
      this.mVinyl.map?.dispose?.();
      this.mVinyl.roughnessMap?.dispose?.();
      this.mVinyl.map = grooves.map;
      this.mVinyl.roughnessMap = grooves.roughnessMap;
      this.mVinyl.needsUpdate = true;
    }
  }

  setCdTexture(texture) {
    this.discMat.map = texture ?? null;
    this.discMat.color.set(texture ? 0xffffff : 0xc9ced6);
    this.discMat.needsUpdate = true;
  }

  setEnvironment(texture) {
    for (const m of [this.mWood, this.mAlu, this.mChrome, this.mSilver, this.mBlack, this.mVinyl, this.mVinylEdge, this.mCartridge, this.discMat]) {
      m.envMap = texture;
      m.needsUpdate = true;
    }
  }
}
