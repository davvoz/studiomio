/* The Spectral Resonator's sound. The input is cut into overlapping frames (a quarter of a frame
 * apart), windowed and turned into a spectrum; left and right go through one FFT together. In
 * every bin a resonance keeps what it had, turned by the partial's phase step and lowered by its
 * decay, and adds the input the bank lets in (only near the partials). The resonance goes back to
 * sound with the inverse FFT and the same window, overlapping the frames. The resonance comes
 * out one frame later (Resolution: 1024 points ≈ 21 ms at 48 kHz); the dry sound isn't delayed.
 * Runs in the AudioWorklet: everything is allocated here, at the start. */
import type { EffectCore } from '../../dsp/core';
import { Fft, joinPair, splitPair } from '../../../dsp/fft';
import { PartialMotion } from './partial-motion';
import { resonatorSettings, voicesOf, type ResonatorSettings, type Voice } from './partials';
import { ResonanceBank } from './resonance-bank';
import { MAX_PARTIALS, MOD, RESOLUTIONS } from './spectral-resonator';

const MAX_SIZE = Math.max(...RESOLUTIONS.map(r => r.size));
/** Hann analysis × Hann synthesis, overlapped every quarter of a frame, sum to 1.5. */
const OVERLAP_GAIN = 1.5;
/** A bin's resonance is never louder than this many times what entered it lately: a steady tone
 *  on a partial with a long decay would otherwise ring tens of dB louder than it came in. */
const MAX_BOOST = 2;
/** How fast Dry/Wet and Output follow the knob, in seconds (no clicks when they move). */
const SMOOTH = 0.02;

/** Above this level the resonance is gently held under 1 (a long decay on a loud tone). */
const SOFT_START = 0.9;
const softClip = (x: number): number => {
  const a = Math.abs(x);
  return a <= SOFT_START ? x : Math.sign(x) * (SOFT_START + (1 - SOFT_START) * Math.tanh((a - SOFT_START) / (1 - SOFT_START)));
};

/** The periodic Hann window of a size. */
const hann = (size: number) => Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));

export class SpectralResonatorCore implements EffectCore {
  private settings: ResonatorSettings = resonatorSettings({});
  private voices: Voice[] = voicesOf(this.settings);
  private readonly bank = new ResonanceBank(MAX_SIZE);
  private readonly motion = new PartialMotion();
  /** The windows and FFTs of every Resolution, made at the start (not in the audio thread's steps). */
  private readonly windows = new Map<number, Float64Array>(RESOLUTIONS.map(r => [r.size, hann(r.size)]));
  private readonly ffts = new Map<number, Fft>(RESOLUTIONS.map(r => [r.size, Fft.of(r.size)]));
  private window!: Float64Array;
  private fft!: Fft;
  private size = 0;
  private hop = 0;
  /** Samples of the current hop already taken in (and given out). */
  private pos = 0;
  private dirty = true;
  // the last frame of input, the overlapping output, the hop ready to go out
  private readonly inL = new Float64Array(MAX_SIZE);
  private readonly inR = new Float64Array(MAX_SIZE);
  private readonly accL = new Float64Array(MAX_SIZE);
  private readonly accR = new Float64Array(MAX_SIZE);
  private readonly outL = new Float64Array(MAX_SIZE / 4);
  private readonly outR = new Float64Array(MAX_SIZE / 4);
  // the FFT's work arrays and the spectra (input and resonance), bins 0 … size/2
  private readonly re = new Float64Array(MAX_SIZE);
  private readonly im = new Float64Array(MAX_SIZE);
  private readonly xLr = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly xLi = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly xRr = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly xRi = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly rLr = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly rLi = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly rRr = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly rRi = new Float64Array(MAX_SIZE / 2 + 1);
  /** Per bin, left and right: what entered lately (it falls as the resonance does), for MAX_BOOST. */
  private readonly heardL = new Float64Array(MAX_SIZE / 2 + 1);
  private readonly heardR = new Float64Array(MAX_SIZE / 2 + 1);
  private mix = 0.5;
  private gain = 1;
  /** Not yet given any parameter: the first ones apply at once, without gliding. */
  private fresh = true;
  private readonly smoothK: number;

  constructor(private readonly sampleRate: number) {
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.resize(this.settings.fftSize);
    this.mix = this.settings.mix;
    this.gain = this.settings.output;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    this.settings = resonatorSettings(p);
    this.voices = voicesOf(this.settings);
    if (this.settings.fftSize !== this.size) this.resize(this.settings.fftSize);
    if (this.fresh) {
      this.fresh = false;
      this.mix = this.settings.mix;
      this.gain = this.settings.output;
    }
    this.dirty = true;
  }

  setTempo(): void { /* it doesn't follow the tempo */ }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const s = this.settings, k = this.smoothK, at = this.size - this.hop;
    for (let i = 0; i < n; i++) {
      const l = inL[i], r = inR[i];
      this.inL[at + this.pos] = l;
      this.inR[at + this.pos] = r;
      this.mix += (s.mix - this.mix) * k;
      this.gain += (s.output - this.gain) * k;
      const dry = 1 - this.mix;
      outL[i] = (l * dry + softClip(this.outL[this.pos]) * this.mix) * this.gain;
      outR[i] = (r * dry + softClip(this.outR[this.pos]) * this.mix) * this.gain;
      if (++this.pos === this.hop) this.step();
    }
  }

  /** A new spectrum size: the resonance starts again from silence. */
  private resize(size: number): void {
    this.size = size;
    this.hop = size / 4;
    this.window = this.windows.get(size) ?? hann(size);
    this.fft = this.ffts.get(size) ?? Fft.of(size);
    this.pos = 0;
    for (const a of [this.inL, this.inR, this.accL, this.accR, this.outL, this.outR, this.rLr, this.rLi, this.rRr, this.rRi, this.heardL, this.heardR]) {
      a.fill(0);
    }
    this.dirty = true;
  }

  /** A hop is in: the frame goes through the resonance and its first hop is ready to go out. */
  private step(): void {
    this.pos = 0;
    const s = this.settings, moving = s.mod !== MOD.none;
    if (moving) this.motion.advance(s, this.hop / this.sampleRate, this.voices.length * MAX_PARTIALS);
    if (moving || this.dirty) this.bank.build(this.size, this.hop, this.sampleRate, s, this.voices, this.motion);
    this.dirty = false;
    this.analyse();
    this.resonate(s.input);
    this.synthesise();
    // the input moves on by a hop
    this.inL.copyWithin(0, this.hop, this.size);
    this.inR.copyWithin(0, this.hop, this.size);
  }

  /** The windowed frame's spectra, left and right with a single FFT. */
  private analyse(): void {
    const w = this.window, { re, im } = this;
    for (let i = 0; i < this.size; i++) {
      re[i] = this.inL[i] * w[i];
      im[i] = this.inR[i] * w[i];
    }
    this.fft.forward(re, im);
    splitPair(re.subarray(0, this.size), im.subarray(0, this.size), this.xLr, this.xLi, this.xRr, this.xRi);
  }

  /** In every bin, on both sides: what was ringing turns and falls, the input the bank lets in is added. */
  private resonate(input: number): void {
    const bins = this.size / 2 + 1, { inLeft, inRight } = this.bank;
    for (let b = 0; b < bins; b++) {
      this.ring(b, inLeft[b] * input, this.xLr, this.xLi, this.rLr, this.rLi, this.heardL);
      this.ring(b, inRight[b] * input, this.xRr, this.xRi, this.rRr, this.rRi, this.heardR);
    }
  }

  /** One bin of one side: x the input's spectrum, r the resonance, heard what entered lately. */
  private ring(b: number, gain: number, xr: Float64Array, xi: Float64Array, rr: Float64Array, ri: Float64Array, heard: Float64Array): void {
    const bank = this.bank, keep = bank.keep[b], c = bank.turnCos[b], sn = bank.turnSin[b];
    const inR = gain * xr[b], inI = gain * xi[b], enter = bank.enter[b];
    let re = keep * (rr[b] * c - ri[b] * sn) + enter * inR;
    let im = keep * (rr[b] * sn + ri[b] * c) + enter * inI;
    heard[b] = Math.max(Math.hypot(inR, inI), heard[b] * keep);
    const limit = MAX_BOOST * heard[b], size = Math.hypot(re, im);
    if (size > limit) {
      const k = limit / size;
      re *= k;
      im *= k;
    }
    rr[b] = re;
    ri[b] = im;
  }

  /** The resonance back to sound, windowed and overlapped; its first hop goes out next. */
  private synthesise(): void {
    const size = this.size, hop = this.hop, w = this.window;
    const re = this.re.subarray(0, size), im = this.im.subarray(0, size);
    joinPair(this.rLr, this.rLi, this.rRr, this.rRi, re, im);
    this.fft.inverse(re, im);
    const gain = this.bank.makeup / OVERLAP_GAIN;
    for (let i = 0; i < size; i++) {
      this.accL[i] += re[i] * w[i] * gain;
      this.accR[i] += im[i] * w[i] * gain;
    }
    this.outL.set(this.accL.subarray(0, hop));
    this.outR.set(this.accR.subarray(0, hop));
    this.accL.copyWithin(0, hop, size);
    this.accR.copyWithin(0, hop, size);
    this.accL.fill(0, size - hop, size);
    this.accR.fill(0, size - hop, size);
  }
}
