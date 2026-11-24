/* Where things are in a modulation lane: a value's height (on a scale in steps, the nearest step),
 * the point under the pointer, a beat on the grid. */
import type { Beats } from '../../core/music-time';
import { snapToScale, type EnvelopePoint, type ModScale } from '../../model/envelope';
import type { BeatAxis } from '../clip-editor/clip-geometry';
import { snapTo } from '../timeline/geometry';

/** Margin above and below the curve. */
export const LANE_PAD = 9;
/** How close (in pixels, across and down) a point is grabbed. */
const HIT_PX = 6;

export class LaneGeometry {
  constructor(
    readonly axis: BeatAxis,
    readonly scale: ModScale,
    /** Where the curve starts (under the shapes' bar, if open). */
    readonly top: number,
    /** The lane's height. */
    readonly height: number,
    /** The grid's step (and the snap's). */
    readonly grid: Beats,
  ) {}

  get curveHeight(): number {
    return Math.max(1, this.height - this.top - LANE_PAD);
  }

  valueToY(v: number): number {
    const { min, max } = this.scale;
    return this.top + (1 - (v - min) / (max - min)) * this.curveHeight;
  }

  /** The value at height `y`; on a scale in steps (an on/off) the nearest step. */
  yToValue(y: number): number {
    const { min, max } = this.scale;
    const u = 1 - (y - this.top) / this.curveHeight;
    return snapToScale(Math.max(min, Math.min(max, min + u * (max - min))), this.scale);
  }

  /** The index of the point under (x, y), the last drawn on top; -1 if none. */
  pointAt(points: readonly EnvelopePoint[], x: number, y: number): number {
    for (let i = points.length - 1; i >= 0; i--) {
      if (Math.abs(this.axis.beatToX(points[i].beat) - x) <= HIT_PX && Math.abs(this.valueToY(points[i].value) - y) <= HIT_PX) return i;
    }
    return -1;
  }

  /** `beat` on the grid (free with Alt), never before 0. */
  snap(beat: Beats, alt: boolean): Beats {
    return Math.max(0, alt ? beat : snapTo(beat, this.grid));
  }
}
