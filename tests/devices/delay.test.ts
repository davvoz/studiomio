import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { DELAY, DIVISIONS, SYNC } from '../../src/devices/effects/delay/delay';
import { DelayCore } from '../../src/devices/effects/delay/delay-core';
import { EffectRunner } from '../../src/devices/worklet/effect-runner';

const SR = 48000, BLOCK = 128;

/** An impulse on the left (and on the right) at the start, then silence; processes in blocks. */
function run(core: DelayCore, frames: number, impulse = true): [Float32Array, Float32Array] {
  const outL = new Float32Array(frames), outR = new Float32Array(frames);
  for (let f = 0; f < frames; f += BLOCK) {
    const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK);
    if (impulse && f === 0) inL[0] = inR[0] = 1;
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    core.process(inL, inR, l, r, BLOCK);
    outL.set(l.subarray(0, Math.min(BLOCK, frames - f)), f);
    outR.set(r.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return [outL, outR];
}

/** Index and value of the peak in [from, to). */
function peak(x: Float32Array, from = 1, to = x.length): [number, number] {
  let at = from;
  for (let i = from; i < to; i++) if (Math.abs(x[i]) > Math.abs(x[at])) at = i;
  return [at, x[at]];
}

/** Echo only, filters open. */
const CLEAN = { mix: 100, lowCut: 20, highCut: 20000, feedback: 0 };

const delay = (params: Record<string, number>, bpm = 120) => {
  const core = new DelayCore(SR);
  core.setTempo(bpm);
  core.setParams(resolveParams(DELAY, params));
  return core;
};

describe('Delay', () => {
  it('in milliseconds: the echo arrives exactly after the given time', () => {
    const [l] = run(delay({ ...CLEAN, sync: SYNC.ms, time: 100 }), SR / 2);
    expect(peak(l)[0]).toBe(4800);
    expect(l[0]).toBe(0); // at dry/wet 100% the direct sound isn't there
  });

  it('synced: 1/8 at 120 BPM = 250 ms, 1/4 at 60 BPM = 1 s', () => {
    const eighth = DIVISIONS.findIndex(([d]) => d === '1/8');
    expect(peak(run(delay({ ...CLEAN, division: eighth }), SR)[0])[0]).toBe(12000);
    const quarter = DIVISIONS.findIndex(([d]) => d === '1/4');
    expect(peak(run(delay({ ...CLEAN, division: quarter }, 60), SR * 1.5)[0])[0]).toBe(48000);
  });

  it('changing tempo moves the echo', () => {
    const core = delay({ ...CLEAN, division: DIVISIONS.findIndex(([d]) => d === '1/4') }, 120);
    expect(core.delaySeconds).toBe(0.5);
    core.setTempo(100);
    expect(core.delaySeconds).toBeCloseTo(0.6, 12);
  });

  it('feedback: each repeat weaker than the previous', () => {
    const [l] = run(delay({ ...CLEAN, sync: SYNC.ms, time: 100, feedback: 50 }), SR / 2);
    const [, a] = peak(l, 4000, 6000), [i2, b] = peak(l, 9000, 10600), [, c] = peak(l, 14000, 15000);
    expect(i2).toBe(9600);
    // 50% feedback, minus the little the filters (even open) remove at every round
    for (const ratio of [b / a, c / b]) {
      expect(ratio).toBeLessThanOrEqual(0.5);
      expect(ratio).toBeGreaterThan(0.45);
    }
  });

  it('ping-pong: the repeats alternate between left and right', () => {
    const [l, r] = run(delay({ ...CLEAN, sync: SYNC.ms, time: 100, feedback: 80, pingPong: 1 }), SR / 2);
    expect(Math.abs(peak(l, 4000, 6000)[1])).toBeGreaterThan(0.3);
    expect(Math.abs(peak(r, 4000, 6000)[1])).toBeLessThan(1e-6);
    expect(Math.abs(peak(r, 9000, 10600)[1])).toBeGreaterThan(0.2);
    expect(Math.abs(peak(l, 9000, 10600)[1])).toBeLessThan(1e-6);
  });

  it('the high cut removes the highs from the repeats', () => {
    const bright = peak(run(delay({ ...CLEAN, sync: SYNC.ms, time: 100 }), 6000)[0], 4000)[1];
    const dark = peak(run(delay({ ...CLEAN, sync: SYNC.ms, time: 100, highCut: 800 }), 6000)[0], 4000)[1];
    expect(dark).toBeLessThan(bright / 5);
  });

  it('dry/wet at 0: only the direct sound passes', () => {
    const [l] = run(delay({ mix: 0, sync: SYNC.ms, time: 100 }), SR / 4);
    expect(l[0]).toBe(1);
    expect(l.subarray(1).every(v => v === 0)).toBe(true);
  });

  it('no NaN and tails dying out, even with high feedback', () => {
    const [l] = run(delay({ sync: SYNC.ms, time: 10, feedback: 95 }), SR * 4);
    expect(l.every(Number.isFinite)).toBe(true);
    expect(Math.abs(peak(l, SR * 3.9)[1])).toBeLessThan(1e-3);
  });
});

describe('turning effects off (EffectRunner)', () => {
  /** A fake effect inverting the signal. */
  const invert = { setParams() {}, setTempo() {}, process: (a: Float32Array, b: Float32Array, l: Float32Array, r: Float32Array, n: number) => {
    for (let i = 0; i < n; i++) { l[i] = -a[i]; r[i] = -b[i]; }
  } };
  const ones = () => new Float32Array(BLOCK).fill(1);

  it('off: the sound passes identical', () => {
    const run = new EffectRunner(invert, SR, false);
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    run.process(ones(), ones(), l, r);
    expect(l.every(v => v === 1)).toBe(true);
  });

  it('turning it on switches to the effect with a 10 ms crossfade, without steps', () => {
    const run = new EffectRunner(invert, SR, false);
    run.setEnabled(true);
    const out: number[] = [];
    for (let b = 0; b < 6; b++) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      run.process(ones(), ones(), l, r);
      out.push(...l);
    }
    expect(out[0]).toBeGreaterThan(0.99);
    expect(out[479]).toBe(-1); // 480 samples = 10 ms
    expect(Math.max(...out.slice(1).map((v, i) => Math.abs(v - out[i])))).toBeLessThan(0.01);
  });
});
