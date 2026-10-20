import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { StepPosition } from '../../src/devices/dsp/steps';
import { GATE, MAX_STEPS, pattern, STEP_RATES, stepParam } from '../../src/devices/effects/gate/gate';
import { GateCore } from '../../src/devices/effects/gate/gate-core';

const SR = 48000, BLOCK = 128, BPM = 120;
/** Campioni per sedicesimo a 120 BPM. */
const SIXTEENTH = 6000;
const BPS = BPM / 60 / SR;

type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

/** Il Gate su un suono costante (1 a sinistra, −1 a destra): l'uscita è il volume. */
function play(params: Record<string, number>, frames: number, transport: Transport = fromZero): [Float32Array, Float32Array] {
  const core = new GateCore(SR);
  core.setTempo(BPM);
  core.setParams(resolveParams(GATE, params));
  const l = new Float32Array(frames), r = new Float32Array(frames);
  const inL = new Float32Array(BLOCK).fill(1), inR = new Float32Array(BLOCK).fill(-1);
  const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    core.setTransport(transport(f));
    core.process(inL, inR, outL, outR, BLOCK);
    l.set(outL.subarray(0, Math.min(BLOCK, frames - f)), f);
    r.set(outR.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return [l, r];
}

/** Aperto/chiuso a metà di ogni sedicesimo (dove attacco e rilascio sono finiti). */
const sampled = (x: Float32Array, steps: number, at = 0.5) => Array.from({ length: steps }, (_, k) => +x[Math.floor((k + at) * SIXTEENTH)].toFixed(3));

/** Un gate che lascia lo step aperto tutto, con attacco e rilascio brevissimi. */
const SHARP = { gate: 100, attack: 0.5, release: 0.5 };

describe('Step con lo swing', () => {
  const at = (pos: number, length = 16, swing = 0) => {
    const p = new StepPosition();
    p.locate(pos, length, swing);
    return [p.index, +p.t.toFixed(6)];
  };

  it('senza swing: lo step è la parte intera, il tempo passato la frazione', () => {
    expect(at(0)).toEqual([0, 0]);
    expect(at(5.25)).toEqual([5, 0.25]);
    expect(at(15.999)).toEqual([15, 0.999]);
  });

  it('con lo swing gli step dispari partono dopo e quelli pari durano di più', () => {
    // swing al massimo: il dispari parte a metà del suo step
    expect(at(1.25, 16, 1)).toEqual([0, 0.833333]);
    expect(at(1.5, 16, 1)).toEqual([1, 0]);
    expect(at(1.75, 16, 1)).toEqual([1, 0.5]);
    expect(at(2, 16, 1)).toEqual([2, 0]);
  });

  it('in un pattern dispari l\'ultimo step non ha swing', () => {
    expect(at(2.5, 3, 1)).toEqual([2, 0.5]);
  });
});

describe('Gate: il pattern', () => {
  it('ogni sedicesimo apre o chiude come dice il pattern, a partire dalla battuta', () => {
    const [l, r] = play({ ...SHARP, ...pattern('x.xx .xx. x.xx .x.x') }, 16 * SIXTEENTH);
    expect(sampled(l, 16)).toEqual([1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1]);
    expect(sampled(r, 4)).toEqual([-1, 0, -1, -1]);
  });

  it('il livello dello step è il volume', () => {
    const [l] = play({ ...SHARP, ...pattern('xo.o') }, 4 * SIXTEENTH);
    expect(sampled(l, 4)).toEqual([1, 0.5, 0, 0.5]);
  });

  it('Gate: lo step resta aperto solo per la sua parte', () => {
    const [l] = play({ ...SHARP, gate: 50, ...pattern('x') }, 2 * SIXTEENTH);
    expect(sampled(l, 2, 0.25)).toEqual([1, 1]);
    expect(sampled(l, 2, 0.75)).toEqual([0, 0]);
  });

  it('Passi: il pattern ricomincia dopo `length` step', () => {
    const [l] = play({ ...SHARP, length: 3, ...pattern('x..') }, 9 * SIXTEENTH);
    expect(sampled(l, 9)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it('Velocità: in ottavi ogni step dura due sedicesimi', () => {
    const eighth = STEP_RATES.findIndex(([l]) => l === '1/8');
    const [l] = play({ ...SHARP, rate: eighth, ...pattern('x.') }, 8 * SIXTEENTH);
    expect(sampled(l, 8)).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('Swing: lo step dispari parte in ritardo', () => {
    const [l] = play({ ...SHARP, swing: 100, ...pattern('.x') }, 2 * SIXTEENTH);
    expect(sampled(l, 2, 0.25)).toEqual([0, 0]); // il dispari a 1.25 non è ancora partito
    expect(sampled(l, 2, 0.75)).toEqual([0, 1]);
  });

  it('Profondità: chiuso lascia passare il resto', () => {
    const [l] = play({ ...SHARP, depth: 60, ...pattern('x.') }, 2 * SIXTEENTH);
    expect(sampled(l, 2)).toEqual([1, 0.4]);
  });
});

describe('Gate: il tempo', () => {
  it('dopo un salto del trasporto il pattern riparte dal punto giusto della battuta', () => {
    // a metà del primo sedicesimo il trasporto salta al secondo sedicesimo (chiuso)
    const jump: Transport = f => ({ beat: f < 3072 ? f * BPS : 0.25 + (f - 3072) * BPS, bpm: BPM, beatsPerBar: 4 });
    const [l] = play({ ...SHARP, ...pattern('x.xx') }, 4 * SIXTEENTH, jump);
    expect(l[3000]).toBe(1);
    expect(l[3072 + 300]).toBe(0);
  });

  it('da fermo gira libero al tempo del progetto', () => {
    const [l] = play({ ...SHARP, ...pattern('x.xx') }, 4 * SIXTEENTH, () => null);
    expect(sampled(l, 4)).toEqual([1, 0, 1, 1]);
  });

  it('attacco e rilascio: il volume scivola, niente salti', () => {
    const [l] = play({ attack: 2, release: 10, gate: 50, ...pattern('x.') }, 4 * SIXTEENTH);
    let jump = 0;
    for (let n = 1; n < l.length; n++) jump = Math.max(jump, Math.abs(l[n] - l[n - 1]));
    expect(jump).toBeLessThanOrEqual(1 / (0.002 * SR) + 1e-6);
    // il terzo sedicesimo riapre: dopo 1 ms di attacco è a metà
    expect(l[2 * SIXTEENTH - 1]).toBe(0);
    expect(Math.abs(l[2 * SIXTEENTH + 47] - 0.5)).toBeLessThanOrEqual(1 / 96 + 1e-6); // al campione, o uno dopo
  });
});

describe('Gate: la descrizione', () => {
  it('32 step nascosti, che non vanno su macro e controller', () => {
    const steps = GATE.sections.flatMap(s => s.params).filter(p => p.id.startsWith('step'));
    expect(steps).toHaveLength(MAX_STEPS);
    expect(steps.every(p => p.hidden)).toBe(true);
  });

  it('i preset hanno pattern ripetuti su tutti gli step', () => {
    const swing = GATE.presets.find(p => p.name === 'Galoppo')!;
    expect([0, 1, 2, 3, 28, 29, 30, 31].map(i => swing.params[stepParam(i)])).toEqual([100, 0, 100, 100, 100, 0, 100, 100]);
  });
});
