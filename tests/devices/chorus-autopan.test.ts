import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { LFO_SHAPE } from '../../src/devices/dsp/lfo';
import { AUTO_PAN, AUTO_PAN_SYNC } from '../../src/devices/effects/auto-pan/auto-pan';
import { AutoPanCore } from '../../src/devices/effects/auto-pan/auto-pan-core';
import { CHORUS, CHORUS_MODE, CHORUS_SYNC, MAX_DEPTH_MS } from '../../src/devices/effects/chorus/chorus';
import { ChorusCore } from '../../src/devices/effects/chorus/chorus-core';
import { TEMPO_RATE } from '../../src/devices/rates';

const SR = 48000, BLOCK = 128, BPM = 120;
const BPS = BPM / 60 / SR;
/** Campioni in un quarto a 120 BPM. */
const BEAT = 24000;

type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

interface Core {
  setTempo(bpm: number): void;
  setTransport(t: TransportPosition | null): void;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}

/** Fa suonare un effetto a blocchi; `after` riceve il core dopo ogni blocco, col campione da cui ripartirà. */
function play<C extends Core>(core: C, o: {
  frames: number; left?: (n: number) => number; right?: (n: number) => number; transport?: Transport; after?: (core: C, frame: number) => void;
}): [Float32Array, Float32Array] {
  core.setTempo(BPM);
  const left = o.left ?? (() => 1), right = o.right ?? left, transport = o.transport ?? fromZero;
  const l = new Float32Array(o.frames), r = new Float32Array(o.frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let f = 0; f < o.frames; f += BLOCK) {
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = left(f + i);
      inR[i] = right(f + i);
    }
    core.setTransport(transport(f));
    core.process(inL, inR, outL, outR, BLOCK);
    l.set(outL.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    r.set(outR.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    o.after?.(core, f + BLOCK);
  }
  return [l, r];
}

const chorus = (params: Record<string, number>) => {
  const core = new ChorusCore(SR);
  core.setParams(resolveParams(CHORUS, params));
  return core;
};
const autoPan = (params: Record<string, number>) => {
  const core = new AutoPanCore(SR);
  core.setParams(resolveParams(AUTO_PAN, params));
  return core;
};

const sine = (hz: number) => (n: number) => 0.5 * Math.sin((2 * Math.PI * hz * n) / SR);
const maxJump = (x: Float32Array) => x.reduce((m, y, n) => (n ? Math.max(m, Math.abs(y - x[n - 1])) : 0), 0);

describe('Chorus', () => {
  it('senza profondità è il suono ritardato esattamente del Ritardo', () => {
    const impulse = (n: number) => (n === 0 ? 1 : 0);
    const [l, r] = play(chorus({ depth: 0, delay: 10, mix: 100 }), { frames: 1000, left: impulse, right: () => 0 });
    expect(l[480]).toBeCloseTo(1, 6);
    expect(l.reduce((s, y) => s + Math.abs(y), 0)).toBeCloseTo(1, 6);
    expect(r.every(y => y === 0)).toBe(true); // i canali non si mescolano
  });

  it('Dry/Wet a 0: il suono passa com\'è', () => {
    const [l] = play(chorus({ mix: 0 }), { frames: 2000, left: sine(440) });
    for (let n = 0; n < 2000; n += 37) expect(l[n]).toBeCloseTo(sine(440)(n), 6);
  });

  it('il ritardo ondeggia di Profondità attorno al Ritardo, a tempo e agganciato alla battuta', () => {
    const delays = new Map<number, number>();
    const params = { mode: CHORUS_MODE.vibrato, sync: CHORUS_SYNC.tempo, division: TEMPO_RATE['1/4'], depth: 50, delay: 5 };
    play(chorus(params), { frames: BEAT, after: (c, f) => delays.set(f, c.delayMs(0, 0)) });
    const swing = 0.5 * MAX_DEPTH_MS;
    // il Vibrato parte da Ritardo + Profondità; a un sedicesimo (6016 campioni) è in cima
    expect(delays.get(6016)!).toBeCloseTo(5 + 2 * swing, 2);
    expect(delays.get(18048)!).toBeCloseTo(5, 2);
  });

  it('Ensemble: tre voci a un terzo di giro; Larghezza sfasa il destro di un quarto', () => {
    const core = chorus({ mode: CHORUS_MODE.ensemble, depth: 100, delay: 10, width: 100 });
    play(core, { frames: BLOCK, transport: () => null });
    const v = [0, 1, 2].map(k => core.delayMs(k, 0));
    expect(v[0] + v[1] + v[2]).toBeCloseTo(30, 1); // tre seni a 120° si annullano
    const right = core.delayMs(0, 1);
    expect(Math.abs(right - v[0])).toBeGreaterThan(1);
  });

  it('con il feedback al massimo resta stabile', () => {
    const [l] = play(chorus({ feedback: 90, delay: 2, depth: 80, mix: 100 }), { frames: SR, left: sine(220) });
    expect(l.every(Number.isFinite)).toBe(true);
    expect(Math.max(...l.map(Math.abs))).toBeLessThan(10);
  });

  it('niente click mentre il ritardo ondeggia', () => {
    const [l] = play(chorus({ depth: 100, rate: 3, sync: CHORUS_SYNC.hz, mix: 100 }), { frames: SR / 2, left: sine(220) });
    expect(maxJump(l)).toBeLessThan(0.04); // il seno da solo: 0.014 per campione
  });
});

describe('Auto Pan', () => {
  /** Il volume dei due canali a ogni blocco, per il campione d'inizio del blocco dopo. */
  function gains(params: Record<string, number>, transport: Transport = fromZero, frames = BEAT) {
    const out = new Map<number, [number, number]>();
    play(autoPan(params), { frames, transport, after: (c, f) => out.set(f, [c.gain(0), c.gain(1)]) });
    return out;
  }
  const QUARTER = { division: TEMPO_RATE['1/4'] };

  it('a 180° i canali vanno in controfase: in cima a sinistra, a destra niente', () => {
    const g = gains(QUARTER);
    const [l, r] = g.get(6016)!; // un sedicesimo: il seno è in cima
    expect(l).toBeCloseTo(1, 3);
    expect(r).toBeCloseTo(0, 2);
    const [l2, r2] = g.get(18048)!;
    expect(l2).toBeCloseTo(0, 2);
    expect(r2).toBeCloseTo(1, 3);
  });

  it('potenza costante: a metà strada −3 dB per canale (non −6), e in ogni punto la somma delle potenze è 1', () => {
    const g = gains(QUARTER);
    const [l] = g.get(128)!;
    expect(l).toBeCloseTo(Math.SQRT1_2, 1);
    for (const [a, b] of g.values()) expect(a * a + b * b).toBeCloseTo(1, 2);
  });

  it('Stereo a 0°: tremolo, i canali insieme; Quantità dice quanto scende', () => {
    const [l, r] = gains({ ...QUARTER, stereo: 0, amount: 50 }).get(18048)!;
    expect(l).toBeCloseTo(0.5, 2);
    expect(r).toBeCloseTo(l, 9);
  });

  it('Fase sposta il giro rispetto alla battuta', () => {
    const [l] = gains({ ...QUARTER, phase: 90 }).get(128)!;
    expect(l).toBeCloseTo(1, 3);
  });

  it('da fermo gira libero al tempo del progetto; in Hz non guarda il trasporto', () => {
    expect(gains(QUARTER, () => null).get(6016)![0]).toBeCloseTo(1, 3);
    const hz = gains({ sync: AUTO_PAN_SYNC.hz, rate: 1 }, f => ({ beat: 3.3 + f * BPS, bpm: BPM, beatsPerBar: 4 }), SR / 2);
    expect(hz.get(12032)![0]).toBeCloseTo(1, 3); // un quarto di secondo
  });

  it('onda quadra: il volume salta ma il suono no', () => {
    const [l] = play(autoPan({ shape: LFO_SHAPE.square, division: TEMPO_RATE['1/16'] }), { frames: BEAT, left: sine(220) });
    expect(maxJump(l)).toBeLessThan(0.03); // il seno da solo: 0.014
  });
});
