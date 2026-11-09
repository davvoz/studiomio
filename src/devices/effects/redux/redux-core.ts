/* The Redux's sound. For each sample:
 *
 *   input → (Pre filter) → holds the sample until the phase reaches the top (the
 *   step is Frequency / project rate, the top moves randomly with the Jitter) → at each
 *   new sample rounds it to 2^(bits−1) steps per side → (Post filter) → mix → × Output
 *
 * The bits can be fractional: the number of steps glides without jumps. The filters are
 * 24 dB low-passes, Pre just below half the Frequency (removes what would
 * fold back), Post at half (smooths the steps). Runs in the AudioWorklet; no Web
 * Audio here. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { FILTER_TYPE, MultimodeFilter } from '../../dsp/multimode-filter';
import { Noise } from '../../dsp/noise';
import { MAX_BITS, REDUX_FILTER } from './redux';

const SMOOTH = 0.02;
/** How much the phase's top can move with Jitter at 100% (in fractions of the step). */
const MAX_JITTER = 0.9;

export class ReduxCore implements EffectCore {
  private readonly filters: MultimodeFilter[];
  private readonly noise = new Noise();
  private readonly smoothK: number;
  private step = 1;
  private jitter = 0;
  private levels = 2 ** (MAX_BITS - 1);
  private filter: number = REDUX_FILTER.off;
  private phase = 1;
  private top = 1;
  private holdL = 0;
  private holdR = 0;
  private mix = 1;
  private targetMix = 1;
  private output = 1;
  private targetOutput = 1;
  private fresh = true;
  /** How many new samples it took (for tests). */
  taken = 0;

  constructor(private readonly sampleRate: number) {
    this.filters = [0, 1, 2, 3].map(() => new MultimodeFilter(sampleRate));
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const rate = p.rate ?? 8000;
    this.step = rate / this.sampleRate;
    this.jitter = Math.max(0, Math.min(1, (p.jitter ?? 0) / 100)) * MAX_JITTER;
    this.levels = 2 ** (Math.max(1, Math.min(MAX_BITS, p.bits ?? 8)) - 1);
    const filter = p.filter ?? REDUX_FILTER.off;
    if (filter !== this.filter) for (const f of this.filters) f.reset();
    this.filter = filter;
    // [0, 1] the Pre of the two channels, [2, 3] the Post
    for (let c = 0; c < 2; c++) {
      this.filters[c].set(rate * 0.45, 0, FILTER_TYPE.lowPass, 4);
      this.filters[c + 2].set(rate * 0.5, 0, FILTER_TYPE.lowPass, 4);
    }
    this.targetMix = Math.max(0, Math.min(1, (p.mix ?? 100) / 100));
    this.targetOutput = dbToGain(p.output ?? 0);
    if (this.fresh) {
      this.mix = this.targetMix;
      this.output = this.targetOutput;
    }
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { filters: [preL, preR, postL, postR], step, jitter, levels, smoothK: k } = this;
    const pre = this.filter === REDUX_FILTER.pre, post = this.filter === REDUX_FILTER.post;
    let { phase, top, holdL, holdR, mix, output } = this;
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      const sL = pre ? preL.process(xL) : xL, sR = pre ? preR.process(xR) : xR;
      if (phase >= top) {
        phase -= top;
        top = jitter > 0 ? 1 + jitter * this.noise.next() : 1;
        holdL = Math.round(sL * levels) / levels;
        holdR = Math.round(sR * levels) / levels;
        this.taken++;
      }
      phase += step;
      const wL = post ? postL.process(holdL) : holdL, wR = post ? postR.process(holdR) : holdR;
      mix += (this.targetMix - mix) * k;
      output += (this.targetOutput - output) * k;
      outL[i] = (xL + (wL - xL) * mix) * output;
      outR[i] = (xR + (wR - xR) * mix) * output;
    }
    this.phase = phase;
    this.top = top;
    this.holdL = holdL;
    this.holdR = holdR;
    this.mix = mix;
    this.output = output;
  }
}
