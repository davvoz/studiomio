import { afterEach, describe, expect, it, vi } from 'vitest';
import { DspEngine } from '../src/dsp/engine';
import { defaultStretchers } from '../src/dsp/stretch/warp-renderer';
import type { MessagePortLike } from '../src/workers/rpc';
import { DspService, toSharedChannels } from '../src/workers/dsp-service';
import type { PooledWorker } from '../src/workers/worker-pool';

const SR = 44100;
/** 4 s of clicks at 120 BPM. */
const clicks = () => [Float32Array.from({ length: 4 * SR }, (_, i) => (i % (SR / 2) < 64 ? 0.9 : 0))];

/** The real worker module, run in this thread behind a pair of ports with asynchronous messages. */
async function inThreadWorker(): Promise<PooledWorker> {
  const inside: MessagePortLike = { onmessage: null, postMessage: m => queueMicrotask(() => outside.onmessage?.({ data: m } as MessageEvent)) };
  const outside: PooledWorker = {
    onmessage: null,
    postMessage: m => queueMicrotask(() => inside.onmessage?.({ data: m } as MessageEvent)),
    terminate: () => {},
  };
  vi.stubGlobal('self', inside);
  vi.resetModules();
  await import('../src/workers/dsp.worker');
  return outside;
}

describe('the DSP service', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads a sample in the workers, analyses it, follows its beats and drops it', async () => {
    const worker = await inThreadWorker();
    const dsp = new DspService(() => worker, 1);
    expect(dsp.workers).toBe(1);
    await dsp.loadSource('s1', { channels: clicks(), sampleRate: SR });
    const analysis = await dsp.analyze('s1');
    expect(analysis.tempo).toBeCloseTo(120, 0);
    const beats = await dsp.trackBeats('s1', 120);
    expect(beats.length).toBeGreaterThan(4);
    expect(Object.values(await dsp.info()).every(v => v === 'js')).toBe(true);
    await dsp.dropSource('s1');
    await expect(dsp.analyze('s1')).rejects.toThrow(/not loaded/);
    await expect(dsp.renderWarp('s1', {} as never)).rejects.toThrow(/not loaded/);
    dsp.dispose();
  });

  it('one worker per core but one, at most 8; shared memory only when the page is isolated', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 });
    expect(DspService.defaultSize()).toBe(8);
    vi.stubGlobal('navigator', { hardwareConcurrency: 1 });
    expect(DspService.defaultSize()).toBe(1);
    const ch = [new Float32Array([1, 2])];
    expect(toSharedChannels(ch)[0].buffer).toBeInstanceOf(ArrayBuffer);
    vi.stubGlobal('crossOriginIsolated', true);
    const shared = toSharedChannels(ch);
    expect(shared[0].buffer).toBeInstanceOf(SharedArrayBuffer);
    expect([...shared[0]]).toEqual([1, 2]);
  });

  it('the engine says which implementation each warp mode uses', () => {
    const engine = new DspEngine();
    const [mode] = Object.keys(defaultStretchers()) as (keyof ReturnType<typeof defaultStretchers>)[];
    engine.override({ [mode]: defaultStretchers()[mode] }, 'wasm');
    expect(engine.info[mode]).toBe('wasm');
  });
});
