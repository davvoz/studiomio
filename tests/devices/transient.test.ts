import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { TRANSIENT } from '../../src/devices/effects/transient/transient';
import { RunningMax, softLimit, TransientCore } from '../../src/devices/effects/transient/transient-core';
import { effectType } from '../../src/devices/registry';
import { EFFECT_CORES } from '../../src/devices/worklet/cores';

const SR = 48000;
const at = (s: number) => Math.round(s * SR);

/** Hits of a 200 Hz tone: a sharp attack and a long decay, every 0.25 s, at `level`. */
function hits(seconds: number, level = 0.5): Float32Array {
  const x = new Float32Array(at(seconds)), period = at(0.25);
  for (let i = 0; i < x.length; i++) {
    const t = (i % period) / SR;
    x[i] = level * Math.exp(-t / 0.08) * Math.sin(2 * Math.PI * 200 * t);
  }
  return x;
}

function run(params: Record<string, number>, input: Float32Array): Float32Array {
  const core = new TransientCore(SR);
  core.setParams(resolveParams(TRANSIENT, params));
  const out = new Float32Array(input.length), sink = new Float32Array(input.length);
  for (let f = 0; f < input.length; f += 128) {
    const n = Math.min(128, input.length - f);
    core.process(input.subarray(f, f + n), input.subarray(f, f + n), out.subarray(f, f + n), sink.subarray(f, f + n), n);
  }
  return out;
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

// the second hit, so the followers have seen one already
const HEAD: [number, number] = [at(0.25), at(0.255)];
const BODY: [number, number] = [at(0.3), at(0.45)];

describe('Transient', () => {
  it('is an effect with its engine; every preset plays without exploding', () => {
    expect(effectType('transient')).toBe(TRANSIENT);
    expect(EFFECT_CORES.transient(SR)).toBeInstanceOf(TransientCore);
    const x = hits(1);
    for (const p of TRANSIENT.presets) {
      const y = run(p.params, x);
      expect(y.every(Number.isFinite), p.name).toBe(true);
      expect(Math.max(...y.map(Math.abs)), p.name).toBeLessThan(4);
    }
  });

  it('at zero it leaves the sound as it is', () => {
    const x = hits(0.6);
    const y = run({}, x);
    for (let i = 0; i < x.length; i++) expect(y[i]).toBeCloseTo(x[i], 6);
  });

  it('attack raises the start of the hits and not their body; negative lowers it', () => {
    const x = hits(0.6), up = run({ attack: 100, speed: 10 }, x), down = run({ attack: -100, speed: 10 }, x);
    expect(rms(up, ...HEAD)).toBeGreaterThan(rms(x, ...HEAD) * 1.5);
    expect(rms(down, ...HEAD)).toBeLessThan(rms(x, ...HEAD) * 0.7);
    expect(rms(up, ...BODY) / rms(x, ...BODY)).toBeLessThan(1.25);
  });

  it('sustain raises or lowers what follows the hit', () => {
    const x = hits(0.6), up = run({ sustain: 100, speed: 5, length: 300 }, x), down = run({ sustain: -100, speed: 5, length: 300 }, x);
    expect(rms(up, ...BODY)).toBeGreaterThan(rms(x, ...BODY) * 1.5);
    expect(rms(down, ...BODY)).toBeLessThan(rms(x, ...BODY) * 0.6);
  });

  it('no threshold: a quiet hit is shaped like a loud one', () => {
    const loud = hits(0.6, 0.5), quiet = hits(0.6, 0.05);
    const gain = (x: Float32Array) => rms(run({ attack: 80 }, x), ...HEAD) / rms(x, ...HEAD);
    expect(gain(quiet)).toBeCloseTo(gain(loud), 1);
  });

  it('clip keeps the peaks within 0 dB and leaves the low levels clean', () => {
    expect(softLimit(0.5)).toBe(0.5);
    expect(Math.abs(softLimit(30))).toBeLessThanOrEqual(1);
    const y = run({ attack: 100, output: 12, clip: 1 }, hits(0.6, 0.9));
    expect(Math.max(...y.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('mix at zero is the dry sound', () => {
    const x = hits(0.6), y = run({ attack: 100, sustain: -100, mix: 0 }, x);
    for (let i = 0; i < x.length; i += 97) expect(y[i]).toBeCloseTo(x[i], 6);
  });

  it('the detector: the highest of the last samples, like counting them one by one', () => {
    const max = new RunningMax(7), x = Array.from({ length: 300 }, (_, i) => Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.051)));
    x.forEach((v, i) => expect(max.next(v)).toBeCloseTo(Math.max(...x.slice(Math.max(0, i - 6), i + 1)), 6));
  });

  it('on a held low tone (a 45 Hz kick tail) the gain stays still: it does not distort the wave', () => {
    const tone = Float32Array.from({ length: at(1) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 45 * i) / SR));
    const y = run({ attack: 100, sustain: 100 }, tone);
    let lo = Infinity, hi = 0;
    for (let i = at(0.5); i < at(1); i++) if (Math.abs(tone[i]) > 0.3) {
      const g = y[i] / tone[i];
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(hi / lo).toBeLessThan(1.01);
  });
});
