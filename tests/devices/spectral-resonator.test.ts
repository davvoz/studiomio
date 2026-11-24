import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { partialHz, partialsOf, resonatorSettings, voicesOf } from '../../src/devices/effects/spectral-resonator/partials';
import { PartialMotion } from '../../src/devices/effects/spectral-resonator/partial-motion';
import { MOD, noteHz, SPECTRAL_RESONATOR } from '../../src/devices/effects/spectral-resonator/spectral-resonator';
import { SpectralResonatorCore } from '../../src/devices/effects/spectral-resonator/spectral-resonator-core';
import { itTimed } from '../helpers/timing';

const SR = 48000, BLOCK = 128;

const resonator = (params: Record<string, number>) => {
  const core = new SpectralResonatorCore(SR);
  core.setParams(resolveParams(SPECTRAL_RESONATOR, params));
  return core;
};

function run(core: SpectralResonatorCore, inL: Float32Array, inR = inL): [Float32Array, Float32Array] {
  const outL = new Float32Array(inL.length), outR = new Float32Array(inL.length);
  for (let f = 0; f < inL.length; f += BLOCK) {
    const n = Math.min(BLOCK, inL.length - f);
    core.process(inL.subarray(f, f + n), inR.subarray(f, f + n), outL.subarray(f, f + n), outR.subarray(f, f + n), n);
  }
  return [outL, outR];
}

/** White noise, always the same. */
function noise(frames: number, seed = 3): Float32Array {
  let a = seed;
  return Float32Array.from({ length: frames }, () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return (a / 0x7fffffff) * 2 - 1;
  }).map(v => v * 0.3);
}
const sine = (hz: number, frames: number, amp = 0.5) => Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const silence = (frames: number) => new Float32Array(frames);
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** The amplitude of the component at `hz` in [from, to) (Goertzel). */
function level(x: Float32Array, hz: number, from: number, to: number): number {
  const w = (2 * Math.PI * hz) / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) {
    const s = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / (to - from);
}
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};
const wet = (params: Record<string, number>) => ({ mix: 100, ...params });

describe('Spectral Resonator: the partials', () => {
  it('the note with Fine, the chord, the unison detuned and spread', () => {
    const s = resonatorSettings(resolveParams(SPECTRAL_RESONATOR, { chord: 2, unison: 3, detune: 20 }));
    expect(s.rootHz).toBeCloseTo(110, 9);
    const v = voicesOf(s);
    expect(v.map(x => +x.hz.toFixed(2))).toEqual([108.74, 110, 111.28, 162.92, 164.81, 166.73]);
    expect(v.map(x => x.pan)).toEqual([-0.8, 0, 0.8, -0.8, 0, 0.8]);
    expect(resonatorSettings(resolveParams(SPECTRAL_RESONATOR, { fine: 100 })).rootHz).toBeCloseTo(noteHz(46), 9);
  });

  it('harmonic by default; Stretch pulls them apart, Shift moves them all', () => {
    const s = resonatorSettings(resolveParams(SPECTRAL_RESONATOR, {}));
    expect([1, 2, 3].map(k => partialHz(100, k, s))).toEqual([100, 200, 300]);
    const wide = { ...s, stretch: 1 }, shifted = { ...s, shift: 50 };
    expect(partialHz(100, 4, wide)).toBeCloseTo(800, 9); // 4^1.5
    expect(partialHz(100, 2, shifted)).toBe(250);
  });

  it('Damping: the high ones quieter and shorter; nothing above the limit', () => {
    const s = resonatorSettings(resolveParams(SPECTRAL_RESONATOR, { damping: 100, partials: 64 }));
    const ps = partialsOf(s, 5000);
    expect(ps).toHaveLength(45); // 110 … 4950 Hz
    expect(ps.every(p => p.hz <= 5000)).toBe(true);
    expect(ps[10].left).toBeLessThan(ps[0].left);
    expect(ps[10].decay).toBeLessThan(ps[0].decay);
  });

  it('the mod moves them: Chorus a little, Granular closes some; the same seed, the same moves', () => {
    const s = resonatorSettings(resolveParams(SPECTRAL_RESONATOR, { mod: MOD.granular, modRate: 20, modAmount: 100 }));
    const a = new PartialMotion(5), b = new PartialMotion(5);
    for (let i = 0; i < 100; i++) { a.advance(s, 0.01, 64); b.advance(s, 0.01, 64); }
    const gates = Array.from({ length: 64 }, (_, i) => a.gate(i));
    expect(gates).toEqual(Array.from({ length: 64 }, (_, i) => b.gate(i)));
    expect(gates.filter(g => g < 0.5).length).toBeGreaterThan(20);
    const chorus = new PartialMotion();
    chorus.advance({ ...s, mod: MOD.chorus, modAmount: 1 }, 0.1, 64);
    const cents = Array.from({ length: 64 }, (_, i) => chorus.cents(i));
    expect(Math.max(...cents.map(Math.abs))).toBeLessThanOrEqual(25);
    expect(new Set(cents.map(c => c.toFixed(3))).size).toBeGreaterThan(50); // each its own
  });
});

describe('Spectral Resonator: the sound', () => {
  it('at Dry/Wet 0 the sound passes intact', () => {
    const x = noise(9600);
    expect(run(resonator({ mix: 0 }), x)[0]).toEqual(x);
  });

  it('a noise rings on the partials of the note, not between them', () => {
    const [y] = run(resonator(wet({ decay: 1500, damping: 0 })), noise(SR * 2));
    const from = SR, to = 2 * SR;
    for (const hz of [110, 220, 330, 440]) expect(level(y, hz, from, to)).toBeGreaterThan(4 * level(y, hz + 55, from, to));
  });

  it('a chord: also the fifth rings', () => {
    const [single] = run(resonator(wet({ decay: 1500 })), noise(SR * 2));
    const [fifth] = run(resonator(wet({ decay: 1500, chord: 2 })), noise(SR * 2));
    const e = noteHz(52); // E2, the fifth above A1
    expect(level(fifth, e, SR, 2 * SR)).toBeGreaterThan(4 * level(single, e, SR, 2 * SR));
  });

  it('it keeps ringing after the sound stops, for as long as Decay says', () => {
    const x = concat(noise(SR / 2), silence(SR * 2));
    const tail = (decay: number) => { const [y] = run(resonator(wet({ decay, damping: 0 })), x); return rms(y, SR, SR + SR / 4); };
    expect(tail(3000)).toBeGreaterThan(10 * tail(150));
    expect(tail(150)).toBeLessThan(1e-3);
  });

  it('a long decay on a loud tone stays under full scale, and finite', () => {
    const [y, r] = run(resonator(wet({ decay: 20000, damping: 0, input: 12 })), sine(220, SR * 3, 0.9));
    let peak = 0;
    for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]), Math.abs(r[i]));
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.3); // it does ring
    expect(y.every(Number.isFinite)).toBe(true);
  });

  it('the resonance arrives one frame later at each Resolution', () => {
    for (const [resolution, size] of [[0, 1024], [1, 2048], [2, 4096]]) {
      const [y] = run(resonator(wet({ resolution })), concat(silence(512), noise(SR / 2)));
      const first = y.findIndex(v => Math.abs(v) > 1e-6);
      expect(first).toBeGreaterThanOrEqual(512);
      expect(first).toBeLessThanOrEqual(512 + size);
    }
  });

  it('Unison spreads in stereo: left and right differ', () => {
    const [l, r] = run(resonator(wet({ unison: 4, detune: 30 })), noise(SR));
    expect(rms(l, SR / 2)).toBeGreaterThan(0.001);
    let diff = 0;
    for (let i = SR / 2; i < SR; i++) diff += Math.abs(l[i] - r[i]);
    expect(diff / (SR / 2)).toBeGreaterThan(0.1 * rms(l, SR / 2));
  });

  it('every mod plays finite sound, the same in two renders', () => {
    for (const mod of [MOD.chorus, MOD.wander, MOD.granular]) {
      const x = noise(SR);
      const [a] = run(resonator(wet({ mod, modRate: 4, modAmount: 80 })), x);
      const [b] = run(resonator(wet({ mod, modRate: 4, modAmount: 80 })), x);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(rms(a, SR / 2)).toBeGreaterThan(0.001);
      expect(a).toEqual(b);
    }
  });

  itTimed('it costs little: ten seconds of the heaviest setting in a fraction of that (about 0.4 s here)', () => {
    const core = resonator(wet({ chord: 8, unison: 8, partials: 64, resolution: 2, mod: MOD.wander }));
    const x = noise(SR);
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
    const t = performance.now();
    for (let s = 0; s < 10; s++) {
      for (let f = 0; f < SR; f += BLOCK) core.process(x.subarray(f, f + BLOCK), x.subarray(f, f + BLOCK), outL, outR, BLOCK);
    }
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
