// Tastatur, Maus/Touch, Mausrad und Gamepad.

import { VIEW_ORDER } from '../core/store.js';

const DRAG_PX = 6;

export class Input {
  constructor({ canvas, store, carousel, player, ui, stage, actions, onActivity }) {
    Object.assign(this, { canvas, store, carousel, player, ui, stage, actions });
    this.onActivity = onActivity ?? (() => {});
    this.pointer = null;
    this.wheelAcc = 0;
    this.pad = { prev: [], dirX: 0, dirY: 0, nextX: 0, nextY: 0, heldX: 0, heldY: 0, id: null };
    this.clickTimer = null;
    window.addEventListener('keydown', (e) => this.#onKey(e));
    canvas.addEventListener('pointerdown', (e) => this.#onDown(e));
    canvas.addEventListener('pointermove', (e) => this.#onMove(e));
    canvas.addEventListener('pointerup', (e) => this.#onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.#onUp(e, true));
    canvas.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => {
      this.ui.toast(`Controller verbunden: ${e.gamepad.id.replace(/\(.*\)/, '').trim() || 'Gamepad'}`);
    });
  }

  get inspecting() {
    return this.store.mode === 'inspect';
  }

  // ---------- Tastatur ----------
  #onKey(e) {
    this.onActivity();
    const { ui, store, player, actions, carousel } = this;
    const k = e.key;
    if (ui.viewer) {
      if (k === 'ArrowLeft') ui.viewerStep(-1);
      else if (k === 'ArrowRight' || k === ' ') ui.viewerStep(1);
      else if (k === 'Escape' || k === 'Backspace' || k === 'b' || k === 'B') ui.closeViewer();
      e.preventDefault();
      return;
    }
    if (ui.modal) {
      if (k === 'Escape') {
        ui.closeModal();
        e.preventDefault();
      }
      return;
    }
    if (ui.pickOpen && (k === 'Escape' || !ui.typing)) {
      // Auswahlfenster „Zur Wiedergabeliste“: Esc schließt, sonst nur Tab/Enter darin
      if (k === 'Escape') {
        ui.closePopover();
        e.preventDefault();
      }
      return;
    }
    if (ui.deckOpen && !ui.typing) {
      // Große Plattenspieler-Ansicht: nur Zurück und die Wiedergabe-Tasten
      const back = k === 'Escape' || k === 'Backspace' || k === 'd' || k === 'D';
      if (back) actions.closeDeck();
      else if (k === ' ') player.toggle();
      else if (k === '[') player.prev();
      else if (k === ']') player.next();
      else if (k === 'm' || k === 'M') player.toggleMute();
      else if (k === '+' || k === '=') player.setVolume(player.volume + 0.05);
      else if (k === '-') player.setVolume(player.volume - 0.05);
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (player.current) player.seek(player.time + (k === 'ArrowLeft' ? -10 : 10));
      } else return;
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'k')) {
      e.preventDefault();
      ui.focusSearch();
      return;
    }
    if (e.altKey && !ui.typing && this.inspecting && (k === 'ArrowUp' || k === 'ArrowDown')) {
      // Wiedergabeliste: gewählten Titel verschieben
      ui.moveFocusedTrack(k === 'ArrowUp' ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (ui.typing || e.ctrlKey || e.metaKey || e.altKey) return;

    const inspect = this.inspecting;
    let handled = true;
    switch (k) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = k === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey && player.current) player.seek(player.time + dir * 10);
        else store.step(dir);
        break;
      }
      case 'ArrowUp':
        if (inspect) ui.moveTrackFocus(-1);
        else if (this.carousel?.isWall) this.actions.shelfRow(-1);
        else handled = false;
        break;
      case 'ArrowDown':
        if (inspect) ui.moveTrackFocus(1);
        else if (this.carousel?.isWall) this.actions.shelfRow(1);
        else handled = false;
        break;
      case 'PageUp':
        store.step(-10, { jump: true });
        break;
      case 'PageDown':
        store.step(10, { jump: true });
        break;
      case 'Home':
        store.select(0, { jump: true });
        break;
      case 'End':
        store.select(store.view.length - 1, { jump: true });
        break;
      case 'Enter':
        if (inspect) {
          if (ui.focusTrack >= 0) actions.playTrack(ui.focusTrack);
          else actions.playAlbum();
        } else actions.inspect();
        break;
      case 'Escape':
      case 'Backspace':
        if (inspect) actions.back();
        else if (store.query) {
          ui.el.search.value = '';
          store.setQuery('');
        } else handled = false;
        break;
      case ' ':
        if (player.current) player.toggle();
        else actions.playAlbum();
        break;
      case 'p':
      case 'P':
        actions.playAlbum();
        break;
      case 'r':
      case 'R':
        actions.randomAlbum();
        break;
      case 'f':
      case 'F':
        if (inspect) actions.flip();
        break;
      case 'o':
      case 'O':
        if (inspect) actions.toggleLid();
        break;
      case 'b':
      case 'B':
        if (inspect) actions.openBooklet();
        break;
      case 's':
      case 'S':
        actions.toggleFavorite();
        break;
      case 'v':
      case 'V':
        actions.cycleView();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        actions.setView(VIEW_ORDER[Number(k) - 1]);
        break;
      case 'w':
      case 'W':
        actions.addCurrent();
        break;
      case 'Delete':
        if (inspect) ui.removeFocusedTrack();
        else handled = false;
        break;
      case 'l':
      case 'L':
        actions.cycleLayout();
        break;
      case 't':
      case 'T':
        actions.cycleTheme();
        break;
      case '/':
        ui.focusSearch();
        break;
      case '?':
      case 'h':
      case 'H':
        ui.openModal('help');
        break;
      case '[':
        player.prev();
        break;
      case ']':
        player.next();
        break;
      case 'm':
      case 'M':
        player.toggleMute();
        break;
      case 'd':
      case 'D':
        actions.toggleDeck();
        break;
      case '+':
      case '=':
        player.setVolume(player.volume + 0.05);
        break;
      case '-':
        player.setVolume(player.volume - 0.05);
        break;
      case '0':
        if (inspect) carousel.resetView();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  // ---------- Maus & Touch ----------
  #onDown(e) {
    this.onActivity();
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointer = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), drag: false, vel: 0 };
  }

  #onMove(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    this.onActivity();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const now = performance.now();
    const dt = Math.max(1, now - p.t);
    if (!p.drag && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DRAG_PX) {
      p.drag = true;
      if (this.inspecting) this.carousel.rotating = true;
      else this.carousel.dragStart();
    }
    if (p.drag) {
      if (this.inspecting) {
        this.carousel.rotateBy(dx * 0.009, dy * 0.006);
      } else {
        const perItem = this.#pxPerItem();
        const items = -dx / perItem;
        this.carousel.dragBy(items);
        const v = (items / dt) * 1000;
        p.vel = p.vel * 0.6 + v * 0.4;
      }
    }
    p.x = e.clientX;
    p.y = e.clientY;
    p.t = now;
  }

  #onUp(e, cancel = false) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    this.pointer = null;
    if (p.drag) {
      if (this.carousel.rotating) this.carousel.rotating = false;
      else {
        const stale = performance.now() - p.t > 120;
        this.carousel.dragEnd(stale ? 0 : p.vel);
      }
      return;
    }
    if (!cancel) this.#click(e);
  }

  #pxPerItem() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const layout = this.store.settings.layout;
    if (layout === 'shelf') return Math.max(18, w / 46);
    if (layout === 'wheel') return Math.max(60, w / 9);
    return Math.max(60, w / 11);
  }

  #click(e) {
    const ndc = this.stage.ndc(e.clientX, e.clientY);
    const slot = this.carousel.pick(ndc);
    if (!this.inspecting) {
      if (!slot) return;
      if (slot.index === this.store.index) this.actions.inspect();
      else this.store.select(slot.index);
      return;
    }
    const inspected = this.carousel.inspected;
    if (slot && slot === inspected) {
      // Einfachklick: öffnen/schließen, Doppelklick: umdrehen
      if (this.clickTimer) {
        clearTimeout(this.clickTimer);
        this.clickTimer = null;
        this.actions.flip();
      } else {
        this.clickTimer = setTimeout(() => {
          this.clickTimer = null;
          this.actions.toggleLid();
        }, 240);
      }
    } else if (slot) {
      this.store.select(slot.index);
    } else {
      this.actions.back();
    }
  }

  #onWheel(e) {
    e.preventDefault();
    this.onActivity();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 40;
      dy *= 40;
    } else if (e.deltaMode === 2) {
      dx *= 400;
      dy *= 400;
    }
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (this.inspecting) {
      this.carousel.rotateBy(d * 0.0035, 0);
      return;
    }
    this.wheelAcc += d;
    const step = this.store.settings.layout === 'shelf' ? 30 : 55;
    while (Math.abs(this.wheelAcc) >= step) {
      const s = Math.sign(this.wheelAcc);
      this.store.step(s);
      this.wheelAcc -= s * step;
    }
    clearTimeout(this.wheelReset);
    this.wheelReset = setTimeout(() => (this.wheelAcc = 0), 200);
  }

  // ---------- Gamepad ----------
  pollGamepads(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) {
      if (p && p.connected) {
        gp = p;
        break;
      }
    }
    if (!gp) return;
    const pad = this.pad;
    const now = performance.now();
    const pressed = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.6);
    const edge = (i) => pressed(i) && !pad.prev[i];

    const lx = gp.axes[0] ?? 0;
    const ly = gp.axes[1] ?? 0;
    const dirX = pressed(14) || lx < -0.55 ? -1 : pressed(15) || lx > 0.55 ? 1 : 0;
    const dirY = pressed(12) || ly < -0.55 ? -1 : pressed(13) || ly > 0.55 ? 1 : 0;

    const { ui, store, actions, player, carousel } = this;
    let active = false;
    if (ui.deckOpen) {
      // Große Plattenspieler-Ansicht: Sticks drehen die Kamera, B zurück, Start = Pause
      const ax = Math.abs(lx) > 0.2 ? lx : gp.axes[2] ?? 0;
      const ay = Math.abs(ly) > 0.2 ? ly : gp.axes[3] ?? 0;
      if (Math.abs(ax) > 0.18 || Math.abs(ay) > 0.18) {
        actions.deckOrbit(ax * dt * 420, ay * dt * 260);
        active = true;
      }
      if (edge(1) || edge(10)) actions.closeDeck();
      if (edge(9)) player.toggle();
      if (edge(6)) player.prev();
      if (edge(7)) player.next();
      for (const i of [1, 6, 7, 9, 10]) if (edge(i)) active = true;
      pad.prev = gp.buttons.map((b) => b.pressed || b.value > 0.6);
      if (active) this.onActivity();
      return;
    }
    const fireX = (dir) => {
      if (ui.viewer) return ui.viewerStep(dir);
      if (ui.modal) return;
      store.step(dir);
    };
    const fireY = (dir) => {
      if (ui.viewer || ui.modal) return;
      if (this.inspecting) ui.moveTrackFocus(dir);
      else if (carousel?.isWall) actions.shelfRow(dir);
      else if (dir < 0) actions.inspect();
    };
    const repeat = (dir, key, fire) => {
      if (dir === 0) {
        pad[key] = 0;
        return;
      }
      active = true;
      const heldKey = key === 'dirX' ? 'heldX' : 'heldY';
      const nextKey = key === 'dirX' ? 'nextX' : 'nextY';
      if (pad[key] !== dir) {
        pad[key] = dir;
        pad[heldKey] = now;
        pad[nextKey] = now + 380;
        fire(dir);
      } else if (now >= pad[nextKey]) {
        const held = now - pad[heldKey];
        pad[nextKey] = now + (held > 2500 ? 40 : held > 1200 ? 70 : 110);
        fire(dir);
      }
    };
    repeat(dirX, 'dirX', fireX);
    repeat(dirY, 'dirY', fireY);

    if (edge(0)) {
      active = true;
      if (ui.viewer) ui.viewerStep(1);
      else if (ui.modal) ui.closeModal();
      else if (this.inspecting) {
        if (ui.focusTrack >= 0) actions.playTrack(ui.focusTrack);
        else actions.playAlbum();
      } else actions.inspect();
    }
    if (edge(1)) {
      active = true;
      if (!ui.closeViewer() && !ui.closeModal() && this.inspecting) actions.back();
    }
    if (edge(2)) {
      active = true;
      actions.playAlbum();
    }
    if (edge(3)) {
      active = true;
      if (this.inspecting) actions.flip();
      else actions.randomAlbum();
    }
    if (edge(4)) {
      active = true;
      store.jumpLetter(-1);
    }
    if (edge(5)) {
      active = true;
      store.jumpLetter(1);
    }
    if (edge(6)) {
      active = true;
      player.prev();
    }
    if (edge(7)) {
      active = true;
      player.next();
    }
    if (edge(8)) {
      active = true;
      if (this.inspecting) actions.toggleLid();
      else actions.cycleLayout();
    }
    if (edge(9)) {
      active = true;
      if (player.current) player.toggle();
      else actions.playAlbum();
    }
    if (edge(11)) {
      active = true;
      actions.toggleFavorite();
    }
    if (edge(10)) {
      active = true;
      // Linker Stick drücken: in der Detailansicht Booklet, sonst Plattenspieler groß
      if (this.inspecting && ui.panelDetail?.tracks?.length) actions.openBooklet();
      else if (player.current) actions.openDeck();
    }

    const rx = gp.axes[2] ?? 0;
    const ry = gp.axes[3] ?? 0;
    if (this.inspecting && (Math.abs(rx) > 0.18 || Math.abs(ry) > 0.18)) {
      active = true;
      carousel.rotating = true;
      carousel.rotateBy(rx * dt * 2.6, ry * dt * 1.8);
      pad.rotating = true;
    } else if (pad.rotating) {
      pad.rotating = false;
      carousel.rotating = false;
    }

    pad.prev = gp.buttons.map((b) => b.pressed || b.value > 0.6);
    if (active) this.onActivity();
  }
}

