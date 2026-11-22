// Plattenspieler-Ansicht: eigene kleine 3D-Szene, die beim Abspielen unten links über dem Karussell
// erscheint (Bild-in-Bild) und sich per Klick auf die ganze Fläche vergrößert. Teller und Tonarm
// folgen der Wiedergabe; in der großen Ansicht liegt daneben die geöffnete Hülle des Albums.

import * as THREE from 'three';
import { artUrl } from '../core/api.js';
import { drawDisc } from './artgen.js';
import { albumHashColor, mixHex } from './color.js';
import { Slot } from './carousel.js';
import { Turntable, drawVinylLabel, grooveTextures } from './turntable.js';

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

const BG_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;
const BG_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, vUv.y));
  float v = distance(vUv, vec2(0.5, 0.55));
  c *= 1.0 - 0.45 * smoothstep(0.3, 0.95, v);
  gl_FragColor = vec4(c, opacity);
  #include <colorspace_fragment>
}`;

/** Alpha zum Rand hin auslaufend (für die Tischfläche). */
function fadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#d0d0d0');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class Deck {
  constructor({ stage, factory, textures, store, player }) {
    this.stage = stage;
    this.textures = textures;
    this.store = store;
    this.player = player;
    this.scene = new THREE.Scene();
    this.scene.environment = stage.scene.environment;
    // Schatten nur für diese Szene (im Karussell wirft kein Licht Schatten)
    stage.renderer.shadowMap.enabled = true;
    stage.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

    // Licht: Hauptlicht mit Schatten (Tonarm auf der Platte), Aufhellung, Kante
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3530, 0.55));
    this.key = new THREE.DirectionalLight(0xfff4e8, 2.6);
    this.key.position.set(-3.5, 7.5, 4.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -5;
    sc.right = 5;
    sc.top = 5;
    sc.bottom = -5;
    sc.near = 1;
    sc.far = 20;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.015;
    this.key.shadow.radius = 3;
    this.key.target.position.set(0.6, 0, 0.3);
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
    fill.position.set(6, 3, 3);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(1, 4, -7);
    this.scene.add(fill, rim);

    // Hintergrund und Tischplatte (nur in der großen Ansicht), weicher Schatten für das kleine Bild
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERTEX,
      fragmentShader: BG_FRAGMENT,
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, opacity: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    // Eigener Durchgang vor der Szene: sonst überdeckt der (transparente) Hintergrund die Szene
    this.bgScene = new THREE.Scene();
    this.bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    bg.frustumCulled = false;
    this.bgScene.add(bg);
    // Tischfläche, die zum Rand hin in den Hintergrund übergeht
    this.tableMat = new THREE.MeshStandardMaterial({
      color: 0x1d1b1a,
      roughness: 0.82,
      transparent: true,
      opacity: 0,
      alphaMap: fadeTexture(),
      depthWrite: false
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), this.tableMat);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    table.renderOrder = -5;
    this.scene.add(table);
    this.blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 5.4), this.blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.005;
    this.scene.add(blob);

    this.turntable = new Turntable(factory);
    this.scene.add(this.turntable.group);

    // Hülle des Albums neben dem Plattenspieler (große Ansicht)
    this.caseHolder = new THREE.Group();
    // Scharnier hinten: Der Deckel steht hinter der Hülle, man sieht in die offene Hülle hinein
    this.caseHolder.position.set(3.7, 0.055, 1.15);
    this.caseHolder.rotation.y = -Math.PI / 2 + 0.3;
    this.scene.add(this.caseHolder);
    this.slot = new Slot({
      factory,
      scene: this.scene,
      textures,
      settings: store.settings,
      edgesVisible: true,
      cachedDetail: (id) => store.cachedDetail(id),
      onSlotColor: () => {}
    });
    this.slot.shadow.visible = false;
    this.caseHolder.add(this.slot.body);
    this.slot.body.rotation.x = -Math.PI / 2; // liegt mit dem Deckel nach oben
    this.slot.body.traverse((o) => {
      if (o.isMesh && !(Array.isArray(o.material) ? o.material[0] : o.material)?.transparent) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    // Zustand
    this.vis = 0; // eingeblendet (kleines Bild)
    this.full = 0; // 0 = kleines Bild, 1 = ganze Fläche
    this.fullGoal = 0;
    this.album = null;
    this.held = [];
    this.groovesFor = null;
    this.hideAt = 0;
    this.view = { az: 0.5, el: 0.52, dist: 9.8, idle: 0 };
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.target = new THREE.Vector3();
    this.onRect = () => {};
    this.onFullChange = () => {};
    this.setDiscKind(store.settings.deckDisc);
    player.on('track', () => this.#bind());
    store.on('settings', (patch) => {
      if ('deckDisc' in patch) this.setDiscKind(patch.deckDisc);
      if ('deck' in patch && !patch.deck) this.close();
    });
  }

  get enabled() {
    return this.store.settings.deck !== false;
  }

  /** Liegt die CD des Albums gerade auf dem Plattenspieler (dann fehlt sie in der Hülle)? */
  holdsCd(albumId) {
    return this.enabled && this.vis > 0.01 && this.turntable.discKind === 'cd' && this.album?.id === albumId;
  }

  setDiscKind(kind) {
    this.turntable.setDiscKind(kind);
    this.#applyCaseDisc();
  }

  open() {
    if (!this.player.current) return;
    this.fullGoal = 1;
    this.view.idle = 0;
    this.onFullChange(true);
  }

  close() {
    if (this.fullGoal === 0) return;
    this.fullGoal = 0;
    this.onFullChange(false);
  }

  get isOpen() {
    return this.fullGoal === 1;
  }

  /** Deckt die große Ansicht den ganzen Bildschirm ab (Karussell muss nicht gezeichnet werden)? */
  get coversScreen() {
    return this.full > 0.999;
  }

  orbit(dx, dy) {
    this.view.az -= dx * 0.006;
    this.view.el = Math.max(0.12, Math.min(1.3, this.view.el + dy * 0.004));
    this.view.idle = 0;
  }

  zoom(delta) {
    this.view.dist = Math.max(6.5, Math.min(18, this.view.dist * (1 + delta * 0.001)));
    this.view.idle = 0;
  }

  // ---------- Album auf den Teller legen ----------

  #release() {
    for (const e of this.held) this.textures.release(e);
    this.held = [];
  }

  #hold(entry) {
    this.textures.acquire(entry);
    this.held.push(entry);
  }

  async #bind() {
    const cur = this.player.current;
    if (!cur) {
      this.hideAt = performance.now() + 1800; // Arm erst zurückfahren lassen
      return;
    }
    const album = cur.album;
    if (this.album?.id === album.id) return;
    this.album = album;
    const token = (this.token = (this.token ?? 0) + 1);
    this.#release();
    const summary = this.store.all.find((a) => a.id === album.id) ?? album;
    this.slot.bind(summary, -1);
    this.slot.shadow.visible = false;
    this.slot.case.setLid(1);
    this.slot.wantFront('lg', 2);
    this.slot.wantBack(3);
    this.slot.wantInterior(2);
    this.#applyCaseDisc();

    // Rillenbild nach den Titellängen
    const durations = (album.tracks ?? []).map((t) => t.duration || 180);
    const grooves = grooveTextures(durations.length ? durations : [album.duration || 2400]);

    let frontEntry = null;
    if (album.art?.front) {
      frontEntry = await this.textures.load(artUrl(album, 'front', 'md'), 2).catch(() => null);
      if (token !== this.token) return;
    }
    if (frontEntry) this.#hold(frontEntry);
    this.color = (frontEntry && this.textures.colorOf(frontEntry)) || albumHashColor(album);
    const labelCanvas = drawVinylLabel(album, this.color, frontEntry?.image ?? null, frontEntry?.flipped);
    const label = new THREE.CanvasTexture(labelCanvas);
    label.colorSpace = THREE.SRGBColorSpace;
    label.anisotropy = this.textures.anisotropy;
    this.labelTexture?.dispose();
    this.labelTexture = label;
    this.turntable.setVinyl(label, grooves);

    // CD: Scan des Aufdrucks oder erzeugt (wie in der Hülle)
    let discTex = null;
    if (album.art?.disc) {
      const entry = await this.textures.load(artUrl(album, 'disc', 'md'), 2).catch(() => null);
      if (token !== this.token) return;
      if (entry) {
        this.#hold(entry);
        discTex = entry.texture;
      }
    }
    if (!discTex) {
      const entry = this.textures.generated(`disc:${album.id}:${this.color}:${frontEntry ? 1 : 0}`, () =>
        drawDisc(album, this.color, frontEntry?.image ?? null, frontEntry?.flipped)
      );
      this.#hold(entry);
      discTex = entry.texture;
    }
    this.turntable.setCdTexture(discTex);
  }

  #applyCaseDisc() {
    // Bei der CD auf dem Teller ist das Fach der Hülle leer
    if (this.slot?.case) this.slot.case.discGroup.visible = this.turntable.discKind !== 'cd';
  }

  /** Fortschritt im Album (0 … 1) aus Titelnummer und Zeit. */
  #progress() {
    const cur = this.player.current;
    if (!cur) return 0;
    const tracks = cur.album.tracks ?? [];
    let total = 0;
    let before = 0;
    let found = false;
    for (const t of tracks) {
      const d = t.duration || 0;
      if (t === cur.track || t.id === cur.track.id) {
        found = true;
        before = total;
      }
      total += d;
    }
    if (!found || total <= 0) return Math.min(1, this.player.time / Math.max(1, this.player.duration));
    return Math.min(1, (before + Math.min(this.player.time, cur.track.duration || Infinity)) / total);
  }

  // ---------- Bild-in-Bild-Rechteck ----------

  /** Rechteck des kleinen Bildes (CSS-Pixel, Ursprung unten links). */
  pipRect() {
    const W = this.stage.width;
    const H = this.stage.height;
    const playerH = this.playerHeight?.() ?? 96;
    const small = W < 760;
    // In der Detailansicht kleiner, damit die herausgenommene Hülle frei bleibt
    const inspect = this.store.mode === 'inspect';
    const w = small ? 150 : Math.round(Math.min(inspect ? 210 : 270, W * (inspect ? 0.15 : 0.19)));
    const h = Math.min(Math.round(w * 0.72), H * 0.4);
    if (small) {
      // Schmale Bildschirme: oben rechts unter der Kopfleiste (unten liegen Titel und Knöpfe)
      const top = this.topHeight?.() ?? 110;
      return { x: W - w - 6, y: H - top - h - 4, w, h };
    }
    return { x: 18, y: playerH + 14, w, h };
  }

  // ---------- Pro Frame ----------

  update(dt, time, { reduceMotion = false } = {}) {
    const p = this.player;
    const state = p.current ? (p.playing || p.buffering ? 'play' : 'pause') : 'rest';
    const want = this.enabled && (!!p.current || performance.now() < this.hideAt);
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
    this.vis += ((want ? 1 : 0) - this.vis) * k;
    if (Math.abs(this.vis - (want ? 1 : 0)) < 0.002) this.vis = want ? 1 : 0;
    if (!want && this.fullGoal) this.close();
    this.full += (this.fullGoal - this.full) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 4.5));
    if (Math.abs(this.full - this.fullGoal) < 0.002) this.full = this.fullGoal;
    if (this.vis <= 0 && this.full <= 0) {
      if (this.shown) {
        this.shown = false;
        this.onRect(this.rect, 0, 0);
      }
      return;
    }
    this.shown = true;

    this.turntable.update(dt, state, this.#progress(), { reduceMotion });

    // Kamera: kleines Bild schwenkt sanft hin und her, große Ansicht frei drehbar
    const f = ease(this.full);
    this.view.idle += dt;
    if (this.fullGoal && this.view.idle > 6 && !reduceMotion) this.view.az += dt * 0.06;
    const sway = reduceMotion ? 0 : Math.sin(time * 0.22) * 0.32;
    const az = lerp(0.42 + sway, this.view.az, f);
    const el = lerp(0.58, this.view.el, f);
    // Große Ansicht: bei schmalem Bild (Hochformat) so weit weg, dass der Plattenspieler ganz drauf ist
    const tanH = Math.tan(THREE.MathUtils.degToRad(16)) * (this.stage.width / Math.max(1, this.stage.height));
    const fullDist = this.view.dist * Math.max(1, 2.9 / tanH / 9.8);
    const dist = lerp(9.4, fullDist, f);
    // Im Querformat ist die Hülle mit im Bild, im Hochformat steht der Plattenspieler in der Mitte
    const wide = Math.max(0, Math.min(1, (this.stage.width / Math.max(1, this.stage.height) - 0.6) / 0.8));
    const target = this.target.set(lerp(0.15, lerp(0.2, 0.95, wide), f), lerp(0.55, 0.4, f), lerp(0.05, 0.45, f));
    this.camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist
    );
    this.camera.lookAt(target);
    this.camera.fov = lerp(28, 32, f);

    // Hintergrund, Tisch und Hülle nur in der großen Ansicht
    const theme = this.stage.theme;
    const tint = this.color ?? this.stage.tint?.current ?? '#444444';
    const top = mixHex(theme?.background?.top ?? '#262a33', tint, 0.28);
    const bottom = theme?.background?.bottom ?? '#08090c';
    this.bgMat.uniforms.top.value.set(top);
    this.bgMat.uniforms.bottom.value.set(bottom);
    this.bgMat.uniforms.opacity.value = f;
    this.tableMat.color.set(mixHex(bottom, '#ffffff', 0.06));
    this.tableMat.opacity = f;
    this.tableMat.visible = f > 0.01;
    this.blobMat.opacity = 0.55 * (1 - f);
    this.caseHolder.visible = f > 0.02 && !!this.album;
    this.key.castShadow = this.stage.qualityName !== 'low';

    // Rechteck: vom kleinen Bild auf die ganze Fläche, beim Ein-/Ausblenden von unten einschieben
    const pip = this.pipRect();
    const slide = (1 - ease(this.vis)) * (pip.h + pip.y + 20);
    const W = this.stage.width;
    const H = this.stage.height;
    const r = {
      x: lerp(pip.x, 0, f),
      y: lerp(pip.y - slide, 0, f),
      w: lerp(pip.w, W, f),
      h: lerp(pip.h, H, f)
    };
    if (r.x !== this.rect.x || r.y !== this.rect.y || r.w !== this.rect.w || r.h !== this.rect.h) {
      this.rect = r;
      this.onRect(r, this.vis, f);
    }
  }

  render() {
    if (this.vis <= 0 && this.full <= 0) return;
    const renderer = this.stage.renderer;
    const { x, y, w, h } = this.rect;
    if (w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    if (this.coversScreen) renderer.clear(true, true, true);
    else renderer.clearDepth();
    if (this.full > 0.001) renderer.render(this.bgScene, this.bgCamera);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.stage.width, this.stage.height);
    renderer.autoClear = true;
  }
}

