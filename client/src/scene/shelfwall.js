// Regalwand: Böden, Seitenwände, Rückwand und Schilder für die Anordnung „Regal“.
// Die Hüllen selbst stellt das Karussell auf; hier entsteht nur das Möbel drumherum.

import * as THREE from 'three';
import { FONT_TEXT, FONT_TITLE, ellipsize } from './artgen.js';
import { mixHex, readableOn } from './color.js';
import { withReflectionFade } from './jewelcase.js';

export const ROW_H = 1.25 + 0.34; // Höhe eines Fachs (Hülle 125 mm + Luft fürs Schild)
export const MARGIN = 0.3;
export const BOARD_W = 6.4; // nutzbare Breite eines Bodens
const DEPTH = 1.75;
const Z = -0.35; // Mitte der Hüllen im Regal
const THICK = 0.05;

function grainCanvas() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, c.width, c.height);
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const y = rand() * c.height;
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + rand() * 0.07})`;
    ctx.lineWidth = 0.5 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= c.width; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 2);
    ctx.stroke();
  }
  return c;
}

function labelCanvas(title, count, color) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 96;
  const ctx = c.getContext('2d');
  const bg = mixHex(color, '#000000', 0.15);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = mixHex(bg, '#ffffff', 0.12);
  ctx.fillRect(0, 0, c.width, 4);
  const fg = readableOn(bg);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.font = `600 34px ${FONT_TEXT}`;
  const countText = `${count}`;
  const cw = ctx.measureText(countText).width;
  ctx.globalAlpha = 0.65;
  ctx.fillText(countText, c.width - 28 - cw, 52);
  ctx.globalAlpha = 1;
  ctx.font = `700 50px ${FONT_TITLE}`;
  ctx.fillText(ellipsize(ctx, title.toUpperCase(), c.width - 90 - cw), 28, 52);
  return c;
}

export class ShelfWall {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const grain = new THREE.CanvasTexture(grainCanvas());
    grain.colorSpace = THREE.SRGBColorSpace;
    grain.wrapS = THREE.RepeatWrapping;
    // Wenig Umgebungsreflexion: sonst glänzen die Bodenoberseiten im flachen Blickwinkel grau-blau
    this.wood = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x3a2c22, map: grain, roughness: 0.88, envMap: scene.environment, envMapIntensity: 0.15 }));
    // Oberseite der Böden etwas dunkler: das Himmelslicht der Szene ließe sie sonst bläulich leuchten
    this.woodTop = new THREE.MeshLambertMaterial({ color: 0x3a2c22, map: grain });
    this.boardMats = [this.wood, this.wood, this.woodTop, this.wood, this.wood, this.wood];
    this.back = withReflectionFade(new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: 0.95, envMap: scene.environment, envMapIntensity: 0.1 }));
    this.geo = {
      board: new THREE.BoxGeometry(BOARD_W + 2 * MARGIN + 0.1, THICK, DEPTH),
      back: new THREE.BoxGeometry(BOARD_W + 2 * MARGIN, ROW_H, 0.03),
      side: new THREE.BoxGeometry(0.05, ROW_H + THICK, DEPTH),
      label: new THREE.PlaneGeometry(1.05, 0.158)
    };
    this.rows = [];
    this.labelCache = new Map();
    this.color = '#3a2c22';
  }

  applyTheme(theme) {
    const tone = theme.background?.bottom ?? '#000000';
    const light = parseInt(tone.slice(1, 3), 16) > 150;
    this.color = theme.shelf?.color ?? (light ? '#e6e1d8' : '#3b2d23');
    this.wood.color.set(this.color);
    this.woodTop.color.set(mixHex(this.color, '#000000', light ? 0.12 : 0.45));
    this.back.color.set(theme.shelf?.back ?? mixHex(this.color, '#000000', light ? 0.12 : 0.55));
    for (const t of this.labelCache.values()) t.dispose();
    this.labelCache.clear();
    for (const r of this.rows) r.labelKey = null;
  }

  #row(i) {
    if (this.rows[i]) return this.rows[i];
    const g = new THREE.Group();
    const board = new THREE.Mesh(this.geo.board, this.boardMats);
    board.position.set(BOARD_W / 2, -THICK / 2, Z);
    const back = new THREE.Mesh(this.geo.back, this.back);
    back.position.set(BOARD_W / 2, ROW_H / 2 - THICK, Z - DEPTH / 2 - 0.015);
    const left = new THREE.Mesh(this.geo.side, this.wood);
    left.position.set(-MARGIN - 0.025, ROW_H / 2 - THICK, Z);
    const right = new THREE.Mesh(this.geo.side, this.wood);
    right.position.set(BOARD_W + MARGIN + 0.025, ROW_H / 2 - THICK, Z);
    const cap = new THREE.Mesh(this.geo.board, this.wood);
    cap.position.set(BOARD_W / 2, ROW_H - THICK / 2, Z);
    const labelMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const label = new THREE.Mesh(this.geo.label, labelMat);
    // Schild hängt oben im Fach an der Vorderkante des Bodens darüber
    label.position.set(0.5, ROW_H - THICK - 0.085, Z + DEPTH / 2 - 0.02);
    g.add(board, back, left, right, cap, label);
    this.group.add(g);
    const row = { g, cap, label, labelMat, labelKey: null };
    this.rows[i] = row;
    return row;
  }

  #labelTexture(title, count) {
    const key = `${title}|${count}|${this.color}`;
    let t = this.labelCache.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(labelCanvas(title, count, this.color));
      t.colorSpace = THREE.SRGBColorSpace;
      this.labelCache.set(key, t);
      if (this.labelCache.size > 80) {
        const [k, old] = this.labelCache.entries().next().value;
        old.dispose();
        this.labelCache.delete(k);
      }
    }
    return t;
  }

  /**
   * rows: [{ title, count, cont, y }] der sichtbaren Böden; xOffset verschiebt die Wand seitlich;
   * topRow: Index (in rows) des obersten Bodens der ganzen Wand oder -1.
   */
  update(visibleRows, xOffset, topRow) {
    this.group.visible = visibleRows.length > 0;
    visibleRows.forEach((r, i) => {
      const row = this.#row(i);
      row.g.visible = true;
      row.g.position.set(xOffset, r.y, 0);
      row.cap.visible = i === topRow;
      const key = `${r.title}|${r.count}|${r.cont}`;
      if (row.labelKey !== key) {
        row.labelKey = key;
        row.labelMat.map = this.#labelTexture(r.cont ? `${r.title} (Forts.)` : r.title, r.count);
        row.labelMat.needsUpdate = true;
      }
    });
    for (let i = visibleRows.length; i < this.rows.length; i++) this.rows[i].g.visible = false;
  }

  hide() {
    this.group.visible = false;
  }
}
