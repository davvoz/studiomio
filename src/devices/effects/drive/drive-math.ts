/* The Drive's maths, shared by the sound (drive-core.ts) and the curve drawing in the panel:
 * so the curve you see is exactly the one you hear. Pure functions.
 *
 * Each curve also has its exact antiderivative: the engine uses it for "ADAA"
 * antialiasing — instead of f(x) at each sample it takes the curve's average slope between the
 * previous sample and this one, (F(x) − F(x₋₁)) / (x − x₋₁). The very high harmonics the distortion
 * creates are attenuated before folding back; together with oversampling the aliasing disappears. */

export interface Shape {
  readonly id: string;
  readonly label: string;
  /** The curve: for small signals almost a straight line, then it saturates. */
  readonly fn: (x: number) => number;
  /** Its antiderivative (F' = fn), for antialiasing. */
  readonly integral: (x: number) => number;
}

const LN2 = Math.LN2;
/** ln(cosh x) without overflowing for large x. */
const logCosh = (x: number): number => {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - LN2;
};

/** The "hard" clip: linear up to KNEE, then a short knee up to 1. */
const KNEE = 0.9, SOFT = 0.1;
const hard = (x: number): number => {
  const a = Math.abs(x);
  return a <= KNEE ? x : Math.sign(x) * (KNEE + SOFT * Math.tanh((a - KNEE) / SOFT));
};
const hardIntegral = (x: number): number => {
  const a = Math.abs(x);
  return a <= KNEE ? (a * a) / 2 : (KNEE * KNEE) / 2 + KNEE * (a - KNEE) + SOFT * SOFT * logCosh((a - KNEE) / SOFT);
};

/** The tube: tanh plus an even part (tanh²) making the curve asymmetric. */
const TUBE_EVEN = 0.25;

/** The curves, in the order of the values of the "Shape" parameter. */
export const SHAPES: readonly Shape[] = [
  // symmetric: odd harmonics, soft
  { id: 'soft', label: 'Soft', fn: x => Math.tanh(x), integral: logCosh },
  // asymmetric: the positive side goes higher, even (warm) harmonics are born
  {
    id: 'tube', label: 'Tube',
    fn: x => { const t = Math.tanh(x); return t + TUBE_EVEN * t * t; },
    integral: x => logCosh(x) + TUBE_EVEN * (x - Math.tanh(x)),
  },
  // very wide knee: it compresses gently, like tape
  { id: 'tape', label: 'Tape', fn: x => x / Math.sqrt(1 + x * x), integral: x => Math.sqrt(1 + x * x) },
  { id: 'hard', label: 'Hard', fn: hard, integral: hardIntegral },
  // very asymmetric: the positive side screams, the negative squashes earlier
  {
    id: 'fuzz', label: 'Fuzz',
    fn: x => (x >= 0 ? 1 - Math.exp(-2 * x) : -0.7 * (1 - Math.exp(1.4 * x))),
    integral: x => (x >= 0 ? x + (Math.exp(-2 * x) - 1) / 2 : -0.7 * x + 0.5 * (Math.exp(1.4 * x) - 1)),
  },
  // folding: beyond the maximum the sound turns back, harmonics everywhere
  { id: 'fold', label: 'Fold', fn: x => Math.sin(x), integral: x => 1 - Math.cos(x) },
];

/** The tabulated antiderivative, for the engine: cubic Hermite interpolation using the values of
 *  F and its exact slope (the curve) at each node, so it stays smooth and consistent with the
 *  curve even on antialiasing's tiny differences; outside the table the curve is
 *  flat by now and the antiderivative continues in a straight line. Much faster than log, exp and tanh. */
export class IntegralTable {
  private readonly F: Float64Array;
  private readonly f: Float64Array;
  private readonly step: number;
  private readonly last: number;

  constructor(shape: Shape, readonly range = 24, perUnit = 64) {
    const n = Math.round(2 * range * perUnit) + 1;
    this.step = 1 / perUnit;
    this.last = n - 1;
    this.F = Float64Array.from({ length: n }, (_, i) => shape.integral(-range + i * this.step));
    this.f = Float64Array.from({ length: n }, (_, i) => shape.fn(-range + i * this.step));
  }

  at(x: number): number {
    const { F, f, step, last, range } = this;
    const pos = (x + range) / step;
    if (pos <= 0) return F[0] + f[0] * (x + range);
    if (pos >= last) return F[last] + f[last] * (x - range);
    const i = pos | 0, t = pos - i, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * F[i] + (t3 - 2 * t2 + t) * step * f[i] + (-2 * t3 + 3 * t2) * F[i + 1] + (t3 - t2) * step * f[i + 1];
  }
}

/** The shapes that go round in circles (the fold) can't be put in a finite table. */
const PERIODIC = new Set(['fold']);

/** The fastest antiderivative for the engine: tabulated, or the exact one for periodic shapes. */
export const fastIntegral = (shape: Shape): ((x: number) => number) => {
  if (PERIODIC.has(shape.id)) return shape.integral;
  // tape flattens slowly: longer table
  const table = new IntegralTable(shape, shape.id === 'tape' ? 96 : 24);
  return x => table.at(x);
};

/** Below this distance between two samples the average slope is the curve at the midpoint. */
const ADAA_EPS = 1e-5;

/** An antialiasing step: the "average" value of the curve between `prev` and `x`. */
export function adaa(shape: Shape, x: number, prev: number, fPrev: number, fx: number): number {
  const d = x - prev;
  return Math.abs(d) > ADAA_EPS ? (fx - fPrev) / d : shape.fn((x + prev) / 2);
}

/** The maximum shift of the bias (asymmetry), on the already amplified signal. */
export const MAX_BIAS = 0.5;

export interface DriveSettings {
  readonly shape: number;
  /** Gain before the curve, linear. */
  readonly drive: number;
  /** −1 … +1. */
  readonly bias: number;
}

/** The curve with drive and bias, without a DC step: y(0) = 0. */
export function transfer(s: DriveSettings): (x: number) => number {
  const f = (SHAPES[s.shape] ?? SHAPES[0]).fn, b = s.bias * MAX_BIAS, g = s.drive, f0 = f(b);
  return x => f(g * x + b) - f0;
}

/** Reference level of the makeup: a sine at −6 dBFS comes out at the same volume. */
const REF_AMPLITUDE = 0.5;
const REF_POINTS = 256;

/** The gain bringing a reference sine back to its volume after the curve (RMS, without the
 *  DC the bias leaves). Raising the drive changes the colour, not (much) the volume. */
export function autoGain(s: DriveSettings): number {
  const t = transfer(s);
  let sum = 0, sum2 = 0;
  for (let i = 0; i < REF_POINTS; i++) {
    const y = t(REF_AMPLITUDE * Math.sin((2 * Math.PI * (i + 0.5)) / REF_POINTS));
    sum += y;
    sum2 += y * y;
  }
  const mean = sum / REF_POINTS, rms = Math.sqrt(Math.max(1e-12, sum2 / REF_POINTS - mean * mean));
  return Math.max(0.05, Math.min(4, REF_AMPLITUDE / Math.SQRT2 / rms));
}
