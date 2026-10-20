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

/** Fa suonare il Redux a blocchi, lo stesso segnale sui due canali. */
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
/** Quanto pesa una frequenza nel segnale (ampiezza di picco), con una DFT su un pezzo. */
function level(x: Float32Array, hz: number, from = 4800, length = 9600): number {
  let re = 0, im = 0;
  for (let n = from; n < from + length; n++) {
    re += x[n] * Math.cos((2 * Math.PI * hz * n) / SR);
    im += x[n] * Math.sin((2 * Math.PI * hz * n) / SR);
  }
  return (2 * Math.hypot(re, im)) / length;
}

describe('Redux', () => {
  it('al massimo di Frequenza e Bit il suono passa (salvo l\'arrotondamento a 16 bit)', () => {
    const input = sine(440);
    const [l] = play(redux({ rate: MAX_RATE, bits: 16 }), 2000, input);
    for (let n = 0; n < 2000; n++) expect(Math.abs(l[n] - input(n))).toBeLessThanOrEqual(0.5 / 32768 + 1e-7);
  });

  it('a un quarto della frequenza ogni campione resta fermo per quattro', () => {
    const input = sine(300);
    const [l, r] = play(redux({ rate: SR / 4, bits: 16 }), 1024, input);
    for (let n = 0; n < 1024; n++) expect(l[n]).toBeCloseTo(input(n - (n % 4)), 4);
    expect(r).toEqual(l);
  });

  it('i bit: con 1 bit restano −1, 0 e 1; con 3 bit scalini di un quarto', () => {
    const one = play(redux({ rate: MAX_RATE, bits: 1 }), 1000, sine(100, 0.9))[0];
    expect(new Set(one)).toEqual(new Set([-1, 0, 1]));
    const three = play(redux({ rate: MAX_RATE, bits: 3 }), 1000, sine(100, 0.9))[0];
    for (const y of three) expect(Math.abs(y * 4 - Math.round(y * 4))).toBeLessThan(1e-6);
    expect(new Set(three).size).toBe(9); // da −1 a 1 a passi di un quarto
  });

  it('Jitter: il passo cambia, ma in media resta quello della Frequenza', () => {
    const steady = redux({ rate: 1000 }), shaky = redux({ rate: 1000, jitter: 100 });
    play(steady, SR, () => 0);
    play(shaky, SR, () => 0);
    expect(steady.taken).toBe(1000);
    expect(shaky.taken).toBeGreaterThan(950);
    expect(shaky.taken).toBeLessThan(1050);
  });

  it('Jitter: i campioni non arrivano più a passo fisso', () => {
    const gaps = (jitter: number) => {
      const [l] = play(redux({ rate: 2000, bits: 16, jitter }), 12000, n => n / 12000);
      const changes: number[] = [];
      for (let n = 1; n < l.length; n++) if (l[n] !== l[n - 1]) changes.push(n);
      return new Set(changes.slice(1).map((c, k) => c - changes[k]));
    };
    expect(gaps(0)).toEqual(new Set([24]));
    expect(gaps(50).size).toBeGreaterThan(5);
  });

  it('il filtro Prima toglie quello che si ripiegherebbe', () => {
    // 5 kHz con la Frequenza a 4 kHz: senza filtro torna giù a 1 kHz
    const plain = play(redux({ rate: 4000, bits: 16 }), 14400, sine(5000))[0];
    const filtered = play(redux({ rate: 4000, bits: 16, filter: REDUX_FILTER.pre }), 14400, sine(5000))[0];
    expect(level(plain, 1000)).toBeGreaterThan(0.3);
    expect(level(filtered, 1000)).toBeLessThan(0.01);
  });

  it('il filtro Dopo smussa i gradini', () => {
    const input = sine(200, 0.9);
    const plain = play(redux({ rate: 1000, bits: 16 }), 4800, input)[0];
    const smooth = play(redux({ rate: 1000, bits: 16, filter: REDUX_FILTER.post }), 4800, input)[0];
    expect(maxJump(plain)).toBeGreaterThan(0.5);
    expect(maxJump(smooth)).toBeLessThan(0.1);
  });

  it('Dry/Wet a 0 lascia il suono com\'è; Uscita lo alza o abbassa', () => {
    const input = sine(440);
    const [dry] = play(redux({ rate: 500, bits: 2, mix: 0 }), 1000, input);
    for (let n = 0; n < 1000; n += 17) expect(dry[n]).toBeCloseTo(input(n), 6);
    const [loud] = play(redux({ rate: MAX_RATE, bits: 16, output: 6 }), 1000, input);
    expect(loud[500] / input(500)).toBeCloseTo(10 ** (6 / 20), 3);
  });
});
