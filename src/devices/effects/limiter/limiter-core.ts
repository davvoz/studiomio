/* The Limiter's sound, with a lookahead of L samples:
 *
 *   1. requested gain r[n] = min(1, ceiling / peak[n]): the peak of the two channels, and if requested
 *      the one rebuilt between samples (true peak), measured on a 4× oversampled copy;
 *   2. the minimum of r over the last L+1 samples (sliding window, monotonic queue);
 *   3. the release: the gain drops right away, rises with the release constant;
 *   4. a moving average L long: the drop becomes a ramp ending right on the peak;
 *   5. the delayed sound (by L, plus the delay of the oversampled measurement) × that gain,
 *      and for safety a clip at the ceiling.
 *
 * Each value of the average comes from samples covering the delayed peak, so the applied gain
 * never exceeds the requested one: no peak above the ceiling. Runs in the AudioWorklet;
 * no Web Audio here, so it's also tested in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Oversampler } from '../../dsp/oversampler';
import { MAX_LOOKAHEAD_MS } from './limiter';

const SMOOTH = 0.02;
/** Oversampling of the inter-sample peak measurement. */
const TRUE_PEAK_FACTOR = 4;

/** `y` held within ±`limit`. */
const clampTo = (y: number, limit: number): number => {
  if (y > limit) return limit;
  return y < -limit ? -limit : y;
};

export class LimiterCore implements EffectCore {
  private readonly size: number;
  /** The waiting sound and the requested gains, in rings `size` long. */
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  private readonly wanted: Float32Array;
  /** Monotonic queue for the sliding minimum: (absolute) positions of the candidates. */
  private readonly queue: Int32Array;
  private head = 0;
  private tail = 0;
  /** The moving average: the last L values and their sum. */
  private readonly boxBuf: Float64Array;
  private boxSum = 0;
  private count = 0;
  private lookahead = 1;
  private released = 1;
  private releaseK = 0;
  private ceiling = 1;
  private gain = 1;
  private targetGain = 1;
  private truePeak = true;
  private readonly smoothK: number;
  /** The inter-sample measurement: oversampled copies, their delay (integer, in samples) and
   *  the previous sample's peak (each peak counts for two positions: it covers the fractional remainder). */
  private readonly osL = new Oversampler(TRUE_PEAK_FACTOR);
  private readonly osR = new Oversampler(TRUE_PEAK_FACTOR);
  private readonly measureDelay: number;
  private lastPeak = 0;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Before the first block the gain doesn't glide: it starts from the right one. */
  private fresh = true;
  /** The lowest gain since the last read (for the meters and the tests). */
  private minGain = 1;

  constructor(private readonly sampleRate: number) {
    // the branch rising alone delays half of the round trip up and down
    this.measureDelay = Math.floor(this.osL.latency / 2);
    this.size = Math.ceil((MAX_LOOKAHEAD_MS / 1000) * sampleRate) + this.measureDelay + 8;
    this.delayL = new Float32Array(this.size);
    this.delayR = new Float32Array(this.size);
    this.wanted = new Float32Array(this.size).fill(1);
    this.queue = new Int32Array(this.size);
    this.boxBuf = new Float64Array(this.size).fill(1);
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.setParams({});
    this.resetBox();
  }

  /** The effect's delay in samples. */
  get latency(): number {
    return this.lookahead + (this.truePeak ? this.measureDelay : 0);
  }

  /** The strongest reduction since the last read, in dB (reading resets it). */
  takeReduction(): number {
    const db = -20 * Math.log10(Math.max(this.minGain, 1e-6));
    this.minGain = 1;
    return db;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const lookahead = Math.max(1, Math.min(this.size - this.measureDelay - 8, Math.round((v('lookahead', 2) / 1000) * this.sampleRate)));
    const truePeak = v('truePeak', 1) === 1;
    if (lookahead !== this.lookahead || truePeak !== this.truePeak) {
      this.lookahead = lookahead;
      this.truePeak = truePeak;
      this.resetBox();
    }
    this.ceiling = dbToGain(v('ceiling', -0.3));
    this.targetGain = dbToGain(v('gain', 0));
    this.releaseK = 1 - Math.exp(-1 / ((v('release', 80) / 1000) * this.sampleRate));
    if (this.fresh) this.gain = this.targetGain;
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const xl = this.gained(inL, inR, n), xr = this.scratchR;
    const upL = this.truePeak ? this.osL.up(xl, n) : xl, upR = this.truePeak ? this.osR.up(xr, n) : xr;
    for (let i = 0; i < n; i++) {
      const peak = this.truePeak ? this.truePeakAt(upL, upR, i) : Math.max(Math.abs(xl[i]), Math.abs(xr[i]));
      this.limit(xl[i], xr[i], peak > this.ceiling ? this.ceiling / peak : 1, outL, outR, i);
    }
    this.rebase();
  }

  /** The input with the Gain (gliding towards the knob), in the scratch buffers. */
  private gained(inL: Float32Array, inR: Float32Array, n: number): Float32Array {
    if (this.scratchL.length < n) [this.scratchL, this.scratchR] = [new Float32Array(n), new Float32Array(n)];
    const xl = this.scratchL, xr = this.scratchR;
    let gain = this.gain;
    for (let i = 0; i < n; i++) {
      gain += (this.targetGain - gain) * this.smoothK;
      xl[i] = inL[i] * gain;
      xr[i] = inR[i] * gain;
    }
    this.gain = gain;
    this.fresh = false;
    return xl;
  }

  /** 1. The peak of the four oversampled samples covering sample `i` (and of the previous four: the
   *  peak between two samples can fall on either side). */
  private truePeakAt(upL: Float32Array, upR: Float32Array, i: number): number {
    let peak = 0;
    for (let j = i * TRUE_PEAK_FACTOR, end = j + TRUE_PEAK_FACTOR; j < end; j++) {
      const a = Math.abs(upL[j]), b = Math.abs(upR[j]);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    const here = peak;
    if (this.lastPeak > peak) peak = this.lastPeak;
    this.lastPeak = here;
    return peak;
  }

  /** Steps 2–5 for one sample: `want` is the gain this sample asks for; the output is the sound
   *  from `delay` samples ago with the gain that holds every peak under the ceiling. */
  private limit(l: number, r: number, want: number, outL: Float32Array, outR: Float32Array, i: number): void {
    const { size, wanted, queue, boxBuf, lookahead: L, ceiling } = this;
    const count = this.count, at = count % size;
    this.delayL[at] = l;
    this.delayR[at] = r;
    wanted[at] = want;
    // 2. sliding minimum over the last L+1 (the queue keeps the candidates in increasing order)
    while (this.tail > this.head && wanted[queue[(this.tail - 1) % size] % size] >= want) this.tail--;
    queue[this.tail % size] = count;
    this.tail++;
    while (queue[this.head % size] < count - L) this.head++;
    const min = wanted[queue[this.head % size] % size];
    // 3. down right away, up with the release
    const released = min < this.released ? min : this.released + (min - this.released) * this.releaseK;
    this.released = released;
    // 4. long moving average L
    const slot = count % L;
    this.boxSum += released - boxBuf[slot];
    boxBuf[slot] = released;
    const g = this.boxSum / L;
    if (g < this.minGain) this.minGain = g;
    // 5. the sound from `delay` samples ago
    const delay = L + (this.truePeak ? this.measureDelay : 0), from = (count - delay + size) % size;
    outL[i] = clampTo(this.delayL[from] * g, ceiling);
    outR[i] = clampTo(this.delayR[from] * g, ceiling);
    this.count = count + 1;
  }

  /** The absolute indices stay small: samples and queue positions shift by multiples of `size`
   *  and of L (the rings and the average don't notice). */
  private rebase(): void {
    if (this.count <= 1 << 30) return;
    const step = this.size * this.lookahead, shift = Math.floor((this.count - 2 * this.size) / step) * step;
    for (let k = this.head; k < this.tail; k++) this.queue[k % this.size] -= shift;
    this.count -= shift;
    const q = Math.floor(this.head / this.size) * this.size;
    this.head -= q;
    this.tail -= q;
  }

  private resetBox(): void {
    this.boxBuf.fill(1);
    this.boxSum = this.lookahead;
    this.released = 1;
  }
}
