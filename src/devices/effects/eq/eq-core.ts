/* The EQ's sound: for each band the filter sections of eq-math.ts, in series, on the two
 * channels. Frequency, gain and Q glide towards the new value (no jumps while
 * dragging a point), switching a band on is a short crossfade. The coefficients are
 * recomputed every CHUNK samples only while something is moving. Runs in the AudioWorklet. */
import type { EffectCore } from '../../dsp/core';
import { BAND_TYPES, bandsOf, type EqBand } from './eq';
import { sectionsOf, type Section } from './eq-math';

/** Samples between one coefficient update and the next. */
const CHUNK = 32;
/** Settling time of the parameters and length of the on/off crossfade, in seconds. */
const GLIDE = 0.02, FADE = 0.01;

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** A playing band: current values (chasing the target ones), sections and their state. */
class BandVoice {
  target: EqBand;
  private logFreq: number;
  private gain: number;
  private logQ: number;
  /** How much of the band is heard: 0 off, 1 on. */
  amount: number;
  private sections: Section[] = [];
  /** Per section: ic1, ic2 of the left channel, then of the right. */
  private state = new Float64Array(0);
  private dirty = true;

  constructor(band: EqBand) {
    this.target = band;
    this.logFreq = Math.log(band.freq);
    this.gain = band.gain;
    this.logQ = Math.log(band.q);
    this.amount = band.on ? 1 : 0;
  }

  set(band: EqBand): void {
    const prev = this.target;
    this.target = band;
    if (band.type !== prev.type || band.slope !== prev.slope) this.state = new Float64Array(0);
    this.dirty = true;
  }

  /** True if at this moment the band doesn't change the sound (off, or at 0 dB). */
  get silent(): boolean {
    const t = this.target;
    if (this.amount === 0 && !t.on) return true;
    return !!BAND_TYPES[t.type]?.gain && this.gain === 0 && t.gain === 0 && this.amount === (t.on ? 1 : 0);
  }

  /** Takes a step towards the target values and, if needed, recomputes the sections. */
  advance(glide: number, fadeStep: number, sampleRate: number): void {
    const t = this.target;
    const chase = (now: number, to: number, eps: number) => (Math.abs(to - now) < eps ? to : now + (to - now) * glide);
    const logFreq = chase(this.logFreq, Math.log(t.freq), 1e-4);
    const gain = chase(this.gain, t.gain, 1e-3);
    const logQ = chase(this.logQ, Math.log(t.q), 1e-4);
    const moved = logFreq !== this.logFreq || gain !== this.gain || logQ !== this.logQ;
    this.logFreq = logFreq;
    this.gain = gain;
    this.logQ = logQ;
    this.amount = t.on ? Math.min(1, this.amount + fadeStep) : Math.max(0, this.amount - fadeStep);
    if (moved || this.dirty) {
      this.sections = sectionsOf({ ...t, freq: Math.exp(logFreq), gain, q: Math.exp(logQ) }, sampleRate);
      if (this.state.length !== this.sections.length * 4) this.state = new Float64Array(this.sections.length * 4);
      this.dirty = false;
    }
  }

  /** Filters [from, to) of the two channels, in place; during the crossfade it mixes with the sound
   *  entering the band (copied into `dryL`/`dryR`, at least CHUNK long). */
  process(left: Float32Array, right: Float32Array, from: number, to: number, dryL: Float32Array, dryR: Float32Array): void {
    const a = this.amount;
    if (a < 1) {
      dryL.set(left.subarray(from, to));
      dryR.set(right.subarray(from, to));
    }
    for (let s = 0; s < this.sections.length; s++) {
      runSection(this.sections[s], this.state, s * 4, left, from, to);
      runSection(this.sections[s], this.state, s * 4 + 2, right, from, to);
    }
    if (a < 1) {
      for (let i = from; i < to; i++) {
        left[i] = dryL[i - from] + (left[i] - dryL[i - from]) * a;
        right[i] = dryR[i - from] + (right[i] - dryR[i - from]) * a;
      }
    }
  }

  reset(): void {
    this.state.fill(0);
  }
}

/** A section on a channel, in place; `state[o]`, `state[o + 1]` are its memory. */
function runSection({ g, k, m0, m1, m2 }: Section, state: Float64Array, o: number, buf: Float32Array, from: number, to: number): void {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  let ic1 = state[o], ic2 = state[o + 1];
  for (let i = from; i < to; i++) {
    const v0 = buf[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = m0 * v0 + m1 * v1 + m2 * v2;
  }
  // tiny values to zero: no denormal numbers in silence
  state[o] = Math.abs(ic1) < 1e-20 ? 0 : ic1;
  state[o + 1] = Math.abs(ic2) < 1e-20 ? 0 : ic2;
}

export class EqCore implements EffectCore {
  private readonly dryL = new Float32Array(CHUNK);
  private readonly dryR = new Float32Array(CHUNK);
  private bands: BandVoice[] | null = null;
  private output = 1;
  private outputTarget = 1;
  private readonly glide: number;
  private readonly fadeStep: number;

  constructor(private readonly sampleRate: number) {
    this.glide = 1 - Math.exp(-CHUNK / (GLIDE * sampleRate));
    this.fadeStep = CHUNK / (FADE * sampleRate);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const bands = bandsOf(params);
    this.outputTarget = dbToGain(params.output ?? 0);
    if (!this.bands) {
      // the first time the values apply right away
      this.bands = bands.map(b => new BandVoice(b));
      this.output = this.outputTarget;
    } else bands.forEach((b, i) => this.bands![i].set(b));
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    outL.set(inL.subarray(0, n));
    outR.set(inR.subarray(0, n));
    const bands = this.bands ?? [];
    for (let from = 0; from < n; from += CHUNK) {
      const to = Math.min(n, from + CHUNK);
      for (const band of bands) {
        band.advance(this.glide, this.fadeStep, this.sampleRate);
        if (band.silent) band.reset();
        else band.process(outL, outR, from, to, this.dryL, this.dryR);
      }
      const start = this.output;
      this.output = Math.abs(this.outputTarget - start) < 1e-5 ? this.outputTarget : start + (this.outputTarget - start) * this.glide;
      if (start !== 1 || this.output !== 1) {
        const step = (this.output - start) / (to - from);
        for (let i = from, g = start; i < to; i++, g += step) {
          outL[i] *= g;
          outR[i] *= g;
        }
      }
    }
  }
}
