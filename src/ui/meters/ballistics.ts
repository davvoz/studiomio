/* How a meter moves on screen: dB scale and "ballistics" (the peak falls
 * slowly, the maximum value stays still for a moment, the clip stays lit until it's
 * reset). Pure functions and a class without DOM, so they're tested in tests. */
import type { MeterReading } from '../../engine/meters';

/** Below this level the meter is empty. */
export const FLOOR_DB = -70;
/** Falling speed of the peak, in dB per second. */
const FALL_DB_PER_S = 24;
/** How long the maximum mark stays still before rejoining the peak, in seconds. */
const HOLD_S = 1.5;

export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** The meters' scale (similar to the DAWs' IEC 60268-18): more space near 0,
 *  little for very low levels. Pairs (dB, position 0..1), +6 dB at the top. */
const SCALE: readonly (readonly [db: number, pos: number])[] = [
  [FLOOR_DB, 0], [-60, 0.04], [-50, 0.09], [-40, 0.17], [-30, 0.28], [-20, 0.43],
  [-12, 0.58], [-6, 0.71], [0, 0.86], [6, 1],
];

/** Position (0 at the bottom, 1 at the top) of a level in dB. */
export function meterPosition(db: number): number {
  if (!(db > FLOOR_DB)) return 0;
  for (let i = 1; i < SCALE.length; i++) {
    const [d1, p1] = SCALE[i];
    if (db <= d1) {
      const [d0, p0] = SCALE[i - 1];
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
    }
  }
  return 1;
}

/** The shown state of a stereo meter, updated at every frame. */
export class Ballistics {
  readonly peak = [FLOOR_DB, FLOOR_DB];
  readonly rms = [FLOOR_DB, FLOOR_DB];
  readonly hold = [FLOOR_DB, FLOOR_DB];
  private readonly holdAge = [0, 0];
  /** The highest peak since the last reset (the master's number). */
  max = FLOOR_DB;
  /** The signal touched 0 dBFS since the last reset. */
  clip = false;

  update(r: MeterReading, dt: number): void {
    const fall = FALL_DB_PER_S * dt;
    for (const c of [0, 1]) {
      const p = Math.max(FLOOR_DB, gainToDb(r.peak[c]));
      this.peak[c] = Math.max(p, this.peak[c] - fall);
      this.rms[c] = Math.max(FLOOR_DB, gainToDb(r.rms[c]));
      if (p >= this.hold[c]) {
        this.hold[c] = p;
        this.holdAge[c] = 0;
      } else if ((this.holdAge[c] += dt) > HOLD_S) this.hold[c] = this.peak[c]; // the wait over, it follows the peak
      this.max = Math.max(this.max, p);
      if (r.peak[c] >= 1) this.clip = true;
    }
  }

  /** True if there's nothing to show (everything at the bottom of the scale). */
  get idle(): boolean {
    return [...this.peak, ...this.rms, ...this.hold].every(v => v <= FLOOR_DB);
  }

  resetClip(): void {
    this.clip = false;
    this.max = FLOOR_DB;
  }
}
