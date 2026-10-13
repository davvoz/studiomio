import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { Oversampler } from '../../src/devices/dsp/oversampler';
import { COMPRESSOR, DETECTOR } from '../../src/devices/effects/compressor/compressor';
import { CompressorCore } from '../../src/devices/effects/compressor/compressor-core';
import { autoMakeup, curveDb } from '../../src/devices/effects/compressor/compressor-math';
import { LIMITER } from '../../src/devices/effects/limiter/limiter';
import { LimiterCore } from '../../src/devices/effects/limiter/limiter-core';
import { REVERB } from '../../src/devices/effects/reverb/reverb';
import { ReverbCore } from '../../src/devices/effects/reverb/reverb-core';
import type { EffectCore } from '../../src/devices/dsp/core';

const SR = 48000, BLOCK = 128;
const db = (a: number) => 20 * Math.log10(Math.max(1e-12, a));
const gain = (d: number) => Math.pow(10, d / 20);

/** Fa lavorare un effetto a blocchi; restituisce i due canali. */
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

describe('Compressore', () => {
  it('la curva: sotto la soglia niente, sopra il rapporto; il ginocchio raccorda', () => {
    const hard = { threshold: -20, ratio: 4, knee: 0 };
    expect(curveDb(hard, -30)).toBe(-30);
    expect(curveDb(hard, -8)).toBeCloseTo(-17, 6);
    const soft = { ...hard, knee: 10 };
    expect(curveDb(soft, -26)).toBe(-26);
    expect(curveDb(soft, -14)).toBeCloseTo(curveDb(hard, -14), 6);
    // nel ginocchio sta tra il dritto e la curva dura, e continua
    expect(curveDb(soft, -20)).toBeLessThan(-20);
    expect(curveDb(soft, -20)).toBeGreaterThan(curveDb(hard, -15) - 5);
    expect(autoMakeup(hard)).toBeCloseTo(7.5, 6);
  });

  it('un seno sopra la soglia esce dove dice la curva; sotto passa intatto', () => {
    const out = run(compressor({ threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 }), sine(1000, gain(-6), SR))[0];
    expect(db(peak(out, SR / 2))).toBeCloseTo(-15, 0);
    const quiet = sine(1000, gain(-30), SR / 2);
    const same = run(compressor({ threshold: -18 }), quiet)[0];
    expect(peak(same.map((v, i) => v - quiet[i]))).toBeLessThan(1e-6);
  });

  it('attacco e rilascio: la riduzione arriva e se ne va con i suoi tempi', () => {
    const x = new Float32Array(SR);
    x.set(sine(1000, gain(-40), SR / 4));
    x.set(sine(1000, gain(-6), SR / 2), SR / 4);
    x.set(sine(1000, gain(-40), SR / 4), (3 * SR) / 4);
    const out = run(compressor({ threshold: -20, ratio: 10, knee: 0, attack: 20, release: 200 }), x)[0];
    const at = (ms: number) => db(peak(out, Math.round(ms * SR / 1000), Math.round((ms + 2) * SR / 1000)));
    // appena entra il forte passa quasi tutto, dopo 100 ms è compresso
    expect(at(251)).toBeGreaterThan(-9);
    expect(at(350)).toBeLessThan(-16);
    // tornato piano: subito ancora abbassato, dopo un secondo di rilascio quasi libero
    expect(at(752) - -40).toBeLessThan(-6);
  });

  it('mix a zero: esce il dry; canali legati: lo stesso guadagno a sinistra e a destra', () => {
    const x = sine(500, 0.9, SR / 4);
    const dry = run(compressor({ threshold: -40, ratio: 20, mix: 0 }), x)[0];
    expect(peak(dry.map((v, i) => v - x[i]))).toBeLessThan(1e-6);
    const l = sine(500, 0.9, SR / 2), r = sine(500, 0.05, SR / 2);
    const [ol, or] = run(compressor({ threshold: -20, ratio: 8 }), l, r);
    expect(peak(ol, SR / 4) / 0.9).toBeCloseTo(peak(or, SR / 4) / 0.05, 2);
  });

  it('il passa-alto sul rilevatore: un basso forte non lo fa lavorare', () => {
    const reduction = (scHp: number) => {
      const c = compressor({ threshold: -20, ratio: 8, scHp });
      run(c, sine(40, 0.8, SR / 2));
      return c.maxReduction;
    };
    expect(reduction(20)).toBeGreaterThan(10);
    expect(reduction(500)).toBeLessThan(1);
  });

  it('RMS: su un seno sente 3 dB meno del picco', () => {
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

/** Il picco vero (ricostruito) con un sovracampionamento a 8×. */
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
  it('nessun campione oltre il tetto, anche spinto di 12 dB su rumore e colpi', () => {
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    // un suono con dinamica: rumore piano, un seno, e colpi forti ogni 100 ms
    const x = Float32Array.from({ length: SR }, (_, i) => rnd() * 0.05 + (i % 4800 < 30 ? 0.9 * rnd() : 0) + Math.sin(i * 0.01) * 0.2);
    const [l, r] = run(limiter({ gain: 12, ceiling: -1 }), x, x.map(v => -v * 0.8));
    expect(Math.max(peak(l), peak(r))).toBeLessThanOrEqual(gain(-1) + 1e-6);
    expect(db(rms(l))).toBeGreaterThan(db(rms(x)) + 4); // più forte davvero
  });

  it('il guadagno scende prima del picco: un colpo isolato non viene tagliato (forma intatta)', () => {
    const x = new Float32Array(SR / 2);
    x.set(sine(200, 2, 480), 12000); // un colpo da +6 dB, dieci millisecondi
    const lim = limiter({ ceiling: 0, lookahead: 3, truePeak: 0 });
    const out = run(lim, x)[0];
    const L = lim.latency;
    expect(peak(out)).toBeLessThanOrEqual(1 + 1e-6);
    // in pieno colpo il rapporto uscita/ingresso è costante: è un guadagno, non un taglio
    const ratios = [100, 200, 300].map(k => out[12000 + k + L] / x[12000 + k]).filter(Number.isFinite);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.05);
  });

  it('i suoni piani passano intatti, solo ritardati dell\'anticipo', () => {
    const x = sine(440, 0.3, SR / 4);
    const lim = limiter({ lookahead: 2 });
    const out = run(lim, x)[0], L = lim.latency;
    expect(L).toBeGreaterThanOrEqual(96);
    expect(L).toBeLessThan(96 + 20); // l'anticipo più la misura tra i campioni
    let err = 0;
    for (let i = L; i < x.length; i++) err = Math.max(err, Math.abs(out[i] - x[i - L]));
    expect(err).toBeLessThan(1e-6);
  });

  it('tra i campioni: tiene anche il picco ricostruito', () => {
    // un seno a un quarto della frequenza di campionamento, sfasato: i campioni stanno a 0,71, il picco vero è 1
    const x = sine(SR / 4, 1, SR / 2, Math.PI / 4);
    const on = run(limiter({ ceiling: -1, truePeak: 1 }), x)[0];
    const off = run(limiter({ ceiling: -1, truePeak: 0 }), x)[0];
    expect(db(truePeak(on.subarray(4800)))).toBeLessThan(-0.7);
    expect(db(truePeak(off.subarray(4800)))).toBeGreaterThan(-0.6);
  });

  it('dopo un colpo il guadagno torna con il rilascio', () => {
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

describe('Riverbero', () => {
  it('la coda decade nel tempo scelto (−60 dB)', () => {
    for (const decay of [1, 3]) {
      const x = new Float32Array(SR * (decay + 1));
      x[0] = 1;
      const [l, r] = run(reverb({ decay, mix: 100, predelay: 0, damping: 20000, lowCut: 20 }), x);
      const energy = (from: number, to: number) => rms(l, from, to) + rms(r, from, to);
      // pendenza tra 0,2 e 0,2+decay/2 secondi, in dB al secondo
      const a = Math.round(0.2 * SR), b = Math.round((0.2 + decay / 2) * SR), w = SR / 20;
      const slope = (db(energy(b, b + w)) - db(energy(a, a + w))) / (decay / 2);
      expect(-60 / slope).toBeGreaterThan(decay * 0.75);
      expect(-60 / slope).toBeLessThan(decay * 1.3);
    }
  });

  it('dry/wet a zero: il suono passa com\'era; stereo largo; stabile con code lunghissime', () => {
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

  it('pre-delay: la coda parte dopo; smorzamento: gli alti si spengono prima', () => {
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

describe('costo', () => {
  it('compressore, limiter e riverbero stereo: una frazione piccola del tempo reale', () => {
    const x = sine(220, 0.8, BLOCK);
    for (const [name, core] of [['compressore', compressor({})], ['limiter', limiter({ gain: 6 })], ['riverbero', reverb({})]] as const) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      for (let i = 0; i < 200; i++) core.process(x, x, l, r, BLOCK);
      const blocks = 2000, t0 = performance.now();
      for (let i = 0; i < blocks; i++) core.process(x, x, l, r, BLOCK);
      const share = (performance.now() - t0) / ((blocks * BLOCK * 1000) / SR);
      console.log(`${name}: ${(share * 100).toFixed(2)} % di un core`);
      expect(share).toBeLessThan(0.1);
    }
  });
});
