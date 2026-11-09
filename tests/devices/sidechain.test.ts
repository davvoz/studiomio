import { beforeAll, describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { COMPRESSOR } from '../../src/devices/effects/compressor/compressor';
import { CompressorCore } from '../../src/devices/effects/compressor/compressor-core';
import { EFFECT_PROCESSOR, type EffectMessage, type EffectProcessorOptions } from '../../src/devices/worklet/protocol';

const SR = 48000, BLOCK = 128;
const params = resolveParams(COMPRESSOR, { auto: 0, threshold: -24, ratio: 10, attack: 1, release: 50 });

/** A quiet pad (−30 dB, below the threshold) and a loud kick: 50 ms hits every half second. */
const pad = Float32Array.from({ length: SR }, (_, i) => 0.03 * Math.sin((2 * Math.PI * 220 * i) / SR));
const kick = Float32Array.from({ length: SR }, (_, i) => (i % (SR / 2) < SR / 20 ? 0.9 * Math.sin((2 * Math.PI * 60 * i) / SR) : 0));
const silence = new Float32Array(SR);
const peak = (x: Float32Array, from: number, to: number) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
/** During the hit (after the attack) and far from the hit (after the release). */
const during = (x: Float32Array) => peak(x, SR / 100, SR / 20);
const between = (x: Float32Array) => peak(x, SR / 4, SR / 2 - 1);

/** The compressor in blocks; `key` is the sound the detector listens to (null: the input). */
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

describe('Compressor with the sidechain', () => {
  it('alone the quiet pad passes intact; with the kick as key it ducks on the hits', () => {
    const alone = run(pad, null);
    expect(during(alone)).toBeCloseTo(0.03, 3);
    const ducked = run(pad, kick);
    expect(20 * Math.log10(during(ducked) / 0.03)).toBeLessThan(-12);
    // between one hit and the next the pad comes back up
    expect(between(ducked)).toBeCloseTo(0.03, 3);
  });

  it('a silent key doesn\'t make the compressor work, even if the passing sound is loud', () => {
    const out = run(kick, silence);
    expect(during(out)).toBeCloseTo(during(kick), 4);
  });

  it('with the key removed it listens to itself again, exactly as without sidechain', () => {
    const core = new CompressorCore(SR);
    core.setKey(kick, null);
    core.setKey(null, null);
    expect(run(kick, null, core)).toEqual(run(kick, null));
  });
});

// ------------------------------------------------------------------ the AudioWorklet's processor

interface FakePort { onmessage: ((e: { data: EffectMessage }) => void) | null; postMessage(): void }
type Processor = { port: FakePort; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
const processors = new Map<string, new (o: { processorOptions: EffectProcessorOptions }) => Processor>();

describe('effects processor with the sidechain', () => {
  beforeAll(async () => {
    // the AudioWorkletGlobalScope globals the module uses
    Object.assign(globalThis, {
      sampleRate: SR, currentFrame: 0,
      AudioWorkletProcessor: class { readonly port: FakePort = { onmessage: null, postMessage() {} }; },
      registerProcessor: (name: string, ctor: never) => processors.set(name, ctor),
    });
    await import('../../src/devices/worklet/devices.worklet');
  });

  const make = (keyed: boolean) => new (processors.get(EFFECT_PROCESSOR)!)({
    processorOptions: { type: 'compressor', params, enabled: true, bpm: 120, keyed, transport: null },
  });
  /** Plays the processor: `key` goes into the second input (null: nothing connected). */
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

  it('with the sidechain the detector listens to the second input', () => {
    expect(20 * Math.log10(during(play(make(true), pad, kick)) / 0.03)).toBeLessThan(-12);
  });

  it('without, the second input doesn\'t count: it plays as before', () => {
    expect(play(make(false), kick, pad)).toEqual(play(make(false), kick, null));
    expect(during(play(make(false), pad, kick))).toBeCloseTo(0.03, 3);
  });

  it('turned on and off by message; with nothing connected the key is silence', () => {
    const p = make(false);
    p.port.onmessage!({ data: { type: 'keyed', keyed: true } });
    expect(during(play(p, kick, null))).toBeCloseTo(during(kick), 4);
    p.port.onmessage!({ data: { type: 'keyed', keyed: false } });
    expect(during(play(p, kick, null))).toBeLessThan(during(kick) * 0.5);
  });
});
