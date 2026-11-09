/* The Delay's sound: two delay lines (left and right) with interpolated reading, a
 * one-pole high-pass and low-pass on the repeats. The time changes by gliding
 * smoothly (like a tape), without clicks. Runs in the AudioWorklet; no Web Audio here. */
import type { EffectCore } from '../../dsp/core';
import { DIVISIONS, MAX_DELAY_SECONDS, SYNC } from './delay';

/** Coefficient of a one-pole filter with cutoff `hz`. */
const onePole = (hz: number, sampleRate: number) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);

/** Tiny values to zero: the feedback tails mustn't end up in denormal numbers. */
const flush = (x: number) => (Math.abs(x) < 1e-20 ? 0 : x);

/** A delay line with its filters. */
class Line {
  readonly buffer: Float32Array;
  private lp = 0;
  private hpLow = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  /** Reads `delay` samples before position `write`, interpolating. */
  read(write: number, delay: number): number {
    const size = this.buffer.length;
    const pos = write - delay + size;
    const i = Math.floor(pos), frac = pos - i;
    const a = this.buffer[i % size], b = this.buffer[(i + 1) % size];
    return a + (b - a) * frac;
  }

  /** Low-pass (high cut) and high-pass (low cut) on the delayed signal. */
  filter(x: number, lpK: number, hpK: number): number {
    this.lp += lpK * (x - this.lp);
    this.hpLow += hpK * (this.lp - this.hpLow);
    return this.lp - this.hpLow;
  }
}

export class DelayCore implements EffectCore {
  private readonly left: Line;
  private readonly right: Line;
  private write = 0;
  /** Current and wanted delay, in samples. */
  private delay = -1;
  private target = 0;
  private readonly glide: number;
  private params: Readonly<Record<string, number>> = {};
  private bpm = 120;
  private feedback = 0;
  private dry = 1;
  private wet = 0;
  private lpK = 1;
  private hpK = 0;
  private pingPong = false;

  constructor(private readonly sampleRate: number) {
    const size = Math.ceil(MAX_DELAY_SECONDS * sampleRate) + 4;
    this.left = new Line(size);
    this.right = new Line(size);
    this.glide = onePole(8, sampleRate); // ~20 ms to settle
  }

  setParams(p: Readonly<Record<string, number>>): void {
    this.params = p;
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.feedback = v('feedback', 35) / 100;
    const mix = v('mix', 30) / 100;
    // up to halfway the dry stays full, then drops: at 100% only the repeats
    this.dry = Math.min(1, 2 * (1 - mix));
    this.wet = Math.min(1, 2 * mix);
    this.lpK = onePole(v('highCut', 6000), this.sampleRate);
    this.hpK = onePole(v('lowCut', 100), this.sampleRate);
    this.pingPong = v('pingPong', 0) === 1;
    this.updateTarget();
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.updateTarget();
  }

  /** Delay in seconds with the current parameters and tempo. */
  get delaySeconds(): number {
    const p = this.params;
    if ((p.sync ?? SYNC.tempo) === SYNC.ms) return (p.time ?? 300) / 1000;
    const beats = DIVISIONS[p.division ?? 7]?.[1] ?? 0.75;
    return Math.min(MAX_DELAY_SECONDS, (beats * 60) / this.bpm);
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { left, right, feedback: fb, dry, wet, lpK, hpK, glide, target } = this;
    const size = left.buffer.length;
    if (this.delay < 0) this.delay = target;
    let d = this.delay, w = this.write;
    for (let i = 0; i < n; i++) {
      d += (target - d) * glide;
      const yL = left.filter(left.read(w, d), lpK, hpK);
      const yR = right.filter(right.read(w, d), lpK, hpK);
      const xL = inL[i], xR = inR[i];
      if (this.pingPong) {
        // the input comes in on the left; each repeat crosses to the other side
        left.buffer[w] = flush((xL + xR) * 0.5 + yR * fb);
        right.buffer[w] = flush(yL * fb);
      } else {
        left.buffer[w] = flush(xL + yL * fb);
        right.buffer[w] = flush(xR + yR * fb);
      }
      outL[i] = xL * dry + yL * wet;
      outR[i] = xR * dry + yR * wet;
      w = w + 1 === size ? 0 : w + 1;
    }
    this.delay = d;
    this.write = w;
  }

  private updateTarget(): void {
    this.target = Math.max(1, Math.min(this.left.buffer.length - 4, this.delaySeconds * this.sampleRate));
  }
}
