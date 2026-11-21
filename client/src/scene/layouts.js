// Anordnungen der Hüllen. pose(d) bekommt den Abstand zur Auswahl (auch Bruchteile beim Scrollen)
// und liefert Position (Boden = y 0) und Drehung.

import { CASE_D, CASE_W } from './jewelcase.js';

const sign = (v) => (v < 0 ? -1 : 1);

export const LAYOUTS = {
  coverflow: {
    id: 'coverflow',
    label: 'Coverflow',
    window: 12,
    lowWindow: 8,
    camera: { pos: [0, 0.8, 4.7], target: [0, 0.6, 0], fitWidth: 3.4 },
    pose(d, out) {
      const a = Math.abs(d);
      const s = sign(d);
      const t = Math.min(a, 1);
      const e = t * t * (3 - 2 * t);
      const rest = Math.max(a - 1, 0);
      out.x = s * (e * 1.18 + rest * 0.4);
      out.y = 0;
      out.z = -e * 0.95 - rest * 0.015;
      out.yaw = -s * e * 1.12;
      return out;
    }
  },

  shelf: {
    id: 'shelf',
    label: 'Regal',
    window: 28,
    lowWindow: 16,
    camera: { pos: [0, 0.92, 5.1], target: [0, 0.6, 0], fitWidth: 3.2 },
    pose(d, out) {
      const a = Math.abs(d);
      const s = sign(d);
      const t = Math.min(a, 1);
      const e = t * t * (3 - 2 * t);
      const rest = Math.max(a - 1, 0);
      const edge = CASE_W / 2 + 0.1 + CASE_D / 2;
      out.x = s * (e * edge + rest * (CASE_D + 0.008));
      out.y = 0;
      out.z = (1 - e) * 0.5 - e * 0.35;
      // Rücken (Scharnierseite) zeigt zur Kamera
      out.yaw = e * (Math.PI / 2);
      return out;
    }
  },

  wheel: {
    id: 'wheel',
    label: 'Rad',
    window: 8,
    lowWindow: 6,
    camera: { pos: [0, 1.7, 6.9], target: [0, 0.55, -1.0], fitWidth: 4.6 },
    pose(d, out) {
      const R = 6.2;
      const ang = d * 0.245;
      const a = Math.abs(d);
      const pop = Math.max(0, 1 - a);
      out.x = Math.sin(ang) * R;
      out.z = (Math.cos(ang) - 1) * R + pop * 0.45;
      out.y = 0;
      out.yaw = ang;
      return out;
    }
  }
};

export const LAYOUT_ORDER = ['coverflow', 'shelf', 'wheel'];
