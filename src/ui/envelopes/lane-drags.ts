/* The drags in a modulation lane: a point (added or moved), steps painted on the grid or freehand, a
 * range chosen, a range moved. Each one gives the points as they'll be on release (one undo step).
 * `geo` gives the lane's geometry now: the view may scroll or zoom during a drag. */
import type { Beats } from '../../core/music-time';
import { snapToScale, type EnvelopePoint } from '../../model/envelope';
import { snapTo } from '../timeline/geometry';
import { clearRange, EPS, paintStep, replaceRange, sliceRange } from './envelope-points';
import type { LaneGeometry } from './lane-geometry';

/** A drag in the lane: the points as they'll be on release. */
export interface LaneDrag {
  points: EnvelopePoint[];
  changed: boolean;
  readonly label: string;
  /** Chooses a range: it doesn't touch the curve. */
  readonly sweep?: boolean;
  move(x: number, y: number, alt: boolean, shift: boolean): void;
  /** Cancelled: puts back what it touched besides the points. */
  cancel?(): void;
}

/** A range of time chosen in the lane. */
export interface LaneRange {
  readonly from: Beats;
  readonly to: Beats;
}

type Geometry = () => LaneGeometry;
type SetRange = (range: LaneRange | null) => void;

/** How dense the freehand drawing can be, in parts of the grid. */
const FREEHAND_STEPS = 8;

/** Drags point `index` of `start`, between its neighbours; with Shift the value moves 10 times slower. */
export function pointDrag(geo: Geometry, start: readonly EnvelopePoint[], index: number, label: string, changed: boolean): LaneDrag {
  const prev = start[index - 1]?.beat ?? 0, next = start[index + 1]?.beat ?? Infinity;
  const origin = start[index];
  let fineY: number | null = null, fineValue = origin.value;
  const drag: LaneDrag = {
    points: [...start], changed, label,
    move: (x, y, alt, shift) => {
      const g = geo();
      const beat = Math.max(prev, Math.min(next, g.snap(g.axis.xToBeat(x), alt)));
      // with Shift the value moves 10 times slower, from where it was
      if (shift) {
        fineY ??= y;
        const span = g.scale.max - g.scale.min;
        fineValue = Math.max(g.scale.min, Math.min(g.scale.max, fineValue - ((y - fineY) / g.curveHeight) * span * 0.1));
        fineY = y;
      } else {
        fineY = null;
        fineValue = g.yToValue(y);
      }
      const p = { beat, value: snapToScale(fineValue, g.scale) };
      drag.points = start.map((q, i) => (i === index ? p : q));
      drag.changed = true;
    },
  };
  return drag;
}

/** Paints steps on the grid: each touched cell takes the value under the pointer; if
 *  the pointer skips some cells, those in between take the values between the two points.
 *  With Alt freehand: a line from the previous point. */
export function drawDrag(geo: Geometry, start: readonly EnvelopePoint[]): LaneDrag {
  let last: { beat: Beats; value: number } | null = null;
  const drag: LaneDrag = {
    points: [...start], changed: false, label: 'Draw modulation',
    move: (x, y, alt) => {
      const g = geo(), grid = g.grid, beat = Math.max(0, g.axis.xToBeat(x)), value = g.yToValue(y);
      if (alt) {
        const at = snapTo(beat, grid / FREEHAND_STEPS);
        if (last && at !== last.beat) {
          const [a, b] = at > last.beat ? [last, { beat: at, value }] : [{ beat: at, value }, last];
          drag.points = replaceRange(drag.points, a.beat, b.beat, [a, b], g.scale.neutral);
        }
        last = { beat: at, value };
        drag.changed = true;
        return;
      }
      const a = last ?? { beat, value };
      const c0 = Math.floor(Math.min(a.beat, beat) / grid + EPS), c1 = Math.floor(Math.max(a.beat, beat) / grid + EPS);
      for (let c = c0; c <= c1; c++) {
        const u = beat === a.beat ? 1 : Math.max(0, Math.min(1, ((c + 0.5) * grid - a.beat) / (beat - a.beat)));
        drag.points = paintStep(drag.points, c * grid, (c + 1) * grid, snapToScale(a.value + (value - a.value) * u, g.scale), g.scale.neutral);
      }
      last = { beat, value };
      drag.changed = true;
    },
  };
  return drag;
}

/** Chooses a range by dragging (on the grid; Alt: without). */
export function sweepDrag(geo: Geometry, start: readonly EnvelopePoint[], x0: number, setRange: SetRange): LaneDrag {
  const g0 = geo(), from = g0.snap(g0.axis.xToBeat(x0), false);
  return {
    points: [...start], changed: false, label: '', sweep: true,
    move: (x, _y, alt) => {
      const g = geo(), at = g.snap(g.axis.xToBeat(x), alt);
      setRange({ from: Math.min(from, at), to: Math.max(from, at) });
    },
    cancel: () => setRange(null),
  };
}

/** Drags the chosen range: in time on the grid (Alt: without), in value all together. */
export function rangeDrag(geo: Geometry, start: readonly EnvelopePoint[], range: LaneRange, x0: number, y0: number, setRange: SetRange): LaneDrag {
  const g0 = geo(), { neutral, min, max } = g0.scale, axis = g0.axis;
  const inner = sliceRange(start, range.from, range.to, neutral), base = clearRange(start, range.from, range.to, neutral);
  const beat0 = axis.xToBeat(x0), value0 = g0.yToValue(y0), length = range.to - range.from;
  const drag: LaneDrag = {
    points: [...start], changed: false, label: 'Move modulation range',
    move: (x, y, alt) => {
      const g = geo();
      const raw = axis.xToBeat(x) - beat0, dt = Math.max(-range.from, alt ? raw : snapTo(raw, g.grid));
      const dv = g.yToValue(y) - value0, from = range.from + dt;
      const moved = inner.map(p => ({ beat: from + p.beat, value: Math.max(min, Math.min(max, p.value + dv)) }));
      drag.points = replaceRange(base, from, from + length, moved, neutral);
      setRange({ from, to: from + length });
    },
    cancel: () => setRange(range),
  };
  return drag;
}

/** A press in the lane. */
export interface LanePress {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Draw mode (B). */
  readonly draw: boolean;
  /** The curve now. */
  readonly points: readonly EnvelopePoint[];
  /** The chosen range, if any. */
  readonly range: LaneRange | null;
}

/** The drag a press starts: in draw mode the steps, with Shift a range to choose, in the chosen range
 *  the range, on a point that point, elsewhere a new point. A click outside the range just leaves
 *  it (null: nothing starts), except in draw mode. A click on a point or in the range moves nothing. */
export function pressLane(geo: Geometry, p: LanePress, setRange: SetRange): LaneDrag | null {
  const g = geo(), range = p.range;
  const hit = g.pointAt(p.points, p.x, p.y), beat = g.axis.xToBeat(p.x);
  const inRange = !!range && beat >= range.from && beat <= range.to;
  if (range && !inRange && !p.shift) {
    setRange(null);
    if (!p.draw) return null;
  }
  const drag = startDrag(geo, p, hit, inRange ? range : null, setRange);
  drag.move(p.x, p.y, p.alt, false);
  if (!p.draw && (hit >= 0 || inRange)) drag.changed = false;
  return drag;
}

function startDrag(geo: Geometry, p: LanePress, hit: number, inRange: LaneRange | null, setRange: SetRange): LaneDrag {
  if (p.draw) return drawDrag(geo, p.points);
  if (p.shift) return sweepDrag(geo, p.points, p.x, setRange);
  if (inRange) return rangeDrag(geo, p.points, inRange, p.x, p.y, setRange);
  if (hit >= 0) return pointDrag(geo, p.points, hit, 'Move modulation point', false);
  // a new point where it was pressed, ready to drag
  const g = geo(), q = { beat: g.snap(g.axis.xToBeat(p.x), p.alt), value: g.yToValue(p.y) };
  const i = p.points.filter(o => o.beat <= q.beat).length;
  return pointDrag(geo, [...p.points.slice(0, i), q, ...p.points.slice(i)], i, 'Add modulation point', true);
}

/** The cursor over the lane: a crosshair to draw, text to choose a range, move on a point or the range,
 *  copy (a new point) elsewhere. */
export function laneCursor(g: LaneGeometry, points: readonly EnvelopePoint[], range: LaneRange | null, x: number, y: number, shift: boolean, draw: boolean): string {
  if (draw) return 'crosshair';
  if (shift) return 'text';
  const beat = g.axis.xToBeat(x);
  if (range && beat >= range.from && beat <= range.to) return 'move';
  return g.pointAt(points, x, y) >= 0 ? 'move' : 'copy';
}
