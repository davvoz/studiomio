/** The saturations of the layered instruments' output, in the order of their choices. */
export const DRIVE_TYPES = ['Soft', 'Hard', 'Folded'] as const;

/** The saturation `type` (in DRIVE_TYPES), with `amount` 0..1: at 0 the sound is clean; then tanh,
 *  hard clipping at ±1, or folding (beyond the edge the wave turns back). */
export function driveSample(x: number, amount: number, type: number): number {
  if (amount < 0.005) return x;
  const d = 1 + amount * 9, wet = Math.min(1, amount * 5);
  let y: number;
  if (type === 1) y = Math.max(-1, Math.min(1, x * d));
  else if (type === 2) y = Math.sin((Math.PI / 2) * x * d);
  else y = Math.tanh(x * d) / Math.tanh(d);
  return x + (y - x) * wet;
}

/** Soft saturation keeping the peak at 1 (`amount` 0..1, at 0 clean). */
export const softClip = (x: number, amount: number): number =>
  (amount < 0.005 ? x : Math.tanh(x * (1 + amount * 6)) / Math.tanh(1 + amount * 6));
