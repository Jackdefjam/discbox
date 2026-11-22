// 3D-Modell des Standard-Jewel-Case (142 × 125 × 10,4 mm) nach dem Original:
// klares Unterteil und klarer Deckel mit Scharnier, schwarzer Tray mit geriffeltem Steg und Rosette,
// Booklet unter dem Deckel, Tray-Card mit zwei Rücken. Die Geometrie steht in casegeometry.js.

import * as THREE from 'three';
import { drawDiscAlpha, drawFavSticker, drawShadow } from './artgen.js';
import { J, buildJewelGeometry } from './casegeometry.js';

export const MM = 0.01; // 1 mm in Szeneneinheiten
export const CASE = { W: 142, H: 125, D: 10.4, BOOK: 120, BACK_W: 138, BACK_H: 118, SPINE: 6.5 };
export const CASE_W = CASE.W * MM;
export const CASE_H = CASE.H * MM;
export const CASE_D = CASE.D * MM;

/** Kenndaten der Hülle (für Ansicht und Rücken). open: Öffnungswinkel des Deckels. */
export const SPEC = { id: 'jewel', label: 'Jewel-Case', W: CASE.W, H: CASE.H, D: CASE.D, spineW: CASE.SPINE, spineH: CASE.BACK_H, open: 2.18 };

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

// Grundfarbe der Plastikkanten: Polystyrol wirkt an Kanten hell mit einem Hauch Grün
const RIM_BASE = new THREE.Color(0xd2dfdb);

/** Erzeugt geteilte Geometrien und Materialien einmalig. */
export class CaseFactory {
  constructor() {
    // Klare Flächen: Schwarz + additiv – die Hülle legt nur Glanz und Spiegelungen über das Cover, keinen Schleier
    this.plastic = withReflectionFade(
      new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        roughness: 0.1,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.06,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        envMapIntensity: 1.0
      })
    );
    // Kanten, Stirnseiten, Fasen: dort sieht man längs ins Plastik – hell, glasig, leicht getönt
    this.rim = withReflectionFade(
      new THREE.MeshPhysicalMaterial({
        color: RIM_BASE.clone(),
        roughness: 0.16,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        transparent: true,
        vertexColors: true, // Deckkraft je Bauteil (Vertexalpha): zarte Stirnseiten, kräftige Lichtlinien
        depthWrite: false,
        // Beidseitig: Fasen unter der Frontplatte sieht man „von innen“ durch das klare Plastik
        side: THREE.DoubleSide,
        envMapIntensity: 2.2
      })
    );
    // Schwarzer Tray aus glänzendem Polystyrol
    this.trayBlack = withReflectionFade(
      new THREE.MeshPhysicalMaterial({
        color: 0x2e2e33,
        roughness: 0.55,
        metalness: 0,
        clearcoat: 0.25,
        clearcoatRoughness: 0.3,
        vertexColors: true // Steg am Scharnier dunkler (Vertexfarbe)
      })
    );
    this.trayClear = withReflectionFade(
      new THREE.MeshPhysicalMaterial({ color: 0xd8dde4, roughness: 0.15, transparent: true, opacity: 0.3, depthWrite: false, vertexColors: true })
    );
    this.paperEdge = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0xe8e3d8, roughness: 0.9 }));
    this.cardInner = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }));
    this.pickMat = new THREE.MeshBasicMaterial({ visible: false });

    this.discAlpha = new THREE.CanvasTexture(drawDiscAlpha());
    // Datenseite und Rand der CD: Silber
    this.discSilver = withReflectionFade(
      new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.9, roughness: 0.2, alphaMap: this.discAlpha, alphaTest: 0.5 })
    );
    this.discEdge = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.3 }));
    this.shadowTex = new THREE.CanvasTexture(drawShadow());
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.7 });
    const stickerTex = new THREE.CanvasTexture(drawFavSticker());
    stickerTex.colorSpace = THREE.SRGBColorSpace;
    this.stickerMat = withReflectionFade(new THREE.MeshStandardMaterial({ map: stickerTex, roughness: 0.35, metalness: 0.15 }));

    this.geo = {
      ...buildJewelGeometry(),
      shadow: new THREE.PlaneGeometry(1, 1),
      sticker: new THREE.CircleGeometry(6.5, 40)
    };
  }

  /** Themes tönen die Plastikkanten leicht (z. B. kühl bei „Neon“). */
  setEdgeColor(hex) {
    this.rim.color.copy(RIM_BASE).lerp(new THREE.Color(hex), 0.3);
  }

  /** Eigene Umgebung nur für die Spiegelungen auf dem Plastik. */
  setCaseEnvironment(texture) {
    for (const m of [this.plastic, this.rim, this.trayBlack]) {
      m.envMap = texture;
      m.needsUpdate = true;
    }
  }
}

const paper = (opts = {}) =>
  withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.62, metalness: 0, ...opts }));

export class JewelCase {
  constructor(factory) {
    this.variant = 'jewel';
    this.spec = SPEC;
    this.factory = factory;
    const f = factory;
    const g = f.geo;
    this.group = new THREE.Group();
    const model = new THREE.Group();
    model.scale.setScalar(MM);
    this.group.add(model);
    this.model = model;
    this.lid = 0;

    // Materialien mit Bildern (je Hülle eigene)
    this.frontMat = paper({ roughness: 0.45 });
    this.backMat = paper({ roughness: 0.6 });
    this.spineHingeMat = paper({ roughness: 0.6 });
    this.spineOtherMat = paper();
    this.inlayMat = paper({ color: 0xece7dc, roughness: 0.75 });
    this.discMat = withReflectionFade(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.38, alphaMap: f.discAlpha, alphaTest: 0.5 })
    );

    /** Seitenverhältnisse der bedruckten Flächen (für das Zuschneiden der Bilder). */
    this.frontAspect = 1;
    this.backAspect = CASE.BACK_W / CASE.BACK_H;
    this.hasSpines = true;

    // Unterteil, Tray und Tray-Card
    this.base = new THREE.Mesh(g.base, [f.plastic, f.rim]);
    this.base.renderOrder = 2;
    this.tray = new THREE.Mesh(g.tray, f.trayBlack);
    this.back = new THREE.Mesh(g.inlay, [f.cardInner, this.backMat]);
    this.back.position.z = (J.inlay.z0 + J.inlay.z1) / 2;
    this.spineHinge = new THREE.Mesh(g.spine, this.spineHingeMat);
    this.spineHinge.rotation.y = -Math.PI / 2;
    this.spineHinge.position.set(-J.spine.x, 0, J.spine.zc);
    this.spineOther = new THREE.Mesh(g.spine, this.spineOtherMat);
    this.spineOther.rotation.y = Math.PI / 2;
    this.spineOther.position.set(J.spine.x, 0, J.spine.zc);
    model.add(this.base, this.tray, this.back, this.spineHinge, this.spineOther);

    // CD (nur sichtbar, wenn der Deckel offen ist)
    this.interior = new THREE.Group();
    this.well = new THREE.Mesh(g.well, f.trayBlack);
    this.interior.add(this.well);
    this.discGroup = new THREE.Group();
    this.discGroup.position.set(J.disc.x, 0, J.disc.z);
    const top = new THREE.Mesh(g.discTop, this.discMat);
    top.position.z = J.disc.t / 2;
    const bottom = new THREE.Mesh(g.discBottom, f.discSilver);
    bottom.position.z = -J.disc.t / 2;
    this.discGroup.add(top, bottom, new THREE.Mesh(g.discEdge, f.discEdge));
    this.interior.add(this.discGroup);
    this.interior.visible = false;
    model.add(this.interior);

    // Deckel: dreht um die Zapfen der Scharnierarme
    const A = J.axis;
    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(A.x, 0, A.z);
    const lid = new THREE.Group();
    lid.position.set(-A.x, 0, -A.z);
    this.lidShell = new THREE.Mesh(g.lid, [f.plastic, f.rim]);
    this.lidShell.renderOrder = 3;
    // Booklet: außen Cover, innen die letzte Seite, Kanten aus Papier
    this.booklet = new THREE.Mesh(g.booklet, [f.paperEdge, this.frontMat, this.inlayMat]);
    this.booklet.position.set(J.booklet.x, 0, (J.booklet.z0 + J.booklet.z1) / 2);
    // Favoriten-Aufkleber außen auf dem Deckel (oben rechts)
    this.sticker = new THREE.Mesh(f.geo.sticker, f.stickerMat);
    this.sticker.position.set(J.W / 2 - 12, J.H / 2 - 11, J.zFront + 0.08);
    this.sticker.visible = false;
    lid.add(this.lidShell, this.booklet, this.sticker);
    this.lidPivot.add(lid);
    model.add(this.lidPivot);

    // Unsichtbarer Körper zum Anklicken
    this.pick = new THREE.Mesh(g.pick, f.pickMat);
    this.pick.userData.jewelcase = this;
    model.add(this.pick);
  }

  /** Deckel öffnen: t = 0 (zu) … 1 (offen). */
  setLid(t) {
    this.lid = t;
    this.lidPivot.rotation.y = -t * this.spec.open;
    this.interior.visible = t > 0.004;
  }

  setFavorite(on) {
    this.sticker.visible = !!on;
  }

  /** CD (für das Drehen beim Abspielen). */
  get discs() {
    return [this.discGroup];
  }

  setTray(kind) {
    const m = kind === 'clear' ? this.factory.trayClear : this.factory.trayBlack;
    this.tray.material = m;
    this.well.material = m;
  }

  /** Früher Hilfslinien an den Kanten; die Kanten sind jetzt echte Geometrie. */
  setEdgesVisible() {}

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
    for (const m of [this.backMat, this.spineHingeMat, this.spineOtherMat, this.discMat, this.frontMat, this.inlayMat]) m?.dispose();
  }
}
