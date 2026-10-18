import { beforeAll, describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { COMPRESSOR } from '../../src/devices/effects/compressor/compressor';
import { CompressorCore } from '../../src/devices/effects/compressor/compressor-core';
import { EFFECT_PROCESSOR, type EffectMessage, type EffectProcessorOptions } from '../../src/devices/worklet/protocol';

const SR = 48000, BLOCK = 128;
const params = resolveParams(COMPRESSOR, { auto: 0, threshold: -24, ratio: 10, attack: 1, release: 50 });

/** Un pad piano (−30 dB, sotto la soglia) e una cassa forte: colpi di 50 ms ogni mezzo secondo. */
const pad = Float32Array.from({ length: SR }, (_, i) => 0.03 * Math.sin((2 * Math.PI * 220 * i) / SR));
const kick = Float32Array.from({ length: SR }, (_, i) => (i % (SR / 2) < SR / 20 ? 0.9 * Math.sin((2 * Math.PI * 60 * i) / SR) : 0));
const silence = new Float32Array(SR);
const peak = (x: Float32Array, from: number, to: number) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
/** Durante il colpo (dopo l'attacco) e lontano dal colpo (dopo il rilascio). */
const during = (x: Float32Array) => peak(x, SR / 100, SR / 20);
const between = (x: Float32Array) => peak(x, SR / 4, SR / 2 - 1);

/** Il compressore a blocchi; `key` è il suono che il rilevatore ascolta (null: l'ingresso). */
function run(input: Float32Array, key: Float32Array | null, core = new CompressorCore(SR)): Float32Array {
  core.setParams(params);
  const out = new Float32Array(input.length);
  for (let f = 0; f < input.length; f += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK), inp = input.subarray(f, f + BLOCK);
    if (key) core.setKey(key.subarray(f, f + BLOCK), null);
    core.process(inp, inp, l, r, BLOCK);
    out.set(l, f);
  }
  return out;
}

describe('Compressore con il sidechain', () => {
  it('da solo il pad piano passa intatto; con la cassa come chiave si abbassa sui colpi', () => {
    const alone = run(pad, null);
    expect(during(alone)).toBeCloseTo(0.03, 3);
    const ducked = run(pad, kick);
    expect(20 * Math.log10(during(ducked) / 0.03)).toBeLessThan(-12);
    // tra un colpo e l'altro il pad torna su
    expect(between(ducked)).toBeCloseTo(0.03, 3);
  });

  it('una chiave che tace non fa lavorare il compressore, anche se il suono che passa è forte', () => {
    const out = run(kick, silence);
    expect(during(out)).toBeCloseTo(during(kick), 4);
  });

  it('tolta la chiave ascolta di nuovo sé stesso, esattamente come senza sidechain', () => {
    const core = new CompressorCore(SR);
    core.setKey(kick, null);
    core.setKey(null, null);
    expect(run(kick, null, core)).toEqual(run(kick, null));
  });
});

// ------------------------------------------------------------------ il processore dell'AudioWorklet

interface FakePort { onmessage: ((e: { data: EffectMessage }) => void) | null; postMessage(): void }
type Processor = { port: FakePort; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
const processors = new Map<string, new (o: { processorOptions: EffectProcessorOptions }) => Processor>();

describe('processore degli effetti con il sidechain', () => {
  beforeAll(async () => {
    // i globali dell'AudioWorkletGlobalScope che il modulo usa
    Object.assign(globalThis, {
      sampleRate: SR, currentFrame: 0,
      AudioWorkletProcessor: class { readonly port: FakePort = { onmessage: null, postMessage() {} }; },
      registerProcessor: (name: string, ctor: never) => processors.set(name, ctor),
    });
    await import('../../src/devices/worklet/devices.worklet');
  });

  const make = (keyed: boolean) => new (processors.get(EFFECT_PROCESSOR)!)({
    processorOptions: { type: 'compressor', params, enabled: true, bpm: 120, keyed },
  });
  /** Fa suonare il processore: `key` va nel secondo ingresso (null: niente collegato). */
  function play(p: Processor, input: Float32Array, key: Float32Array | null): Float32Array {
    const out = new Float32Array(input.length);
    for (let f = 0; f < input.length; f += BLOCK) {
      const inp = input.subarray(f, f + BLOCK);
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      const inputs = [[inp, inp], key ? [key.subarray(f, f + BLOCK), key.subarray(f, f + BLOCK)] : []];
      p.process(inputs, [[l, r]]);
      out.set(l, f);
    }
    return out;
  }

  it('con il sidechain il rilevatore ascolta il secondo ingresso', () => {
    expect(20 * Math.log10(during(play(make(true), pad, kick)) / 0.03)).toBeLessThan(-12);
  });

  it('senza, il secondo ingresso non conta: suona come prima', () => {
    expect(play(make(false), kick, pad)).toEqual(play(make(false), kick, null));
    expect(during(play(make(false), pad, kick))).toBeCloseTo(0.03, 3);
  });

  it('acceso e spento per messaggio; senza niente collegato la chiave è silenzio', () => {
    const p = make(false);
    p.port.onmessage!({ data: { type: 'keyed', keyed: true } });
    expect(during(play(p, kick, null))).toBeCloseTo(during(kick), 4);
    p.port.onmessage!({ data: { type: 'keyed', keyed: false } });
    expect(during(play(p, kick, null))).toBeLessThan(during(kick) * 0.5);
  });
});
