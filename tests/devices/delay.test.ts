import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { DELAY, DIVISIONS, SYNC } from '../../src/devices/effects/delay/delay';
import { DelayCore } from '../../src/devices/effects/delay/delay-core';
import { EffectRunner } from '../../src/devices/worklet/effect-runner';

const SR = 48000, BLOCK = 128;

/** Un impulso a sinistra (e a destra) all'inizio, poi silenzio; elabora a blocchi. */
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

/** Indice e valore del picco in [from, to). */
function peak(x: Float32Array, from = 1, to = x.length): [number, number] {
  let at = from;
  for (let i = from; i < to; i++) if (Math.abs(x[i]) > Math.abs(x[at])) at = i;
  return [at, x[at]];
}

/** Solo eco, filtri aperti. */
const CLEAN = { mix: 100, lowCut: 20, highCut: 20000, feedback: 0 };

const delay = (params: Record<string, number>, bpm = 120) => {
  const core = new DelayCore(SR);
  core.setTempo(bpm);
  core.setParams(resolveParams(DELAY, params));
  return core;
};

describe('Delay', () => {
  it('in millisecondi: l\'eco arriva esattamente dopo il tempo dato', () => {
    const [l] = run(delay({ ...CLEAN, sync: SYNC.ms, time: 100 }), SR / 2);
    expect(peak(l)[0]).toBe(4800);
    expect(l[0]).toBe(0); // a dry/wet 100% il suono diretto non c'è
  });

  it('a tempo: 1/8 a 120 BPM = 250 ms, 1/4 a 60 BPM = 1 s', () => {
    const eighth = DIVISIONS.findIndex(([d]) => d === '1/8');
    expect(peak(run(delay({ ...CLEAN, division: eighth }), SR)[0])[0]).toBe(12000);
    const quarter = DIVISIONS.findIndex(([d]) => d === '1/4');
    expect(peak(run(delay({ ...CLEAN, division: quarter }, 60), SR * 1.5)[0])[0]).toBe(48000);
  });

  it('cambiare tempo sposta l\'eco', () => {
    const core = delay({ ...CLEAN, division: DIVISIONS.findIndex(([d]) => d === '1/4') }, 120);
    expect(core.delaySeconds).toBe(0.5);
    core.setTempo(100);
    expect(core.delaySeconds).toBeCloseTo(0.6, 12);
  });

  it('feedback: ogni ripetizione più debole della precedente', () => {
    const [l] = run(delay({ ...CLEAN, sync: SYNC.ms, time: 100, feedback: 50 }), SR / 2);
    const [, a] = peak(l, 4000, 6000), [i2, b] = peak(l, 9000, 10600), [, c] = peak(l, 14000, 15000);
    expect(i2).toBe(9600);
    // 50% di feedback, meno quel poco che i filtri (anche aperti) tolgono a ogni giro
    for (const ratio of [b / a, c / b]) {
      expect(ratio).toBeLessThanOrEqual(0.5);
      expect(ratio).toBeGreaterThan(0.45);
    }
  });

  it('ping-pong: le ripetizioni si alternano tra sinistra e destra', () => {
    const [l, r] = run(delay({ ...CLEAN, sync: SYNC.ms, time: 100, feedback: 80, pingPong: 1 }), SR / 2);
    expect(Math.abs(peak(l, 4000, 6000)[1])).toBeGreaterThan(0.3);
    expect(Math.abs(peak(r, 4000, 6000)[1])).toBeLessThan(1e-6);
    expect(Math.abs(peak(r, 9000, 10600)[1])).toBeGreaterThan(0.2);
    expect(Math.abs(peak(l, 9000, 10600)[1])).toBeLessThan(1e-6);
  });

  it('il high cut toglie gli acuti dalle ripetizioni', () => {
    const bright = peak(run(delay({ ...CLEAN, sync: SYNC.ms, time: 100 }), 6000)[0], 4000)[1];
    const dark = peak(run(delay({ ...CLEAN, sync: SYNC.ms, time: 100, highCut: 800 }), 6000)[0], 4000)[1];
    expect(dark).toBeLessThan(bright / 5);
  });

  it('dry/wet a 0: passa solo il suono diretto', () => {
    const [l] = run(delay({ mix: 0, sync: SYNC.ms, time: 100 }), SR / 4);
    expect(l[0]).toBe(1);
    expect(l.subarray(1).every(v => v === 0)).toBe(true);
  });

  it('nessun NaN e code che si spengono, anche con feedback alto', () => {
    const [l] = run(delay({ sync: SYNC.ms, time: 10, feedback: 95 }), SR * 4);
    expect(l.every(Number.isFinite)).toBe(true);
    expect(Math.abs(peak(l, SR * 3.9)[1])).toBeLessThan(1e-3);
  });
});

describe('spegnimento degli effetti (EffectRunner)', () => {
  /** Un effetto finto che inverte il segnale. */
  const invert = { setParams() {}, setTempo() {}, process: (a: Float32Array, b: Float32Array, l: Float32Array, r: Float32Array, n: number) => {
    for (let i = 0; i < n; i++) { l[i] = -a[i]; r[i] = -b[i]; }
  } };
  const ones = () => new Float32Array(BLOCK).fill(1);

  it('spento: il suono passa identico', () => {
    const run = new EffectRunner(invert, SR, false);
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    run.process(ones(), ones(), l, r);
    expect(l.every(v => v === 1)).toBe(true);
  });

  it('accenderlo passa all\'effetto con una dissolvenza di 10 ms, senza scalini', () => {
    const run = new EffectRunner(invert, SR, false);
    run.setEnabled(true);
    const out: number[] = [];
    for (let b = 0; b < 6; b++) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      run.process(ones(), ones(), l, r);
      out.push(...l);
    }
    expect(out[0]).toBeGreaterThan(0.99);
    expect(out[479]).toBe(-1); // 480 campioni = 10 ms
    expect(Math.max(...out.slice(1).map((v, i) => Math.abs(v - out[i])))).toBeLessThan(0.01);
  });
});
