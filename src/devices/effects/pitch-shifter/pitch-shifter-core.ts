/* The Pitch Shifter's sound. The input (plus the feedback) goes onto a tape; two heads
 * read it back at a delay gliding inside the Window at the speed that shifts the pitch
 * (faster than the tape: up, slower: down), offset by half a window. When one reaches
 * the end it jumps to the other side, and there its volume is zero: the two hand over the sound with a
 * squared-sine crossfade, which always sums to one. Left and right each have their
 * own heads (Stereo detunes them in opposite directions). With the pitch still the heads slowly return
 * to the middle of the window, where only one plays: no comb filter. Semitones glides with Glide,
 * Window and mix glide smoothly. Runs in the AudioWorklet; no Web Audio here. */
import type { EffectCore } from '../../dsp/core';
import { TapeBuffer } from '../../dsp/tape-buffer';
import { MAX_WINDOW_MS } from './pitch-shifter';

/** The heads' minimum delay, in samples (the interpolation also reads the neighbours). */
const OFFSET = 4;
/** The speed at which still heads return to the middle of the window (17 cents: a dive that settles). */
const SETTLE = 0.01;
const SMOOTH = 0.03;

export class PitchShifterCore implements EffectCore {
  private readonly tape: TapeBuffer;
  private readonly tmp = new Float32Array(2);
  private readonly smoothK: number;
  private readonly ms: number;
  /** Where the heads are in the window (0..1), per channel. */
  private readonly phase = [0.5, 0.5];
  private readonly ratio = [1, 1];
  private lastL = 0;
  private lastR = 0;
  private fresh = true;

  private semitones = 0;
  private targetSemitones = 0;
  private cents = 0;
  private spread = 0;
  private glideK = 1;
  private window: number;
  private targetWindow: number;
  private feedback = 0;
  private mix = 1;
  private targetMix = 1;
  /** The step the ratios were computed for (NaN: to be recomputed). */
  private ratioFor = NaN;

  constructor(private readonly sampleRate: number) {
    this.ms = sampleRate / 1000;
    this.tape = new TapeBuffer(Math.ceil(MAX_WINDOW_MS * this.ms) + OFFSET + 8);
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.window = this.targetWindow = 60 * this.ms;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.targetSemitones = v('semitones', 0);
    this.cents = v('fine', 0);
    this.spread = v('spread', 0);
    const glide = v('glide', 20) / 1000;
    this.glideK = glide > 0 ? 1 - Math.exp(-1 / (glide * this.sampleRate)) : 1;
    this.targetWindow = v('window', 60) * this.ms;
    this.feedback = v('feedback', 0) / 100;
    this.targetMix = v('mix', 100) / 100;
    this.ratioFor = NaN;
    if (this.fresh) {
      this.semitones = this.targetSemitones;
      this.window = this.targetWindow;
      this.mix = this.targetMix;
    }
  }

  setTempo(): void {}

  /** The speed ratio of the channel's heads (for tests and for drawing it). */
  ratioOf(channel: 0 | 1): number {
    this.updateRatios();
    return this.ratio[channel];
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { tape, tmp, phase, ratio } = this, fb = this.feedback;
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      tape.write(xL + this.lastL * fb, xR + this.lastR * fb);
      const now = tape.written - 1;
      this.semitones += (this.targetSemitones - this.semitones) * this.glideK;
      this.window += (this.targetWindow - this.window) * this.smoothK;
      this.updateRatios();
      const w = this.window;
      let wL = 0, wR = 0;
      for (let c = 0; c < 2; c++) {
        let ph = phase[c];
        const r = ratio[c];
        if (Math.abs(r - 1) < 1e-7) ph += Math.max(-SETTLE / w, Math.min(SETTLE / w, 0.5 - ph));
        else ph += (1 - r) / w;
        ph -= Math.floor(ph);
        phase[c] = ph;
        const other = ph < 0.5 ? ph + 0.5 : ph - 0.5;
        const g = Math.sin(Math.PI * ph) ** 2;
        tape.read(now - OFFSET - ph * w, tmp);
        let y = tmp[c] * g;
        tape.read(now - OFFSET - other * w, tmp);
        y += tmp[c] * (1 - g);
        if (c === 0) wL = y;
        else wR = y;
      }
      this.lastL = wL;
      this.lastR = wR;
      this.mix += (this.targetMix - this.mix) * this.smoothK;
      const m = this.mix;
      outL[i] = xL + (wL - xL) * m;
      outR[i] = xR + (wR - xR) * m;
    }
  }

  private updateRatios(): void {
    const st = this.semitones;
    if (st === this.ratioFor) return;
    this.ratioFor = st;
    const base = st + this.cents / 100, half = this.spread / 200;
    this.ratio[0] = 2 ** ((base - half) / 12);
    this.ratio[1] = 2 ** ((base + half) / 12);
  }
}
