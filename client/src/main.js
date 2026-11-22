import '@fontsource-variable/inter';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/700.css';
import './style.css';

import { api } from './core/api.js';
import { Player } from './core/player.js';
import { Store } from './core/store.js';
import { applyThemeCss, buildThemeList } from './core/themes.js';
import { Carousel } from './scene/carousel.js';
import { albumHashColor } from './scene/color.js';
import { Deck } from './scene/deck.js';
import { createCaseEnvironment } from './scene/environment.js';
import { CaseFactory } from './scene/jewelcase.js';
import { LAYOUT_ORDER } from './scene/layouts.js';
import { Stage } from './scene/stage.js';
import { TextureStore } from './scene/textures.js';
import { Input } from './ui/input.js';
import { UI } from './ui/ui.js';

const root = document.getElementById('app');
const canvas = document.getElementById('stage');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 40px Oswald'),
        document.fonts.load('400 40px Oswald'),
        document.fonts.load('600 20px "Inter Variable"'),
        document.fonts.load('500 20px "Inter Variable"')
      ]),
      new Promise((r) => setTimeout(r, 2500))
    ]);
  } catch {
    /* Ersatzschriften verwenden */
  }
}

async function boot() {
  if (!webglAvailable()) {
    root.innerHTML = '<div class="fatal">Dein Browser unterstützt kein WebGL 2 – discbox braucht es für die 3D-Ansicht.</div>';
    return;
  }
  const store = new Store();
  const [status, customThemes] = await Promise.all([api.status(), api.themes(), loadFonts()]);
  store.status = status;
  const themes = buildThemeList(customThemes);

  const stage = new Stage(canvas);
  const textures = new TextureStore(stage.renderer);
  const factory = new CaseFactory();
  factory.setCaseEnvironment(createCaseEnvironment(stage.renderer));
  const player = new Player({ transcoding: status.transcoding, volume: store.settings.volume });
  const carousel = new Carousel({ stage, store, textures, factory, player });
  // Plattenspieler beim Abspielen (eigene kleine Szene, per Klick groß)
  const deck = new Deck({ stage, factory, textures, store, player });
  carousel.discAway = (id) => deck.holdsCd(id);

  // ---------- Aktionen ----------
  const actions = {
    async inspect() {
      const album = store.current;
      if (!album) return;
      store.setMode('inspect');
    },
    back() {
      if (store.mode === 'inspect') store.setMode('browse');
    },
    async playAlbum({ shuffle = false } = {}) {
      const album = store.current;
      if (!album) return;
      try {
        const detail = await store.detail(album.id);
        player.playAlbum(detail, 0, { shuffle });
      } catch (err) {
        ui.toast(`Album konnte nicht geladen werden: ${err.message}`, { kind: 'error' });
      }
    },
    async playTrack(i) {
      const album = store.current;
      if (!album) return;
      const detail = await store.detail(album.id);
      const cur = player.current;
      if (cur && cur.album.id === detail.id && cur.track.id === detail.tracks[i]?.id) {
        player.toggle();
        return;
      }
      player.playAlbum(detail, i, { shuffle: false });
    },
    flip() {
      carousel.flip();
    },
    openDeck() {
      if (!player.current) return ui.toast('Erst ein Album abspielen – dann legt discbox es auf den Plattenspieler.');
      if (store.settings.deck === false) store.updateSettings({ deck: true });
      deck.open();
    },
    closeDeck() {
      deck.close();
    },
    toggleDeck() {
      if (deck.isOpen) deck.close();
      else actions.openDeck();
    },
    deckOrbit(dx, dy) {
      deck.orbit(dx, dy);
    },
    deckZoom(delta) {
      deck.zoom(delta);
    },
    toggleLid() {
      carousel.toggleLid();
      ui.setLidButton(carousel.lidAction());
    },
    openBooklet() {
      const album = store.current;
      if (!album?.gallery) return ui.toast('Keine Booklet-Scans in diesem Albumordner.');
      const detail = store.cachedDetail(album.id);
      ui.openViewer(album, detail?.galleryNames ?? []);
    },
    /** Regalwand: einen Boden höher (−1) oder tiefer (+1). */
    shelfRow(dir) {
      const j = carousel.rowNeighbor(store.index, dir);
      if (j != null) store.select(j);
    },
    randomAlbum() {
      const n = store.view.length;
      if (n < 2) return;
      let i = store.index;
      while (i === store.index) i = Math.floor(Math.random() * n);
      store.select(i, { jump: true });
    },
    async rescan(full) {
      try {
        const res = await api.scan(full);
        ui.toast(res.started ? (full ? 'Bibliothek wird komplett neu eingelesen …' : 'Bibliothek wird eingelesen …') : 'Es läuft bereits ein Scan.');
        pollSoon(500);
      } catch (err) {
        ui.toast(`Scan nicht möglich: ${err.message}`, { kind: 'error' });
      }
    },
    async lookupOnline(mbid) {
      const album = store.current;
      if (!album) return;
      try {
        await api.lookupOnline(album.id, mbid || undefined);
        ui.toast(mbid ? 'Cover werden von diesem Release geladen …' : 'Suche online nach Covern …');
        watchOnline = album.id;
        pollSoon(1500);
      } catch (err) {
        ui.toast(err.message, { kind: 'error' });
      }
    },
    gotoPlaying() {
      const cur = player.current;
      if (!cur) return;
      store.selectId(cur.album.id, { jump: true });
      store.setMode('inspect');
    },
    setLayout(id) {
      store.updateSettings({ layout: id });
    },
    cycleLayout() {
      const i = LAYOUT_ORDER.indexOf(store.settings.layout);
      const next = LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length];
      store.updateSettings({ layout: next });
      ui.toast(`Anordnung: ${{ coverflow: 'Coverflow', shelf: 'Regal', wheel: 'Rad' }[next]}`, { ms: 1400 });
    },
    cycleTheme() {
      const i = themes.findIndex((t) => t.id === store.settings.theme);
      const next = themes[(i + 1) % themes.length];
      store.updateSettings({ theme: next.id });
      ui.toast(`Theme: ${next.name}`, { ms: 1400 });
    },
    changeSetting(key, value) {
      if (key === 'completeOnly') return store.setCompleteOnly(value);
      store.updateSettings({ [key]: value });
    },
    async toggleFavorite() {
      const album = store.current;
      if (!album) return;
      const on = !album.favorite;
      store.markFavorite([album.id], on);
      try {
        await api.setFavorite(album.id, on);
        ui.toast(on ? `★ „${album.title}“ ist jetzt Favorit` : `„${album.title}“ aus den Favoriten entfernt`, { ms: 1600 });
      } catch (err) {
        store.markFavorite([album.id], !on);
        ui.toast(`Favorit nicht gespeichert: ${err.message}`, { kind: 'error' });
      }
    },
    /** Alle Alben mit Front- und Rückseite zu Favoriten machen. */
    async favoriteAllComplete() {
      const ids = store.completeAlbums.filter((a) => !a.favorite).map((a) => a.id);
      if (!ids.length) return ui.toast('Alle Alben mit Front- und Rückseite sind schon Favoriten.');
      store.markFavorite(ids, true);
      try {
        await api.setFavorites(ids, true);
        ui.toast(`${ids.length} Alben zu den Favoriten hinzugefügt`);
      } catch (err) {
        store.markFavorite(ids, false);
        ui.toast(`Favoriten nicht gespeichert: ${err.message}`, { kind: 'error' });
      }
    },
    showAll() {
      store.setCollection('all');
    },
    resetFilters() {
      store.query = '';
      store.genre = '';
      store.setCompleteOnly(false);
      store.setCollection('all');
    }
  };

  const ui = new UI({ root, store, player, actions, themes });
  deck.playerHeight = () => ui.playerOffset();
  deck.topHeight = () => ui.topOffset();
  deck.onRect = (rect, vis, full) => ui.placeDeckPip(rect, vis, full);
  deck.onFullChange = (open) => ui.showDeckView(open);

  // ---------- Einstellungen anwenden ----------
  let autoQuality = { level: 'medium', samples: [], changes: 0 };
  const effectiveQuality = () => (store.settings.quality === 'auto' ? autoQuality.level : store.settings.quality);
  function applyQuality() {
    const q = effectiveQuality();
    stage.setQuality(q);
    textures.perFrame = q === 'low' ? 1 : q === 'medium' ? 2 : 3; // GPU-Uploads pro Frame
    carousel.setQualityFlags({ edges: stage.quality.edges, lowWindow: stage.quality.lowWindow });
  }
  function applyTheme() {
    const theme = themes.find((t) => t.id === store.settings.theme) ?? themes[0];
    stage.applyTheme(theme);
    carousel.applyTheme(theme);
    factory.setEdgeColor(theme.caseEdges ?? '#ffffff');
    applyThemeCss(theme);
  }
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced && !localStorage.getItem('discbox.settings.v1')) store.settings.reduceMotion = true;
  if (window.devicePixelRatio <= 1.25 && !/Mobi|Android|TV|SMART/i.test(navigator.userAgent)) autoQuality.level = 'high';

  applyTheme();
  applyQuality();
  stage.setReflections(store.settings.reflections);
  stage.setParticles(store.settings.particles);

  store.on('settings', (patch) => {
    if ('theme' in patch) applyTheme();
    if ('quality' in patch) {
      autoQuality = { level: autoQuality.level, samples: [], changes: 0 };
      applyQuality();
    }
    if ('reflections' in patch) stage.setReflections(patch.reflections);
    if ('particles' in patch) stage.setParticles(patch.particles);
    if ('layout' in patch) {
      carousel.setLayout(patch.layout);
      ui.setLayoutButtons(patch.layout);
    }
    if ('spineDirection' in patch || 'tray' in patch) carousel.refreshAppearance();
  });

  // ---------- Zustandswechsel ----------
  carousel.onColor = (color) => {
    stage.setTint(color);
    ui.setAlbumColor(color);
  };

  async function loadDetailFor(album) {
    try {
      const detail = await store.detail(album.id);
      carousel.setDetail(detail);
      if (store.mode === 'inspect' && store.current?.id === album.id) ui.renderPanel(album, detail);
    } catch (err) {
      ui.toast(`Details nicht ladbar: ${err.message}`, { kind: 'error' });
    }
  }

  store.on('index', (i, opts = {}) => {
    carousel.setIndex(i, opts);
    const album = store.current;
    ui.renderCaption(album);
    if (!album) return;
    const color = carousel.currentColor() ?? albumHashColor(album);
    stage.setTint(color);
    ui.setAlbumColor(color);
    if (store.mode === 'inspect') {
      ui.renderPanel(album, store.cachedDetail(album.id));
      ui.setLidButton(carousel.lidAction());
      loadDetailFor(album);
    }
  });

  store.on('view', () => carousel.rebuild());

  store.on('mode', (mode) => {
    const album = store.current;
    if (mode === 'inspect' && album) {
      ui.renderPanel(album, store.cachedDetail(album.id));
      ui.showPanel(true);
      ui.setLidButton('Öffnen');
      loadDetailFor(album);
    } else {
      ui.showPanel(false);
    }
    requestAnimationFrame(() => (carousel.panel = ui.panelGeometry()));
  });

  player.on('error', (msg) => ui.toast(msg, { kind: 'error' }));
  player.on('blocked', () => ui.toast('Der Browser hat die Wiedergabe blockiert – bitte einmal auf ▶ klicken.'));

  // ---------- Daten laden & Status abfragen ----------
  let watchOnline = null;
  async function reloadAlbums() {
    const { albums, version } = await api.albums();
    store.setAlbums(albums, version);
    if (watchOnline) {
      store.details.delete(watchOnline);
      const a = store.all.find((x) => x.id === watchOnline);
      if (a && store.current?.id === a.id && store.mode === 'inspect') loadDetailFor(a);
    }
  }

  let pollTimer = null;
  async function poll() {
    clearTimeout(pollTimer);
    try {
      const status = await api.status();
      store.status = status;
      if (status.version !== store.version) await reloadAlbums();
      else if (watchOnline && !status.online.pending) {
        const a = store.all.find((x) => x.id === watchOnline);
        store.details.delete(watchOnline);
        if (a && store.current?.id === a.id && store.mode === 'inspect') loadDetailFor(a);
        watchOnline = null;
      }
      const wasRunning = lastStatus?.scan?.running;
      if (wasRunning && !status.scan.running && status.scan.stats) {
        const st = status.scan.stats;
        ui.toast(`Fertig: ${st.albums.toLocaleString('de-DE')} Alben, ${st.tracks.toLocaleString('de-DE')} Titel (neu: ${st.added}, entfernt: ${st.removed})`);
      }
      lastStatus = status;
      ui.renderStatus(status, store.all.length);
      const busy = status.scan.running || status.online.pending > 0;
      pollTimer = setTimeout(poll, busy ? 1200 : 15000);
    } catch {
      pollTimer = setTimeout(poll, 5000);
    }
  }
  let lastStatus = status;
  const pollSoon = (ms) => {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  };

  await reloadAlbums();
  ui.renderStatus(status, store.all.length);
  ui.renderCaption(store.current);
  carousel.rebuild();
  pollSoon(status.scan.running ? 800 : 4000);

  // ---------- Eingabe & Leerlauf ----------
  let lastActivity = performance.now();
  let attract = false;
  let attractNext = 0;
  const input = new Input({
    canvas,
    store,
    carousel,
    player,
    ui,
    stage,
    actions,
    onActivity: () => {
      lastActivity = performance.now();
      if (attract) {
        attract = false;
        document.body.classList.remove('attract');
        stage.orbit.x = 0;
        stage.orbit.y = 0;
      }
    }
  });

  window.addEventListener('resize', () => {
    stage.resize();
    carousel.panel = ui.panelGeometry();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollSoon(200);
  });

  // ---------- Hauptschleife ----------
  let last = performance.now();
  let time = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    const reduceMotion = store.settings.reduceMotion;

    input.pollGamepads(dt);
    textures.tick();

    // Bildschirmschoner
    const idle = store.settings.idleMinutes;
    if (idle > 0 && !attract && store.mode === 'browse' && !ui.modal && now - lastActivity > idle * 60000 && store.view.length > 1) {
      attract = true;
      attractNext = now + 1500;
      document.body.classList.add('attract');
    }
    if (attract) {
      if (now > attractNext) {
        store.step(1, { wrap: true });
        attractNext = now + 7000;
      }
      stage.orbit.x = Math.sin(time * 0.12) * 0.7;
      stage.orbit.y = Math.sin(time * 0.09) * 0.15;
    }

    carousel.update(dt, time, { reduceMotion });
    stage.update(dt, time, { reduceMotion });
    deck.update(dt, time, { reduceMotion });
    if (!deck.coversScreen) stage.render();
    deck.render();
    ui.tick();

    // Automatische Qualität: langsam → herunterschalten, sehr schnell → hochschalten
    if (store.settings.quality === 'auto' && autoQuality.changes < 3 && !document.hidden) {
      const s = autoQuality.samples;
      s.push(dt);
      if (s.length >= 150) {
        const sorted = [...s].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        s.length = 0;
        const order = ['low', 'medium', 'high'];
        const idx = order.indexOf(autoQuality.level);
        if (median > 1 / 30 && idx > 0) {
          autoQuality.level = order[idx - 1];
          autoQuality.changes++;
          applyQuality();
        } else if (median < 1 / 75 && idx < 2 && autoQuality.changes === 0) {
          autoQuality.level = order[idx + 1];
          autoQuality.changes++;
          applyQuality();
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.body.classList.add('ready');

  // Für Fehlersuche in der Browser-Konsole
  window.discbox = { store, stage, carousel, player, textures, ui, deck };
}

boot().catch((err) => {
  console.error(err);
  root.insertAdjacentHTML(
    'beforeend',
    `<div class="fatal">discbox konnte nicht starten: ${String(err.message ?? err).replace(/</g, '&lt;')}</div>`
  );
});
