/* The drawing of a modulation lane: grid, what doesn't play darker, the neutral line, the chosen range,
 * the curve with its points, for a choice the option heard, the value under the pointer, the playhead. */
import type { Beats, TimeSignature } from '../../core/music-time';
import type { Color } from '../../model/clip';
import { envelopeValueAt, type EnvelopePoint, type ModTarget } from '../../model/envelope';
import { paintBeatGrid } from '../clip-editor/clip-frame';
import { COLORS, withAlpha } from '../timeline/painters';
import type { LaneRange } from './lane-drags';
import type { LaneGeometry } from './lane-geometry';
import { choiceTarget, formatModValue, type ModChain } from './mod-targets';

/** Below this distance the points' squares aren't drawn: on a dense shape they're a wall. */
const HANDLE_GAP_PX = 8;

export interface LanePaint {
  readonly g: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly geo: LaneGeometry;
  readonly target: ModTarget;
  readonly signature: TimeSignature;
  /** The playing part (outside it's darker), if the host has one. */
  readonly span: { readonly start: Beats; readonly end: Beats } | null | undefined;
  readonly range: LaneRange | null;
  readonly points: readonly EnvelopePoint[];
  readonly color: Color;
  readonly draw: boolean;
  /** Where the pointer is over the lane, if it is. */
  readonly hover: { readonly x: number; readonly y: number } | null;
  /** A drag is in progress: the value shown is the curve's, not the pointer's. */
  readonly dragging: boolean;
  readonly chain: ModChain | null;
  readonly playhead: Beats | null;
}

/** The empty lane (nothing open): only the background. */
export function paintLaneBackground(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#15171a';
  g.fillRect(0, 0, w, h);
}

export function paintLane(p: LanePaint): void {
  const { g, width: w, height: h, geo } = p, axis = geo.axis;
  paintLaneBackground(g, w, h);
  paintBeatGrid(g, axis, w, 0, h, geo.grid, p.signature);
  // outside what plays: darker
  if (p.span) {
    const x0 = axis.beatToX(p.span.start), x1 = axis.beatToX(p.span.end);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(0, 0, Math.max(0, x0), h);
    g.fillRect(x1, 0, Math.max(0, w - x1), h);
  }
  // the neutral line (no modulation)
  const ny = Math.round(geo.valueToY(geo.scale.neutral)) + 0.5;
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(0, ny);
  g.lineTo(w, ny);
  g.stroke();
  g.setLineDash([]);
  if (p.range) paintRange(p);
  g.font = '10.5px system-ui, sans-serif';
  if (p.points.length) paintCurve(p, ny);
  else {
    g.fillStyle = COLORS.rulerText;
    g.fillText(p.draw ? 'Drag to draw in steps · with Alt freehand · B to exit' : 'Click: a point · B: draw · F: ready-made shapes · Shift+drag: choose a range · Ctrl+V: paste', 8, h - 8);
  }
  // the value under the pointer (or of the dragged point)
  if (p.hover) {
    const v = p.dragging ? null : geo.yToValue(p.hover.y);
    const text = formatModValue(p.target, v ?? envelopeValueAt(p.points, axis.xToBeat(p.hover.x)), p.chain);
    g.fillStyle = '#e8eaee';
    g.fillText(text, Math.min(w - 110, p.hover.x + 10), Math.max(12, Math.min(h - 4, p.hover.y - 6)));
  }
  if (p.playhead !== null) {
    g.fillStyle = COLORS.playhead;
    g.fillRect(Math.round(axis.beatToX(p.playhead)) - 0.5, 0, 2, h);
  }
}

function paintRange({ g, geo, range, height: h }: LanePaint): void {
  const x0 = geo.axis.beatToX(range!.from), x1 = geo.axis.beatToX(range!.to);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(x0, 0, x1 - x0, h);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(Math.round(x0), 0, 1, h);
  g.fillRect(Math.round(x1), 0, 1, h);
}

/** The curve: flat before the first point and after the last, filled down to the neutral line. */
function paintCurve(p: LanePaint, ny: number): void {
  const { g, width: w, geo, points: pts, color } = p;
  const xs = pts.map(q => geo.axis.beatToX(q.beat)), ys = pts.map(q => geo.valueToY(q.value));
  g.beginPath();
  g.moveTo(Math.min(0, xs[0]), ys[0]);
  xs.forEach((x, i) => g.lineTo(x, ys[i]));
  g.lineTo(Math.max(w, xs.at(-1)!), ys.at(-1)!);
  g.lineTo(Math.max(w, xs.at(-1)!), ny);
  g.lineTo(Math.min(0, xs[0]), ny);
  g.closePath();
  g.fillStyle = withAlpha(color, 0.18);
  g.fill();
  g.beginPath();
  g.moveTo(Math.min(0, xs[0]), ys[0]);
  xs.forEach((x, i) => g.lineTo(x, ys[i]));
  g.lineTo(Math.max(w, xs.at(-1)!), ys.at(-1)!);
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.stroke();
  g.lineWidth = 1;
  paintHeardChoice(p);
  const hot = p.hover ? geo.pointAt(pts, p.hover.x, p.hover.y) : -1;
  let shown: { x: number; y: number } | null = null;
  xs.forEach((x, i) => {
    if (x < -4 || x > w + 4) return;
    if (i !== hot && shown && Math.hypot(x - shown.x, ys[i] - shown.y) < HANDLE_GAP_PX) return;
    shown = { x, y: ys[i] };
    g.fillStyle = i === hot ? '#ffffff' : color;
    g.fillRect(Math.round(x) - 3, Math.round(ys[i]) - 3, 7, 7);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeRect(Math.round(x) - 2.5, Math.round(ys[i]) - 2.5, 6, 6);
  });
}

/** For a choice (a switch, a menu): in steps, the option really heard with the
 *  curve and the knob where it is, at the height where that option is exact. */
function paintHeardChoice({ g, width: w, geo, chain, target, points: pts }: LanePaint): void {
  const choice = chain ? choiceTarget(chain, target) : null;
  if (!choice) return;
  const last = choice.spec.options.length - 1;
  const yOf = (option: number) => geo.valueToY((last ? option / last : 0) - choice.baseUnit);
  g.beginPath();
  let prev = -1;
  for (let x = 0; x <= w; x += 2) {
    const option = choice.heard(envelopeValueAt(pts, geo.axis.xToBeat(x)));
    if (prev < 0) g.moveTo(x, yOf(option));
    else if (option !== prev) g.lineTo(x, yOf(prev));
    g.lineTo(x, yOf(option));
    prev = option;
  }
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.setLineDash([3, 3]);
  g.stroke();
  g.setLineDash([]);
}
