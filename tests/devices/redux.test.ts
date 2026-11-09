import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { MAX_RATE, REDUX, REDUX_FILTER } from '../../src/devices/effects/redux/redux';
import { ReduxCore } from '../../src/devices/effects/redux/redux-core';

const SR = 48000, BLOCK = 128;

const redux = (params: Record<string, number>) => {
  const core = new ReduxCore(SR);
  core.setParams(resolveParams(REDUX, params));
  return core;
};

/** Plays the Redux in blocks, the same signal on both channels. */
function play(core: ReduxCore, frames: number, input: (n: number) => number): [Float32Array, Float32Array] {
  const l = new Float32Array(frames), r = new Float32Array(frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    for (let i = 0; i < BLOCK; i++) inL[i] = inR[i] = input(f + i);
    core.process(inL, inR, outL, outR, BLOCK);
    l.set(outL.subarray(0, Math.min(BLOCK, frames - f)), f);
    r.set(outR.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return [l, r];
}

const sine = (hz: number, amp = 0.5) => (n: number) => amp * Math.sin((2 * Math.PI * hz * n) / SR);
const maxJump = (x: Float32Array) => x.reduce((m, y, n) => (n ? Math.max(m, Math.abs(y - x[n - 1])) : 0), 0);
/** How much a frequency weighs in the signal (peak amplitude), with a DFT on a piece. */
function level(x: Float32Array, hz: number, from = 4800, length = 9600): number {
  let re = 0, im = 0;
  for (let n = from; n < from + length; n++) {
    re += x[n] * Math.cos((2 * Math.PI * hz * n) / SR);
    im += x[n] * Math.sin((2 * Math.PI * hz * n) / SR);
  }
  return (2 * Math.hypot(re, im)) / length;
}

describe('Redux', () => {
  it('at maximum Frequency and Bits the sound passes (except the 16-bit rounding)', () => {
    const input = sine(440);
    const [l] = play(redux({ rate: MAX_RATE, bits: 16 }), 2000, input);
    for (let n = 0; n < 2000; n++) expect(Math.abs(l[n] - input(n))).toBeLessThanOrEqual(0.5 / 32768 + 1e-7);
  });

  it('at a quarter of the rate each sample stays still for four', () => {
    const input = sine(300);
    const [l, r] = play(redux({ rate: SR / 4, bits: 16 }), 1024, input);
    for (let n = 0; n < 1024; n++) expect(l[n]).toBeCloseTo(input(n - (n % 4)), 4);
    expect(r).toEqual(l);
  });

  it('the bits: with 1 bit −1, 0 and 1 remain; with 3 bits steps of a quarter', () => {
    const one = play(redux({ rate: MAX_RATE, bits: 1 }), 1000, sine(100, 0.9))[0];
    expect(new Set(one)).toEqual(new Set([-1, 0, 1]));
    const three = play(redux({ rate: MAX_RATE, bits: 3 }), 1000, sine(100, 0.9))[0];
    for (const y of three) expect(Math.abs(y * 4 - Math.round(y * 4))).toBeLessThan(1e-6);
    expect(new Set(three).size).toBe(9); // from −1 to 1 in steps of a quarter
  });

  it('Jitter: the step changes, but on average it stays the Frequency\'s', () => {
    const steady = redux({ rate: 1000 }), shaky = redux({ rate: 1000, jitter: 100 });
    play(steady, SR, () => 0);
    play(shaky, SR, () => 0);
    expect(steady.taken).toBe(1000);
    expect(shaky.taken).toBeGreaterThan(950);
    expect(shaky.taken).toBeLessThan(1050);
  });

  it('Jitter: the samples no longer arrive at a fixed step', () => {
    const gaps = (jitter: number) => {
      const [l] = play(redux({ rate: 2000, bits: 16, jitter }), 12000, n => n / 12000);
      const changes: number[] = [];
      for (let n = 1; n < l.length; n++) if (l[n] !== l[n - 1]) changes.push(n);
      return new Set(changes.slice(1).map((c, k) => c - changes[k]));
    };
    expect(gaps(0)).toEqual(new Set([24]));
    expect(gaps(50).size).toBeGreaterThan(5);
  });

  it('the Pre filter removes what would fold back', () => {
    // 5 kHz with the Frequency at 4 kHz: without filter it comes back down to 1 kHz
    const plain = play(redux({ rate: 4000, bits: 16 }), 14400, sine(5000))[0];
    const filtered = play(redux({ rate: 4000, bits: 16, filter: REDUX_FILTER.pre }), 14400, sine(5000))[0];
    expect(level(plain, 1000)).toBeGreaterThan(0.3);
    expect(level(filtered, 1000)).toBeLessThan(0.01);
  });

  it('the Post filter smooths the steps', () => {
    const input = sine(200, 0.9);
    const plain = play(redux({ rate: 1000, bits: 16 }), 4800, input)[0];
    const smooth = play(redux({ rate: 1000, bits: 16, filter: REDUX_FILTER.post }), 4800, input)[0];
    expect(maxJump(plain)).toBeGreaterThan(0.5);
    expect(maxJump(smooth)).toBeLessThan(0.1);
  });

  it('Dry/Wet at 0 leaves the sound as it is; Output raises or lowers it', () => {
    const input = sine(440);
    const [dry] = play(redux({ rate: 500, bits: 2, mix: 0 }), 1000, input);
    for (let n = 0; n < 1000; n += 17) expect(dry[n]).toBeCloseTo(input(n), 6);
    const [loud] = play(redux({ rate: MAX_RATE, bits: 16, output: 6 }), 1000, input);
    expect(loud[500] / input(500)).toBeCloseTo(10 ** (6 / 20), 3);
  });
});
