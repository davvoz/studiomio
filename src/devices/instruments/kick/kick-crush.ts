/* The Kick's Crush (see kick.ts): the distortion of hard kicks. The body and the tail go up to twice
 * the sample rate, through a gain of up to +36 dB into a smooth hard-clipping curve (with an offset
 * for the even harmonics: the asymmetry), and back down; then a resonant low-pass gives the
 * distortion its tone. The oversampling delays the kick by LATENCY samples: the layers that
 * don't go through the crush (the snap, the body's envelope for the rumble's ducking) are delayed
 * by the same amount, so the hit stays one. Pure: no Web Audio, tested in Node. */
import { Oversampler } from '../../dsp/oversampler';
import { Svf } from '../../dsp/svf';

const LP = 0;
/** The curve's hardness: the higher, the closer to hard clipping. */
const HARDNESS = 4;
/** The highest gain into the curve, in dB. */
const MAX_GAIN_DB = 36;

/** A smooth hard clip: linear near 0, flat at ±1, no corners. */
export const hardCurve = (u: number): number => u / Math.pow(1 + Math.pow(Math.abs(u), HARDNESS), 1 / HARDNESS);

/** The crush curve with `gain` and `offset` (the asymmetry), 0 at 0. */
export const crushCurve = (x: number, gain: number, offset: number): number => hardCurve(x * gain + offset) - hardCurve(offset);

export interface CrushSettings {
  /** 0..1 */
  readonly amount: number;
  readonly tone: number;
  /** 0..1 */
  readonly resonance: number;
  /** 0..1 */
  readonly asymmetry: number;
}

export class KickCrush {
  private readonly os = new Oversampler(2);
  /** The delay of the oversampling round trip, in samples (whole, for the 2× stage). */
  readonly latency: number;
  private readonly filter: Svf;
  private gain = 1;
  private offset = 0;
  private makeup = 1;
  // the delay lines of the layers outside the crush
  private readonly lines: Float32Array[];
  private pos = 0;

  constructor(sampleRate: number, lines: number) {
    this.latency = Math.round(this.os.latency);
    this.filter = new Svf(sampleRate);
    this.lines = Array.from({ length: lines }, () => new Float32Array(this.latency + 1));
  }

  set(s: CrushSettings): void {
    this.gain = Math.pow(10, (s.amount * MAX_GAIN_DB) / 20);
    this.offset = s.asymmetry * 0.6;
    // the louder the curve is driven, the more it sits at ±1: bring it back near the clean level
    this.makeup = 1 / (1 + s.amount * 0.6);
    this.filter.set(s.tone, s.resonance * 0.85, LP);
  }

  /** Crushes `n` samples of `kick` in place. */
  process(kick: Float32Array, n: number): void {
    const up = this.os.up(kick, n), g = this.gain, o = this.offset;
    for (let j = 0, m = n * 2; j < m; j++) up[j] = crushCurve(up[j], g, o);
    this.os.down(up, kick, n);
    const k = this.makeup;
    for (let i = 0; i < n; i++) kick[i] = this.filter.process(kick[i]) * k;
  }

  /** Delays `n` samples of each of `layers` (one per line) by the latency, in place. */
  align(layers: readonly Float32Array[], n: number): void {
    const size = this.latency + 1;
    let pos = this.pos;
    for (let i = 0; i < n; i++) {
      const read = (pos + 1) % size;
      layers.forEach((x, l) => {
        const line = this.lines[l];
        line[pos] = x[i];
        x[i] = line[read];
      });
      pos = read;
    }
    this.pos = pos;
  }

  clear(): void {
    this.filter.reset();
    for (const line of this.lines) line.fill(0);
  }
}
