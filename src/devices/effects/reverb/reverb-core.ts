/* The Reverb's sound: an 8-line feedback delay network (FDN).
 *
 *   input → pre-delay → 4 diffusion allpasses (per channel) → 8 delay lines
 *   each line: high damping, gain for the decay → Hadamard matrix →
 *   back into the lines; the output sums the lines with different signs for the two channels
 *   → low cut → width → mix with the dry
 *
 * The line lengths are coprime (no shared resonances) and scale with the
 * Size; each line's gain gives exactly the chosen decay (−60 dB in the
 * Decay time). Two lines are slightly modulated, to remove the metallic sound. Runs
 * in the AudioWorklet; no Web Audio here, so it's also tested in Node. */
import type { EffectCore } from '../../dsp/core';
import { MAX_PREDELAY_MS } from './reverb';

const LINES = 8;
/** Line lengths at 48 kHz with Size at 100 % (about 30–90 ms). */
const LENGTHS = [1433, 1601, 1867, 2053, 2251, 2399, 2647, 2879];
/** Lengths of the diffusion allpasses (about 2–12 ms) and their coefficient at maximum. */
const DIFFUSERS = [[142, 379, 107, 277], [131, 353, 113, 307]];
const MAX_DIFFUSION = 0.7;
/** The modulation: how many samples and how fast. */
const MOD_DEPTH = 12, MOD_RATE = 0.7;
const SMOOTH = 0.03;

const flush = (x: number) => (Math.abs(x) < 1e-20 ? 0 : x);

/** A Schroeder allpass: diffuses without colouring. */
class Allpass {
  private readonly buf: Float32Array;
  private pos = 0;

  constructor(length: number) {
    this.buf = new Float32Array(length);
  }

  process(x: number, g: number): number {
    const d = this.buf[this.pos];
    const v = x + g * d;
    this.buf[this.pos] = flush(v);
    if (++this.pos >= this.buf.length) this.pos = 0;
    return d - g * v;
  }
}

/** A delay line with interpolated reading (for the modulation). */
class Line {
  readonly buf: Float32Array;
  private pos = 0;
  /** The damping: one-pole low-pass in the feedback. */
  lp = 0;

  constructor(maxLength: number) {
    this.buf = new Float32Array(maxLength + MOD_DEPTH + 4);
  }

  read(delay: number): number {
    const size = this.buf.length;
    const p = this.pos - delay + size;
    const i = Math.floor(p), f = p - i;
    const a = this.buf[i % size], b = this.buf[(i + 1) % size];
    return a + (b - a) * f;
  }

  write(x: number): void {
    this.buf[this.pos] = flush(x);
    if (++this.pos >= this.buf.length) this.pos = 0;
  }
}

export class ReverbCore implements EffectCore {
  private readonly lines: Line[];
  private readonly diffusers: Allpass[][];
  private readonly pre: Float32Array[];
  private prePos = 0;
  private readonly scale: number;
  private lengths: number[] = [];
  private gains: number[] = [];
  private dampK = 0;
  private hpK = 0;
  private hpL = 0;
  private hpR = 0;
  private hpPrevL = 0;
  private hpPrevR = 0;
  private diffusion = 0.5;
  private predelay = 0;
  private width = 1;
  private wet = 0.25;
  private dry = 1;
  private targetWet = 0.25;
  private targetDry = 1;
  private phase = 0;
  private readonly smoothK: number;
  private readonly fb = new Float64Array(LINES);
  /** Before the first block dry and wet don't glide: they start from the right ones. */
  private fresh = true;

  constructor(private readonly sampleRate: number) {
    this.scale = sampleRate / 48000;
    this.lines = LENGTHS.map(l => new Line(Math.ceil(l * this.scale)));
    this.diffusers = DIFFUSERS.map(ch => ch.map(l => new Allpass(Math.ceil(l * this.scale))));
    const preSize = Math.ceil((MAX_PREDELAY_MS / 1000) * sampleRate) + 2;
    this.pre = [new Float32Array(preSize), new Float32Array(preSize)];
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.setParams({});
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const size = v('size', 60) / 100, decay = v('decay', 2.2);
    this.lengths = LENGTHS.map(l => Math.max(16, l * this.scale * (0.25 + 0.75 * size)));
    // −60 dB in `decay` seconds: each round of a line d samples long loses 60·d/(decay·sr) dB
    this.gains = this.lengths.map(d => Math.pow(10, (-3 * d) / (decay * this.sampleRate)));
    this.dampK = 1 - Math.exp((-2 * Math.PI * v('damping', 7000)) / this.sampleRate);
    this.hpK = Math.exp((-2 * Math.PI * v('lowCut', 150)) / this.sampleRate);
    this.diffusion = (v('diffusion', 70) / 100) * MAX_DIFFUSION;
    this.predelay = Math.round((v('predelay', 20) / 1000) * this.sampleRate);
    this.width = v('width', 100) / 100;
    const mix = v('mix', 25) / 100;
    // constant power between dry and wet
    this.targetWet = Math.sin((mix * Math.PI) / 2);
    this.targetDry = Math.cos((mix * Math.PI) / 2);
    if (this.fresh) {
      this.wet = this.targetWet;
      this.dry = this.targetDry;
    }
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { lines, lengths, gains, dampK, hpK, diffusion, fb, pre, smoothK } = this;
    const [dl, dr] = this.diffusers;
    this.fresh = false;
    const preSize = pre[0].length, phaseStep = (2 * Math.PI * MOD_RATE) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      // pre-delay
      pre[0][this.prePos] = inL[i];
      pre[1][this.prePos] = inR[i];
      const rp = (this.prePos - this.predelay + preSize) % preSize;
      let a = pre[0][rp], b = pre[1][rp];
      if (++this.prePos >= preSize) this.prePos = 0;
      // diffusion
      for (const ap of dl) a = ap.process(a, diffusion);
      for (const ap of dr) b = ap.process(b, diffusion);
      // the lines: read (two modulated in antiphase), damping, decay
      this.phase += phaseStep;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      const mod = Math.sin(this.phase) * MOD_DEPTH;
      for (let k = 0; k < LINES; k++) {
        const line = lines[k];
        const d = lengths[k] + (k === 2 ? mod : k === 5 ? -mod : 0);
        line.lp += dampK * (line.read(d) - line.lp);
        fb[k] = line.lp * gains[k];
      }
      // the outputs before mixing: sums with different signs for the two channels
      const wl = fb[0] - fb[1] + fb[2] - fb[3] + fb[4] - fb[5] + fb[6] - fb[7];
      const wr = fb[0] + fb[1] - fb[2] - fb[3] + fb[4] + fb[5] - fb[6] - fb[7];
      // Hadamard 8×8 (fast, in three steps), normalized: it preserves energy
      for (let h = 1; h < LINES; h <<= 1) {
        for (let k = 0; k < LINES; k += h << 1) {
          for (let j = k; j < k + h; j++) {
            const x = fb[j], y = fb[j + h];
            fb[j] = x + y;
            fb[j + h] = x - y;
          }
        }
      }
      const norm = 1 / Math.sqrt(LINES);
      for (let k = 0; k < LINES; k++) lines[k].write(fb[k] * norm + (k < 4 ? a : b) * 0.5);
      // low cut on the tail, width, mix
      this.hpL = hpK * (this.hpL + wl - this.hpPrevL);
      this.hpR = hpK * (this.hpR + wr - this.hpPrevR);
      this.hpPrevL = wl;
      this.hpPrevR = wr;
      const mid = (this.hpL + this.hpR) * 0.5, side = (this.hpL - this.hpR) * 0.5 * this.width;
      this.wet += (this.targetWet - this.wet) * smoothK;
      this.dry += (this.targetDry - this.dry) * smoothK;
      const g = this.wet * 0.35;
      outL[i] = inL[i] * this.dry + (mid + side) * g;
      outR[i] = inR[i] * this.dry + (mid - side) * g;
    }
    this.hpL = flush(this.hpL);
    this.hpR = flush(this.hpR);
  }
}
