/* The Sampler zone editor's measures and rules, without the DOM: the visible keys (key ↔ pixels), the
 * rows, what's under the pointer, how a dragged bar or edge moves, the wheel on the keys and on the
 * rows, which row a newly chosen zone brings into view. */
import { zoneMap, zoneParam, type ZoneKey, type ZoneMap } from '../../../devices/instruments/sampler/sampler';
import type { ParamValues } from '../../../model/device';

/** The keyboard at the top, the rows and the column of names. */
export const KEYS_H = 16, ROW_H = 14, NAME_W = 118;
/** How much the grip widens on a bar's edges, and the narrowest bar that has edges. */
const EDGE = 4, MIN_EDGES = 14;
/** The tightest zoom, in keys. */
const MIN_KEYS = 12;

/** The pointer over each part of a zone row. */
export const CURSOR_OF: Readonly<Record<string, string>> = { lo: 'ew-resize', hi: 'ew-resize', move: 'grab', key: 'pointer', name: 'pointer' };

export interface ZoneRow {
  readonly index: number;
  readonly name: string;
}

export type ZoneHit =
  | { readonly kind: 'key'; readonly key: number }
  | { readonly kind: 'name'; readonly zone: number }
  | { readonly kind: 'lo' | 'hi' | 'move'; readonly zone: number }
  | { readonly kind: 'row'; readonly zone: number }
  | { readonly kind: 'empty' };

export const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(k % 12);

/** The keys shown (`k0` … `k1`) right of the names, in a canvas `width` wide. */
export class KeyWindow {
  constructor(readonly k0 = 0, readonly k1 = 128, readonly width = NAME_W + 1) {}

  get keysWidth(): number {
    return Math.max(1, this.width - NAME_W);
  }

  xOf(key: number): number {
    return NAME_W + ((key - this.k0) / (this.k1 - this.k0)) * this.keysWidth;
  }

  /** The key at `x` (from the canvas's left), or null on the names column. */
  keyAt(x: number): number | null {
    if (x < NAME_W) return null;
    return Math.max(0, Math.min(127, Math.floor(this.k0 + ((x - NAME_W) / this.keysWidth) * (this.k1 - this.k0))));
  }

  /** The wheel at `x`: Shift (or a sideways turn) scrolls the keys, otherwise it zooms around the key under it. */
  wheeled(w: { readonly deltaX: number; readonly deltaY: number; readonly shift: boolean }, x: number): KeyWindow {
    const span = this.k1 - this.k0;
    if (w.shift || Math.abs(w.deltaX) > Math.abs(w.deltaY)) {
      const d = ((w.shift ? w.deltaY : w.deltaX) / this.keysWidth) * span;
      const k0 = Math.max(0, Math.min(128 - span, this.k0 + d));
      return new KeyWindow(k0, k0 + span, this.width);
    }
    const at = this.k0 + ((x - NAME_W) / this.keysWidth) * span;
    const next = Math.max(MIN_KEYS, Math.min(128, span * Math.pow(1.0015, w.deltaY)));
    const k0 = Math.max(0, Math.min(128 - next, at - ((at - this.k0) / span) * next));
    return new KeyWindow(k0, k0 + next, this.width);
  }
}

/** The row at `y` (from the canvas's top) with the rows scrolled to `top`; -1 on the keyboard. */
export const rowAt = (y: number, top: number): number => (y < KEYS_H ? -1 : top + Math.floor((y - KEYS_H) / ROW_H));

/** How many rows fit in a canvas `h` tall. */
export const visibleRows = (h: number): number => Math.max(1, Math.floor((h - KEYS_H) / ROW_H));

/** What's at (x, y): a key, a zone's name, its bar (an edge, or the whole bar), its row, nothing. */
export function zoneHit(win: KeyWindow, rows: readonly ZoneRow[], values: Readonly<Record<string, number>>, x: number, y: number, top: number): ZoneHit {
  if (y < KEYS_H) {
    const key = win.keyAt(x);
    return key === null ? { kind: 'empty' } : { kind: 'key', key };
  }
  const row = rows[rowAt(y, top)];
  if (!row) return { kind: 'empty' };
  if (x < NAME_W) return { kind: 'name', zone: row.index };
  const z = zoneMap(values, row.index);
  const xa = win.xOf(z.lo), xb = win.xOf(z.hi + 1);
  if (xb - xa >= MIN_EDGES) {
    if (Math.abs(x - xa) <= EDGE) return { kind: 'lo', zone: row.index };
    if (Math.abs(x - xb) <= EDGE) return { kind: 'hi', zone: row.index };
  }
  return x >= xa - 1 && x <= xb + 1 ? { kind: 'move', zone: row.index } : { kind: 'row', zone: row.index };
}

/** The values after moving an edge of the zone by `d` keys, or the whole zone (with the root note). */
export function movedZone(kind: 'lo' | 'hi' | 'move', z: ZoneMap, d: number): ParamValues {
  const id = (key: ZoneKey) => zoneParam(z.index, key);
  if (kind === 'lo') return { [id('lo')]: Math.max(0, Math.min(z.hi, z.lo + d)), [id('hi')]: z.hi };
  if (kind === 'hi') return { [id('lo')]: z.lo, [id('hi')]: Math.max(z.lo, Math.min(127, z.hi + d)) };
  const k = Math.max(-z.lo, Math.min(127 - z.hi, d));
  return { [id('lo')]: z.lo + k, [id('hi')]: z.hi + k, [id('root')]: Math.max(0, Math.min(127, z.root + k)) };
}

/** The wheel on the names: the rows scroll by one, down to the empty row at the bottom. */
export function wheeledRows(top: number, rows: number, shown: number, deltaY: number): number {
  const max = Math.max(0, rows + 1 - shown);
  return Math.max(0, Math.min(max, top + Math.sign(deltaY)));
}

/** The first row shown: a newly chosen zone (`selected` ≠ `revealed`) is brought into view; it stays within the rows. */
export function revealedTop(rows: readonly ZoneRow[], selected: number, revealed: number, top: number, shown: number): number {
  let next = top;
  if (selected !== revealed) {
    const at = rows.findIndex(r => r.index === selected);
    if (at >= 0 && at < next) next = at;
    else if (at >= next + shown) next = at - shown + 1;
  }
  return Math.max(0, Math.min(next, rows.length + 1 - shown));
}
