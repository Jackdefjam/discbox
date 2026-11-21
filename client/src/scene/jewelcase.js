// 3D-Modell einer Standard-CD-Hülle (Jewel Case, 142 × 125 × 10,4 mm) mit aufklappbarem Deckel,
// Booklet, Tray-Card mit zwei Rücken, schwarzem Tray und CD.

import * as THREE from 'three';
import { drawDiscAlpha, drawShadow } from './artgen.js';

export const MM = 0.01; // 1 mm in Szeneneinheiten
export const CASE = { W: 142, H: 125, D: 10.4, LID: 2.6, BOOK: 120, BACK_W: 138, BACK_H: 118, SPINE: 6.5 };
export const CASE_W = CASE.W * MM;
export const CASE_H = CASE.H * MM;
export const CASE_D = CASE.D * MM;

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

/** Erzeugt geteilte Geometrien und Materialien einmalig. */
export class CaseFactory {
  constructor() {
    const { W, H, D, LID, BOOK, BACK_W, BACK_H, SPINE } = CASE;
    this.geo = {
      base: new THREE.BoxGeometry(W, H, D - LID),
      lid: new THREE.BoxGeometry(W, H, LID),
      booklet: new THREE.PlaneGeometry(BOOK, BOOK),
      back: new THREE.PlaneGeometry(BACK_W, BACK_H),
      spine: new THREE.PlaneGeometry(SPINE, BACK_H),
      tray: new THREE.BoxGeometry(W - 3, H - 3, 1.2),
      hub: new THREE.CylinderGeometry(7.3, 7.5, 1.4, 40),
      disc: new THREE.RingGeometry(7.5, 60, 96, 1),
      knuckle: new THREE.CylinderGeometry(1.5, 1.5, 9, 16),
      pick: new THREE.BoxGeometry(W, H, D),
      shadow: new THREE.PlaneGeometry(1, 1)
    };
    this.geo.baseEdges = new THREE.EdgesGeometry(this.geo.base);
    this.geo.lidEdges = new THREE.EdgesGeometry(this.geo.lid);

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
    this.pickMat = new THREE.MeshBasicMaterial({ visible: false });

    this.discAlpha = new THREE.CanvasTexture(drawDiscAlpha());
    this.shadowTex = new THREE.CanvasTexture(drawShadow());
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.7 });
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
  constructor(factory) {
    const { W, H, D, LID, BOOK } = CASE;
    const f = factory;
    this.factory = f;
    this.group = new THREE.Group();
    const model = new THREE.Group();
    model.scale.setScalar(MM);
    this.group.add(model);

    // Unterteil
    const baseZ = -LID / 2;
    this.base = new THREE.Mesh(f.geo.base, f.plastic);
    this.base.position.z = baseZ;
    this.base.renderOrder = 2;
    this.baseEdges = new THREE.LineSegments(f.geo.baseEdges, f.edges);
    this.baseEdges.position.z = baseZ;

    this.backMat = paper();
    this.back = new THREE.Mesh(f.geo.back, this.backMat);
    this.back.rotation.y = Math.PI;
    this.back.position.z = -D / 2 + 0.35;

    this.spineHingeMat = paper();
    this.spineHinge = new THREE.Mesh(f.geo.spine, this.spineHingeMat);
    this.spineHinge.rotation.y = -Math.PI / 2;
    this.spineHinge.position.set(-W / 2 + 0.6, 0, -D / 2 + 0.3 + CASE.SPINE / 2);

    this.spineOtherMat = paper();
    this.spineOther = new THREE.Mesh(f.geo.spine, this.spineOtherMat);
    this.spineOther.rotation.y = Math.PI / 2;
    this.spineOther.position.set(W / 2 - 0.6, 0, -D / 2 + 0.3 + CASE.SPINE / 2);

    // Innenleben (nur sichtbar, wenn der Deckel offen ist)
    this.interior = new THREE.Group();
    this.tray = new THREE.Mesh(f.geo.tray, f.trayBlack);
    this.tray.position.z = -D / 2 + 6.0;
    // Der Tray ist auch bei geschlossener Hülle am Scharnierstreifen sichtbar
    this.hub = new THREE.Mesh(f.geo.hub, f.trayBlack);
    this.hub.rotation.x = Math.PI / 2;
    this.hub.position.z = -D / 2 + 7.0;
    this.discMat = withReflectionFade(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.38, alphaMap: f.discAlpha, alphaTest: 0.5 })
    );
    this.disc = new THREE.Mesh(f.geo.disc, this.discMat);
    this.disc.position.z = -D / 2 + 6.95;
    this.interior.add(this.hub, this.disc);
    this.interior.visible = false;

    // Deckel mit Scharnier links
    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(-W / 2, 0, D / 2 - LID);
    const lid = new THREE.Group();
    lid.position.set(W / 2, 0, LID / 2);
    this.lidShell = new THREE.Mesh(f.geo.lid, f.plastic);
    this.lidShell.renderOrder = 3;
    this.lidEdges = new THREE.LineSegments(f.geo.lidEdges, f.edges);
    this.frontMat = paper({ roughness: 0.5 });
    this.booklet = new THREE.Mesh(f.geo.booklet, this.frontMat);
    this.booklet.position.set(3, 0, LID / 2 - 0.45);
    this.inlayMat = paper({ color: 0xece7dc, roughness: 0.75 });
    this.inlay = new THREE.Mesh(f.geo.booklet, this.inlayMat);
    this.inlay.rotation.y = Math.PI;
    this.inlay.position.set(3, 0, LID / 2 - 0.55);
    this.inlay.visible = false;
    lid.add(this.lidShell, this.lidEdges, this.booklet, this.inlay);
    for (const y of [H / 2 - 6, -H / 2 + 6]) {
      const k = new THREE.Mesh(f.geo.knuckle, f.knuckleMat);
      k.position.set(-W / 2 + 1.4, y, 0);
      lid.add(k);
    }
    this.lidPivot.add(lid);

    // Unsichtbarer Körper zum Anklicken
    this.pick = new THREE.Mesh(f.geo.pick, f.pickMat);
    this.pick.userData.jewelcase = this;

    model.add(this.base, this.baseEdges, this.back, this.spineHinge, this.spineOther, this.tray, this.interior, this.lidPivot, this.pick);
    this.model = model;
    this.lid = 0;
  }

  /** Deckel öffnen: t = 0 (zu) … 1 (offen, ca. 125°). */
  setLid(t) {
    this.lid = t;
    this.lidPivot.rotation.y = -t * 2.18;
    const open = t > 0.004;
    this.interior.visible = open;
    this.inlay.visible = open;
  }

  setTray(kind) {
    const m = kind === 'clear' ? this.factory.trayClear : this.factory.trayBlack;
    this.tray.material = m;
    this.hub.material = m;
  }

  setEdgesVisible(v) {
    this.baseEdges.visible = v;
    this.lidEdges.visible = v;
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
    for (const m of [this.backMat, this.spineHingeMat, this.spineOtherMat, this.discMat, this.frontMat, this.inlayMat]) m.dispose();
  }
}
