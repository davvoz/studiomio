import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { EffectCore } from '../../src/devices/dsp/core';
import { CLIPPER } from '../../src/devices/effects/clipper/clipper';
import { clipCurve, ClipperCore } from '../../src/devices/effects/clipper/clipper-core';
import { STEREO } from '../../src/devices/effects/stereo/stereo';
import { StereoCore } from '../../src/devices/effects/stereo/stereo-core';
import { EFFECT_TYPES } from '../../src/devices/registry';
import { EFFECT_CORES } from '../../src/devices/worklet/cores';

const SR = 48000, BLOCK = 128;
const db = (a: number) => 20 * Math.log10(Math.max(1e-12, a));

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
const sine = (freq: number, amp: number, n: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
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
/** Ampiezza della componente a `freq` (correlazione con seno e coseno). */
const amplitudeAt = (x: Float32Array, freq: number, from: number) => {
  let s = 0, c = 0;
  for (let i = from; i < x.length; i++) {
    s += x[i] * Math.sin((2 * Math.PI * freq * i) / SR);
    c += x[i] * Math.cos((2 * Math.PI * freq * i) / SR);
  }
  return (2 * Math.hypot(s, c)) / (x.length - from);
};

const clipper = (params: Record<string, number>) => {
  const c = new ClipperCore(SR);
  c.setParams(resolveParams(CLIPPER, params));
  return c;
};

describe('Clipper', () => {
  it('la curva: dritta fino al ginocchio, poi entra nel tetto senza superarlo; a 0 è il taglio netto', () => {
    expect(clipCurve(0.5, 0)).toBe(0.5);
    expect(clipCurve(3, 0)).toBe(1);
    expect(clipCurve(-3, 0)).toBe(-1);
    expect(clipCurve(0.6, 0.3)).toBe(0.6);
    for (const u of [0.8, 1, 2, 10]) {
      expect(clipCurve(u, 0.3)).toBeLessThanOrEqual(1);
      expect(clipCurve(u, 0.3)).toBeLessThanOrEqual(u);
    }
    // continua e con pendenza 1 sul ginocchio
    expect(clipCurve(0.7 + 1e-6, 0.3) - clipCurve(0.7, 0.3)).toBeCloseTo(1e-6, 9);
    expect(clipCurve(1.5, 1)).toBeCloseTo(Math.tanh(1.5), 9);
  });

  it('sotto il ginocchio il suono passa uguale (solo il ritardo del sovracampionamento)', () => {
    const c = clipper({ ceiling: -1, knee: 30 });
    const x = sine(1000, 0.3, SR / 2);
    const [y] = run(c, x);
    const from = 4000;
    expect(amplitudeAt(y, 1000, from)).toBeCloseTo(0.3, 3);
    expect(db(rms(y, from))).toBeCloseTo(db(rms(x, from)), 1);
  });

  it('i picchi restano attorno al tetto e il taglio si legge in dB', () => {
    const c = clipper({ drive: 12, ceiling: -6, knee: 0 });
    const [y] = run(c, sine(100, 0.9, SR / 2));
    expect(db(peak(y, 4000))).toBeLessThan(-5.5);
    expect(db(peak(y, 4000))).toBeGreaterThan(-6.6);
    expect(c.takeReduction()).toBeGreaterThan(10);
    expect(c.takeReduction()).toBeCloseTo(0, 9);
  });

  it('sovracampionato: tagliare un seno acuto non ripiega armoniche nell\'udibile', () => {
    // 7 kHz tagliato duro: la terza armonica (21 kHz) sta sotto Nyquist, la quinta (35 kHz) si
    // ripiegherebbe a 13 kHz senza sovracampionamento (a 4×, il predefinito, viene filtrata)
    const c = clipper({ drive: 12, ceiling: -6, knee: 0 });
    const [y] = run(c, sine(7000, 0.9, SR / 2));
    const fundamental = amplitudeAt(y, 7000, 4000), alias = amplitudeAt(y, 13000, 4000);
    // senza sovracampionamento lo stesso taglio lascia l'alias a circa −17 dB
    const naive = Float32Array.from({ length: SR / 2 }, (_, i) => 0.5 * clipCurve(3.58 * Math.sin((2 * Math.PI * 7000 * i) / SR), 0));
    expect(db(amplitudeAt(naive, 13000, 4000) / amplitudeAt(naive, 7000, 4000))).toBeGreaterThan(-20);
    expect(db(alias / fundamental)).toBeLessThan(-50);
  });
});

describe('Stereo', () => {
  const stereo = (params: Record<string, number>) => {
    const s = new StereoCore(SR);
    s.setParams(resolveParams(STEREO, params));
    return s;
  };

  it('un suono mono esce identico', () => {
    const x = sine(60, 0.5, 4800);
    const [l, r] = run(stereo({ width: 150, monoFreq: 200 }), x, x);
    for (let i = 0; i < x.length; i++) {
      expect(l[i]).toBeCloseTo(x[i], 6);
      expect(r[i]).toBeCloseTo(x[i], 6);
    }
  });

  it('bassi mono: sotto la frequenza il lato sparisce, sopra resta', () => {
    const n = SR / 2, lowL = sine(40, 0.5, n), highL = sine(2000, 0.5, n);
    const neg = (x: Float32Array) => x.map(v => -v);
    // tutto lato (L = −R): il basso a 40 Hz quasi scompare, i 2 kHz passano
    const [ll] = run(stereo({ monoFreq: 200 }), lowL, neg(lowL));
    const [hl] = run(stereo({ monoFreq: 200 }), highL, neg(highL));
    expect(db(rms(ll, 4000) / rms(lowL, 4000))).toBeLessThan(-30);
    expect(db(rms(hl, 4000) / rms(highL, 4000))).toBeGreaterThan(-0.2);
  });

  it('larghezza 0 fa mono, il guadagno scala', () => {
    const l = sine(500, 0.5, 4800), r = sine(700, 0.5, 4800);
    const [ol, or] = run(stereo({ width: 0, bassMono: 0, gain: -6 }), l, r);
    for (let i = 0; i < l.length; i += 97) {
      expect(ol[i]).toBeCloseTo(or[i], 6);
      expect(ol[i]).toBeCloseTo(((l[i] + r[i]) / 2) * Math.pow(10, -6 / 20), 5);
    }
  });
});

describe('registro', () => {
  it('Clipper e Stereo hanno descrizione e motore', () => {
    for (const type of ['clipper', 'stereo']) {
      expect(EFFECT_TYPES.some(t => t.type === type)).toBe(true);
      expect(EFFECT_CORES[type]).toBeTypeOf('function');
    }
  });
});
