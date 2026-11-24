/* The Sampler zone editor's drawing: at the top the keyboard (the keys just played lit), below a row per
 * zone with the bar of its keys (as tall as its velocities) and a dot on the root note, the rows that
 * play lit, the empty row for new zones, where the zoom and the scroll are. */
import { noteName, zoneMap, type ZoneMap } from '../../../devices/instruments/sampler/sampler';
import { ACCENT, BACKGROUND, GRID, LABEL } from '../../kit/canvas';
import { isBlack, KEYS_H, NAME_W, ROW_H, type KeyWindow, type ZoneHit, type ZoneRow } from './zone-geometry';

/** What the zones are drawn from. */
export interface ZonePaint {
  readonly g: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly win: KeyWindow;
  /** The first row shown, and how many fit. */
  readonly top: number;
  readonly shown: number;
  readonly rows: readonly ZoneRow[];
  readonly selected: number;
  readonly values: Readonly<Record<string, number>>;
  /** The root note is shown (not in Slice). */
  readonly pitched: boolean;
  readonly hot: ZoneHit | null;
  /** The zones playing now. */
  readonly lit: ReadonlySet<number>;
  /** The key was just played (it's lit for a moment). */
  flashing(key: number): boolean;
  readonly enabled: boolean;
}

export function paintZones(p: ZonePaint): void {
  const { g, w, h, win, rows, top, shown } = p;
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = p.enabled ? 1 : 0.5;
  const lo = Math.floor(win.k0), hi = Math.min(127, Math.ceil(win.k1));
  const keyW = win.keysWidth / (win.k1 - win.k0);
  paintColumns(g, win, h, lo, hi, keyW);
  // the zones' rows
  g.font = '10.5px system-ui, sans-serif';
  g.textBaseline = 'middle';
  rows.slice(top, top + shown).forEach((row, i) => paintRow(p, keyW, row, KEYS_H + i * ROW_H));
  paintFreeRow(g, rows.length, top, shown);
  g.fillStyle = GRID;
  g.fillRect(NAME_W - 1, KEYS_H, 1, h - KEYS_H);
  // more rows than are visible: where you are
  if (rows.length + 1 > shown) {
    const span = h - KEYS_H, total = rows.length + 1;
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(NAME_W - 4, KEYS_H + (top / total) * span, 2, Math.max(6, (shown / total) * span));
  }
  paintKeyboard(p, lo, hi, keyW);
  g.globalAlpha = 1;
  g.textBaseline = 'alphabetic';
}

/** The columns of the black keys and the octaves, under the rows. */
function paintColumns(g: CanvasRenderingContext2D, win: KeyWindow, h: number, lo: number, hi: number, keyW: number): void {
  for (let k = lo; k <= hi; k++) {
    const x = win.xOf(k);
    if (isBlack(k)) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x, KEYS_H, keyW, h - KEYS_H);
    }
    if (k % 12 === 0) {
      g.fillStyle = GRID;
      g.fillRect(Math.round(x), KEYS_H, 1, h - KEYS_H);
    }
  }
}

/** A zone's row at `y`: highlighted if chosen or playing, its bar, its root note, its name. */
function paintRow(p: ZonePaint, keyW: number, row: ZoneRow, y: number): void {
  const { g, w, win } = p, z = zoneMap(p.values, row.index), on = row.index === p.selected;
  if (on || p.lit.has(row.index)) {
    g.fillStyle = p.lit.has(row.index) ? 'rgba(255,157,46,0.16)' : 'rgba(255,255,255,0.06)';
    g.fillRect(0, y, w, ROW_H);
  }
  const xa = Math.max(NAME_W, win.xOf(z.lo)), xb = Math.min(w, win.xOf(z.hi + 1));
  if (xb > xa) paintBar(p, row, z, y, xa, xb);
  if (p.pitched && z.root >= win.k0 && z.root < win.k1) {
    g.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.arc(win.xOf(z.root + 0.5), y + ROW_H / 2, Math.min(3, Math.max(1.5, keyW / 3)), 0, 2 * Math.PI);
    g.fill();
  }
  // the name over everything, with the column's background
  g.fillStyle = on ? '#262b31' : BACKGROUND;
  g.fillRect(0, y, NAME_W, ROW_H);
  g.fillStyle = on ? ACCENT : 'rgba(255,255,255,0.8)';
  g.fillText(clip(g, `${row.index + 1}  ${row.name}`, NAME_W - 10), 5, y + ROW_H / 2 + 0.5);
}

/** The zone's bar over its keys, as tall as its velocities, with the keys' name if it fits and
 *  doesn't cover the root note's dot. */
function paintBar(p: ZonePaint, row: ZoneRow, z: ZoneMap, y: number, xa: number, xb: number): void {
  const { g, win } = p, on = row.index === p.selected;
  const hot = p.hot && 'zone' in p.hot && p.hot.zone === row.index;
  const inner = ROW_H - 3, yb = y + ROW_H - 1.5;
  const y0 = yb - (z.vhi / 127) * inner, y1 = yb - ((z.vlo - 1) / 127) * inner;
  if (on) g.fillStyle = ACCENT;
  else g.fillStyle = hot ? 'rgba(255,157,46,0.7)' : 'rgba(255,157,46,0.45)';
  g.fillRect(xa, y0, Math.max(2, xb - xa - 1), Math.max(2, y1 - y0));
  const range = z.lo === z.hi ? noteName(z.lo) : `${noteName(z.lo)}–${noteName(z.hi)}`;
  const textEnd = xa + 8 + g.measureText(range).width, dot = win.xOf(z.root + 0.5);
  if (textEnd < xb && !(p.pitched && dot > xa && dot < textEnd + 3)) {
    g.fillStyle = on ? '#141414' : 'rgba(255,255,255,0.85)';
    g.fillText(range, xa + 4, y + ROW_H / 2 + 0.5);
  }
}

/** The empty row at the bottom: new zones are loaded there. */
function paintFreeRow(g: CanvasRenderingContext2D, count: number, top: number, shown: number): void {
  const free = count - top;
  if (free < 0 || free >= shown) return;
  const y = KEYS_H + free * ROW_H;
  g.fillStyle = BACKGROUND;
  g.fillRect(0, y, NAME_W, ROW_H);
  g.fillStyle = LABEL;
  g.fillText(count ? '+ zones (double click or files)' : 'Drag audio files here', 5, y + ROW_H / 2 + 0.5);
}

/** The keyboard at the top (the keys just played lit), and where the zoom is. */
function paintKeyboard(p: ZonePaint, lo: number, hi: number, keyW: number): void {
  const { g, w, h, win } = p;
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, w, KEYS_H);
  for (let k = lo; k <= hi; k++) {
    const x = win.xOf(k), lit = p.flashing(k);
    const hotKey = p.hot?.kind === 'key' && p.hot.key === k;
    if (lit) g.fillStyle = ACCENT;
    else if (hotKey) g.fillStyle = '#d9d9d9';
    else g.fillStyle = isBlack(k) ? '#2a2d31' : '#b9bcc0';
    g.fillRect(x, 1, Math.max(1, keyW - 1), KEYS_H - 2);
    if (k % 12 === 0 && keyW * 12 > 34) {
      g.fillStyle = '#141414';
      g.font = '600 8.5px system-ui, sans-serif';
      g.fillText(noteName(k), x + 2, KEYS_H / 2 + 0.5);
    }
  }
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, NAME_W, KEYS_H);
  g.fillStyle = LABEL;
  g.font = '10px system-ui, sans-serif';
  g.fillText('Zone', 5, KEYS_H / 2 + 0.5);
  if (win.k1 - win.k0 < 127.9) {
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(NAME_W + (win.k0 / 128) * win.keysWidth, h - 2, Math.max(2, ((win.k1 - win.k0) / 128) * win.keysWidth), 2);
  }
}

/** The text shortened with "…" to fit in `width`. */
export function clip(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}
