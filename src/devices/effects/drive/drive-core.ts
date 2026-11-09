/* The Drive's sound. For each channel, at the oversampled rate:
 *
 *   input ─┬─ LR4 crossover ─ lows ─────────────────────────────┐ (the clean part)
 *          │                  highs + non-clean lows            │
 *          │                    → colour (emphasis) → drive → curve (+ bias, with ADAA antialiasing)
 *          │                    → DC removal → inverse colour → tone → auto gain ─┤
 *          └─ dry ────────────────────────────────────── mix ──────────────────────┘ → output
 *
 * Everything (also the dry and the clean lows) goes through the same oversampling, so the branches
 * stay sample-aligned: the parallel mix and the crossover don't make comb filters.
 * The per-sample loop is written for speed (inline filters, no indirect calls):
 * it runs 4 times per sample and per channel. Runs in the AudioWorklet; no Web Audio here, so it's
 * also tested in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Oversampler } from '../../dsp/oversampler';
import { Tpt } from '../../dsp/tpt';
import { OVERSAMPLING } from './drive';
import { autoGain, fastIntegral, MAX_BIAS, SHAPES, type Shape } from './drive-math';

/** The Q of a Butterworth: two in a row make a Linkwitz-Riley (lows + highs = whole sound). */
const BUTTERWORTH_Q = Math.SQRT1_2;
/** The "Colour" tilts the spectrum around this frequency, up to ±COLOR_DB between lows and highs. */
const COLOR_HZ = 700, COLOR_DB = 9;
/** The filter removing the DC left by the asymmetric curve. */
const DC_HZ = 8;
/** Time with which the gains follow the knobs. */
const SMOOTH = 0.02;
/** After how much input silence (seconds) the Drive stops computing: the filters' tails
 *  ended long ago. It starts working again at the first non-zero sample. */
const IDLE_AFTER = 0.5;
const ADAA_EPS = 1e-5;

/** The tabulated antiderivatives, made once per shape (shared by all instances). */
const INTEGRALS = new Map<string, (x: number) => number>();
const integralOf = (s: Shape) => {
  let F = INTEGRALS.get(s.id);
  if (!F) INTEGRALS.set(s.id, (F = fastIntegral(s)));
  return F;
};

/** The values gliding without steps: where they are and where they're going. */
class Gains {
  constructor(
    public drive = 1,
    /** Makeup of the distorted branch. */
    public wet = 1,
    public mix = 1,
    public output = 1,
    public clean = 0,
    public bias = 0,
  ) {}

  copy(): Gains {
    return new Gains(this.drive, this.wet, this.mix, this.output, this.clean, this.bias);
  }

  /** A step towards `target`, by a fraction `k`. */
  approach(target: Gains, k: number): void {
    this.drive += (target.drive - this.drive) * k;
    this.wet += (target.wet - this.wet) * k;
    this.mix += (target.mix - this.mix) * k;
    this.output += (target.output - this.output) * k;
    this.clean += (target.clean - this.clean) * k;
    this.bias += (target.bias - this.bias) * k;
  }
}

class Channel {
  readonly os: Oversampler;
  /** The crossover: the first filter gives lows and highs, the second makes them steep (LR4). */
  readonly split1 = new Tpt();
  readonly splitLow = new Tpt();
  readonly splitHigh = new Tpt();
  readonly tone = new Tpt();
  pre = 0;
  post = 0;
  dcX = 0;
  dcY = 0;
  /** The sample before the curve (for antialiasing). */
  u = 0;

  constructor(factor: 2 | 4 | 8) {
    this.os = new Oversampler(factor);
  }

  setFilters(split: number, tone: number, rate: number): void {
    for (const f of [this.split1, this.splitLow, this.splitHigh]) f.set(split, BUTTERWORTH_Q, rate);
    this.tone.set(tone, BUTTERWORTH_Q, rate);
  }
}

export class DriveCore implements EffectCore {
  private factor: 2 | 4 | 8 = 4;
  private channels: Channel[] = [];
  private shape: Shape = SHAPES[1];
  private readonly target = new Gains();
  private current: Gains | null = null;
  private colorHigh = 1;
  private split = 120;
  private tone = 16000;
  /** Samples of input silence in a row. */
  private silent = 0;

  constructor(private readonly sampleRate: number) {
    this.build();
  }

  /** The effect's delay in samples (from the oversampling). */
  get latency(): number {
    return this.channels[0].os.latency;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const factor = OVERSAMPLING[v('oversampling', 1)] ?? 4;
    const shape = v('shape', 1), drive = dbToGain(v('drive', 12)), bias = v('bias', 0) / 100;
    this.shape = SHAPES[shape] ?? SHAPES[1];
    const t = this.target;
    t.drive = drive;
    t.bias = bias;
    t.wet = v('auto', 1) ? autoGain({ shape, drive, bias }) : 1;
    t.mix = v('mix', 100) / 100;
    t.output = dbToGain(v('output', 0));
    t.clean = v('low', 50) / 100;
    this.colorHigh = Math.pow(10, (v('color', 0) / 100) * (COLOR_DB / 40));
    this.split = v('split', 120);
    this.tone = v('tone', 16000);
    if (factor !== this.factor) {
      this.factor = factor;
      this.build();
    }
    for (const c of this.channels) c.setFilters(this.split, this.tone, this.sampleRate * this.factor);
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    if (isSilent(inL, n) && isSilent(inR, n)) this.silent += n;
    else this.silent = 0;
    if (this.silent > IDLE_AFTER * this.sampleRate) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      return;
    }
    const from = this.current ?? this.target.copy();
    const to = from.copy();
    to.approach(this.target, 1 - Math.exp(-n / (SMOOTH * this.sampleRate)));
    this.current = to;
    this.run(this.channels[0], inL, outL, n, from, to);
    this.run(this.channels[1], inR, outR, n, from, to);
  }

  private build(): void {
    this.channels = [new Channel(this.factor), new Channel(this.factor)];
    for (const c of this.channels) c.setFilters(this.split, this.tone, this.sampleRate * this.factor);
  }

  private run(ch: Channel, input: Float32Array, output: Float32Array, n: number, from: Gains, to: Gains): void {
    const up = ch.os.up(input, n), m = n * this.factor, rate = this.sampleRate * this.factor;
    const shape = this.shape, F = integralOf(shape);
    const preK = 1 - Math.exp((-2 * Math.PI * COLOR_HZ) / rate), dcR = Math.exp((-2 * Math.PI * DC_HZ) / rate);
    const gHigh = this.colorHigh, gLow = 1 / gHigh;
    // the bias changes per block (its DC is removed by the filter): the curve at 0 once only
    const b = to.bias * MAX_BIAS, f0 = shape.fn(b);
    // linear ramps along the block: value at the start and per-sample step
    let drive = from.drive, clean = from.clean, mix = from.mix, wetGain = from.wet, out = from.output;
    const dDrive = (to.drive - drive) / m, dClean = (to.clean - clean) / m, dMix = (to.mix - mix) / m;
    const dWet = (to.wet - wetGain) / m, dOut = (to.output - out) / m;
    const { split1, splitLow, splitHigh, tone } = ch;
    let { pre, post, dcX, dcY, u: uPrev } = ch;
    // the previous sample's antiderivative, with the current curve (the shape may have just changed)
    let fPrev = F(uPrev);
    for (let i = 0; i < m; i++) {
      drive += dDrive;
      clean += dClean;
      mix += dMix;
      wetGain += dWet;
      out += dOut;
      const x = up[i];
      split1.tick(x);
      splitLow.tick(split1.low);
      splitHigh.tick(split1.high);
      const low = splitLow.low, high = splitHigh.high;
      // colour: highs up and lows down (or the opposite) before the curve…
      let d = high + low * (1 - clean);
      pre += preK * (d - pre);
      d = pre * gLow + (d - pre) * gHigh;
      // antialiasing: the curve's average slope between the previous sample and this one
      const u = drive * d + b, fu = F(u), du = u - uPrev;
      const y = (du > ADAA_EPS || du < -ADAA_EPS ? (fu - fPrev) / du : shape.fn((u + uPrev) * 0.5)) - f0;
      uPrev = u;
      fPrev = fu;
      const dc = y - dcX + dcR * dcY;
      dcX = y;
      dcY = dc;
      // …and the opposite after: the timbre comes back, the distortion stays where it was chosen
      post += preK * (dc - post);
      tone.tick(post * gHigh + (dc - post) * gLow);
      const wet = tone.low * wetGain + low * clean;
      up[i] = (x + (wet - x) * mix) * out;
    }
    ch.pre = pre;
    ch.post = post;
    ch.dcX = dcX;
    ch.dcY = Math.abs(dcY) < 1e-20 ? 0 : dcY;
    ch.u = uPrev;
    ch.os.down(up, output, n);
  }
}

const isSilent = (x: Float32Array, n: number): boolean => {
  for (let i = 0; i < n; i++) if (x[i] !== 0) return false;
  return true;
};
