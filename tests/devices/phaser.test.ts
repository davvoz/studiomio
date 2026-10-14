import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { PHASER, PHASER_MODE, PHASER_SYNC } from '../../src/devices/effects/phaser/phaser';
import { PhaserCore } from '../../src/devices/effects/phaser/phaser-core';
import { TEMPO_RATE } from '../../src/devices/rates';

const SR = 48000, BLOCK = 128;

const phaser = (params: Record<string, number>) => {
  const core = new PhaserCore(SR);
  core.setTempo(120);
  core.setParams(resolveParams(PHASER, params));
  return core;
};

/** Elabora `input` (uguale nei due canali) a blocchi. */
function run(core: PhaserCore, input: Float32Array): [Float32Array, Float32Array] {
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

describe('Phaser', () => {
  it('a mix 0 il suono passa intatto', () => {
    const x = sine(440, 4800);
    expect(run(phaser({ mix: 0 }), x)[0]).toEqual(x);
  });

  it('due stadi fermi a metà mix fanno una buca proprio al centro', () => {
    const fixed = { stages: 0, center: 1000, depth: 0, feedback: 0, mix: 50 };
    const atCenter = rms(run(phaser(fixed), sine(1000, SR / 2))[0], SR / 4);
    const away = rms(run(phaser(fixed), sine(100, SR / 2))[0], SR / 4);
    expect(atCenter).toBeLessThan(0.01);
    expect(away).toBeGreaterThan(0.6);
  });

  it('il flanger ripete il colpo dopo il suo ritardo', () => {
    const x = new Float32Array(4800);
    x[0] = 1;
    const [y] = run(phaser({ mode: PHASER_MODE.flanger, delay: 5, depth: 0, feedback: 0, mix: 100 }), x);
    let at = 0;
    for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[at])) at = i;
    expect(at).toBe(240);
  });

  it('va a tempo e il destro è sfasato', () => {
    // la buca gira con l'LFO: a 120 BPM e 1 battuta il giro dura 2 secondi
    const moving = { stages: 0, center: 1000, depth: 100, feedback: 0, mix: 50, sync: PHASER_SYNC.tempo, division: TEMPO_RATE['1 battuta'], stereo: 90 };
    const [l, r] = run(phaser(moving), sine(1000, 4 * SR));
    const env = (x: Float32Array, at: number) => rms(x, at - 480, at + 480);
    // dopo un giro l'LFO sinistro è a zero (buca al centro), a un quarto di giro no; il destro
    // è un quarto di giro avanti
    expect(env(l, 2 * SR)).toBeLessThan(0.1);
    expect(env(l, SR / 2)).toBeGreaterThan(0.5);
    expect(env(r, 2 * SR)).toBeGreaterThan(0.5);
  });

  it('con il feedback al massimo resta limitato', () => {
    for (const mode of [PHASER_MODE.phaser, PHASER_MODE.flanger]) {
      const [y] = run(phaser({ mode, feedback: 95, depth: 100, mix: 100, sync: PHASER_SYNC.hz, rate: 3 }), sine(220, SR));
      expect(Math.max(...y.map(Math.abs))).toBeLessThan(4);
      expect(y.every(Number.isFinite)).toBe(true);
    }
  });
});
