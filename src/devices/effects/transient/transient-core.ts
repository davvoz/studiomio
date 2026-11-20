/* The Transient's sound (see transient.ts). One detector for both channels (the louder of the
 * two, so the stereo image does not move): the highest level of the last 20 ms, which is steady
 * on a held tone (down to a kick's 45 Hz), so the gain doesn't follow the waveform. It feeds
 * three envelope followers:
 *
 *   attack:  level  vs  slow (opens in Speed, closes at once)
 *            → in the first milliseconds of a hit the level is above the slow one by D dB
 *   sustain: tail (opens at once, closes in Length)  vs  short (opens at once, closes in Speed)
 *            → while the hit dies out the tail one is above the short one by S dB
 *
 * The gain is Attack × D + Sustain × S (in dB, within ±24): no threshold, so a quiet hit is
 * shaped like a loud one. Pure: no Web Audio, tested in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';

/** How far the gain can go, in dB. */
const RANGE_DB = 24;
const FLOOR = 1e-6;
const SMOOTH = 0.02;
/** The fastest opening of the followers, in seconds. */
const INSTANT = 0.0002;
/** The detector's window, in seconds: longer than half a period of the lowest tone. */
const WINDOW = 0.02;

const coef = (seconds: number, sampleRate: number) => Math.exp(-1 / Math.max(1, seconds * sampleRate));

/** An envelope follower with its own opening and closing times. */
class Follower {
  value = 0;
  private up = 0;
  private down = 0;

  set(attack: number, release: number, sampleRate: number): void {
    this.up = coef(attack, sampleRate);
    this.down = coef(release, sampleRate);
  }

  next(x: number): number {
    const k = x > this.value ? this.up : this.down;
    this.value = x + (this.value - x) * k;
    return this.value;
  }
}

/** The highest value of the last `size` samples (a monotonic queue: constant time per sample). */
export class RunningMax {
  private readonly values: Float32Array;
  private readonly times: Float64Array;
  private head = 0;
  private count = 0;
  private t = 0;

  constructor(private readonly size: number) {
    this.values = new Float32Array(size + 1);
    this.times = new Float64Array(size + 1);
  }

  next(x: number): number {
    const cap = this.values.length;
    // the older smaller values can never be the highest again
    while (this.count > 0 && this.values[(this.head + this.count - 1) % cap] <= x) this.count--;
    const tail = (this.head + this.count) % cap;
    this.values[tail] = x;
    this.times[tail] = this.t;
    this.count++;
    // the ones out of the window leave from the front
    while (this.times[this.head] <= this.t - this.size) {
      this.head = (this.head + 1) % cap;
      this.count--;
    }
    this.t++;
    return this.values[this.head];
  }
}

/** How far `a` is above `b`, in dB, never below 0. */
const above = (a: number, b: number) => Math.max(0, 20 * Math.log10((a + FLOOR) / (b + FLOOR)));

/** A soft limit at ±1: clean up to 0.8, then a tanh knee. */
export const softLimit = (x: number): number => {
  const a = Math.abs(x);
  if (a <= 0.8) return x;
  const y = 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
  return x < 0 ? -y : y;
};

export class TransientCore implements EffectCore {
  private readonly level: RunningMax;
  private readonly slow = new Follower();
  private readonly tail = new Follower();
  private readonly short = new Follower();
  private attack = 0;
  private sustain = 0;
  private clip = false;
  private output = 1;
  private targetOutput = 1;
  private mix = 1;
  private targetMix = 1;
  private fresh = true;
  private readonly smoothK: number;
  /** The gain applied to the last sample, in dB. */
  lastGainDb = 0;

  constructor(private readonly sampleRate: number) {
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.level = new RunningMax(Math.round(WINDOW * sampleRate));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const sr = this.sampleRate, speed = (p.speed ?? 12) / 1000, length = Math.max(speed * 2, (p.length ?? 120) / 1000);
    this.slow.set(speed, INSTANT, sr);
    this.tail.set(INSTANT, length, sr);
    this.short.set(INSTANT, speed, sr);
    this.attack = (p.attack ?? 0) / 100;
    this.sustain = (p.sustain ?? 0) / 100;
    this.clip = (p.clip ?? 0) >= 0.5;
    this.targetOutput = dbToGain(p.output ?? 0);
    this.targetMix = (p.mix ?? 100) / 100;
    if (this.fresh) {
      this.output = this.targetOutput;
      this.mix = this.targetMix;
    }
  }

  setTempo(): void {}

  /** The gain in dB for one detector value. */
  private gainDb(x: number): number {
    const level = this.level.next(x);
    const d = above(level, this.slow.next(level));
    const s = above(this.tail.next(level), this.short.next(level));
    return Math.max(-RANGE_DB, Math.min(RANGE_DB, this.attack * Math.min(d, RANGE_DB) + this.sustain * Math.min(s, RANGE_DB)));
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const k = this.smoothK;
    let output = this.output, mix = this.mix, db = this.lastGainDb;
    for (let i = 0; i < n; i++) {
      output += (this.targetOutput - output) * k;
      mix += (this.targetMix - mix) * k;
      const l = inL[i], r = inR[i];
      db = this.gainDb(Math.max(Math.abs(l), Math.abs(r)));
      const g = (1 - mix + mix * Math.pow(10, db / 20)) * output;
      let yl = l * g, yr = r * g;
      if (this.clip) {
        yl = softLimit(yl);
        yr = softLimit(yr);
      }
      outL[i] = yl;
      outR[i] = yr;
    }
    this.output = output;
    this.mix = mix;
    this.lastGainDb = db;
  }
}
