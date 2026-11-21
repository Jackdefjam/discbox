// Eigene Studio-Umgebung für die Spiegelungen auf der Plastikhülle: dunkler Raum mit wenigen
// Softboxen. So entstehen elegante Glanzstreifen statt eines grellen Lichtflecks über dem Cover.

import * as THREE from 'three';

export function createCaseEnvironment(renderer) {
  const scene = new THREE.Scene();
  const sphere = new THREE.SphereGeometry(20, 48, 24);
  const pos = sphere.attributes.position;
  const colors = [];
  const low = new THREE.Color(0x030304);
  const high = new THREE.Color(0x1d2026);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / 20 + 1) / 2;
    c.lerpColors(low, high, t * t);
    colors.push(c.r, c.g, c.b);
  }
  sphere.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const panels = [];
  const light = (w, h, intensity, position, color = 0xffffff) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...position);
    m.lookAt(0, 0, 0);
    scene.add(m);
    panels.push(geo, mat);
  };
  light(3.2, 1.4, 2.4, [-6, 6.5, 9]); // Softbox vorne oben links → Glanz in der Ecke
  light(0.7, 10, 1.3, [12, 2, 3]); // Lichtstreifen rechts
  light(0.7, 10, 0.9, [-12, 2, -1]); // Lichtstreifen links
  light(12, 0.6, 1.0, [0, 10, -7]); // Kante hinten oben
  light(2.5, 0.5, 0.8, [5, -3, 8], 0xbcd4ff); // kühler Akzent unten rechts

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  sphere.dispose();
  for (const p of panels) p.dispose();
  return texture;
}
