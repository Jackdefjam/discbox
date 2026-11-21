// Eingebaute Themes. Eigene Themes: JSON-Dateien in <DATA_DIR>/themes/ (gleiche Struktur, fehlende Werte
// werden vom Theme "studio" übernommen).

export const BUILTIN_THEMES = [
  {
    id: 'studio',
    name: 'Studio',
    background: { top: '#262a33', bottom: '#08090c' },
    fog: { color: '#08090c', near: 7, far: 17 },
    floor: { color: '#0b0c0f', reflectivity: 0.42, grid: null },
    lights: { ambient: 0.55, sky: '#d8e2ff', ground: '#1a1410', key: 2.4, keyColor: '#fff6ea', rim: 1.6, rimColor: '#8fb4ff', env: 0.9 },
    accent: '#7dd3fc',
    tint: 0.42,
    particles: { kind: 'dust', count: 160, color: '#ffffff', size: 0.018, opacity: 0.35 },
    ui: { text: '#f4f5f7', muted: '#9aa3b2', panel: 'rgba(14, 16, 22, 0.72)', panelBorder: 'rgba(255,255,255,0.08)' },
    caseEdges: '#ffffff'
  },
  {
    id: 'neon',
    name: 'Neon Arcade',
    background: { top: '#2a0848', bottom: '#05010e' },
    fog: { color: '#05010e', near: 6, far: 16 },
    floor: { color: '#07020f', reflectivity: 0.6, grid: { color: '#ff2bd6', strength: 0.55, scale: 2.5 } },
    lights: { ambient: 0.45, sky: '#ff7ae6', ground: '#0b0420', key: 2.0, keyColor: '#ffe9ff', rim: 2.6, rimColor: '#22e1ff', env: 0.8 },
    accent: '#ff3ddc',
    tint: 0.3,
    particles: { kind: 'stars', count: 260, color: '#9cf6ff', size: 0.022, opacity: 0.7 },
    ui: { text: '#fdf4ff', muted: '#c3a6d6', panel: 'rgba(22, 6, 40, 0.74)', panelBorder: 'rgba(255, 61, 220, 0.28)' },
    caseEdges: '#a5f3fc'
  },
  {
    id: 'wohnzimmer',
    name: 'Wohnzimmer',
    background: { top: '#4a3424', bottom: '#120c08' },
    fog: { color: '#120c08', near: 6.5, far: 15 },
    floor: { color: '#1d140d', reflectivity: 0.32, grid: null },
    lights: { ambient: 0.5, sky: '#ffd9a8', ground: '#2a1a0e', key: 2.6, keyColor: '#ffd29a', rim: 1.1, rimColor: '#ff9f5a', env: 0.75 },
    accent: '#f5b14c',
    tint: 0.35,
    particles: { kind: 'fireflies', count: 70, color: '#ffc46b', size: 0.03, opacity: 0.8 },
    ui: { text: '#fbf3e8', muted: '#c9b49a', panel: 'rgba(30, 20, 12, 0.74)', panelBorder: 'rgba(245, 177, 76, 0.22)' },
    caseEdges: '#ffe7c2'
  },
  {
    id: 'mitternacht',
    name: 'Mitternacht',
    background: { top: '#11264a', bottom: '#02060f' },
    fog: { color: '#02060f', near: 6.5, far: 16 },
    floor: { color: '#030913', reflectivity: 0.45, grid: null },
    lights: { ambient: 0.5, sky: '#b9d4ff', ground: '#030a18', key: 2.2, keyColor: '#eef4ff', rim: 2.0, rimColor: '#5aa2ff', env: 0.9 },
    accent: '#93c5fd',
    tint: 0.38,
    particles: { kind: 'stars', count: 220, color: '#ffffff', size: 0.016, opacity: 0.6 },
    ui: { text: '#eef4ff', muted: '#9fb3d1', panel: 'rgba(6, 14, 30, 0.74)', panelBorder: 'rgba(147, 197, 253, 0.18)' },
    caseEdges: '#dbeafe'
  },
  {
    id: 'galerie',
    name: 'Galerie (hell)',
    background: { top: '#fbfbf9', bottom: '#d6d6d1' },
    fog: { color: '#d6d6d1', near: 7, far: 18 },
    floor: { color: '#e4e4df', reflectivity: 0.35, grid: null },
    lights: { ambient: 0.9, sky: '#ffffff', ground: '#bdbdb5', key: 2.2, keyColor: '#ffffff', rim: 0.8, rimColor: '#ffffff', env: 1.0 },
    accent: '#d9480f',
    tint: 0.18,
    particles: null,
    ui: { text: '#16161a', muted: '#5f6168', panel: 'rgba(255, 255, 255, 0.78)', panelBorder: 'rgba(0,0,0,0.08)' },
    caseEdges: '#ffffff'
  }
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function buildThemeList(custom = []) {
  const base = BUILTIN_THEMES[0];
  const list = BUILTIN_THEMES.map((t) => ({ ...t }));
  for (const c of custom) {
    const merged = deepMerge(base, c);
    const i = list.findIndex((t) => t.id === merged.id);
    if (i >= 0) list[i] = merged;
    else list.push(merged);
  }
  return list;
}

/** Setzt CSS-Variablen für die Oberfläche. */
export function applyThemeCss(theme) {
  const root = document.documentElement.style;
  root.setProperty('--accent', theme.accent);
  root.setProperty('--text', theme.ui.text);
  root.setProperty('--muted', theme.ui.muted);
  root.setProperty('--panel', theme.ui.panel);
  root.setProperty('--panel-border', theme.ui.panelBorder);
  root.setProperty('--bg-bottom', theme.background.bottom);
  root.setProperty('--on-accent', isLight(theme.accent) ? '#0b0b0e' : '#ffffff');
  document.documentElement.dataset.themeTone = isLight(theme.background.bottom) ? 'light' : 'dark';
}

export function isLight(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}
