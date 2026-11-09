import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { Oversampler } from '../../src/devices/dsp/oversampler';
import { COMPRESSOR, DETECTOR } from '../../src/devices/effects/compressor/compressor';
import { CompressorCore } from '../../src/devices/effects/compressor/compressor-core';
import { autoMakeup, curveDb } from '../../src/devices/effects/compressor/compressor-math';
import { LIMITER } from '../../src/devices/effects/limiter/limiter';
import { NOISE_GATE } from '../../src/devices/effects/noise-gate/noise-gate';
import { NoiseGateCore } from '../../src/devices/effects/noise-gate/noise-gate-core';
import { LimiterCore } from '../../src/devices/effects/limiter/limiter-core';
import { REVERB } from '../../src/devices/effects/reverb/reverb';
import { ReverbCore } from '../../src/devices/effects/reverb/reverb-core';
import { MULTIBAND } from '../../src/devices/effects/multiband/multiband';
import { MultibandCore } from '../../src/devices/effects/multiband/multiband-core';
import type { EffectCore } from '../../src/devices/dsp/core';

const SR = 48000, BLOCK = 128;
const db = (a: number) => 20 * Math.log10(Math.max(1e-12, a));
const gain = (d: number) => Math.pow(10, d / 20);

/** Runs an effect in blocks; returns the two channels. */
function run(core: EffectCore, left: Float32Array, right: Float32Array = left): [Float32Array, Float32Array] {
  const outL = new Float32Array(left.length), outR = new Float32Array(left.length);
  for (let f = 0; f < left.length; f += BLOCK) {
    const n = Math.min(BLOCK, left.length - f);
    const l = new Float32Array(n), r = new Float32Array(n);
    core.process(left.slice(f, f + n), right.slice(f, f + n), l, r, n);
    outL.set(l, f);
    outR.set(r, f);
  }
  return [outL, outR];
}

const sine = (freq: number, amp: number, n: number, phase = 0) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR + phase));
const peak = (x: Float32Array, from = 0, to = x.length) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

const compressor = (params: Record<string, number>) => {
  const c = new CompressorCore(SR);
  c.setParams(resolveParams(COMPRESSOR, { auto: 0, ...params }));
  return c;
};

describe('Compressor', () => {
  it('on a steady sound it reaches the curve\'s reduction, whatever the attack and release', () => {
    // −6 dB in, threshold −18, 4:1: 9 dB less. The peak detector mustn't "average"
    // between one half-wave and the next, otherwise moving the attack changes how much it compresses
    for (const [attack, release] of [[1, 100], [10, 120], [30, 150], [100, 100], [100, 1000]]) {
      for (const freq of [200, 1000]) {
        const x = sine(freq, 0.5, 96000);
        const [out] = run(compressor({ threshold: -18, ratio: 4, knee: 0, attack, release }), x);
        expect(db(peak(x, 48000)) - db(peak(out, 48000)), `attack ${attack}, release ${release}, ${freq} Hz`).toBeCloseTo(9, 0);
      }
    }
  });

  it('a slow attack doesn\'t lengthen the release', () => {
    const quiet = 48000, loud = sine(1000, 0.9, quiet);
    const x = new Float32Array(quiet * 2);
    x.set(loud);
    const y = x.map((v, i) => (i < quiet ? v : 0.001));
    const c = compressor({ threshold: -30, ratio: 8, knee: 0, attack: 100, release: 10 });
    const [out] = run(c, y);
    // 100 ms after the end of the loud sound (10 releases) the reduction is over, the output is the input
    expect(Math.abs(out[quiet + 4800])).toBeCloseTo(0.001, 4);
  });

  it('it tells its panel what it hears and how much it reduces', () => {
    const c = compressor({ threshold: -18, ratio: 4, knee: 0, attack: 1, release: 100 });
    run(c, sine(1000, 0.5, 48000));
    const out = new Float32Array(2);
    c.readDynamics(out);
    expect(out[0]).toBeCloseTo(-6, 0);
    expect(out[1]).toBeCloseTo(9, 0);
  });

  it('the curve: below the threshold nothing, above the ratio; the knee blends', () => {
    const hard = { threshold: -20, ratio: 4, knee: 0 };
    expect(curveDb(hard, -30)).toBe(-30);
    expect(curveDb(hard, -8)).toBeCloseTo(-17, 6);
    const soft = { ...hard, knee: 10 };
    expect(curveDb(soft, -26)).toBe(-26);
    expect(curveDb(soft, -14)).toBeCloseTo(curveDb(hard, -14), 6);
    // in the knee it sits between the straight and the hard curve, and it's continuous
    expect(curveDb(soft, -20)).toBeLessThan(-20);
    expect(curveDb(soft, -20)).toBeGreaterThan(curveDb(hard, -15) - 5);
    expect(autoMakeup(hard)).toBeCloseTo(7.5, 6);
  });

  it('a sine above the threshold comes out where the curve says; below it passes intact', () => {
    const out = run(compressor({ threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 }), sine(1000, gain(-6), SR))[0];
    expect(db(peak(out, SR / 2))).toBeCloseTo(-15, 0);
    const quiet = sine(1000, gain(-30), SR / 2);
    const same = run(compressor({ threshold: -18 }), quiet)[0];
    expect(peak(same.map((v, i) => v - quiet[i]))).toBeLessThan(1e-6);
  });

  it('attack and release: the reduction arrives and leaves with its own times', () => {
    const x = new Float32Array(SR);
    x.set(sine(1000, gain(-40), SR / 4));
    x.set(sine(1000, gain(-6), SR / 2), SR / 4);
    x.set(sine(1000, gain(-40), SR / 4), (3 * SR) / 4);
    const out = run(compressor({ threshold: -20, ratio: 10, knee: 0, attack: 20, release: 200 }), x)[0];
    const at = (ms: number) => db(peak(out, Math.round(ms * SR / 1000), Math.round((ms + 2) * SR / 1000)));
    // as soon as the loud comes in almost everything passes, after 100 ms it's compressed
    expect(at(251)).toBeGreaterThan(-9);
    expect(at(350)).toBeLessThan(-16);
    // back to quiet: right away still lowered, after a second of release almost free
    expect(at(752) - -40).toBeLessThan(-6);
  });

  it('mix at zero: the dry comes out; linked channels: the same gain on the left and on the right', () => {
    const x = sine(500, 0.9, SR / 4);
    const dry = run(compressor({ threshold: -40, ratio: 20, mix: 0 }), x)[0];
    expect(peak(dry.map((v, i) => v - x[i]))).toBeLessThan(1e-6);
    const l = sine(500, 0.9, SR / 2), r = sine(500, 0.05, SR / 2);
    const [ol, or] = run(compressor({ threshold: -20, ratio: 8 }), l, r);
    expect(peak(ol, SR / 4) / 0.9).toBeCloseTo(peak(or, SR / 4) / 0.05, 2);
  });

  it('the high-pass on the detector: a loud bass doesn\'t make it work', () => {
    const reduction = (scHp: number) => {
      const c = compressor({ threshold: -20, ratio: 8, scHp });
      run(c, sine(40, 0.8, SR / 2));
      return c.maxReduction;
    };
    expect(reduction(20)).toBeGreaterThan(10);
    expect(reduction(500)).toBeLessThan(1);
  });

  it('RMS: on a sine it hears 3 dB less than the peak', () => {
    const level = (detector: number) => {
      const out = run(compressor({ threshold: -30, ratio: 2, knee: 0, attack: 1, release: 100, detector }), sine(1000, gain(-6), SR))[0];
      return db(peak(out, SR / 2));
    };
    expect(level(DETECTOR.rms) - level(DETECTOR.peak)).toBeCloseTo(1.5, 0);
  });
});

const limiter = (params: Record<string, number>) => {
  const c = new LimiterCore(SR);
  c.setParams(resolveParams(LIMITER, params));
  return c;
};

/** The true (rebuilt) peak with 8× oversampling. */
function truePeak(x: Float32Array): number {
  const os = new Oversampler(8);
  let p = 0;
  for (let f = 0; f + BLOCK <= x.length; f += BLOCK) {
    const up = os.up(x.subarray(f, f + BLOCK), BLOCK);
    for (let i = 0; i < BLOCK * 8; i++) p = Math.max(p, Math.abs(up[i]));
  }
  return p;
}

describe('Limiter', () => {
  it('no sample above the ceiling, even pushed by 12 dB on noise and hits', () => {
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    // a sound with dynamics: quiet noise, a sine, and loud hits every 100 ms
    const x = Float32Array.from({ length: SR }, (_, i) => rnd() * 0.05 + (i % 4800 < 30 ? 0.9 * rnd() : 0) + Math.sin(i * 0.01) * 0.2);
    const [l, r] = run(limiter({ gain: 12, ceiling: -1 }), x, x.map(v => -v * 0.8));
    expect(Math.max(peak(l), peak(r))).toBeLessThanOrEqual(gain(-1) + 1e-6);
    expect(db(rms(l))).toBeGreaterThan(db(rms(x)) + 4); // really louder
  });

  it('the gain drops before the peak: an isolated hit isn\'t cut (shape intact)', () => {
    const x = new Float32Array(SR / 2);
    x.set(sine(200, 2, 480), 12000); // a +6 dB hit, ten milliseconds
    const lim = limiter({ ceiling: 0, lookahead: 3, truePeak: 0 });
    const out = run(lim, x)[0];
    const L = lim.latency;
    expect(peak(out)).toBeLessThanOrEqual(1 + 1e-6);
    // in the middle of the hit the output/input ratio is constant: it's a gain, not a clip
    const ratios = [100, 200, 300].map(k => out[12000 + k + L] / x[12000 + k]).filter(Number.isFinite);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.05);
  });

  it('quiet sounds pass untouched, only delayed by the lookahead', () => {
    const x = sine(440, 0.3, SR / 4);
    const lim = limiter({ lookahead: 2 });
    const out = run(lim, x)[0], L = lim.latency;
    expect(L).toBeGreaterThanOrEqual(96);
    expect(L).toBeLessThan(96 + 20); // the lookahead plus the inter-sample measurement
    let err = 0;
    for (let i = L; i < x.length; i++) err = Math.max(err, Math.abs(out[i] - x[i - L]));
    expect(err).toBeLessThan(1e-6);
  });

  it('between the samples: it also holds the rebuilt peak', () => {
    // a sine at a quarter of the sample rate, phase-shifted: the samples are at 0.71, the true peak is 1
    const x = sine(SR / 4, 1, SR / 2, Math.PI / 4);
    const on = run(limiter({ ceiling: -1, truePeak: 1 }), x)[0];
    const off = run(limiter({ ceiling: -1, truePeak: 0 }), x)[0];
    expect(db(truePeak(on.subarray(4800)))).toBeLessThan(-0.7);
    expect(db(truePeak(off.subarray(4800)))).toBeGreaterThan(-0.6);
  });

  it('after a hit the gain comes back with the release', () => {
    const x = sine(1000, 0.5, SR);
    x.set(sine(1000, 2, 2400), 4800);
    const out = run(limiter({ ceiling: 0, release: 50 }), x)[0];
    expect(peak(out, SR / 2, SR)).toBeGreaterThan(0.49);
  });
});

const reverb = (params: Record<string, number>) => {
  const c = new ReverbCore(SR);
  c.setParams(resolveParams(REVERB, params));
  return c;
};

describe('Reverb', () => {
  it('the tail decays in the chosen time (−60 dB)', () => {
    for (const decay of [1, 3]) {
      const x = new Float32Array(SR * (decay + 1));
      x[0] = 1;
      const [l, r] = run(reverb({ decay, mix: 100, predelay: 0, damping: 20000, lowCut: 20 }), x);
      const energy = (from: number, to: number) => rms(l, from, to) + rms(r, from, to);
      // slope between 0.2 and 0.2+decay/2 seconds, in dB per second
      const a = Math.round(0.2 * SR), b = Math.round((0.2 + decay / 2) * SR), w = SR / 20;
      const slope = (db(energy(b, b + w)) - db(energy(a, a + w))) / (decay / 2);
      expect(-60 / slope).toBeGreaterThan(decay * 0.75);
      expect(-60 / slope).toBeLessThan(decay * 1.3);
    }
  });

  it('dry/wet at zero: the sound passes as it was; wide stereo; stable with very long tails', () => {
    const x = sine(300, 0.5, SR / 4);
    const dry = run(reverb({ mix: 0 }), x)[0];
    expect(peak(dry.map((v, i) => v - x[i]))).toBeLessThan(1e-6);
    const imp = new Float32Array(SR * 2);
    imp[0] = 1;
    const [l, r] = run(reverb({ mix: 100, decay: 2 }), imp);
    let c = 0;
    for (let i = 2400; i < imp.length; i++) c += l[i] * r[i];
    expect(Math.abs(c) / (rms(l, 2400) * rms(r, 2400) * (imp.length - 2400))).toBeLessThan(0.3);
    const long = run(reverb({ mix: 100, decay: 20 }), sine(200, 0.5, SR * 6))[0];
    expect(long.every(Number.isFinite)).toBe(true);
    expect(peak(long)).toBeLessThan(3);
  });

  it('pre-delay: the tail starts later; damping: the highs die out earlier', () => {
    const imp = new Float32Array(SR);
    imp[0] = 1;
    const out = run(reverb({ mix: 100, predelay: 50, diffusion: 0 }), imp)[0];
    expect(peak(out, 0, Math.round(0.05 * SR))).toBeLessThan(1e-6);
    const bright = (damping: number) => {
      const o = run(reverb({ mix: 100, damping, decay: 2 }), imp)[0];
      const d = o.map((v, i) => (i ? v - o[i - 1] : 0));
      return rms(d, SR / 2, SR) / rms(o, SR / 2, SR);
    };
    expect(bright(2000)).toBeLessThan(bright(18000) / 2);
  });
});

const multiband = (params: Record<string, number>) => {
  const c = new MultibandCore(SR);
  c.setParams(resolveParams(MULTIBAND, params));
  return c;
};

/** Amplitude of the component at `freq` in x[from…] (Hann window). */
function amplitude(x: Float32Array, freq: number, from: number, n: number): number {
  let re = 0, im = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)), a = (2 * Math.PI * freq * (from + i)) / SR;
    re += w * x[from + i] * Math.cos(a);
    im += w * x[from + i] * Math.sin(a);
    wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

describe('Multiband', () => {
  it('at rest it\'s flat: the three bands summed back give the whole sound (every frequency)', () => {
    for (const freq of [40, 120, 700, 2500, 9000]) {
      const out = run(multiband({ depth: 0 }), sine(freq, 0.5, SR / 2))[0];
      expect(Math.abs(db(amplitude(out, freq, SR / 4, SR / 4) / 0.5))).toBeLessThan(0.1);
    }
  });

  it('downward: a loud sound drops; upward: a quiet one rises', () => {
    const level = (amp: number, params: Record<string, number>) => {
      const out = run(multiband(params), sine(1000, amp, SR))[0];
      return db(amplitude(out, 1000, SR / 2, SR / 2) / amp);
    };
    expect(level(0.8, { depth: 100, upward: 0 })).toBeLessThan(-15);
    expect(level(0.001, { depth: 100, downward: 0 })).toBeGreaterThan(10); // −60 dB: 18 below the threshold, ×¾
    // the depth doses: at half, half the dB
    expect(Math.abs(level(0.8, { depth: 50, upward: 0 }) - level(0.8, { depth: 100, upward: 0 }) / 2)).toBeLessThan(1.5);
    // the floor: almost total silence doesn't swell
    expect(level(0.00005, { depth: 100 })).toBeLessThan(1);
  });

  it('the bands work by themselves: a loud bass doesn\'t lower the highs', () => {
    const x = Float32Array.from({ length: SR }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 60 * i) / SR) + 0.01 * Math.sin((2 * Math.PI * 6000 * i) / SR));
    const out = run(multiband({ depth: 100, upward: 0 }), x)[0];
    expect(db(amplitude(out, 60, SR / 2, SR / 2) / 0.8)).toBeLessThan(-10);
    expect(Math.abs(db(amplitude(out, 6000, SR / 2, SR / 2) / 0.01))).toBeLessThan(1);
  });
});

describe('cost', () => {
  it('compressor, limiter and stereo reverb: a small fraction of real time', () => {
    const x = sine(220, 0.8, BLOCK);
    for (const [name, core] of [['compressor', compressor({})], ['limiter', limiter({ gain: 6 })], ['reverb', reverb({})], ['multiband', multiband({})]] as const) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      for (let i = 0; i < 200; i++) core.process(x, x, l, r, BLOCK);
      const blocks = 2000, t0 = performance.now();
      for (let i = 0; i < blocks; i++) core.process(x, x, l, r, BLOCK);
      const share = (performance.now() - t0) / ((blocks * BLOCK * 1000) / SR);
      console.log(`${name}: ${(share * 100).toFixed(2)} % of a core`);
      expect(share).toBeLessThan(0.1);
    }
  });
});

describe('Noise Gate', () => {
  const gate = (params: Record<string, number>) => {
    const c = new NoiseGateCore(SR);
    c.setParams(resolveParams(NOISE_GATE, params));
    return c;
  };
  /** A sound going from one level to the other halfway. */
  const steps = (a: number, b: number, n = 48000) => sine(1000, 1, n).map((v, i) => v * (i < n / 2 ? a : b));

  it('above the threshold the sound passes as it is, below it\'s silent', () => {
    const [loud] = run(gate({ threshold: -40 }), sine(1000, 0.5, 24000));
    expect(peak(loud, 12000)).toBeCloseTo(0.5, 3);
    const [quiet] = run(gate({ threshold: -40 }), sine(1000, 0.001, 24000));
    expect(peak(quiet)).toBe(0);
  });

  it('the range says how much it closes', () => {
    const x = steps(0.5, 0.001);
    const [out] = run(gate({ threshold: -40, floor: -12, hold: 0, release: 10 }), x);
    expect(db(peak(out, 40000) / 0.001)).toBeCloseTo(-12, 0);
  });

  it('it doesn\'t chatter on a low sound nor on one around the threshold', () => {
    // 40 Hz: the detector doesn't close at every zero crossing
    const [low] = run(gate({ threshold: -30, hold: 0 }), sine(40, 0.5, 48000));
    expect(rms(low, 24000) / rms(sine(40, 0.5, 48000), 24000)).toBeCloseTo(1, 2);
    // it sits inside the hysteresis: once open it stays open
    const wobble = Float32Array.from(sine(1000, 1, 48000), (v, i) => v * (i < 4800 ? 0.1 : 0.1 * (0.85 + 0.1 * Math.sin(i / 2000))));
    const [out] = run(gate({ threshold: -20, hysteresis: 6, hold: 0, release: 5 }), wobble);
    expect(rms(out, 24000) / rms(wobble, 24000)).toBeCloseTo(1, 2);
  });

  it('hold keeps it open after the end of the sound', () => {
    const x = steps(0.5, 0.001);
    const at = 24000 + Math.round(0.1 * SR);
    const [held] = run(gate({ threshold: -40, hold: 200, release: 5 }), x);
    expect(Math.abs(held[at - 3]) + Math.abs(held[at - 2]) + Math.abs(held[at - 1])).toBeGreaterThan(0.0005);
    const [short] = run(gate({ threshold: -40, hold: 0, release: 5 }), x);
    expect(peak(short, at)).toBe(0);
  });

  it('attack and release are ramps: no volume jumps', () => {
    const x = Float32Array.from({ length: 24000 }, (_, i) => (i < 12000 ? 0 : 0.5));
    const [out] = run(gate({ threshold: -20, attack: 10 }), x);
    expect(out[12000 + 240]).toBeLessThan(0.5);
    expect(out[12000 + 480]).toBeCloseTo(0.5, 3);
  });

  it('invert: it closes when the sound is loud', () => {
    const [loud] = run(gate({ threshold: -40, flip: 1 }), sine(1000, 0.5, 24000));
    expect(peak(loud, 12000)).toBe(0);
    const [quiet] = run(gate({ threshold: -40, flip: 1 }), sine(1000, 0.001, 24000));
    expect(peak(quiet, 12000)).toBeCloseTo(0.001, 4);
  });

  it('with the sidechain it opens to the key\'s sound', () => {
    const c = gate({ threshold: -40 });
    const key = sine(1000, 0.5, BLOCK), x = new Float32Array(BLOCK).fill(0.001), l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    c.setKey(key, key);
    for (let i = 0; i < 100; i++) c.process(x, x, l, r, BLOCK);
    expect(l[0]).toBeCloseTo(0.001, 5);
  });

  it('the detector\'s filters remove what it mustn\'t hear', () => {
    const low = sine(50, 0.5, 48000);
    const [open] = run(gate({ threshold: -30 }), low);
    expect(peak(open, 24000)).toBeGreaterThan(0.4);
    const [closed] = run(gate({ threshold: -30, scHp: 2000 }), low);
    expect(peak(closed, 24000)).toBe(0);
  });
});
