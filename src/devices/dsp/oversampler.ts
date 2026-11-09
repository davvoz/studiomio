/* Oversampling for nonlinearities (saturation, distortion): the sound goes up to 2, 4 or 8
 * times the sample rate, is distorted there, and comes back down filtered. The harmonics the
 * distortion creates above half the original rate are removed instead of folding back
 * (aliasing) into out-of-tune, dirty notes.
 *
 * Each doubling uses a linear-phase "half-band" FIR filter (Kaiser window): half the
 * coefficients are zero and the odd branch is only the centre, so in polyphase form it costs
 * half of a normal FIR. Linear phase = constant delay (`latency`), the same for all
 * frequencies: a signal going up and down without changes comes out identical, only delayed. */

/** Modified Bessel function I0 (series), for the Kaiser window. */
function besselI0(x: number): number {
  let sum = 1, term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/** The even coefficients of a half-band filter `taps` long (of the form 4K+3), with unity gain
 *  at DC; the (odd) centre is 0.5 and the other odd ones 0. */
export function halfbandEvenTaps(taps: number, beta: number): Float64Array {
  if ((taps - 3) % 4 !== 0) throw new RangeError(`a half-band filter has 4K+3 coefficients, not ${taps}`);
  const c = (taps - 1) / 2, even = new Float64Array((taps + 1) / 2), i0 = besselI0(beta);
  let sum = 0;
  for (let k = 0; k < even.length; k++) {
    const i = 2 * k, t = (i - c) / 2;
    const window = besselI0(beta * Math.sqrt(Math.max(0, 1 - ((2 * i) / (taps - 1) - 1) ** 2))) / i0;
    even[k] = (Math.sin(Math.PI * t) / (Math.PI * t)) * 0.5 * window;
    sum += even[k];
  }
  // unity gain at DC: the even ones sum to 0.5 (the other 0.5 is the centre)
  for (let k = 0; k < even.length; k++) even[k] *= 0.5 / sum;
  return even;
}

/** One doubling: up (inserts a sample every two and filters) and down (filters and keeps one every two). */
class HalfbandStage {
  private readonly taps: Float64Array;
  private readonly m: number;
  /** Delay of the odd branch, in samples of the low rate: (taps − 3) / 4. */
  private readonly k: number;
  // doubled histories (each sample written twice): the window is read without modulo
  private readonly upHist: Float64Array;
  private upPos = 0;
  private readonly evenHist: Float64Array;
  private readonly oddHist: Float64Array;
  private downPos = 0;

  constructor(taps: number, beta: number) {
    this.taps = halfbandEvenTaps(taps, beta);
    this.m = this.taps.length;
    this.k = (taps - 3) / 4;
    this.upHist = new Float64Array(2 * this.m);
    this.evenHist = new Float64Array(2 * this.m);
    this.oddHist = new Float64Array(2 * this.m);
  }

  /** Delay of a pass up and down, in samples of the high rate. */
  get delay(): number {
    return 2 * (2 * this.k + 1);
  }

  /** `n` samples of `input` → 2n samples in `out`. */
  up(input: Float32Array, out: Float32Array, n: number): void {
    const { taps, m, upHist: h } = this;
    let pos = this.upPos;
    for (let i = 0; i < n; i++) {
      pos = (pos === 0 ? m : pos) - 1;
      h[pos] = h[pos + m] = input[i];
      // h[pos + j] is x[n − j]
      let acc = 0;
      for (let j = 0; j < m; j++) acc += taps[j] * h[pos + j];
      out[2 * i] = 2 * acc;
      out[2 * i + 1] = h[pos + this.k];
    }
    this.upPos = pos;
  }

  /** 2n samples of `input` → `n` samples in `out`. */
  down(input: Float32Array, out: Float32Array, n: number): void {
    const { taps, m, evenHist: e, oddHist: o } = this;
    let pos = this.downPos;
    for (let i = 0; i < n; i++) {
      pos = (pos === 0 ? m : pos) - 1;
      e[pos] = e[pos + m] = input[2 * i];
      let acc = 0;
      for (let j = 0; j < m; j++) acc += taps[j] * e[pos + j];
      // the centre touches the odd sample of K + 1 pairs ago
      out[i] = acc + 0.5 * o[pos + this.k + 1];
      o[pos] = o[pos + m] = input[2 * i + 1];
    }
    this.downPos = pos;
  }
}

/** Coefficients and window shape for each stage: the first doubling (the closest to the
 *  original rate) must cut sharper, the following ones work on an already filtered sound. */
const STAGES: readonly (readonly [taps: number, beta: number])[] = [[47, 8], [23, 7], [15, 6]];

/** Oversampling of one channel by a factor of 1, 2, 4 or 8. */
export class Oversampler {
  readonly factor: number;
  private readonly stages: HalfbandStage[];
  /** The buffers of each level (0 = original rate). */
  private levels: Float32Array[] = [];

  constructor(factor: 1 | 2 | 4 | 8, block = 128) {
    this.factor = factor;
    this.stages = STAGES.slice(0, Math.log2(factor)).map(([t, b]) => new HalfbandStage(t, b));
    this.ensure(block);
  }

  /** Delay of a pass up and down, in samples of the original rate (can be fractional). */
  get latency(): number {
    return this.stages.reduce((sum, s, i) => sum + s.delay / 2 ** (i + 1), 0);
  }

  /** Brings `n` samples up: returns the buffer at the high rate (n × factor samples,
   *  valid until the next call). */
  up(input: Float32Array, n: number): Float32Array {
    this.ensure(n);
    if (!this.stages.length) {
      this.levels[0].set(input.subarray(0, n));
      return this.levels[0];
    }
    let src = input, len = n;
    this.stages.forEach((s, i) => {
      s.up(src, this.levels[i + 1], len);
      src = this.levels[i + 1];
      len *= 2;
    });
    return src;
  }

  /** Brings `high` (n × factor samples) back down into `out` (n samples). */
  down(high: Float32Array, out: Float32Array, n: number): void {
    if (!this.stages.length) {
      out.set(high.subarray(0, n));
      return;
    }
    let src = high;
    for (let i = this.stages.length - 1; i >= 0; i--) {
      const len = n * 2 ** i, dst = i === 0 ? out : this.levels[i];
      this.stages[i].down(src, dst, len);
      src = dst;
    }
  }

  private ensure(n: number): void {
    if (this.levels[0]?.length >= n) return;
    this.levels = Array.from({ length: this.stages.length + 1 }, (_, i) => new Float32Array(n * 2 ** i));
  }
}
