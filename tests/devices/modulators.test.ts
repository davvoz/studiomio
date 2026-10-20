import { describe, expect, it } from 'vitest';
import { EnvelopeFollower } from '../../src/devices/dsp/envelope-follower';
import { cycleRandom, LFO_SHAPE, LfoClock, lfoAt } from '../../src/devices/dsp/lfo';
import { FILTER_TYPE, MultimodeFilter } from '../../src/devices/dsp/multimode-filter';

const SR = 48000;
const bar = { bpm: 120, beatsPerBar: 4 };

describe('LFO: le onde', () => {
  it('seno e triangolo partono da 0 e salgono, i denti di sega e la quadra dagli estremi', () => {
    expect(lfoAt(LFO_SHAPE.sine, 0.25)).toBeCloseTo(1, 12);
    expect(lfoAt(LFO_SHAPE.sine, 3.75)).toBeCloseTo(-1, 12);
    expect(lfoAt(LFO_SHAPE.triangle, 0)).toBe(0);
    expect(lfoAt(LFO_SHAPE.triangle, 0.25)).toBe(1);
    expect(lfoAt(LFO_SHAPE.triangle, 0.75)).toBe(-1);
    expect(lfoAt(LFO_SHAPE.sawDown, 2)).toBe(1);
    expect(lfoAt(LFO_SHAPE.sawUp, 2)).toBe(-1);
    expect(lfoAt(LFO_SHAPE.square, 0.1)).toBe(1);
    expect(lfoAt(LFO_SHAPE.square, 0.6)).toBe(-1);
  });

  it('S&H: un valore per giro, sempre lo stesso per lo stesso giro (anche indietro nel tempo)', () => {
    const values = Array.from({ length: 64 }, (_, k) => lfoAt(LFO_SHAPE.sampleHold, k + 0.3));
    for (let k = 0; k < 64; k++) {
      expect(lfoAt(LFO_SHAPE.sampleHold, k + 0.9)).toBe(values[k]);
      expect(Math.abs(values[k])).toBeLessThanOrEqual(1);
    }
    expect(new Set(values).size).toBe(64);
    expect(lfoAt(LFO_SHAPE.sampleHold, -2.5)).toBe(cycleRandom(-3));
    // un altro seme, altri valori
    expect(lfoAt(LFO_SHAPE.sampleHold, 5.5, 7)).not.toBe(values[5]);
  });

  it('S&H morbido: scivola da un valore al successivo senza salti tra un giro e l\'altro', () => {
    for (let k = 1; k < 20; k++) {
      expect(lfoAt(LFO_SHAPE.smoothRandom, k - 1e-9)).toBeCloseTo(lfoAt(LFO_SHAPE.smoothRandom, k), 6);
      expect(lfoAt(LFO_SHAPE.smoothRandom, k + 1 - 1e-9)).toBeCloseTo(lfoAt(LFO_SHAPE.sampleHold, k), 6);
    }
  });

  it('i valori casuali stanno in −1..1 e in media fanno zero', () => {
    let sum = 0;
    for (let k = 0; k < 10000; k++) {
      const r = cycleRandom(k);
      expect(r).toBeGreaterThanOrEqual(-1);
      expect(r).toBeLessThan(1);
      sum += r;
    }
    expect(Math.abs(sum / 10000)).toBeLessThan(0.03);
  });
});

describe('LFO: l\'orologio', () => {
  it('a tempo, col trasporto che va, la posizione viene dalla battuta: un giro di 1/4 parte sul quarto', () => {
    const clock = new LfoClock(SR);
    clock.start({ beats: 1, hz: 0 }, { beat: 2.25, ...bar }, 120);
    expect(clock.cycles).toBeCloseTo(2.25, 12);
    for (let i = 0; i < 6000; i++) clock.next(); // un sedicesimo a 120 BPM
    expect(clock.cycles).toBeCloseTo(2.5, 9);
  });

  it('dopo un salto torna allo stesso punto del brano, qualunque cosa sia successa prima', () => {
    const a = new LfoClock(SR), b = new LfoClock(SR);
    a.start({ beats: 2, hz: 0 }, { beat: 0, ...bar }, 120);
    for (let i = 0; i < 100000; i++) a.next();
    a.start({ beats: 2, hz: 0 }, { beat: 9, ...bar }, 120);
    b.start({ beats: 2, hz: 0 }, { beat: 9, ...bar }, 120);
    expect(a.cycles).toBe(b.cycles);
  });

  it('da fermo gira libero al tempo del progetto, senza salti tra un blocco e l\'altro', () => {
    const clock = new LfoClock(SR);
    for (let block = 0; block < 375; block++) { // 1 s a blocchi di 128
      clock.start({ beats: 1, hz: 0 }, null, 120);
      for (let i = 0; i < 128; i++) clock.next();
    }
    expect(clock.cycles).toBeCloseTo(2, 9); // 1/4 a 120 BPM: 2 giri al secondo
  });

  it('in Hz non guarda il trasporto', () => {
    const clock = new LfoClock(SR);
    clock.start({ beats: null, hz: 3 }, { beat: 17, ...bar }, 120);
    expect(clock.cycles).toBe(0);
    for (let i = 0; i < SR; i++) clock.next();
    expect(clock.cycles).toBeCloseTo(3, 9);
  });
});

/** Quanto passa (in dB) di un seno alla frequenza data, a regime. */
function gainDb(filter: MultimodeFilter, hz: number): number {
  let inSum = 0, outSum = 0;
  for (let i = 0; i < SR / 2; i++) {
    const x = Math.sin((2 * Math.PI * hz * i) / SR), y = filter.process(x);
    if (i >= SR / 4) {
      inSum += x * x;
      outSum += y * y;
    }
  }
  return 10 * Math.log10(outSum / inSum);
}

const filter = (cutoff: number, type: number, poles: 2 | 4 = 2, resonance = 0) => {
  const f = new MultimodeFilter(SR);
  f.set(cutoff, resonance, type, poles);
  return f;
};

describe('Filtro multimodo', () => {
  it('passa-basso: −3 dB al taglio, poi 12 o 24 dB per ottava', () => {
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass), 100)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass), 1000)).toBeCloseTo(-3, 0);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass, 4), 1000)).toBeCloseTo(-3, 0);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass), 4000)).toBeLessThan(-22);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass, 4), 4000)).toBeLessThan(-45);
  });

  it('passa-alto: lo specchio', () => {
    expect(gainDb(filter(1000, FILTER_TYPE.highPass), 10000)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.highPass), 250)).toBeLessThan(-22);
    expect(gainDb(filter(1000, FILTER_TYPE.highPass, 4), 250)).toBeLessThan(-45);
  });

  it('passa-banda: tutto al centro, poco ai lati; notch: il contrario', () => {
    expect(gainDb(filter(1000, FILTER_TYPE.bandPass), 1000)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.bandPass, 4), 1000)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.bandPass), 8000)).toBeLessThan(-15);
    expect(gainDb(filter(1000, FILTER_TYPE.notch), 1000)).toBeLessThan(-30);
    expect(gainDb(filter(1000, FILTER_TYPE.notch), 8000)).toBeCloseTo(0, 0);
  });

  it('la risonanza alza il picco al taglio', () => {
    const flat = gainDb(filter(1000, FILTER_TYPE.lowPass, 2, 0), 1000);
    const half = gainDb(filter(1000, FILTER_TYPE.lowPass, 2, 0.5), 1000);
    const full = gainDb(filter(1000, FILTER_TYPE.lowPass, 4, 1), 1000);
    expect(half).toBeGreaterThan(flat + 3);
    expect(full).toBeGreaterThan(20);
  });

  it('con il cutoff che salta di continuo resta stabile', () => {
    const f = new MultimodeFilter(SR);
    let peak = 0;
    for (let i = 0; i < SR; i++) {
      if (i % 8 === 0) f.set(20 * Math.pow(1000, cycleRandom(i) * 0.5 + 0.5), 0.9, FILTER_TYPE.lowPass, 4);
      const y = f.process(Math.sin(i * 0.05));
      expect(Number.isFinite(y)).toBe(true);
      peak = Math.max(peak, Math.abs(y));
    }
    expect(peak).toBeLessThan(100);
  });
});

describe('Inseguitore d\'inviluppo', () => {
  it('sale con l\'attacco e scende con il rilascio', () => {
    const env = new EnvelopeFollower(SR);
    env.set(0.01, 0.1);
    for (let i = 0; i < SR / 100; i++) env.process(i % 2 ? -1 : 1);
    expect(env.value).toBeCloseTo(1 - Math.exp(-1), 2);
    for (let i = 0; i < SR / 10; i++) env.process(0);
    expect(env.value).toBeCloseTo((1 - Math.exp(-1)) * Math.exp(-1), 2);
  });
});
