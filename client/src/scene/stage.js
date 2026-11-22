// Renderer, Kamera, Licht, Spiegelboden, Hintergrund und Partikel.

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { drawSprite } from './artgen.js';
import { hexToRgb, mixHex } from './color.js';
import { reflectionUniforms } from './jewelcase.js';

const FloorShader = {
  name: 'DiscboxFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    floorColor: { value: new THREE.Color() },
    reflectivity: { value: 0.5 },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    blur: { value: 1.6 },
    fogColorOut: { value: new THREE.Color() },
    fogNear: { value: 7 },
    fogFar: { value: 17 },
    gridColor: { value: new THREE.Color() },
    gridStrength: { value: 0 },
    gridScale: { value: 2 },
    time: { value: 0 }
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying float vDepth;
    varying vec2 vPos;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPos = world.xz;
      vec4 mv = viewMatrix * world;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec3 floorColor;
    uniform float reflectivity;
    uniform vec2 texel;
    uniform float blur;
    uniform vec3 fogColorOut;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec3 gridColor;
    uniform float gridStrength;
    uniform float gridScale;
    uniform float time;
    varying vec4 vUv;
    varying float vDepth;
    varying vec2 vPos;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec2 o = texel * blur;
      vec4 r = texture2D(tDiffuse, uv) * 0.2;
      r += texture2D(tDiffuse, uv + vec2(o.x, 0.0)) * 0.1;
      r += texture2D(tDiffuse, uv - vec2(o.x, 0.0)) * 0.1;
      r += texture2D(tDiffuse, uv + vec2(0.0, o.y)) * 0.1;
      r += texture2D(tDiffuse, uv - vec2(0.0, o.y)) * 0.1;
      r += texture2D(tDiffuse, uv + o) * 0.1;
      r += texture2D(tDiffuse, uv - o) * 0.1;
      r += texture2D(tDiffuse, uv + vec2(o.x, -o.y)) * 0.1;
      r += texture2D(tDiffuse, uv + vec2(-o.x, o.y)) * 0.1;
      // Leichter Glanzverlauf: vorne kräftiger
      float gloss = reflectivity * (0.55 + 0.45 * smoothstep(fogFar, fogNear * 0.5, vDepth));
      vec3 col = mix(floorColor, r.rgb, clamp(r.a, 0.0, 1.0) * gloss);
      if (gridStrength > 0.0) {
        vec2 p = vPos * gridScale;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float pulse = 0.75 + 0.25 * sin(time * 1.3 - length(vPos) * 0.8);
        col += gridColor * line * gridStrength * pulse;
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      float fogF = smoothstep(fogNear, fogFar, vDepth);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorOut, fogF);
    }`
};

const QUALITY = {
  high: { pixelRatio: 2, reflection: 0.75, edges: true, particles: true, lowWindow: false },
  medium: { pixelRatio: 1.5, reflection: 0.5, edges: true, particles: true, lowWindow: false },
  low: { pixelRatio: 1, reflection: 0, edges: false, particles: false, lowWindow: true }
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
    this.camPos = new THREE.Vector3(0, 0.8, 4.7);
    this.camTarget = new THREE.Vector3(0, 0.6, 0);
    this.camPosGoal = this.camPos.clone();
    this.camTargetGoal = this.camTarget.clone();
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.orbit = { x: 0, y: 0 };

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.5);
    this.key = new THREE.DirectionalLight(0xffffff, 2.4);
    this.key.position.set(-3, 5, 6);
    this.rim = new THREE.DirectionalLight(0x88aaff, 1.5);
    this.rim.position.set(4, 3, -5);
    this.scene.add(this.hemi, this.key, this.rim);

    this.fog = new THREE.Fog(0x000000, 7, 17);
    this.scene.fog = this.fog;

    // Hintergrund (Verlauf + Vignette), auf Canvas gezeichnet
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = 256;
    this.bgCanvas.height = 256;
    this.bgTexture = new THREE.CanvasTexture(this.bgCanvas);
    this.bgTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bgTexture;

    // Boden: Spiegel oder schlichte Fläche
    const floorGeo = new THREE.PlaneGeometry(60, 60);
    this.reflector = new Reflector(floorGeo, { shader: FloorShader, textureWidth: 1024, textureHeight: 1024, multisample: 0 });
    this.reflector.rotation.x = -Math.PI / 2;
    this.floorUniforms = this.reflector.material.uniforms;
    const originalBefore = this.reflector.onBeforeRender;
    const prevClear = new THREE.Color();
    this.reflectionHidden = [];
    this.reflector.onBeforeRender = (renderer, scene, camera, ...rest) => {
      const bg = scene.background;
      scene.background = null;
      renderer.getClearColor(prevClear);
      const prevAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      reflectionUniforms.uReflPass.value = 1;
      const hidden = this.reflectionHidden.filter((o) => o.visible);
      for (const o of hidden) o.visible = false;
      originalBefore.call(this.reflector, renderer, scene, camera, ...rest);
      for (const o of hidden) o.visible = true;
      reflectionUniforms.uReflPass.value = 0;
      renderer.setClearColor(prevClear, prevAlpha);
      scene.background = bg;
    };
    this.plainFloor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.plainFloor.rotation.x = -Math.PI / 2;
    this.scene.add(this.reflector, this.plainFloor);

    this.tint = { current: null, goal: null, amount: 0 };
    this.theme = null;
    this.qualityName = 'medium';
    this.reflectionsWanted = true;
    this.particlesWanted = true;
    this.#buildParticles();
    this.resize();
  }

  get quality() {
    return QUALITY[this.qualityName];
  }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'medium';
    this.resize();
    this.#updateFloorMode();
    this.#updateParticles();
  }

  setReflections(on) {
    this.reflectionsWanted = on;
    this.#updateFloorMode();
  }

  setParticles(on) {
    this.particlesWanted = on;
    this.#updateParticles();
  }

  /** Spiegelboden vorübergehend aus (Regalwand: spart viel Rechenzeit). */
  setReflectionSuppressed(on) {
    if (this.reflectionSuppressed === on) return;
    this.reflectionSuppressed = on;
    this.#updateFloorMode();
  }

  /** Kamera fährt mit nach oben (Regalwand mit mehreren Böden). */
  setLift(y) {
    if (Math.abs((this.lift ?? 0) - y) < 1e-4) return;
    this.lift = y;
    this.#fitCamera(false);
  }

  #updateFloorMode() {
    const on = this.reflectionsWanted && !this.reflectionSuppressed && this.quality.reflection > 0;
    this.reflector.visible = on;
    this.plainFloor.visible = !on;
    this.resize();
  }

  #updateParticles() {
    const t = this.theme?.particles;
    this.particles.visible = !!(t && this.particlesWanted && this.quality.particles);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const scale = this.quality.reflection || 0.5;
    const rw = Math.max(256, Math.round(w * pr * scale));
    const rh = Math.max(256, Math.round(h * pr * scale));
    this.reflector.getRenderTarget().setSize(rw, rh);
    this.floorUniforms.texel.value.set(1 / rw, 1 / rh);
    this.width = w;
    this.height = h;
    this.#fitCamera(true);
  }

  /** Kameraposition für ein Layout; bei schmalen Bildschirmen weiter weg. */
  setCameraPreset(preset, immediate = false) {
    this.preset = preset;
    this.#fitCamera(immediate);
  }

  #fitCamera(immediate) {
    if (!this.preset) return;
    const [px, py, pz] = this.preset.pos;
    const [tx, ty, tz] = this.preset.target;
    const fovH = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
    const dist = Math.hypot(px - tx, py - ty, pz - tz);
    const need = this.preset.fitWidth / 2 / Math.tan(fovH / 2);
    const k = Math.max(1, need / dist);
    const lift = this.lift ?? 0;
    this.camPosGoal.set(tx + (px - tx) * k, ty + (py - ty) * k + lift, tz + (pz - tz) * k);
    this.camTargetGoal.set(tx, ty + lift, tz);
    if (immediate) {
      this.camPos.copy(this.camPosGoal);
      this.camTarget.copy(this.camTargetGoal);
    }
  }

  applyTheme(theme) {
    this.theme = theme;
    this.hemi.color.set(theme.lights.sky);
    this.hemi.groundColor.set(theme.lights.ground);
    this.hemi.intensity = theme.lights.ambient;
    this.key.color.set(theme.lights.keyColor);
    this.key.intensity = theme.lights.key;
    this.rim.color.set(theme.lights.rimColor);
    this.rim.intensity = theme.lights.rim;
    this.scene.environmentIntensity = theme.lights.env ?? 1;
    this.fog.color.set(theme.fog.color);
    this.fog.near = theme.fog.near;
    this.fog.far = theme.fog.far;
    const u = this.floorUniforms;
    u.floorColor.value.set(theme.floor.color);
    u.reflectivity.value = theme.floor.reflectivity;
    const [r, g, b] = hexToRgb(theme.fog.color);
    // Nebel wird nach der Farbraumumwandlung gemischt → sRGB-Rohwerte ohne Umrechnung setzen
    u.fogColorOut.value.setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
    u.fogNear.value = theme.fog.near;
    u.fogFar.value = theme.fog.far;
    if (theme.floor.grid) {
      u.gridColor.value.set(theme.floor.grid.color);
      u.gridStrength.value = theme.floor.grid.strength;
      u.gridScale.value = theme.floor.grid.scale;
    } else {
      u.gridStrength.value = 0;
    }
    this.plainFloor.material.color.set(theme.floor.color);
    this.#configureParticles(theme.particles);
    this.#updateParticles();
    this.tint.amount = theme.tint ?? 0.3;
    this.tint.current = this.tint.goal ?? theme.background.top;
    this.#drawBackground();
  }

  /** Hintergrund leicht in Albumfarbe einfärben. */
  setTint(hex) {
    this.tint.goal = hex;
    if (!this.tint.current) this.tint.current = hex;
  }

  /** Bildschirmhöhe (0 = oben, 1 = unten), auf der der unendliche Boden den Horizont bildet. */
  #horizon() {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return 0.5;
    dir.normalize();
    const far = cam.position.clone().addScaledVector(dir, 500);
    far.y = 0;
    far.project(cam);
    return Math.max(0.05, Math.min(0.95, (1 - far.y) / 2));
  }

  #drawBackground() {
    const t = this.theme;
    if (!t) return;
    const ctx = this.bgCanvas.getContext('2d');
    const W = this.bgCanvas.width;
    const H = this.bgCanvas.height;
    const hz = this.#horizon();
    this.lastHorizon = hz;
    const tintHex = this.tint.current ?? t.background.top;
    const top = mixHex(t.background.top, tintHex, this.tint.amount);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(Math.max(0, hz - 0.3), mixHex(top, t.fog.color, 0.45));
    g.addColorStop(hz, t.fog.color);
    g.addColorStop(1, t.background.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Lichtkegel oben
    const glow = ctx.createRadialGradient(W / 2, H * 0.06, 0, W / 2, H * 0.06, W * 0.75);
    glow.addColorStop(0, `${mixHex(top, '#ffffff', 0.25)}66`);
    glow.addColorStop(1, `${top}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H * hz);
    this.bgTexture.needsUpdate = true;
  }

  #buildParticles() {
    const max = 320;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(max * 3);
    this.pCol = new Float32Array(max * 3);
    this.pVel = new Float32Array(max * 3);
    this.pPhase = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.02,
      map: new THREE.CanvasTexture(drawSprite()),
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.reflectionHidden.push(this.particles);
  }

  #configureParticles(cfg) {
    const geo = this.particles.geometry;
    if (!cfg) {
      geo.setDrawRange(0, 0);
      return;
    }
    const n = Math.min(cfg.count ?? 150, 320);
    this.pCfg = cfg;
    this.pBase = new THREE.Color(cfg.color);
    const mat = this.particles.material;
    mat.size = cfg.size ?? 0.02;
    mat.opacity = cfg.opacity ?? 0.5;
    mat.blending = this.theme && isDarkTheme(this.theme) ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (let i = 0; i < n; i++) {
      this.pPos[i * 3] = (Math.random() - 0.5) * 14;
      this.pPos[i * 3 + 1] = 0.05 + Math.random() * 3.4;
      this.pPos[i * 3 + 2] = -7 + Math.random() * 9.5;
      const speed = cfg.kind === 'stars' ? 0.004 : cfg.kind === 'fireflies' ? 0.06 : 0.025;
      this.pVel[i * 3] = (Math.random() - 0.5) * speed;
      this.pVel[i * 3 + 1] = (Math.random() - 0.3) * speed * 0.6;
      this.pVel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      this.pPhase[i] = Math.random() * Math.PI * 2;
    }
    this.pCount = n;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
  }

  #updateParticlesFrame(dt, time) {
    if (!this.particles.visible || !this.pCount) return;
    const cfg = this.pCfg;
    const kind = cfg.kind;
    const base = this.pBase;
    for (let i = 0; i < this.pCount; i++) {
      const j = i * 3;
      if (kind === 'fireflies') {
        this.pVel[j] += (Math.random() - 0.5) * 0.02 * dt;
        this.pVel[j + 1] += (Math.random() - 0.5) * 0.02 * dt;
        this.pVel[j + 2] += (Math.random() - 0.5) * 0.02 * dt;
        this.pVel[j] *= 0.995;
        this.pVel[j + 1] *= 0.995;
        this.pVel[j + 2] *= 0.995;
      }
      this.pPos[j] += this.pVel[j] * dt * 10;
      this.pPos[j + 1] += this.pVel[j + 1] * dt * 10;
      this.pPos[j + 2] += this.pVel[j + 2] * dt * 10;
      if (this.pPos[j] > 7) this.pPos[j] = -7;
      if (this.pPos[j] < -7) this.pPos[j] = 7;
      if (this.pPos[j + 1] > 3.5) this.pPos[j + 1] = 0.05;
      if (this.pPos[j + 1] < 0.03) this.pPos[j + 1] = 3.4;
      if (this.pPos[j + 2] > 2.5) this.pPos[j + 2] = -7;
      if (this.pPos[j + 2] < -7) this.pPos[j + 2] = 2.5;
      let k = 1;
      if (kind === 'stars') k = 0.45 + 0.55 * Math.max(0, Math.sin(time * 1.7 + this.pPhase[i] * 3.0));
      else if (kind === 'fireflies') k = 0.2 + 0.8 * Math.max(0, Math.sin(time * 1.2 + this.pPhase[i]));
      else k = 0.6 + 0.4 * Math.sin(time * 0.5 + this.pPhase[i]);
      this.pCol[j] = base.r * k;
      this.pCol[j + 1] = base.g * k;
      this.pCol[j + 2] = base.b * k;
    }
    const geo = this.particles.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  /** Bildschirmkoordinaten → Normalisiert (-1 … 1). */
  ndc(clientX, clientY, out = new THREE.Vector2()) {
    const r = this.canvas.getBoundingClientRect();
    return out.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  update(dt, time, { reduceMotion = false } = {}) {
    const k = 1 - Math.exp(-dt * (reduceMotion ? 20 : 4));
    this.camPos.lerp(this.camPosGoal, k);
    this.camTarget.lerp(this.camTargetGoal, k);
    this.camera.position.copy(this.camPos);
    this.camera.position.x += this.orbit.x;
    this.camera.position.y += this.orbit.y;
    this.camera.lookAt(this.camTarget);

    let redraw = false;
    if (this.tint.goal && this.tint.current !== this.tint.goal) {
      const next = mixHex(this.tint.current, this.tint.goal, Math.min(1, dt * 3));
      this.tint.current = next === this.tint.current ? this.tint.goal : next;
      redraw = true;
    }
    this.camera.updateMatrixWorld();
    if (Math.abs(this.#horizon() - (this.lastHorizon ?? -1)) > 0.002) redraw = true;
    if (redraw) this.#drawBackground();
    this.floorUniforms.time.value = time;
    this.#updateParticlesFrame(dt, time);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function isDarkTheme(theme) {
  const [r, g, b] = hexToRgb(theme.background.bottom);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}
