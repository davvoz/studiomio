/* The Multiband's sound. Per channel:
 *
 *   input → LR4 crossover at xLow → lows ─ allpass at xHigh (to stay in phase) ─┐
 *                                → rest → LR4 crossover at xHigh → mids ─────────┤ each × its gain
 *                                                                → highs ────────┘ → sum → mix → output
 *
 * The gain of each band comes from a peak detector linked between the channels: above the
 * high threshold it compresses downwards (strong ratio), below the low one it raises upwards
 * (ratio 4:1, up to +18 dB, and nothing below the floor: the noise stays down). Depth
 * scales everything; the gain is smoothed in dB with attack and release. With Depth 0 and the bands
 * at 0 dB the whole sound comes out (the three bands summed back are an allpass); the mix's dry is that
 * same sum, so mixing doesn't create holes around the cuts. Runs in the AudioWorklet;
 * no Web Audio here, so it's also tested in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Tpt } from '../../dsp/tpt';

const BUTTERWORTH_Q = Math.SQRT1_2;
/** Thresholds (dBFS) and ratios of the two compressions, per band (lows, mids, highs): those
 *  of the OTT, more or less. */
const DOWN_THRESHOLD = [-30, -30, -32];
const UP_THRESHOLD = [-40, -42, -41];
const DOWN_RATIO = 20, UP_RATIO = 4;
const MAX_UP = 18;
/** Below the floor nothing is raised (in 10 dB the upward push dies out). */
const FLOOR = -70;
/** How long each band's detector holds the peak (seconds): at least a few periods, otherwise
 *  at the zero crossings the level would collapse and the gain would tremble at every cycle. */
const PEAK_HOLD = [0.03, 0.01, 0.005];
/** Attack and release with Time at 0 and at 100 (seconds). */
const ATTACK = [0.0008, 0.03], RELEASE = [0.02, 0.5];
const SMOOTH = 0.02;
const LOG_TO_DB = 20 / Math.LN10;

/** A fourth-order Linkwitz-Riley crossover: two Butterworths in series. */
class Crossover {
  private readonly a = new Tpt();
  private readonly lo = new Tpt();
  private readonly hi = new Tpt();
  low = 0;
  high = 0;

  set(freq: number, sampleRate: number): void {
    for (const f of [this.a, this.lo, this.hi]) f.set(freq, BUTTERWORTH_Q, sampleRate);
  }

  tick(x: number): void {
    this.a.tick(x);
    this.lo.tick(this.a.low);
    this.hi.tick(this.a.high);
    this.low = this.lo.low;
    this.high = this.hi.high;
  }
}

/** The three bands of a channel. */
class Bands {
  private readonly first = new Crossover();
  private readonly second = new Crossover();
  /** The lows' allpass: the same crossover as the second cut, summed back. */
  private readonly lowAllpass = new Crossover();
  readonly out = new Float64Array(3);

  set(xLow: number, xHigh: number, sampleRate: number): void {
    this.first.set(xLow, sampleRate);
    this.second.set(xHigh, sampleRate);
    this.lowAllpass.set(xHigh, sampleRate);
  }

  split(x: number): void {
    this.first.tick(x);
    this.second.tick(this.first.high);
    this.lowAllpass.tick(this.first.low);
    this.out[0] = this.lowAllpass.low + this.lowAllpass.high;
    this.out[1] = this.second.low;
    this.out[2] = this.second.high;
  }
}

export class MultibandCore implements EffectCore {
  private readonly left = new Bands();
  private readonly right = new Bands();
  /** The current gain of each band (dB) and that of the knobs. */
  private readonly gainDb = new Float64Array(3);
  private readonly bandGain = new Float64Array(3);
  /** The chased peak of each band and how fast it falls back. */
  private readonly peak = new Float64Array(3);
  private readonly peakK: number[];
  private depth = 0.5;
  private up = 1;
  private down = 1;
  private attackK = 0;
  private releaseK = 0;
  private input = 1;
  private output = 1;
  private mix = 1;
  private targetOutput = 1;
  private targetMix = 1;
  private readonly smoothK: number;
  private fresh = true;

  constructor(private readonly sampleRate: number) {
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.peakK = PEAK_HOLD.map(t => Math.exp(-1 / (t * sampleRate)));
    this.setParams({});
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const t = v('time', 50) / 100;
    const between = ([a, b]: readonly number[]) => a * Math.pow(b / a, t);
    this.attackK = Math.exp(-1 / (between(ATTACK) * this.sampleRate));
    this.releaseK = Math.exp(-1 / (between(RELEASE) * this.sampleRate));
    this.depth = v('depth', 50) / 100;
    this.up = v('upward', 100) / 100;
    this.down = v('downward', 100) / 100;
    this.input = dbToGain(v('input', 0));
    ['low', 'mid', 'high'].forEach((id, b) => { this.bandGain[b] = dbToGain(v(id, 0)); });
    const xLow = v('xLow', 120), xHigh = Math.max(xLow * 2, v('xHigh', 2500));
    this.left.set(xLow, xHigh, this.sampleRate);
    this.right.set(xLow, xHigh, this.sampleRate);
    this.targetOutput = dbToGain(v('output', 0));
    this.targetMix = v('mix', 100) / 100;
    if (this.fresh) {
      this.output = this.targetOutput;
      this.mix = this.targetMix;
    }
  }

  setTempo(): void {}

  /** The gain (dB) band `b` would want for a level of `x` (dBFS). */
  private wanted(b: number, x: number): number {
    let g = 0;
    if (x > DOWN_THRESHOLD[b]) g -= (x - DOWN_THRESHOLD[b]) * (1 - 1 / DOWN_RATIO) * this.down;
    else if (x < UP_THRESHOLD[b] && x > FLOOR - 10) {
      const fade = x < FLOOR ? (x - (FLOOR - 10)) / 10 : 1;
      g += Math.min(MAX_UP, (UP_THRESHOLD[b] - x) * (1 - 1 / UP_RATIO)) * this.up * fade;
    }
    return g * this.depth;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { left, right, gainDb, bandGain, attackK, releaseK, input, smoothK, peak, peakK } = this;
    const L = left.out, R = right.out;
    for (let i = 0; i < n; i++) {
      const xl = inL[i] * input, xr = inR[i] * input;
      left.split(xl);
      right.split(xr);
      let yl = 0, yr = 0;
      const dl = (L[0] + L[1] + L[2]) / input, dr = (R[0] + R[1] + R[2]) / input;
      for (let b = 0; b < 3; b++) {
        const level = Math.max(Math.abs(L[b]), Math.abs(R[b]), peak[b] * peakK[b]);
        peak[b] = level < 1e-20 ? 0 : level;
        const want = this.wanted(b, level > 1e-7 ? Math.log(level) * LOG_TO_DB : -140);
        // the gain drops with the attack, rises with the release
        const k = want < gainDb[b] ? attackK : releaseK;
        gainDb[b] = k * gainDb[b] + (1 - k) * want;
        const g = Math.exp(gainDb[b] / LOG_TO_DB) * bandGain[b];
        yl += L[b] * g;
        yr += R[b] * g;
      }
      this.output += (this.targetOutput - this.output) * smoothK;
      this.mix += (this.targetMix - this.mix) * smoothK;
      const o = this.output, m = this.mix;
      outL[i] = (dl + (yl - dl) * m) * o;
      outR[i] = (dr + (yr - dr) * m) * o;
    }
  }
}
