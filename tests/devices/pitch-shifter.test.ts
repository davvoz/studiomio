import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { PITCH_SHIFTER } from '../../src/devices/effects/pitch-shifter/pitch-shifter';
import { PitchShifterCore } from '../../src/devices/effects/pitch-shifter/pitch-shifter-core';

const SR = 48000, BLOCK = 128;

const shifter = (params: Record<string, number>) => {
  const core = new PitchShifterCore(SR);
  core.setParams(resolveParams(PITCH_SHIFTER, params));
  return core;
};

/** Elabora `input` (uguale nei due canali) a blocchi. */
function run(core: PitchShifterCore, input: Float32Array): [Float32Array, Float32Array] {
  const outL = new Float32Array(input.length), outR = new Float32Array(input.length);
  for (let f = 0; f < input.length; f += BLOCK) {
    const n = Math.min(BLOCK, input.length - f), x = input.subarray(f, f + n);
    core.process(x, x, outL.subarray(f, f + n), outR.subarray(f, f + n), n);
  }
  return [outL, outR];
}

const sine = (hz: number, frames: number) => Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};
/** L'ampiezza della componente a `hz` nel tratto (Goertzel). */
function level(x: Float32Array, hz: number, from: number, to: number): number {
  const w = (2 * Math.PI * hz) / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) {
    const s = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2)) / (to - from);
}
/** La componente più forte entro il 3% da `hz`: le testine che si passano il suono a ogni
 *  finestra spostano un poco le righe (righe ogni 1/finestra), come in ogni harmonizer. */
const near = (x: Float32Array, hz: number, from: number, to: number) =>
  Math.max(...Array.from({ length: 61 }, (_, k) => level(x, hz * (0.97 + k * 0.001), from, to)));

describe('Pitch Shifter', () => {
  it('a mix 0 il suono passa intatto', () => {
    const x = sine(440, 4800);
    expect(run(shifter({ semitones: 7, mix: 0 }), x)[0]).toEqual(x);
  });

  it.each([
    [12, 880], [-12, 220], [7, 440 * 2 ** (7 / 12)], [-5, 440 * 2 ** (-5 / 12)],
  ])('sposta un La di %i semitoni', (semitones, hz) => {
    const [y] = run(shifter({ semitones, window: 60 }), sine(440, SR));
    const from = SR / 4, to = SR;
    expect(near(y, hz, from, to)).toBeGreaterThan(0.5);
    expect(near(y, 440, from, to)).toBeLessThan(0.1);
  });

  it('a intonazione ferma non colora il suono', () => {
    const [y] = run(shifter({}), sine(1000, SR / 2));
    expect(rms(y, SR / 4)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('dopo un tuffo e il ritorno le testine si posano e il pettine sparisce', () => {
    const core = shifter({ semitones: -5, glide: 0 });
    run(core, sine(1000, SR / 3));
    core.setParams(resolveParams(PITCH_SHIFTER, { semitones: 0, glide: 0 }));
    const [y] = run(core, sine(1000, 3 * SR));
    expect(rms(y, 2.5 * SR)).toBeCloseTo(Math.SQRT1_2, 2);
    expect(level(y, 1000, 2.5 * SR, 3 * SR)).toBeGreaterThan(0.99);
  });

  it('Stereo scorda il sinistro in giù e il destro in su', () => {
    const core = shifter({ semitones: 0, spread: 20 });
    expect(core.ratioOf(0)).toBeCloseTo(2 ** (-0.1 / 12), 6);
    expect(core.ratioOf(1)).toBeCloseTo(2 ** (0.1 / 12), 6);
  });

  it('il Glide fa scivolare i cambi di Semitoni', () => {
    const core = shifter({ semitones: 0, glide: 500 });
    run(core, sine(440, BLOCK));
    core.setParams(resolveParams(PITCH_SHIFTER, { semitones: 12, glide: 500 }));
    run(core, sine(440, SR / 10));
    const r = core.ratioOf(0);
    expect(r).toBeGreaterThan(1.05);
    expect(r).toBeLessThan(1.6);
    run(core, sine(440, 4 * SR));
    expect(core.ratioOf(0)).toBeCloseTo(2, 3);
  });

  it('con il feedback al massimo resta limitato', () => {
    const [y] = run(shifter({ semitones: 12, feedback: 95, window: 200 }), sine(220, 2 * SR));
    expect(y.every(Number.isFinite)).toBe(true);
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(20);
  });
});
