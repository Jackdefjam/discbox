// Bedienoberfläche über der 3D-Szene.

import { artUrl } from '../core/api.js';
import { SHELF_GROUPS, SORTS } from '../core/store.js';
import { fmtTime } from '../scene/artgen.js';
import { LAYOUT_ORDER, LAYOUTS } from '../scene/layouts.js';
import { VARIANTS } from '../scene/jewelcase.js';
import { ICONS } from './icons.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (root, sel) => root.querySelector(sel);

const SOURCE_LABEL = { folder: 'Ordner', embedded: 'eingebettet', online: 'MusicBrainz', null: 'generiert' };
const PHASE_LABEL = { walk: 'Ordner werden durchsucht', tags: 'Tags werden gelesen', group: 'Alben werden gebildet', art: 'Cover werden zugeordnet', save: 'Wird gespeichert' };

function fmtLong(sec) {
  if (!sec) return '';
  if (sec < 60) return `${Math.round(sec)} Sek.`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m} Min.`;
}

export class UI {
  constructor({ root, store, player, actions, themes }) {
    this.root = root;
    this.store = store;
    this.player = player;
    this.actions = actions;
    this.themes = themes;
    this.focusTrack = -1;
    this.panelOpen = false;
    this.modal = null;
    this.#build();
    this.#bind();
  }

  // ---------- Aufbau ----------
  #build() {
    const s = this.store.settings;
    const layoutButtons = LAYOUT_ORDER.map(
      (id) =>
        `<button class="seg-btn" data-layout="${id}" title="${LAYOUTS[id].label} (L)" aria-label="${LAYOUTS[id].label}">${ICONS[id]}</button>`
    ).join('');
    const sortOptions = Object.entries(SORTS)
      .map(([id, v]) => `<option value="${id}" ${id === s.sort ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    this.root.insertAdjacentHTML(
      'beforeend',
      `
      <header class="topbar chrome">
        <div class="brand">${ICONS.disc}<span>disc<b>box</b></span></div>
        <label class="search">${ICONS.search}<input type="search" placeholder="Suchen …  ( / )" autocomplete="off" spellcheck="false" aria-label="Suchen"><button class="clear" title="Suche leeren" aria-label="Suche leeren">${ICONS.close}</button></label>
        <div class="tools">
          <div class="seg views" role="tablist" aria-label="Ansicht">
            <button class="seg-btn txt" data-view="all" title="Alle Alben (V)">Alle</button>
            <button class="seg-btn txt" data-view="favorites" title="Favoriten (V)">${ICONS.star}<span class="fav-count"></span></button>
          </div>
          <button class="icon complete-only" title="Nur Alben mit Front- und Rückseite" aria-label="Nur Alben mit Front- und Rückseite">${ICONS.pair}</button>
          <select class="sort" title="Sortierung" aria-label="Sortierung">${sortOptions}</select>
          <select class="genre" title="Genre" aria-label="Genre"><option value="">Alle Genres</option></select>
          <div class="seg layouts">${layoutButtons}</div>
          <button class="icon random" title="Zufälliges Album (R)" aria-label="Zufälliges Album">${ICONS.dice}</button>
          <button class="icon scan" title="Bibliothek neu einlesen" aria-label="Bibliothek neu einlesen">${ICONS.refresh}<span class="badge"></span></button>
          <button class="icon open-settings" title="Einstellungen" aria-label="Einstellungen">${ICONS.settings}</button>
          <button class="icon open-help" title="Tastenkürzel (?)" aria-label="Hilfe">${ICONS.help}</button>
        </div>
      </header>

      <div class="shade chrome"></div>
      <section class="caption chrome" aria-live="polite">
        <div class="cap-artist"></div>
        <div class="cap-title"></div>
        <div class="cap-meta"></div>
        <div class="cap-actions">
          <button class="btn primary cap-play">${ICONS.play}<span>Abspielen</span></button>
          <button class="btn ghost cap-open">${ICONS.open}<span>Ansehen</span></button>
          <button class="btn ghost cap-fav" title="Favorit (S)">${ICONS.starOutline}<span>Favorit</span></button>
        </div>
        <div class="cap-count"></div>
      </section>

      <nav class="rail chrome" aria-label="Schnellsprung"></nav>

      <aside class="panel" aria-hidden="true">
        <div class="panel-inner">
          <button class="btn ghost small p-back">${ICONS.back}<span>Zurück</span><kbd>Esc</kbd></button>
          <div class="p-artist"></div>
          <h1 class="p-title"></h1>
          <div class="p-chips"></div>
          <div class="p-actions">
            <button class="btn primary p-play">${ICONS.play}<span>Abspielen</span></button>
            <button class="btn ghost p-shuffle" title="Zufällige Reihenfolge">${ICONS.shuffle}<span>Zufall</span></button>
            <button class="btn ghost p-fav" title="Favorit (S)">${ICONS.starOutline}<span>Favorit</span></button>
            <button class="btn ghost p-lid" title="Hülle öffnen (O)">${ICONS.open}<span>Öffnen</span></button>
            <button class="btn ghost p-flip" title="Umdrehen (F)">${ICONS.flip}<span>Umdrehen</span></button>
            <button class="btn ghost p-booklet" title="Booklet & Scans (B)">${ICONS.booklet}<span>Booklet</span></button>
            <button class="btn ghost p-coveropts" title="Cover-Optionen">${ICONS.cloud}<span>Cover</span></button>
          </div>
          <div class="p-case">
            <span class="p-case-label">Hülle</span>
            <div class="seg case-seg">
              <button class="seg-btn txt" data-case="auto" title="Automatisch wählen">Auto</button>
              <button class="seg-btn txt" data-case="jewel" title="Jewel-Case">Jewel</button>
              <button class="seg-btn txt" data-case="slim" title="Slim-Case">Slim</button>
              <button class="seg-btn txt" data-case="double" title="Doppel-CD-Hülle">Doppel</button>
              <button class="seg-btn txt" data-case="digipak" title="Digipak (Pappe)">Digipak</button>
            </div>
            <div class="p-case-hint"></div>
          </div>
          <div class="p-cover hidden">
            <div class="p-cover-status"></div>
            <div class="p-cover-row">
              <button class="btn small p-online">${ICONS.refresh}<span>Online neu suchen</span></button>
            </div>
            <div class="p-cover-row">
              <input class="p-mbid" placeholder="MusicBrainz-Release-Link oder -ID" spellcheck="false">
              <button class="btn small p-mbid-go">Übernehmen</button>
            </div>
            <p class="hint">Tipp: Eigene Bilder als <code>cover.jpg</code>, <code>back.jpg</code> und <code>cd.png</code> in den Albumordner legen – sie haben immer Vorrang.</p>
          </div>
          <ol class="p-tracks"></ol>
          <div class="p-foot"></div>
        </div>
      </aside>

      <footer class="player chrome hidden">
        <button class="np-thumb" title="Zum Album">${ICONS.disc}<img alt=""></button>
        <div class="np-text"><div class="np-title"></div><div class="np-sub"></div></div>
        <div class="np-main">
          <div class="np-controls">
            <button class="icon np-shuffle" title="Zufall">${ICONS.shuffle}</button>
            <button class="icon np-prev" title="Vorheriger Titel ([)">${ICONS.prev}</button>
            <button class="icon np-play big" title="Wiedergabe/Pause (Leertaste)">${ICONS.play}</button>
            <button class="icon np-next" title="Nächster Titel (])">${ICONS.next}</button>
            <button class="icon np-repeat" title="Wiederholen">${ICONS.repeat}</button>
          </div>
          <div class="np-progress">
            <span class="t-cur">0:00</span>
            <input class="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Position">
            <span class="t-dur">0:00</span>
          </div>
        </div>
        <div class="np-volume">
          <button class="icon np-mute" title="Stumm (M)">${ICONS.volume}</button>
          <input class="vol" type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" aria-label="Lautstärke">
        </div>
      </footer>

      <div class="scan-overlay hidden"><div class="scan-card">
        <div class="spinner">${ICONS.disc}</div>
        <h2>Bibliothek wird eingelesen</h2>
        <p class="scan-phase"></p>
        <div class="bar"><span></span></div>
        <p class="scan-count"></p>
      </div></div>

      <div class="empty hidden"><div class="empty-card">
        ${ICONS.disc}
        <h2>Keine Alben gefunden</h2>
        <p class="empty-msg"></p>
        <button class="btn primary empty-scan">${ICONS.refresh}<span>Erneut einlesen</span></button>
      </div></div>

      <div class="filter-empty chrome hidden"><div class="empty-card">
        <div class="fe-icon">${ICONS.star}</div>
        <h2 class="fe-title"></h2>
        <p class="fe-msg"></p>
        <div class="fe-actions"></div>
      </div></div>

      <div class="modal settings hidden" role="dialog" aria-label="Einstellungen"><div class="modal-card">
        <header><h2>Einstellungen</h2><button class="icon modal-close" aria-label="Schließen">${ICONS.close}</button></header>
        <div class="modal-body settings-body"></div>
      </div></div>

      <div class="modal help hidden" role="dialog" aria-label="Hilfe"><div class="modal-card wide">
        <header><h2>Bedienung</h2><button class="icon modal-close" aria-label="Schließen">${ICONS.close}</button></header>
        <div class="modal-body help-body"></div>
      </div></div>

      <div class="viewer hidden" role="dialog" aria-label="Booklet">
        <button class="icon v-close" aria-label="Schließen">${ICONS.close}</button>
        <button class="icon v-prev" aria-label="Vorheriges Bild">${ICONS.chevronLeft}</button>
        <figure><img alt=""><figcaption></figcaption></figure>
        <button class="icon v-next" aria-label="Nächstes Bild">${ICONS.chevronRight}</button>
      </div>

      <div class="toasts" aria-live="polite"></div>
    `
    );
    const r = this.root;
    this.el = {
      search: $(r, '.search input'),
      clear: $(r, '.search .clear'),
      sort: $(r, '.sort'),
      genre: $(r, '.genre'),
      layouts: [...r.querySelectorAll('[data-layout]')],
      scanBtn: $(r, '.scan'),
      views: [...r.querySelectorAll('[data-view]')],
      favCount: $(r, '.fav-count'),
      completeOnly: $(r, '.complete-only'),
      capFav: $(r, '.cap-fav'),
      pFav: $(r, '.p-fav'),
      filterEmpty: $(r, '.filter-empty'),
      feTitle: $(r, '.fe-title'),
      feMsg: $(r, '.fe-msg'),
      feActions: $(r, '.fe-actions'),
      scanBadge: $(r, '.scan .badge'),
      caption: $(r, '.caption'),
      capArtist: $(r, '.cap-artist'),
      capTitle: $(r, '.cap-title'),
      capMeta: $(r, '.cap-meta'),
      capCount: $(r, '.cap-count'),
      rail: $(r, '.rail'),
      panel: $(r, '.panel'),
      pArtist: $(r, '.p-artist'),
      pTitle: $(r, '.p-title'),
      pChips: $(r, '.p-chips'),
      pTracks: $(r, '.p-tracks'),
      pFoot: $(r, '.p-foot'),
      pLid: $(r, '.p-lid'),
      pBooklet: $(r, '.p-booklet'),
      pCover: $(r, '.p-cover'),
      pCoverStatus: $(r, '.p-cover-status'),
      pMbid: $(r, '.p-mbid'),
      player: $(r, '.player'),
      npThumb: $(r, '.np-thumb img'),
      npTitle: $(r, '.np-title'),
      npSub: $(r, '.np-sub'),
      npPlay: $(r, '.np-play'),
      npShuffle: $(r, '.np-shuffle'),
      npRepeat: $(r, '.np-repeat'),
      npMute: $(r, '.np-mute'),
      seek: $(r, '.seek'),
      tCur: $(r, '.t-cur'),
      tDur: $(r, '.t-dur'),
      vol: $(r, '.vol'),
      scanOverlay: $(r, '.scan-overlay'),
      scanPhase: $(r, '.scan-phase'),
      scanBar: $(r, '.scan-overlay .bar span'),
      scanCount: $(r, '.scan-count'),
      empty: $(r, '.empty'),
      emptyMsg: $(r, '.empty-msg'),
      settings: $(r, '.modal.settings'),
      settingsBody: $(r, '.settings-body'),
      help: $(r, '.modal.help'),
      helpBody: $(r, '.help-body'),
      viewer: $(r, '.viewer'),
      viewerImg: $(r, '.viewer img'),
      viewerCap: $(r, '.viewer figcaption'),
      toasts: $(r, '.toasts')
    };
    this.#renderHelp();
    this.setLayoutButtons(s.layout);
  }

  #bind() {
    const { el, store, player, actions } = this;
    // Nach Mausklicks den Fokus vom Knopf nehmen, sonst lösen Leertaste/Enter ihn erneut aus
    document.addEventListener('click', (e) => {
      if (e.detail > 0) e.target.closest?.('button')?.blur();
    });
    el.search.addEventListener('input', () => store.setQuery(el.search.value));
    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (el.search.value) {
          el.search.value = '';
          store.setQuery('');
        }
        el.search.blur();
        e.stopPropagation();
      } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
        el.search.blur();
        e.preventDefault();
      }
    });
    el.clear.addEventListener('click', (e) => {
      e.preventDefault();
      el.search.value = '';
      store.setQuery('');
    });
    el.sort.addEventListener('change', () => store.setSort(el.sort.value));
    for (const b of el.views) b.addEventListener('click', () => store.setCollection(b.dataset.view));
    el.completeOnly.addEventListener('click', () => store.setCompleteOnly(!store.settings.completeOnly));
    el.capFav.addEventListener('click', () => actions.toggleFavorite());
    el.pFav.addEventListener('click', () => actions.toggleFavorite());
    el.feActions.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) actions[b.dataset.act]?.();
    });
    el.genre.addEventListener('change', () => store.setGenre(el.genre.value));
    for (const b of el.layouts) b.addEventListener('click', () => actions.setLayout(b.dataset.layout));
    $(this.root, '.random').addEventListener('click', () => actions.randomAlbum());
    el.scanBtn.addEventListener('click', () => actions.rescan(false));
    $(this.root, '.empty-scan').addEventListener('click', () => actions.rescan(false));
    $(this.root, '.open-settings').addEventListener('click', () => this.openModal('settings'));
    $(this.root, '.open-help').addEventListener('click', () => this.openModal('help'));
    for (const b of this.root.querySelectorAll('.modal-close')) b.addEventListener('click', () => this.closeModal());
    for (const m of this.root.querySelectorAll('.modal')) {
      m.addEventListener('pointerdown', (e) => {
        if (e.target === m) this.closeModal();
      });
    }

    $(this.root, '.cap-play').addEventListener('click', () => actions.playAlbum());
    $(this.root, '.cap-open').addEventListener('click', () => actions.inspect());

    $(this.root, '.p-back').addEventListener('click', () => actions.back());
    $(this.root, '.p-play').addEventListener('click', () => actions.playAlbum());
    $(this.root, '.p-shuffle').addEventListener('click', () => actions.playAlbum({ shuffle: true }));
    el.pLid.addEventListener('click', () => actions.toggleLid());
    $(this.root, '.p-flip').addEventListener('click', () => actions.flip());
    el.pBooklet.addEventListener('click', () => actions.openBooklet());
    $(this.root, '.p-coveropts').addEventListener('click', () => el.pCover.classList.toggle('hidden'));
    $(this.root, '.p-online').addEventListener('click', () => actions.lookupOnline());
    $(this.root, '.p-mbid-go').addEventListener('click', () => actions.lookupOnline(el.pMbid.value.trim()));
    for (const b of this.root.querySelectorAll('[data-case]')) b.addEventListener('click', () => actions.setCase(b.dataset.case));
    el.pTracks.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) actions.playTrack(Number(li.dataset.i));
    });

    $(this.root, '.np-thumb').addEventListener('click', () => actions.gotoPlaying());
    el.npPlay.addEventListener('click', () => player.toggle());
    $(this.root, '.np-prev').addEventListener('click', () => player.prev());
    $(this.root, '.np-next').addEventListener('click', () => player.next());
    el.npShuffle.addEventListener('click', () => player.setShuffle(!player.shuffle));
    el.npRepeat.addEventListener('click', () => player.cycleRepeat());
    el.npMute.addEventListener('click', () => player.toggleMute());
    el.vol.addEventListener('input', () => {
      player.setVolume(Number(el.vol.value) / 100);
      store.updateSettings({ volume: player.volume });
    });
    el.seek.addEventListener('input', () => {
      this.seeking = true;
      el.tCur.textContent = fmtTime((Number(el.seek.value) / 1000) * player.duration);
    });
    el.seek.addEventListener('change', () => {
      player.seek((Number(el.seek.value) / 1000) * player.duration);
      this.seeking = false;
    });

    $(this.root, '.v-close').addEventListener('click', () => this.closeViewer());
    $(this.root, '.v-prev').addEventListener('click', () => this.viewerStep(-1));
    $(this.root, '.v-next').addEventListener('click', () => this.viewerStep(1));
    el.viewer.addEventListener('pointerdown', (e) => {
      if (e.target === el.viewer || e.target.tagName === 'FIGURE') this.closeViewer();
    });

    player.on('track', () => this.renderPlayer());
    player.on('state', () => this.renderPlayerState());
    player.on('queue', () => this.renderPlayerState());
    player.on('volume', () => this.renderPlayerState());
    store.on('view', () => {
      this.renderRail();
      this.renderGenres();
    });
    store.on('filters', () => {
      el.search.value = store.query;
      el.genre.value = store.genre;
      this.renderFilters();
    });
    store.on('view', () => this.renderFilters());
  }

  // ---------- Allgemein ----------
  get typing() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') && a.type !== 'range';
  }

  focusSearch() {
    this.el.search.focus();
    this.el.search.select();
  }

  setLayoutButtons(id) {
    for (const b of this.el.layouts) b.classList.toggle('active', b.dataset.layout === id);
  }

  setAlbumColor(hex) {
    if (hex) document.documentElement.style.setProperty('--album', hex);
  }

  toast(message, { kind = 'info', ms = 3200 } = {}) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = message;
    this.el.toasts.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }

  /** Platz, den das Detail-Panel einnimmt (für die Position der Hülle). */
  panelGeometry() {
    const topbar = this.root.querySelector('.topbar').getBoundingClientRect();
    const top = Math.min(0.3, Math.max(0, (topbar.bottom - 12) / window.innerHeight));
    if (!this.panelOpen) return { side: 'right', frac: 0, top: 0 };
    const r = this.el.panel.getBoundingClientRect();
    if (window.innerWidth < 820) {
      // Höhe statt Position messen: Das Panel fährt gerade noch per CSS-Transform herein
      const bottom = parseFloat(getComputedStyle(this.el.panel).bottom) || 0;
      return { side: 'bottom', frac: Math.min(0.75, (r.height + bottom + 8) / window.innerHeight), top };
    }
    return { side: 'right', frac: Math.min(0.6, (r.width + 24) / window.innerWidth), top: top * 0.5 };
  }

  /** Ansicht (Alle/Favoriten), Cover-Filter, Zähler und Hinweis bei leerer Ansicht. */
  renderFilters() {
    const { el, store } = this;
    for (const b of el.views) b.classList.toggle('active', b.dataset.view === store.collection);
    const favs = store.favoriteCount;
    el.favCount.textContent = favs ? String(favs) : '';
    el.completeOnly.classList.toggle('active', !!store.settings.completeOnly);
    el.completeOnly.title = store.settings.completeOnly
      ? 'Filter aktiv: nur Alben mit Front- und Rückseite (klicken zum Aufheben)'
      : 'Nur Alben mit Front- und Rückseite';
    this.renderFavorite(store.current);

    const empty = store.all.length > 0 && store.view.length === 0;
    el.filterEmpty.classList.toggle('hidden', !empty);
    if (!empty) return;
    const complete = store.completeAlbums.filter((a) => !a.favorite).length;
    if (store.collection === 'favorites' && !favs) {
      el.feTitle.textContent = 'Noch keine Favoriten';
      el.feMsg.innerHTML =
        'Markiere Alben mit <b>★ Favorit</b> oder der Taste <kbd>S</kbd>. Du kannst auch alle Alben übernehmen, bei denen Front- <i>und</i> Rückseite vorhanden sind.';
      el.feActions.innerHTML =
        (complete ? `<button class="btn primary" data-act="favoriteAllComplete">${ICONS.star}<span>${complete} Alben mit Front + Rückseite übernehmen</span></button>` : '') +
        `<button class="btn ghost" data-act="showAll"><span>Alle Alben zeigen</span></button>`;
    } else {
      el.feTitle.textContent = 'Nichts gefunden';
      const reasons = [
        store.collection === 'favorites' ? 'nur Favoriten' : null,
        store.settings.completeOnly ? 'nur mit Front- und Rückseite' : null,
        store.genre ? `Genre „${store.genre}“` : null,
        store.query ? `Suche „${store.query}“` : null
      ].filter(Boolean);
      el.feMsg.textContent = `Kein Album passt zu: ${reasons.join(', ')}.`;
      el.feActions.innerHTML = `<button class="btn primary" data-act="resetFilters"><span>Filter zurücksetzen</span></button>`;
    }
  }

  renderFavorite(album) {
    const on = !!album?.favorite;
    for (const b of [this.el.capFav, this.el.pFav]) {
      b.classList.toggle('is-fav', on);
      b.innerHTML = `${on ? ICONS.star : ICONS.starOutline}<span>${on ? 'Favorit' : 'Favorit'}</span>`;
      b.title = on ? 'Aus den Favoriten entfernen (S)' : 'Zu den Favoriten (S)';
    }
  }

  // ---------- Browse-Ansicht ----------
  renderCaption(album) {
    const { el } = this;
    if (!album) {
      el.caption.classList.add('empty-cap');
      return;
    }
    el.caption.classList.remove('empty-cap');
    el.capArtist.textContent = album.artist;
    el.capTitle.textContent = album.title;
    const meta = [album.year, album.genres?.[0], `${album.trackCount} Titel`, fmtLong(album.duration), album.format].filter(Boolean);
    el.capMeta.textContent = meta.join('  ·  ');
    const g = this.store.groups?.[this.store.groupIndexOf(this.store.index)];
    el.capCount.textContent = g
      ? `${g.title}  ·  ${this.store.index - g.start + 1} / ${g.end - g.start + 1}`
      : `${this.store.index + 1} / ${this.store.view.length}${this.store.collection === 'favorites' ? ' Favoriten' : ''}`;
    this.renderFavorite(album);
    el.caption.classList.remove('swap');
    void el.caption.offsetWidth;
    el.caption.classList.add('swap');
    this.highlightRail();
  }

  renderRail() {
    const letters = this.store.letters();
    this.el.rail.innerHTML = letters.map((l) => `<button data-i="${l.index}" title="${esc(l.letter)}">${esc(l.letter)}</button>`).join('');
    this.el.rail.classList.toggle('groups', !!this.store.groups && this.store.settings.shelfGroup !== 'letter');
    this.el.rail.classList.toggle('hidden', letters.length < (this.store.groups ? 2 : 3));
    for (const b of this.el.rail.children) b.addEventListener('click', () => this.store.select(Number(b.dataset.i), { jump: true }));
    this.highlightRail();
  }

  highlightRail() {
    const cur = this.store.letterAt(this.store.index);
    for (const b of this.el.rail.children) b.classList.toggle('active', b.title === cur);
  }

  renderGenres() {
    const sel = this.el.genre;
    const cur = this.store.genre;
    const genres = this.store.genres;
    const sig = genres.map((g) => g.genre).join('|');
    if (sig === this.genreSig) return;
    this.genreSig = sig;
    sel.innerHTML =
      `<option value="">Alle Genres</option>` +
      genres.map((g) => `<option value="${esc(g.genre)}" ${g.genre === cur ? 'selected' : ''}>${esc(g.genre)} (${g.count})</option>`).join('');
    sel.classList.toggle('hidden', genres.length < 2);
  }

  // ---------- Detailansicht ----------
  showPanel(open) {
    this.panelOpen = open;
    this.el.panel.classList.toggle('open', open);
    this.el.panel.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('inspecting', open);
    if (!open) {
      this.el.pCover.classList.add('hidden');
      this.focusTrack = -1;
    }
  }

  renderPanel(album, detail) {
    const { el } = this;
    this.panelAlbum = album;
    this.panelDetail = detail ?? null;
    el.pArtist.textContent = album.artist;
    el.pTitle.textContent = album.title;
    const chips = [
      album.year,
      ...(album.genres ?? []).slice(0, 2),
      album.discs > 1 ? `${album.discs} CDs` : null,
      `${album.trackCount} Titel`,
      fmtLong(album.duration),
      album.format
    ].filter(Boolean);
    el.pChips.innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
    el.pBooklet.classList.toggle('hidden', !(album.gallery > 0));
    if (!detail) {
      el.pTracks.innerHTML = `<li class="loading">Titelliste wird geladen …</li>`;
      el.pFoot.textContent = '';
      return;
    }
    const rows = [];
    let disc = null;
    detail.tracks.forEach((t, i) => {
      if (detail.discs > 1 && t.disc !== disc) {
        disc = t.disc;
        rows.push(`<li class="disc-head">CD ${disc}</li>`);
      }
      const badge = t.transcode ? `<span class="fmt" title="Wird für den Browser umgewandelt">${esc(t.codec)}</span>` : '';
      rows.push(
        `<li data-i="${i}" tabindex="-1"><span class="no">${String(t.no).padStart(2, '0')}</span>` +
          `<span class="eq"><i></i><i></i><i></i></span>` +
          `<span class="tt"><span class="t">${esc(t.title)}</span>${t.artist ? `<span class="a">${esc(t.artist)}</span>` : ''}</span>` +
          `${badge}<span class="dur">${fmtTime(t.duration)}</span></li>`
      );
    });
    el.pTracks.innerHTML = rows.join('');
    const src = detail.artSources ?? {};
    const srcText = ['front', 'back', 'disc']
      .map((k) => `${{ front: 'Front', back: 'Rückseite', disc: 'CD' }[k]}: ${SOURCE_LABEL[src[k] ?? 'null']}`)
      .join(' · ');
    el.pFoot.innerHTML = `<div>${esc(srcText)}</div><div class="folder" title="${esc(detail.folder)}">Ordner: ${esc(detail.folder || '/')}</div>`;
    this.renderCoverStatus(detail);
    this.markPlaying();
    this.#markFocus();
  }

  renderCoverStatus(detail) {
    const o = detail.online;
    const map = {
      found: 'Front und Rückseite online gefunden',
      partial: 'Online teilweise gefunden',
      notfound: 'Online nichts gefunden',
      error: `Online-Suche fehlgeschlagen${o?.error ? ` (${o.error})` : ''}`
    };
    let text = o ? map[o.status] ?? '' : 'Online-Suche noch nicht gelaufen (nur nötig, wenn lokale Bilder fehlen)';
    if (o?.checkedAt) text += ` · ${new Date(o.checkedAt).toLocaleDateString('de-DE')}`;
    if (o?.mbid) text += ` · Release ${o.mbid.slice(0, 8)}…`;
    this.el.pCoverStatus.textContent = text;
  }

  /** Hüllen-Auswahl im Panel; resolved = { variant, reason } der aktuellen Wahl. */
  renderCase(album, resolved) {
    const active = album.caseVariant ?? 'auto';
    for (const b of this.root.querySelectorAll('[data-case]')) b.classList.toggle('active', b.dataset.case === active);
    const label = VARIANTS[resolved.variant]?.label ?? resolved.variant;
    const why = {
      musicbrainz: `laut MusicBrainz: ${album.packaging}`,
      discs: `${album.discs} CDs`,
      default: 'Standard aus den Einstellungen'
    }[resolved.reason];
    this.root.querySelector('.p-case-hint').textContent =
      resolved.reason === 'manual' ? `Festgelegt: ${label} · Taste C wechselt` : `Automatisch: ${label} (${why}) · Taste C wechselt`;
  }

  setLidButton(label) {
    $(this.el.pLid, 'span').textContent = label;
  }

  markPlaying() {
    const cur = this.player.current;
    const detail = this.panelDetail;
    for (const li of this.el.pTracks.querySelectorAll('li[data-i]')) {
      const t = detail?.tracks[Number(li.dataset.i)];
      const playing = !!cur && !!t && cur.track.id === t.id;
      li.classList.toggle('playing', playing);
      li.classList.toggle('paused', playing && !this.player.playing);
    }
  }

  moveTrackFocus(delta) {
    const n = this.panelDetail?.tracks.length ?? 0;
    if (!n) return;
    this.focusTrack = this.focusTrack < 0 ? (delta > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, this.focusTrack + delta));
    this.#markFocus(true);
  }

  #markFocus(scroll) {
    for (const li of this.el.pTracks.querySelectorAll('li[data-i]')) {
      const on = Number(li.dataset.i) === this.focusTrack;
      li.classList.toggle('focus', on);
      if (on && scroll) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ---------- Player-Leiste ----------
  renderPlayer() {
    const { el, player } = this;
    const cur = player.current;
    el.player.classList.toggle('hidden', !cur);
    document.body.classList.toggle('has-player', !!cur);
    if (!cur) return;
    el.npTitle.textContent = cur.track.title;
    el.npSub.textContent = `${cur.track.artist ?? cur.album.artist} — ${cur.album.title}`;
    const url = artUrl(cur.album, 'front', 'sm');
    el.npThumb.src = url ?? '';
    el.npThumb.style.visibility = url ? 'visible' : 'hidden';
    this.renderPlayerState();
    this.markPlaying();
  }

  renderPlayerState() {
    const { el, player } = this;
    el.npPlay.innerHTML = player.playing ? ICONS.pause : ICONS.play;
    el.npPlay.classList.toggle('buffering', player.buffering && player.playing === false);
    el.npShuffle.classList.toggle('active', player.shuffle);
    el.npRepeat.classList.toggle('active', player.repeat !== 'off');
    el.npRepeat.innerHTML = player.repeat === 'one' ? ICONS.repeatOne : ICONS.repeat;
    el.npRepeat.title = { off: 'Wiederholen: aus', all: 'Wiederholen: Album', one: 'Wiederholen: Titel' }[player.repeat];
    el.npMute.innerHTML = player.muted || player.volume === 0 ? ICONS.mute : ICONS.volume;
    el.vol.value = String(Math.round(player.volume * 100));
    el.vol.style.setProperty('--p', `${player.muted ? 0 : Math.round(player.volume * 100)}%`);
    this.markPlaying();
  }

  /** Wird pro Frame aufgerufen (nur Fortschritt). */
  tick() {
    const { el, player } = this;
    if (!player.current || this.seeking) return;
    const dur = player.duration;
    const t = player.time;
    const v = dur ? Math.round((t / dur) * 1000) : 0;
    if (v !== this.lastSeek) {
      el.seek.value = String(v);
      el.seek.style.setProperty('--p', `${v / 10}%`);
      this.lastSeek = v;
    }
    const cur = fmtTime(t);
    if (cur !== this.lastCur) el.tCur.textContent = this.lastCur = cur;
    const d = fmtTime(dur);
    if (d !== this.lastDur) el.tDur.textContent = this.lastDur = d;
  }

  // ---------- Scan & Leerzustand ----------
  renderStatus(status, albumCount) {
    const { el } = this;
    const scan = status?.scan ?? {};
    const running = !!scan.running;
    el.scanBtn.classList.toggle('spinning', running);
    const pct = scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
    el.scanBadge.textContent = running ? `${pct}%` : status?.online?.pending ? '☁' : '';
    el.scanBtn.title = running
      ? `${PHASE_LABEL[scan.phase] ?? 'Scan läuft'} … ${pct}%`
      : status?.online?.pending
        ? `Suche online nach ${status.online.pending} fehlenden Covern …`
        : 'Bibliothek neu einlesen';
    const overlay = running && albumCount === 0;
    el.scanOverlay.classList.toggle('hidden', !overlay);
    if (overlay) {
      el.scanPhase.textContent = PHASE_LABEL[scan.phase] ?? 'Bitte warten …';
      el.scanBar.style.width = `${pct}%`;
      el.scanCount.textContent = scan.total ? `${scan.done.toLocaleString('de-DE')} / ${scan.total.toLocaleString('de-DE')}` : '';
    }
    const empty = !running && albumCount === 0 && !!status;
    el.empty.classList.toggle('hidden', !empty);
    if (empty) {
      el.emptyMsg.innerHTML = scan.error
        ? `Fehler beim Einlesen: <b>${esc(scan.error)}</b>`
        : this.store.all.length && (this.store.query || this.store.genre)
          ? 'Kein Album passt zur Suche oder zum Filter.'
          : 'Im Musikordner wurden keine Audiodateien gefunden. Prüfe, ob dein Musikordner im Container unter <code>/music</code> eingebunden ist.';
    }
  }

  // ---------- Modale Fenster ----------
  openModal(name) {
    this.closeModal();
    if (name === 'settings') this.renderSettings();
    const m = name === 'settings' ? this.el.settings : this.el.help;
    m.classList.remove('hidden');
    this.modal = name;
    m.querySelector('.modal-close')?.focus();
  }

  closeModal() {
    if (!this.modal) return false;
    this.el.settings.classList.add('hidden');
    this.el.help.classList.add('hidden');
    this.modal = null;
    return true;
  }

  renderSettings() {
    const s = this.store.settings;
    const st = this.store.status;
    const opt = (v, label, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
    const check = (key, label, hint = '') =>
      `<label class="row check"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    this.el.settingsBody.innerHTML = `
      <section><h3>Darstellung</h3>
        <label class="row"><span>Theme</span><select data-key="theme">${this.themes.map((t) => opt(t.id, esc(t.name), s.theme)).join('')}</select></label>
        <label class="row"><span>Anordnung</span><select data-key="layout">${LAYOUT_ORDER.map((id) => opt(id, LAYOUTS[id].label, s.layout)).join('')}</select></label>
        <label class="row"><span>Regal einteilen nach<small>Ein Boden je Abschnitt, ↑/↓ wechselt den Boden</small></span><select data-key="shelfGroup">${Object.entries(SHELF_GROUPS).map(([id, g]) => opt(id, g.label, s.shelfGroup)).join('')}</select></label>
        <label class="row"><span>Qualität</span><select data-key="quality">
          ${opt('auto', 'Automatisch', s.quality)}${opt('high', 'Hoch', s.quality)}${opt('medium', 'Mittel', s.quality)}${opt('low', 'Niedrig (schwache Geräte, TV)', s.quality)}
        </select></label>
        ${check('reflections', 'Spiegelnder Boden')}
        ${check('particles', 'Partikel/Atmosphäre')}
        ${check('reduceMotion', 'Weniger Bewegung', 'Schnellere, ruhigere Übergänge')}
        <label class="row"><span>Bildschirmschoner</span><select data-key="idleMinutes">
          ${opt(0, 'Aus', s.idleMinutes)}${opt(2, 'nach 2 Minuten', s.idleMinutes)}${opt(5, 'nach 5 Minuten', s.idleMinutes)}${opt(15, 'nach 15 Minuten', s.idleMinutes)}
        </select></label>
      </section>
      <section><h3>Ansicht</h3>
        <label class="row"><span>Beim Start zeigen</span><select data-key="startView">
          ${opt('favorites', 'Favoriten', s.startView)}${opt('all', 'Alle Alben', s.startView)}
        </select></label>
        ${check('completeOnly', 'Nur Alben mit Front- und Rückseite', 'Alben ohne vollständige Cover werden ausgeblendet')}
        <div class="row buttons">
          <button class="btn small s-favcomplete">${ICONS.star}<span>Alle ${this.store.completeAlbums.filter((a) => !a.favorite).length} Alben mit Front + Rückseite zu Favoriten</span></button>
        </div>
      </section>
      <section><h3>CD-Hülle</h3>
        <label class="row"><span>Schrift auf dem Rücken</span><select data-key="spineDirection">
          ${opt('down', 'von oben nach unten', s.spineDirection)}${opt('up', 'von unten nach oben', s.spineDirection)}
        </select></label>
        ${check('caseAuto', 'Hülle automatisch wählen', 'Nach Verpackung laut MusicBrainz und Anzahl der CDs')}
        <label class="row"><span>Standard-Hülle</span><select data-key="defaultCase">
          ${opt('jewel', 'Jewel-Case', s.defaultCase)}${opt('slim', 'Slim-Case', s.defaultCase)}${opt('digipak', 'Digipak', s.defaultCase)}${opt('double', 'Doppel-CD', s.defaultCase)}
        </select></label>
        <label class="row"><span>Tray (CD-Halter)</span><select data-key="tray">
          ${opt('black', 'Schwarz', s.tray)}${opt('clear', 'Klar', s.tray)}
        </select></label>
      </section>
      <section><h3>Bibliothek</h3>
        <p class="info">${st ? `${st.albums.toLocaleString('de-DE')} Alben · ${st.tracks.toLocaleString('de-DE')} Titel · Frontcover: ${st.covers.front} · Rückseiten: ${st.covers.back}` : ''}</p>
        <p class="info">${st?.scannedAt ? `Zuletzt eingelesen: ${new Date(st.scannedAt).toLocaleString('de-DE')}` : ''}</p>
        <p class="info">Umwandlung für Browser: ${st?.transcoding ? `aktiv (${st.transcoding.toUpperCase()})` : 'nicht verfügbar (ffmpeg fehlt)'} · Online-Cover: ${st?.online?.enabled ? 'an' : 'aus'}</p>
        <div class="row buttons">
          <button class="btn small s-scan">${ICONS.refresh}<span>Neu einlesen</span></button>
          <button class="btn small ghost s-fullscan" title="Liest alle Tags neu, auch unveränderte Dateien">Komplett neu einlesen</button>
        </div>
      </section>
      <p class="info muted">discbox ${st?.appVersion ?? ''} · Coverdaten von MusicBrainz / Cover Art Archive</p>`;
    for (const input of this.el.settingsBody.querySelectorAll('[data-key]')) {
      input.addEventListener('change', () => {
        const key = input.dataset.key;
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (key === 'idleMinutes') value = Number(value);
        this.actions.changeSetting(key, value);
      });
    }
    $(this.el.settingsBody, '.s-scan').addEventListener('click', () => this.actions.rescan(false));
    $(this.el.settingsBody, '.s-favcomplete').addEventListener('click', async () => {
      await this.actions.favoriteAllComplete();
      this.renderSettings();
    });
    $(this.el.settingsBody, '.s-fullscan').addEventListener('click', () => this.actions.rescan(true));
  }

  #renderHelp() {
    const row = (keys, text) => `<tr><td>${keys.map((k) => `<kbd>${k}</kbd>`).join(' ')}</td><td>${text}</td></tr>`;
    this.el.helpBody.innerHTML = `
      <div class="help-grid">
        <section><h3>Tastatur – Sammlung</h3><table>
          ${row(['←', '→'], 'Album wechseln')}
          ${row(['Bild ↑', 'Bild ↓'], '10 Alben springen')}
          ${row(['↑', '↓'], 'Regal: Boden höher / tiefer')}
          ${row(['Pos1', 'Ende'], 'Anfang / Ende')}
          ${row(['Enter'], 'Album herausnehmen und ansehen')}
          ${row(['P'], 'Album abspielen')}
          ${row(['R'], 'Zufälliges Album')}
          ${row(['S'], 'Favorit an/aus')}
          ${row(['V'], 'Alle Alben / Favoriten')}
          ${row(['/'], 'Suchen')}
          ${row(['L'], 'Anordnung wechseln')}
          ${row(['T'], 'Theme wechseln')}
        </table></section>
        <section><h3>Tastatur – Album</h3><table>
          ${row(['↑', '↓'], 'Titel auswählen')}
          ${row(['Enter'], 'Titel abspielen')}
          ${row(['←', '→'], 'Vorheriges / nächstes Album')}
          ${row(['F'], 'Hülle umdrehen')}
          ${row(['O'], 'Hülle öffnen / schließen')}
          ${row(['B'], 'Booklet & Scans')}
          ${row(['C'], 'Hülle wechseln (Jewel, Slim, Doppel, Digipak)')}
          ${row(['Esc'], 'Zurück')}
        </table></section>
        <section><h3>Wiedergabe</h3><table>
          ${row(['Leertaste'], 'Wiedergabe / Pause')}
          ${row(['[', ']'], 'Vorheriger / nächster Titel')}
          ${row(['M'], 'Stumm')}
          ${row(['+', '−'], 'Lautstärke')}
          ${row(['⇧ ←', '⇧ →'], '10 Sekunden spulen')}
        </table></section>
        <section><h3>Maus & Touch</h3><table>
          ${row(['Ziehen'], 'Durch die Sammlung blättern / Hülle drehen')}
          ${row(['Mausrad'], 'Blättern / Hülle drehen')}
          ${row(['Klick'], 'Hülle auswählen, herausnehmen, öffnen')}
          ${row(['Doppelklick'], 'Hülle umdrehen')}
        </table></section>
        <section><h3>Controller</h3><table>
          ${row(['Steuerkreuz', 'Stick'], 'Blättern / Titel wählen')}
          ${row(['A'], 'Ansehen / Titel abspielen')}
          ${row(['B'], 'Zurück')}
          ${row(['X'], 'Album abspielen')}
          ${row(['Y'], 'Umdrehen / Zufallsalbum')}
          ${row(['LB', 'RB'], 'Buchstabe zurück / vor')}
          ${row(['LT', 'RT'], 'Vorheriger / nächster Titel')}
          ${row(['Select'], 'Hülle öffnen / Anordnung')}
          ${row(['Start'], 'Wiedergabe / Pause')}
          ${row(['Rechter Stick'], 'Hülle drehen')}
        </table></section>
      </div>`;
  }

  // ---------- Booklet-Ansicht ----------
  openViewer(album, names = []) {
    this.viewer = { album, n: album.gallery, i: 0, names };
    this.el.viewer.classList.remove('hidden');
    this.#showViewerImage();
  }

  viewerStep(delta) {
    const v = this.viewer;
    if (!v) return;
    v.i = (v.i + delta + v.n) % v.n;
    this.#showViewerImage();
  }

  #showViewerImage() {
    const v = this.viewer;
    this.el.viewerImg.src = artUrl(v.album, `g${v.i}`, 'lg');
    this.el.viewerCap.textContent = `${v.names[v.i] ?? ''}  ·  ${v.i + 1} / ${v.n}`;
  }

  closeViewer() {
    if (!this.viewer) return false;
    this.viewer = null;
    this.el.viewer.classList.add('hidden');
    this.el.viewerImg.removeAttribute('src');
    return true;
  }
}
