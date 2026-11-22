// 3D-Modelle für CD-Verpackungen:
//   jewel   – Standard-Jewel-Case 142 × 125 × 10,4 mm (Booklet, Tray-Card mit zwei Rücken, schwarzer Tray)
//   slim    – Slim-Case 142 × 125 × 5,2 mm (dünn, ohne bedruckte Rücken)
//   double  – Doppel-CD-Hülle 142 × 125 × 22 mm mit Klapp-Tray (CD 1 oben, CD 2 unten)
//   digipak – Pappklappe 139,7 × 125,5 × 7,5 mm mit eingeklebtem Tray, öffnet wie ein Buch
// Alle Varianten haben dieselbe Schnittstelle (Materialien, setLid, pick …), damit das Karussell
// sie austauschen kann.

import * as THREE from 'three';
import { drawDiscAlpha, drawFavSticker, drawShadow } from './artgen.js';

export const MM = 0.01; // 1 mm in Szeneneinheiten
export const CASE = { W: 142, H: 125, D: 10.4, LID: 2.6, BOOK: 120, BACK_W: 138, BACK_H: 118, SPINE: 6.5 };
export const CASE_W = CASE.W * MM;
export const CASE_H = CASE.H * MM;
export const CASE_D = CASE.D * MM;

export const VARIANTS = {
  jewel: { id: 'jewel', label: 'Jewel-Case', W: 142, H: 125, D: 10.4, LID: 2.6, spineW: 6.5, spineH: 118, open: 2.18 },
  slim: { id: 'slim', label: 'Slim-Case', W: 142, H: 125, D: 5.2, LID: 1.6, spineW: 0, spineH: 118, open: 2.18 },
  double: { id: 'double', label: 'Doppel-CD', W: 142, H: 125, D: 22, LID: 2.6, spineW: 17.5, spineH: 118, open: 2.18 },
  digipak: { id: 'digipak', label: 'Digipak', W: 139.7, H: 125.5, D: 7.5, LID: 1.2, spineW: 7.5, spineH: 125.5, open: 2.75 }
};
export const VARIANT_ORDER = ['jewel', 'slim', 'double', 'digipak'];
export const variantDepth = (id) => (VARIANTS[id] ?? VARIANTS.jewel).D * MM;

/** Gemeinsame Uniforms: Im Spiegel-Durchgang blenden Objekte mit der Höhe aus (klassischer Coverflow-Look). */
export const reflectionUniforms = { uReflPass: { value: 0 }, uReflFade: { value: 0.62 } };

export function withReflectionFade(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReflPass = reflectionUniforms.uReflPass;
    shader.uniforms.uReflFade = reflectionUniforms.uReflFade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vReflY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vReflY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vReflY;\nuniform float uReflPass;\nuniform float uReflFade;')
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n gl_FragColor.a *= mix(1.0, clamp(1.0 - vReflY / uReflFade, 0.0, 1.0), uReflPass);'
      );
  };
  material.customProgramCacheKey = () => 'discbox-reflfade';
  return material;
}

/** Erzeugt geteilte Geometrien und Materialien einmalig (je Variante zwischengespeichert). */
export class CaseFactory {
  constructor() {
    this.geoCache = new Map();
    this.plastic = withReflectionFade(
      new THREE.MeshPhysicalMaterial({
        // Schwarz + additiv: Die Hülle legt nur Glanz und Spiegelungen über das Cover, keinen Schleier
        color: 0x000000,
        roughness: 0.12,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.08,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        envMapIntensity: 1.0
      })
    );
    this.edges = withReflectionFade(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }));
    this.trayBlack = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.32, metalness: 0.05 }));
    this.trayClear = withReflectionFade(
      new THREE.MeshPhysicalMaterial({ color: 0xd8dde4, roughness: 0.15, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.knuckleMat = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.3 }));
    this.cardEdge = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.95 }));
    this.cardInner = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.9 }));
    this.pickMat = new THREE.MeshBasicMaterial({ visible: false });

    this.discAlpha = new THREE.CanvasTexture(drawDiscAlpha());
    this.shadowTex = new THREE.CanvasTexture(drawShadow());
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.7 });
    this.geo = { shadow: new THREE.PlaneGeometry(1, 1), sticker: new THREE.CircleGeometry(6.5, 40) };
    const stickerTex = new THREE.CanvasTexture(drawFavSticker());
    stickerTex.colorSpace = THREE.SRGBColorSpace;
    this.stickerMat = withReflectionFade(new THREE.MeshStandardMaterial({ map: stickerTex, roughness: 0.35, metalness: 0.15 }));
  }

  /** Geometrien einer Variante (einmal erzeugt, von allen Hüllen geteilt). */
  geometry(v) {
    if (this.geoCache.has(v.id)) return this.geoCache.get(v.id);
    const { W, H, D, LID } = v;
    const g = {
      booklet: new THREE.PlaneGeometry(CASE.BOOK, CASE.BOOK),
      back: new THREE.PlaneGeometry(CASE.BACK_W, CASE.BACK_H),
      spine: new THREE.PlaneGeometry(Math.max(v.spineW, 0.1), v.spineH),
      tray: new THREE.BoxGeometry(W - 3, H - 3, 1.2),
      hub: new THREE.CylinderGeometry(7.3, 7.5, 1.4, 40),
      disc: new THREE.RingGeometry(7.5, 60, 96, 1),
      knuckle: new THREE.CylinderGeometry(1.5, 1.5, 9, 16),
      pick: new THREE.BoxGeometry(W, H, D)
    };
    if (v.id === 'digipak') {
      g.panel = new THREE.BoxGeometry(W, H, LID);
      g.spinePanel = new THREE.BoxGeometry(LID, H, D);
      g.tray = new THREE.BoxGeometry(W - 8, H - 6, D - 2 * LID - 0.6);
    } else {
      g.base = new THREE.BoxGeometry(W, H, D - LID);
      g.lid = new THREE.BoxGeometry(W, H, LID);
      g.baseEdges = new THREE.EdgesGeometry(g.base);
      g.lidEdges = new THREE.EdgesGeometry(g.lid);
      if (v.id === 'double') g.flip = new THREE.BoxGeometry(W - 6, H - 4, 1.2);
    }
    this.geoCache.set(v.id, g);
    return g;
  }

  setEdgeColor(hex) {
    this.edges.color.set(hex);
  }

  /** Eigene Umgebung nur für die Spiegelungen auf dem Plastik. */
  setCaseEnvironment(texture) {
    this.plastic.envMap = texture;
    this.plastic.needsUpdate = true;
  }
}

const paper = (opts = {}) =>
  withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.62, metalness: 0, ...opts }));

export class JewelCase {
  constructor(factory, variant = 'jewel') {
    const v = VARIANTS[variant] ?? VARIANTS.jewel;
    this.variant = v.id;
    this.spec = v;
    this.factory = factory;
    this.group = new THREE.Group();
    const model = new THREE.Group();
    model.scale.setScalar(MM);
    this.group.add(model);
    this.model = model;
    this.lid = 0;

    // Materialien mit Bildern (je Hülle eigene)
    const digi = v.id === 'digipak';
    this.frontMat = paper({ roughness: digi ? 0.82 : 0.5 });
    this.backMat = paper({ roughness: digi ? 0.85 : 0.62 });
    this.spineHingeMat = paper({ roughness: digi ? 0.85 : 0.62 });
    this.spineOtherMat = paper();
    this.inlayMat = paper({ color: 0xece7dc, roughness: 0.75 });
    this.discMat = withReflectionFade(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.38, alphaMap: factory.discAlpha, alphaTest: 0.5 })
    );

    /** Seitenverhältnisse der bedruckten Flächen (für das Zuschneiden der Bilder). */
    this.frontAspect = digi ? v.W / v.H : 1;
    this.backAspect = digi ? v.W / v.H : CASE.BACK_W / CASE.BACK_H;
    this.hasSpines = v.spineW > 0;

    if (digi) this.#buildDigipak(v);
    else this.#buildPlastic(v);

    // Unsichtbarer Körper zum Anklicken
    this.pick = new THREE.Mesh(factory.geometry(v).pick, factory.pickMat);
    this.pick.userData.jewelcase = this;
    model.add(this.pick);
  }

  #buildPlastic(v) {
    const f = this.factory;
    const g = f.geometry(v);
    const { W, H, D, LID } = v;
    const model = this.model;
    const slim = v.id === 'slim';
    const double = v.id === 'double';

    // Unterteil
    const baseZ = -LID / 2;
    this.base = new THREE.Mesh(g.base, f.plastic);
    this.base.position.z = baseZ;
    this.base.renderOrder = 2;
    this.baseEdges = new THREE.LineSegments(g.baseEdges, f.edges);
    this.baseEdges.position.z = baseZ;
    model.add(this.base, this.baseEdges);

    if (!slim) {
      this.back = new THREE.Mesh(g.back, this.backMat);
      this.back.rotation.y = Math.PI;
      this.back.position.z = -D / 2 + 0.35;
      const spineZ = -D / 2 + 0.3 + v.spineW / 2;
      this.spineHinge = new THREE.Mesh(g.spine, this.spineHingeMat);
      this.spineHinge.rotation.y = -Math.PI / 2;
      this.spineHinge.position.set(-W / 2 + 0.6, 0, spineZ);
      this.spineOther = new THREE.Mesh(g.spine, this.spineOtherMat);
      this.spineOther.rotation.y = Math.PI / 2;
      this.spineOther.position.set(W / 2 - 0.6, 0, spineZ);
      model.add(this.back, this.spineHinge, this.spineOther);
    }

    // Tray (bei Slim flacher, bei der Doppel-CD ganz unten)
    // Beim Slim-Case ist der schwarze Tray zugleich die Rückwand
    this.tray = new THREE.Mesh(g.tray, f.trayBlack);
    const trayTop = slim ? -D / 2 + 1.6 : -D / 2 + 6.6;
    this.tray.position.z = trayTop - 0.6;
    model.add(this.tray);

    // Innenleben (nur sichtbar, wenn der Deckel offen ist)
    this.interior = new THREE.Group();
    this.hub = new THREE.Mesh(g.hub, f.trayBlack);
    this.hub.rotation.x = Math.PI / 2;
    this.hub.position.z = trayTop + 0.4;
    this.disc = new THREE.Mesh(g.disc, this.discMat);
    this.disc.position.z = trayTop + 0.35;
    this.interior.add(this.hub, this.disc);

    if (double) {
      // Klapp-Tray mit CD 1, am Scharnier gelagert; darunter liegt CD 2
      this.flipPivot = new THREE.Group();
      this.flipPivot.position.set(-W / 2 + 3, 0, D / 2 - LID - 3.2);
      const flip = new THREE.Group();
      flip.position.set(W / 2 - 3, 0, 0);
      const flipTray = new THREE.Mesh(g.flip, f.trayBlack);
      const hub1 = new THREE.Mesh(g.hub, f.trayBlack);
      hub1.rotation.x = Math.PI / 2;
      hub1.position.z = 1.0;
      this.disc1 = new THREE.Mesh(g.disc, this.discMat);
      this.disc1.position.z = 0.95;
      flip.add(flipTray, hub1, this.disc1);
      this.flipPivot.add(flip);
      this.interior.add(this.flipPivot);
      // CD 2 bekommt ein eigenes Material (eigener Aufdruck „CD 2“)
      this.disc2Mat = this.discMat.clone();
      this.disc.material = this.disc2Mat;
      this.disc2 = this.disc;
    }
    this.interior.visible = false;
    model.add(this.interior);

    // Deckel mit Scharnier links
    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(-W / 2, 0, D / 2 - LID);
    const lid = new THREE.Group();
    lid.position.set(W / 2, 0, LID / 2);
    this.lidShell = new THREE.Mesh(g.lid, f.plastic);
    this.lidShell.renderOrder = 3;
    this.lidEdges = new THREE.LineSegments(g.lidEdges, f.edges);
    this.booklet = new THREE.Mesh(g.booklet, this.frontMat);
    this.booklet.position.set(3, 0, LID / 2 - Math.min(0.45, LID / 3));
    this.inlay = new THREE.Mesh(g.booklet, this.inlayMat);
    this.inlay.rotation.y = Math.PI;
    this.inlay.position.set(3, 0, LID / 2 - Math.min(0.55, LID / 2.5));
    this.inlay.visible = false;
    lid.add(this.lidShell, this.lidEdges, this.booklet, this.inlay);
    // Favoriten-Aufkleber außen auf dem Deckel (oben rechts)
    this.sticker = new THREE.Mesh(f.geo.sticker, f.stickerMat);
    this.sticker.position.set(W / 2 - 12, H / 2 - 11, LID / 2 + 0.08);
    this.sticker.visible = false;
    lid.add(this.sticker);
    if (!slim) {
      for (const y of [H / 2 - 6, -H / 2 + 6]) {
        const k = new THREE.Mesh(g.knuckle, f.knuckleMat);
        k.position.set(-W / 2 + 1.4, y, 0);
        lid.add(k);
      }
    }
    this.lidPivot.add(lid);
    model.add(this.lidPivot);
  }

  #buildDigipak(v) {
    const f = this.factory;
    const g = f.geometry(v);
    const { W, D, LID } = v;
    const model = this.model;
    // BoxGeometry-Flächen: [+x, -x, +y, -y, +z, -z]
    const edge = f.cardEdge;

    // Rückseite (rechte Innenseite trägt den Tray)
    this.backPanel = new THREE.Mesh(g.panel, [edge, edge, edge, edge, f.cardInner, this.backMat]);
    this.backPanel.position.z = -D / 2 + LID / 2;
    // Rücken aus Pappe auf der Scharnierseite
    this.spinePanel = new THREE.Mesh(g.spinePanel, [f.cardInner, this.spineHingeMat, edge, edge, edge, edge]);
    this.spinePanel.position.set(-W / 2 + LID / 2, 0, 0);
    this.tray = new THREE.Mesh(g.tray, f.trayBlack);
    const trayTop = -D / 2 + LID + (D - 2 * LID - 0.6);
    this.tray.position.set(2, 0, trayTop - (D - 2 * LID - 0.6) / 2);
    model.add(this.backPanel, this.spinePanel, this.tray);

    this.interior = new THREE.Group();
    this.hub = new THREE.Mesh(g.hub, f.trayBlack);
    this.hub.rotation.x = Math.PI / 2;
    this.hub.position.set(2, 0, trayTop - 0.2);
    this.disc = new THREE.Mesh(g.disc, this.discMat);
    this.disc.position.set(2, 0, trayTop + 0.25);
    this.interior.add(this.hub, this.disc);
    this.interior.visible = false;
    model.add(this.interior);

    // Vorderklappe: außen Cover, innen Booklet-Seite; dreht um die Kante am Rücken
    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(-W / 2, 0, D / 2);
    const front = new THREE.Mesh(g.panel, [edge, edge, edge, edge, this.frontMat, this.inlayMat]);
    front.position.set(W / 2, 0, -LID / 2);
    this.lidPivot.add(front);
    this.sticker = new THREE.Mesh(f.geo.sticker, f.stickerMat);
    this.sticker.position.set(W - 10, v.H / 2 - 10, 0.08);
    this.sticker.visible = false;
    this.lidPivot.add(this.sticker);
    model.add(this.lidPivot);
    this.inlay = { visible: false };
  }

  /** Deckel öffnen: t = 0 (zu) … 1 (offen). tray: Klapp-Tray der Doppel-CD umklappen (0 … 1). */
  setLid(t, tray = 0) {
    this.lid = t;
    this.lidPivot.rotation.y = -t * this.spec.open;
    if (this.flipPivot) this.flipPivot.rotation.y = -Math.min(tray, t) * 1.9;
    const open = t > 0.004;
    this.interior.visible = open;
    this.inlay.visible = open;
  }

  setFavorite(on) {
    this.sticker.visible = !!on;
  }

  /** Meshes der CDs (für das Drehen beim Abspielen). */
  get discs() {
    return this.disc1 ? [this.disc1, this.disc2] : [this.disc];
  }

  setTray(kind) {
    const m = kind === 'clear' && this.variant !== 'digipak' ? this.factory.trayClear : this.factory.trayBlack;
    this.tray.material = m;
    this.hub.material = m;
  }

  setEdgesVisible(v) {
    if (this.baseEdges) this.baseEdges.visible = v;
    if (this.lidEdges) this.lidEdges.visible = v;
  }

  /** Setzt eine Textur auf ein Material (oder Farbe, wenn keine Textur). */
  static apply(material, texture, fallbackColor) {
    if (texture) {
      material.map = texture;
      material.color.set(0xffffff);
    } else {
      material.map = null;
      if (fallbackColor) material.color.set(fallbackColor);
    }
    material.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.backMat, this.spineHingeMat, this.spineOtherMat, this.discMat, this.disc2Mat, this.frontMat, this.inlayMat]) m?.dispose();
  }
}
