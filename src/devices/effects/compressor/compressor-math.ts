/* The compressor's curve: how much comes out (in dB) for how much goes in, with the soft knee
 * (a quadratic blend `knee` dB wide around the threshold). The sound and the drawing use it. */

export interface Curve {
  readonly threshold: number;
  readonly ratio: number;
  readonly knee: number;
}

/** The output level, in dB, for an input level of `x` dB (without output gain). */
export function curveDb(c: Curve, x: number): number {
  const over = x - c.threshold, slope = 1 / c.ratio - 1;
  if (2 * over <= -c.knee) return x;
  if (2 * Math.abs(over) < c.knee) {
    const t = over + c.knee / 2;
    return x + (slope * t * t) / (2 * c.knee);
  }
  return x + slope * over;
}

/** The automatic makeup gain: gives back half the reduction the curve gives at 0 dB
 *  (an ear compromise: with low thresholds raising it all would be too much). */
export const autoMakeup = (c: Curve): number => -curveDb(c, 0) / 2;
