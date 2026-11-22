// Geometrie des Standard-Jewel-Case nach dem Original (Philips, 1982).
// Maße in Millimetern, Ursprung in der Mitte der geschlossenen Hülle:
//   x – Breite 142 (Scharnier links bei −71), y – Höhe 125, z – Dicke 10,4 (Rückseite −5,2, Vorderseite +5,2)
//
// Aufbau wie beim Vorbild:
//   Unterteil  klar: Bodenplatte, Wände oben/unten/rechts, niedrige Rückenwand links, Scharnierwände
//   Deckel     klar: Frontplatte, Ränder oben/unten/rechts, verdickter Scharnierstreifen mit Fase,
//              Booklet-Anschlag, zwei Scharnierarme mit Zapfen, vier halbrunde Booklet-Halter, Rastnasen
//   Tray       schwarz: Fläche mit CD-Mulde, geriffelter Steg am Scharnier, Rosette mit 16 Zähnen,
//              zwei Rastschlitze rechts
//   Papier     Booklet 120 × 120, Tray-Card 138 × 118 mit zwei Rücken à 6,5 mm
//
// Klare Teile bekommen zwei Materialien: „clear“ für Flächen, durch die man hindurchsieht, und „rim“
// für Kanten, Stirnseiten und Fasen. Dort läuft der Blick längs durch das Plastik – sie wirken
// wie beim echten Polystyrol hell und leicht grünlich.

import * as THREE from 'three';

export const J = {
  W: 142,
  H: 125,
  D: 10.4,
  zBack: -5.2,
  zBackIn: -4.1, // Innenseite der Bodenplatte
  zSeam: 1.8, // hier treffen Deckel und Unterteil aufeinander
  zLidIn: 3.9, // Innenseite der Frontplatte
  zFront: 5.2,
  wall: 1.15, // Wände des Unterteils
  lidWall: 1.7, // Ränder des Deckels (von vorne der helle Rahmen)
  axis: { x: -70.1, z: 1.5 }, // Drehachse des Deckels (Zapfen der Scharnierarme)
  booklet: { x: 4, size: 120, z0: 3.45, z1: 3.85 },
  disc: { x: 4, r: 60, hole: 7.5, t: 1.2, z: 0 },
  inlay: { w: 138, h: 118, z0: -4.1, z1: -3.85 },
  spine: { x: 69.15, w: 6.5, h: 118, zc: -0.85 },
  tray: { top: 1.6, blockTop: 2.6, wellR: 60.4, floor: -1.0, bottom: -3.85 }
};

// ---------- Hilfsfunktionen ----------

const v2 = (x, y) => new THREE.Vector2(x, y);

function arc(cx, cy, r, a0, a1, seg) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push(v2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/** Rechteck mit (je Ecke wählbar) gerundeten Ecken, gegen den Uhrzeigersinn. */
function roundedRect(x0, y0, x1, y1, r, seg = 5) {
  const R = typeof r === 'number' ? { bl: r, br: r, tr: r, tl: r } : r;
  const corner = (cx, cy, rad, a0) => (rad > 0.001 ? arc(cx, cy, rad, a0, a0 + Math.PI / 2, seg) : [v2(cx, cy)]);
  return [
    ...corner(x1 - R.br, y0 + R.br, R.br, -Math.PI / 2),
    ...corner(x1 - R.tr, y1 - R.tr, R.tr, 0),
    ...corner(x0 + R.tl, y1 - R.tl, R.tl, Math.PI / 2),
    ...corner(x0 + R.bl, y0 + R.bl, R.bl, Math.PI)
  ];
}

/** Umlaufender Rand, links offen (dort sitzt das Scharnier); außen rechts gerundet. */
function openRim(xLeft, wall, r) {
  const hw = J.W / 2;
  const hh = J.H / 2;
  return [
    v2(xLeft, hh),
    ...arc(hw - r, hh - r, r, Math.PI / 2, 0, 5),
    ...arc(hw - r, -hh + r, r, 0, -Math.PI / 2, 5),
    v2(xLeft, -hh),
    v2(xLeft, -hh + wall),
    v2(hw - wall, -hh + wall),
    v2(hw - wall, hh - wall),
    v2(xLeft, hh - wall)
  ];
}

/** Fläche in der x-y-Ebene, von z0 bis z1 extrudiert (Fase wird nach außen angesetzt). */
function extrude(shapeOrPoints, z0, z1, { bevel = 0, bevelSegments = 2, curveSegments = 12, holes = [] } = {}) {
  const shape = shapeOrPoints instanceof THREE.Shape ? shapeOrPoints : new THREE.Shape(shapeOrPoints);
  for (const h of holes) shape.holes.push(h instanceof THREE.Path ? h : new THREE.Path(h));
  const depth = Math.max(0.01, z1 - z0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? bevelSegments : 0
  });
  g.translate(0, 0, z0 + bevel);
  return g;
}

/** Profil in der x-z-Ebene (Punkte als x, z), entlang y von y0 bis y1 gezogen. */
function extrudeXZ(points, y0, y1, opts) {
  const g = extrude(points, 0, y1 - y0, opts);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)); // (x, y, z) → (x, −z, y)
  g.translate(0, y1, 0);
  return g;
}

/** Vollkreis als Punktliste (ohne doppelten Endpunkt). */
const circle = (cx, cy, r, seg) => arc(cx, cy, r, 0, Math.PI * 2, seg).slice(0, -1);

function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function circlePath(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
}

/**
 * Sammelt Teile und sortiert ihre Dreiecke nach Material. Eine Funktion entscheidet je Dreieck
 * anhand der Flächennormale (und Lage), welches Material es bekommt – oder null zum Weglassen
 * (verdeckte Flächen).
 */
class Parts {
  constructor() {
    this.buckets = new Map();
  }

  /**
   * tint: Vertexfarbe [r, g, b, a] als Faktor auf das Material, z. B. dunklerer Steg am Tray oder
   * kräftigere Lichtkanten (a) bei den Plastikkanten. Eine Zahl gilt als Helligkeit.
   */
  add(geometry, classify, tint = 1, { flip = false } = {}) {
    const tt = typeof tint === 'number' ? [tint, tint, tint, 1] : tint;
    if (tt.some((v) => v !== 1)) this.tinted = true;
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    if (flip) {
      // Innenseite nach außen kehren (z. B. Wand einer Mulde): Reihenfolge der Ecken tauschen, Normalen umdrehen
      for (let i = 0; i < pos.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const a = pos[i + 3 + k];
          pos[i + 3 + k] = pos[i + 6 + k];
          pos[i + 6 + k] = a;
          const b = nor[i + 3 + k];
          nor[i + 3 + k] = nor[i + 6 + k];
          nor[i + 6 + k] = b;
        }
      }
      for (let i = 0; i < nor.length; i++) nor[i] = -nor[i];
    }
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 9) {
      a.fromArray(pos, i);
      b.fromArray(pos, i + 3);
      c.fromArray(pos, i + 6);
      n.subVectors(c, b).cross(t.subVectors(a, b));
      if (n.lengthSq() < 1e-12) continue; // entartetes Dreieck
      n.normalize();
      t.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const key = typeof classify === 'function' ? classify(n, t) : classify;
      if (!key) continue;
      let bucket = this.buckets.get(key);
      if (!bucket) this.buckets.set(key, (bucket = { pos: [], nor: [], col: [] }));
      for (let k = 0; k < 9; k++) {
        bucket.pos.push(pos[i + k]);
        bucket.nor.push(nor[i + k]);
      }
      for (let k = 0; k < 3; k++) bucket.col.push(...tt);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
    return this;
  }

  /** Eine Geometrie mit einer Gruppe je Material (Reihenfolge = Materialindex). */
  build(keys) {
    let total = 0;
    for (const k of keys) total += this.buckets.get(k)?.pos.length ?? 0;
    const pos = new Float32Array(total);
    const nor = new Float32Array(total);
    const col = this.tinted ? new Float32Array((total / 3) * 4) : null;
    const geo = new THREE.BufferGeometry();
    let o = 0;
    keys.forEach((key, mi) => {
      const bucket = this.buckets.get(key);
      if (!bucket) return;
      pos.set(bucket.pos, o);
      nor.set(bucket.nor, o);
      col?.set(bucket.col, (o / 3) * 4);
      geo.addGroup(o / 3, bucket.pos.length / 3, mi);
      o += bucket.pos.length;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

// Deckkraft der hellen Kanten (Vertexalpha): normale Stirnseiten zart, Lichtlinien kräftig
const RIM = [1, 1, 1, 0.3];
const LINE = [1, 1, 1, 0.7];

// Zuordnung der Flächen klarer Teile
const plate = (n) => (Math.abs(n.z) > 0.9 ? 'clear' : 'rim'); // Platten: Flächen klar, Kanten hell
const wallZ = (n) => (Math.abs(n.z) > 0.9 ? 'rim' : 'clear'); // Wände: Seiten klar, Stirnseiten hell
const flatY = (n) => (Math.abs(n.y) > 0.9 ? 'clear' : 'rim'); // Scharnierarme (liegen in der x-z-Ebene)

// ---------- Deckel ----------

function buildLid() {
  const { axis: A, zSeam, zLidIn, zFront, wall, lidWall } = J;
  const hw = J.W / 2;
  const hh = J.H / 2;
  const p = new Parts();
  const bv = 0.35;

  // Frontplatte (1,3 mm) mit gerundeten Ecken und Fase
  p.add(extrude(roundedRect(-hw + bv, -hh + bv, hw - bv, hh - bv, 0.65), zLidIn, zFront, { bevel: bv }), plate, [1, 1, 1, 0.45]);

  // Ränder oben, unten, rechts (Stirnseite links stößt an die Scharnierarme: innen, entfällt)
  p.add(extrude(openRim(-64.5, lidWall, 1.0), zSeam, zLidIn), (n, c) => (n.x < -0.9 && c.x < -64.4 ? null : wallZ(n)), RIM);

  // Scharnierarme oben und unten mit rundem Ende um die Drehachse
  const arm = [
    v2(-hw + 0.05, zLidIn),
    v2(-64.5, zLidIn),
    v2(-64.5, zSeam),
    v2(A.x + 0.85, A.z),
    ...arc(A.x, A.z, 0.85, 0, -Math.PI, 10).slice(1)
  ];
  const armCls = (n, c) => (n.x > 0.9 && c.x > -64.6 ? null : flatY(n)); // Anschluss an den Rand: innen
  p.add(extrudeXZ(arm, hh - wall, hh), armCls, RIM);
  p.add(extrudeXZ(arm, -hh, -hh + wall), armCls, RIM);
  // Zapfen (sitzen in den Scharnierwänden des Unterteils)
  for (const s of [1, -1]) {
    const pin = new THREE.CylinderGeometry(0.62, 0.62, 2.1, 18);
    pin.translate(A.x, s * (hh - wall - 0.8), A.z);
    p.add(pin, 'rim', LINE);
  }

  // Verdickter Scharnierstreifen; die Fase rechts erscheint von vorne als heller Strich
  const strip = [v2(-69.6, zLidIn), v2(-57.7, zLidIn), v2(-58.2, 3.0), v2(-68.7, 3.0)];
  p.add(
    extrudeXZ(strip, -hh + wall, hh - wall),
    (n) => (n.z > 0.95 || Math.abs(n.y) > 0.9 ? null : n.z < -0.95 ? 'clear' : 'rim'),
    LINE
  );

  // Booklet-Anschlag: schmale Rippe, zweiter heller Strich
  const rib = [v2(-56.95, zLidIn), v2(-56.45, zLidIn), v2(-56.7, 3.2)];
  p.add(extrudeXZ(rib, -58.5, 58.5), (n) => (n.z > 0.9 ? null : 'rim'), LINE);

  // Vier halbrunde Booklet-Halter („half moons“), je zwei oben und unten
  for (const xc of [J.booklet.x - 41.3, J.booklet.x + 41.3]) {
    // Fase an der Rundung: von vorne als heller Halbkreis zu sehen
    const top = arc(xc, hh - lidWall, 4.5, Math.PI, 2 * Math.PI, 12);
    const bottom = arc(xc, -hh + lidWall, 4.5, 0, Math.PI, 12);
    for (const pts of [top, bottom]) {
      p.add(
        extrude(pts, 3.0, 3.4, { bevel: 0.12, bevelSegments: 1 }),
        (n, c) => (Math.abs(n.y) > 0.9 && Math.abs(c.y) > hh - lidWall - 0.2 ? null : plate(n)),
        LINE
      );
    }
  }

  // Rastnasen innen am rechten Rand
  for (const y0 of [36.4, -36.4]) {
    const nub = [v2(hw - lidWall + 0.1, y0 - 1.3), v2(hw - lidWall + 0.1, y0 + 1.3), v2(hw - lidWall - 0.8, y0)];
    p.add(extrude(nub, 2.0, zLidIn - 0.1, { bevel: 0.1, bevelSegments: 1 }), (n, c) => (n.x > 0.9 && c.x > hw - lidWall ? null : 'rim'), LINE);
  }

  return p.build(['clear', 'rim']);
}

// ---------- Unterteil ----------

function buildBase() {
  const { zBack, zBackIn, zSeam, wall } = J;
  const hw = J.W / 2;
  const hh = J.H / 2;
  const p = new Parts();
  const bv = 0.35;

  // Bodenplatte
  p.add(extrude(roundedRect(-hw + bv, -hh + bv, hw - bv, hh - bv, 0.65), zBack, zBackIn, { bevel: bv }), plate, [1, 1, 1, 0.45]);
  // Wände oben, rechts, unten
  p.add(extrude(openRim(-61.8, wall, 1.0), zBackIn, zSeam), (n, c) => (n.x < -0.9 && c.x < -61.7 ? null : wallZ(n)), RIM);
  // Innen liegende Stoßflächen der Wandstücke weglassen
  const joint = (n, c) => ((n.x > 0.9 && c.x > -61.9) || (n.x > 0.9 && Math.abs(c.x + 64.3) < 0.05) ? null : wallZ(n));
  for (const s of [1, -1]) {
    const y = (a, b) => (s > 0 ? [a, b] : [-b, -a]);
    // Scharnierwände (eingerückt, außen laufen die Arme des Deckels)
    p.add(box(-hw, -61.8, ...y(hh - wall - 1.15, hh - wall), zBackIn, zSeam), joint, RIM);
    // Außenwand unter dem Scharnierarm (niedriger, damit der Arm frei drehen kann)
    p.add(box(-hw, -64.3, ...y(hh - wall, hh), zBackIn, 0.4), joint, RIM);
    p.add(box(-64.3, -61.8, ...y(hh - wall, hh), zBackIn, zSeam), joint, RIM);
  }
  // Niedrige Rückenwand links: dahinter sitzt der Rücken der Tray-Card. Oberkante klar, damit der
  // schwarze Steg von vorne bis an den Rand reicht (wie beim Original)
  const yIn = hh - wall - 1.15;
  p.add(box(-hw, -hw + wall, -yIn, yIn, zBackIn, 1.0), (n) => (Math.abs(n.y) > 0.9 ? null : 'clear'));

  return p.build(['clear', 'rim']);
}

// ---------- Tray ----------

function buildTray() {
  const { tray: T, disc } = J;
  const p = new Parts();
  const cx = disc.x;

  // Trayfläche mit Öffnung für die CD-Mulde und zwei Rastschlitzen rechts. Die senkrechte Wand der
  // Mulde entfällt hier: sie kommt schräg (Entformungsschräge wie beim Spritzguss) mit dem Innenleben.
  // Unterseite und innen liegende Stoßfläche zum Steg sind nie zu sehen und entfallen ebenfalls.
  const bv = 0.25;
  const slot = (y0, y1) => roundedRect(66.3 - bv, y0 - bv, 67.3 + bv, y1 + bv, 0.5 + bv, 3);
  const wellWall = (n, c) => Math.abs(n.z) < 0.1 && Math.hypot(c.x - cx, c.y) < T.wellR + 0.6;
  p.add(
    extrude(roundedRect(-58.2 + bv, -61.25 + bv, 68.9 - bv, 61.25 - bv, 1.2 - bv), T.bottom, T.top, {
      bevel: bv,
      curveSegments: 32,
      holes: [circlePath(cx, 0, T.wellR + bv), slot(19.8, 41.5), slot(-41.5, -19.8)]
    }),
    (n, c) => (n.z < -0.9 || wellWall(n, c) || (n.x < -0.9 && c.x < -57.9) ? null : 'black')
  );

  // Geriffelter Steg am Scharnier (von vorne der schwarze Streifen links), tiefschwarz glänzend
  const sb = 0.2;
  const dark = 0.45;
  p.add(
    extrude(roundedRect(-68.9 + sb, -59.6 + sb, -58.2 - sb, 59.6 - sb, { bl: 0.3, br: 1.4, tr: 1.4, tl: 0.3 }), T.bottom, T.blockTop, {
      bevel: sb
    }),
    (n) => (n.z < -0.9 ? null : 'black'),
    dark
  );
  // Dünne Abdeckung über dem Rücken der Tray-Card: von vorne reicht der schwarze Steg bis an den Rand
  p.add(box(-70.5, -68.7, -59.6, 59.6, 2.42, T.blockTop), (n) => (n.z < -0.9 ? null : 'black'), dark);
  const ridges = 14;
  for (let i = 0; i < ridges; i++) {
    const x = -69.95 + (i * 11.05) / (ridges - 1);
    const prof = [v2(x - 0.3, T.blockTop), v2(x + 0.3, T.blockTop), v2(x, T.blockTop + 0.16)];
    p.add(extrudeXZ(prof, -58.4, 58.4), (n) => (n.z < -0.9 ? null : 'black'), dark);
  }

  return p.build(['black']);
}

/** Mulde mit Boden, Auflagering und Rosette – nur bei geöffnetem Deckel zu sehen. */
function buildWell() {
  const { tray: T, disc } = J;
  const p = new Parts();
  const cx = disc.x;
  const rFloor = T.wellR - 0.9;

  // Schräge Wand der Mulde (oben an die Fase der Trayfläche anschließend), Innenseite sichtbar
  const top = T.top - 0.25;
  const wall = new THREE.CylinderGeometry(T.wellR, rFloor, top - T.floor, 128, 1, true);
  wall.rotateX(Math.PI / 2); // Achse entlang z, obere Kante bei +z
  wall.translate(cx, 0, (top + T.floor) / 2);
  p.add(wall, 'black', 1, { flip: true });

  // Boden
  const floor = new THREE.CircleGeometry(rFloor + 0.05, 128);
  floor.translate(cx, 0, T.floor);
  p.add(floor, 'black');

  // Auflagering für die CD
  const ring = (r0, r1, z0, z1) => extrude(circle(cx, 0, r1, 64), z0, z1, { holes: [circle(cx, 0, r0, 64)] });
  p.add(ring(11.5, 16.5, T.floor, -0.6), (n) => (n.z < -0.9 ? null : 'black'));
  // Rosette: Kranz, 16 Zähne, Mittelknopf
  p.add(ring(7.2, 7.6, T.floor, -0.25), (n) => (n.z < -0.9 ? null : 'black'));
  for (let i = 0; i < 16; i++) {
    const tooth = new THREE.BoxGeometry(4.2, 0.95, 1.35);
    tooth.translate(5.15, 0, T.floor + 0.675);
    tooth.rotateZ((i / 16) * Math.PI * 2);
    tooth.translate(cx, 0, 0);
    // Zähne etwas heller: Sie glänzen im CD-Loch wie beim Original als graue Speichen
    p.add(tooth, (n) => (n.z < -0.9 ? null : 'black'), 1.9);
  }
  const knob = new THREE.CylinderGeometry(3.2, 3.2, 1.45, 28);
  knob.rotateX(Math.PI / 2);
  knob.translate(cx, 0, T.floor + 0.725);
  p.add(knob, (n) => (n.z < -0.9 ? null : 'black'), 1.6);

  return p.build(['black']);
}

// ---------- Papier ----------

/** Dünner Quader; Gruppen: Kanten, Oberseite (+z), Unterseite (−z). mergeTop: Kanten und Oberseite in einer Gruppe. */
function paperBox(w, h, t, mergeTop = false) {
  const g = new THREE.BoxGeometry(w, h, t);
  g.clearGroups();
  // Reihenfolge der Flächen in BoxGeometry: +x, −x, +y, −y, +z, −z (je 6 Indizes)
  if (mergeTop) {
    g.addGroup(0, 30, 0);
    g.addGroup(30, 6, 1);
  } else {
    g.addGroup(0, 24, 0);
    g.addGroup(24, 6, 1);
    g.addGroup(30, 6, 2);
  }
  return g;
}

export function buildJewelGeometry() {
  const { booklet, inlay, spine, disc } = J;
  const discTop = new THREE.RingGeometry(disc.hole, disc.r, 128, 1);
  const discBottom = new THREE.RingGeometry(disc.hole, disc.r, 128, 1);
  discBottom.rotateY(Math.PI);
  const discEdge = new THREE.CylinderGeometry(disc.r, disc.r, disc.t, 128, 1, true);
  discEdge.rotateX(Math.PI / 2);
  return {
    lid: buildLid(),
    base: buildBase(),
    tray: buildTray(),
    well: buildWell(),
    booklet: paperBox(booklet.size, booklet.size, booklet.z1 - booklet.z0),
    inlay: paperBox(inlay.w, inlay.h, inlay.z1 - inlay.z0, true),
    spine: new THREE.PlaneGeometry(spine.w, spine.h),
    discTop,
    discBottom,
    discEdge,
    pick: new THREE.BoxGeometry(J.W, J.H, J.D)
  };
}
