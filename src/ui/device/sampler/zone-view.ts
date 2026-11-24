/* The Sampler's zone editor, like Live's: at the top the keyboard, below a row per
 * zone with the bar of its keys (as tall as its velocities) and a dot on the root note. The
 * bars are dragged whole (with the root note) or by an edge; a click on the keyboard plays the
 * key. The wheel zooms on the keys around the pointer (Shift+wheel scrolls, on the names
 * it scrolls the rows); double click on empty space goes back to the whole keyboard. The rows of the zones that
 * play light up and the played keys blink. This is the DOM: the rules are in zone-geometry, the drawing in zone-painter. */
import { zoneMap } from '../../../devices/instruments/sampler/sampler';
import type { ParamValues } from '../../../model/device';
import { fit } from '../../kit/canvas';
import { drag } from '../../kit/pointer';
import {
  CURSOR_OF, KeyWindow, movedZone, NAME_W, revealedTop, rowAt, visibleRows, wheeledRows, zoneHit, type ZoneHit, type ZoneRow,
} from './zone-geometry';
import { paintZones } from './zone-painter';

export type { ZoneRow } from './zone-geometry';

/** How long a played key stays lit (ms). */
const FLASH = 180;

export interface ZoneHost {
  values(): Readonly<Record<string, number>>;
  /** The zones that have a sample, in order. */
  rows(): readonly ZoneRow[];
  selected(): number;
  select(zone: number): void;
  set(values: ParamValues, final: boolean): void;
  audition(pitch: number): void;
  /** The zones playing now. */
  sounding(): ReadonlySet<number>;
  /** The notes played since last time. */
  played(): readonly number[];
  /** Double click on the empty row at the bottom: loads files into new zones. */
  add(): void;
  /** Shows the root note (not in Slice). */
  pitched(): boolean;
  menu(x: number, y: number): void;
}

export class ZoneView {
  readonly canvas = document.createElement('canvas');
  private k0 = 0;
  private k1 = 128;
  /** The first visible row. */
  private top = 0;
  private hot: ZoneHit | null = null;
  private enabled = true;
  private readonly flashes = new Map<number, number>();
  private lit: ReadonlySet<number> = new Set();
  /** The zone chosen at the last drawing: when it changes, its row is brought into view. */
  private revealed = -1;

  constructor(private readonly host: ZoneHost) {
    const c = this.canvas;
    c.className = 'smp-zones';
    c.title = 'Drag a bar (or one of its edges) · click on the keyboard: play · wheel: zoom · double click: the whole keyboard · audio files: new zones from the key';
    c.addEventListener('pointerdown', e => this.press(e));
    c.addEventListener('pointermove', e => {
      if (e.buttons) return;
      const h = this.hit(e.clientX, e.clientY);
      const changed = JSON.stringify(h) !== JSON.stringify(this.hot);
      this.hot = h;
      c.style.cursor = CURSOR_OF[h.kind] ?? 'default';
      if (changed) this.paint();
    });
    c.addEventListener('pointerleave', () => {
      this.hot = null;
      this.paint();
    });
    c.addEventListener('dblclick', e => {
      const h = this.hit(e.clientX, e.clientY);
      if (h.kind === 'empty' && this.rowAt(e.clientY) >= this.host.rows().length) this.host.add();
      else if (h.kind === 'empty' || h.kind === 'row') this.zoomAll();
    });
    c.addEventListener('wheel', e => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const h = this.hit(e.clientX, e.clientY);
      if ('zone' in h) this.host.select(h.zone);
      this.host.menu(e.clientX, e.clientY);
    });
  }

  zoomAll(): void {
    this.k0 = 0;
    this.k1 = 128;
    this.paint();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** The key under the pointer (for the files dropped on it), or null on the names column. */
  keyAt(clientX: number): number | null {
    return this.win.keyAt(clientX - this.canvas.getBoundingClientRect().left);
  }

  /** The zone of the row under the pointer, or null. */
  zoneAt(clientY: number): number | null {
    return this.host.rows()[this.rowAt(clientY)]?.index ?? null;
  }

  /** At every frame: the playing zones and the played keys. */
  tick(): void {
    const now = performance.now();
    for (const p of this.host.played()) this.flashes.set(p, now);
    for (const [p, t] of this.flashes) if (now - t > FLASH) this.flashes.delete(p);
    const lit = this.host.sounding();
    if (this.flashes.size || lit.size || this.lit.size) {
      this.lit = lit;
      this.paint();
    }
  }

  // ---------------------------------------------------------------- measures

  /** The keys shown, over the canvas's width. */
  private get win(): KeyWindow {
    return new KeyWindow(this.k0, this.k1, this.canvas.clientWidth);
  }

  private rowAt(clientY: number): number {
    return rowAt(clientY - this.canvas.getBoundingClientRect().top, this.top);
  }

  private hit(clientX: number, clientY: number): ZoneHit {
    const r = this.canvas.getBoundingClientRect();
    return zoneHit(this.win, this.host.rows(), this.host.values(), clientX - r.left, clientY - r.top, this.top);
  }

  // ---------------------------------------------------------------- gestures

  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    const h = this.hit(e.clientX, e.clientY);
    if (h.kind === 'key') return this.host.audition(h.key);
    if (h.kind === 'empty') return;
    this.host.select(h.zone);
    if (h.kind === 'name' || h.kind === 'row') return;
    e.preventDefault();
    const z0 = zoneMap(this.host.values(), h.zone);
    const perKey = this.win.keysWidth / (this.k1 - this.k0);
    let last: ParamValues | null = null;
    drag(e, this.canvas, dx => {
      const next = movedZone(h.kind, z0, Math.round(dx / perKey));
      if (JSON.stringify(next) === JSON.stringify(last)) return;
      last = next;
      this.host.set(next, false);
    }, () => { if (last) this.host.set(last, true); });
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const x = e.clientX - this.canvas.getBoundingClientRect().left;
    if (x < NAME_W) {
      // on the names: the rows
      this.top = wheeledRows(this.top, this.host.rows().length, visibleRows(this.canvas.clientHeight), e.deltaY);
      return this.paint();
    }
    const next = this.win.wheeled({ deltaX: e.deltaX, deltaY: e.deltaY, shift: e.shiftKey }, x);
    this.k0 = next.k0;
    this.k1 = next.k1;
    this.paint();
  }

  // ---------------------------------------------------------------- drawing

  paint(): void {
    const g = fit(this.canvas);
    if (!g) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const rows = this.host.rows(), selected = this.host.selected(), shown = visibleRows(h);
    // a newly selected zone scrolls into view; the scroll stays within the rows
    this.top = revealedTop(rows, selected, this.revealed, this.top, shown);
    this.revealed = selected;
    paintZones({
      g, w, h, win: this.win, top: this.top, shown, rows, selected, values: this.host.values(), pitched: this.host.pitched(),
      hot: this.hot, lit: this.lit, enabled: this.enabled,
      flashing: k => this.flashes.has(k) && performance.now() - this.flashes.get(k)! < FLASH,
    });
  }
}
