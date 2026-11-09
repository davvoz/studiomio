/* Waveforms with phase in [0, 1). Saw and square use PolyBLEP: the step is
 * rounded off on the sample it falls on, so the harmonics above Nyquist almost vanish
 * (no metallic whistles on high notes). */

export type Wave = (phase: number, dt: number) => number;

/** PolyBLEP correction around a discontinuity at phase 0; `dt` = phase increment. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

const saw: Wave = (t, dt) => 2 * t - 1 - polyBlep(t, dt);
const square: Wave = (t, dt) => (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
const triangle: Wave = t => 1 - 4 * Math.abs(t - 0.5);
const sine: Wave = t => Math.sin(2 * Math.PI * t);

/** Triangle in phase with the sine (0 at phase 0, peak at ¼, trough at ¾), for the LFOs. */
export function sineTriangle(p: number): number {
  if (p < 0.25) return 4 * p;
  if (p < 0.75) return 2 - 4 * p;
  return 4 * p - 4;
}

/** In the order of the options of the "wave" parameters (Saw, Square, Triangle, Sine). */
export const WAVE_TABLE: readonly Wave[] = [saw, square, triangle, sine];

/** LFO waves (Sine, Triangle, Square), without corrections: it goes slowly. */
export const LFO_TABLE: readonly Wave[] = [sine, triangle, t => (t < 0.5 ? 1 : -1)];
