import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { LFO_SHAPE } from '../../src/devices/dsp/lfo';
import { FILTER_TYPE } from '../../src/devices/dsp/multimode-filter';
import { AUTO_FILTER, AUTO_FILTER_SYNC, LFO_OCTAVES } from '../../src/devices/effects/auto-filter/auto-filter';
import { AutoFilterCore } from '../../src/devices/effects/auto-filter/auto-filter-core';
import { TEMPO_RATE } from '../../src/devices/rates';

const SR = 48000, BLOCK = 128, BPM = 120;
const BEAT = 24000;
const BPS = BPM / 60 / SR;

type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

interface Run {
  readonly frames: number;
  readonly input?: (n: number) => number;
  readonly key?: (n: number) => number;
  readonly transport?: Transport;
  /** Chiamata dopo ogni blocco con il campione da cui ripartirà. */
  readonly after?: (core: AutoFilterCore, frame: number) => void;
}

const sine = (hz: number, amp = 0.5) => (n: number) => amp * Math.sin((2 * Math.PI * hz * n) / SR);

/** Fa suonare l'Auto Filter a blocchi, come l'AudioWorklet. */
function play(params: Record<string, number>, o: Run): { core: AutoFilterCore; l: Float32Array; r: Float32Array } {
  const core = new AutoFilterCore(SR);
  core.setTempo(BPM);
  core.setParams(resolveParams(AUTO_FILTER, params));
  const input = o.input ?? sine(220), transport = o.transport ?? fromZero;
  const l = new Float32Array(o.frames), r = new Float32Array(o.frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), kl = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let f = 0; f < o.frames; f += BLOCK) {
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = inR[i] = input(f + i);
      if (o.key) kl[i] = o.key(f + i);
    }
    core.setKey(o.key ? kl : null, o.key ? kl : null);
    core.setTransport(transport(f));
    core.process(inL, inR, outL, outR, BLOCK);
    l.set(outL.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    r.set(outR.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    o.after?.(core, f + BLOCK);
  }
  return { core, l, r };
}

const rms = (x: Float32Array, from = 0, to = x.length) => Math.sqrt(x.subarray(from, to).reduce((s, y) => s + y * y, 0) / (to - from));

/** Il cutoff (dei due canali) a ogni blocco, per campione d'inizio del blocco successivo. */
function cutoffs(params: Record<string, number>, o: Omit<Run, 'after'>) {
  const left = new Map<number, number>(), right = new Map<number, number>();
  play(params, { ...o, after: (core, f) => { left.set(f, core.cutoff(0)); right.set(f, core.cutoff(1)); } });
  return { left, right };
}

/** Un LFO a seno al 100% su 1000 Hz: il cutoff va da 1000/16 a 1000·16. */
const WOBBLE = { freq: 1000, lfoAmount: 100, lfoShape: LFO_SHAPE.sine, lfoDivision: TEMPO_RATE['1/4'] };
const TOP = 1000 * 2 ** LFO_OCTAVES, BOTTOM = 1000 / 2 ** LFO_OCTAVES;

describe('Auto Filter: il filtro', () => {
  it('passa-basso a 2 kHz: i bassi passano, gli acuti no', () => {
    const low = play({ resonance: 0 }, { frames: SR / 2, input: sine(200) });
    const high = play({ resonance: 0 }, { frames: SR / 2, input: sine(12000) });
    expect(rms(low.l, SR / 4)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(rms(high.l, SR / 4)).toBeLessThan(0.02);
  });

  it('Dry/Wet a 0 e Uscita: il suono com\'era, più forte o più piano', () => {
    const { l } = play({ mix: 0, output: -6 }, { frames: BLOCK * 4, input: sine(12000) });
    for (let n = 0; n < l.length; n += 37) expect(l[n]).toBeCloseTo(sine(12000)(n) * 10 ** (-6 / 20), 6);
  });

  it('il drive satura ma non supera mai il livello di un suono pieno', () => {
    const { l } = play({ drive: 24, freq: 20000, resonance: 0 }, { frames: SR / 4, input: sine(100, 1) });
    expect(Math.max(...l.map(Math.abs))).toBeLessThan(1.1);
    expect(l.every(Number.isFinite)).toBe(true);
  });
});

describe('Auto Filter: l\'LFO agganciato alla battuta', () => {
  it('un giro di 1/4: al sedicesimo il cutoff è in cima, al terzo sedicesimo in fondo', () => {
    const { left } = cutoffs(WOBBLE, { frames: 2 * BEAT });
    // a 120 BPM un sedicesimo è 6000 campioni; 6016 è l'inizio di un blocco
    expect(left.get(6016)! / TOP).toBeGreaterThan(0.95);
    expect(left.get(18048)! / BOTTOM).toBeLessThan(1.05);
    expect(left.get(30080)! / TOP).toBeGreaterThan(0.95); // e al quarto dopo
  });

  it('dopo un salto del trasporto riparte dal punto giusto della battuta', () => {
    // il trasporto salta da 0.5 a 2.25 battiti dopo 12032 campioni: subito in cima
    const jump: Transport = f => ({ beat: f < 12032 ? f * BPS : 2.25 + (f - 12032) * BPS, bpm: BPM, beatsPerBar: 4 });
    const { left } = cutoffs(WOBBLE, { frames: 14000, transport: jump });
    expect(left.get(12032 + 640)! / TOP).toBeGreaterThan(0.95); // dopo l'assestamento (2 ms)
  });

  it('Fase sposta il giro, Stereo sfasa il destro', () => {
    const { left, right } = cutoffs({ ...WOBBLE, lfoPhase: 90, lfoStereo: 180 }, { frames: BEAT });
    // a 90° il giro parte dalla cima; il destro, a 180°, dal fondo
    expect(left.get(256)! / TOP).toBeGreaterThan(0.9);
    expect(right.get(256)! / BOTTOM).toBeLessThan(1.1);
  });

  it('da fermo gira libero al tempo del progetto', () => {
    const { left } = cutoffs(WOBBLE, { frames: BEAT, transport: () => null });
    // parte da 0: in cima dopo un quarto di giro (1/4 a 120 BPM: mezzo secondo per giro)
    expect(left.get(6016)! / TOP).toBeGreaterThan(0.95);
  });

  it('in Hz va per conto suo', () => {
    const { left } = cutoffs({ ...WOBBLE, lfoSync: AUTO_FILTER_SYNC.hz, lfoRate: 1 }, { frames: SR / 2, transport: f => ({ beat: 7.25 + f * BPS, bpm: BPM, beatsPerBar: 4 }) });
    expect(left.get(12032)! / TOP).toBeGreaterThan(0.95); // un quarto di secondo
  });

  it('onda quadra al massimo: il cutoff salta ma il suono no (niente click)', () => {
    const { l } = play({ ...WOBBLE, lfoShape: LFO_SHAPE.square, lfoDivision: TEMPO_RATE['1/16'], resonance: 50 }, { frames: BEAT, input: sine(220) });
    let jump = 0;
    for (let n = 1; n < l.length; n++) jump = Math.max(jump, Math.abs(l[n] - l[n - 1]));
    expect(jump).toBeLessThan(0.05); // il seno da solo: 0.014 per campione
  });
});

describe('Auto Filter: l\'inviluppo', () => {
  const ENV = { freq: 200, resonance: 0, envAmount: 100, envAttack: 1, envRelease: 50 };

  it('il suono forte apre il filtro, il silenzio lo richiude', () => {
    const burst = (n: number) => (n < SR / 4 ? sine(220, 0.9)(n) : 0);
    const { left } = cutoffs(ENV, { frames: SR, input: burst });
    expect(left.get(6016)!).toBeGreaterThan(200 * 2 ** 4);
    expect(left.get(SR - 128)!).toBeLessThan(220);
  });

  it('negativo lo chiude', () => {
    const { left } = cutoffs({ ...ENV, freq: 5000, envAmount: -100 }, { frames: SR / 4, input: sine(220, 0.9) });
    expect(left.get(6016)!).toBeLessThan(5000 / 2 ** 4);
  });

  it('col sidechain ascolta la chiave, non il suono che filtra', () => {
    const quiet = sine(220, 0.01), loud = sine(60, 0.9);
    expect(cutoffs(ENV, { frames: SR / 4, input: quiet, key: loud }).left.get(6016)!).toBeGreaterThan(200 * 2 ** 4);
    expect(cutoffs(ENV, { frames: SR / 4, input: loud, key: () => 0 }).left.get(6016)!).toBeLessThan(205);
  });
});

describe('Auto Filter: i tipi', () => {
  it('passa-alto e notch fanno quello che dicono', () => {
    const hp = play({ type: FILTER_TYPE.highPass, freq: 2000, resonance: 0 }, { frames: SR / 2, input: sine(200) });
    expect(rms(hp.l, SR / 4)).toBeLessThan(0.01);
    const notch = play({ type: FILTER_TYPE.notch, freq: 1000, resonance: 0, slope: 1 }, { frames: SR / 2, input: sine(1000) });
    expect(rms(notch.l, SR / 4)).toBeLessThan(0.01);
  });
});
