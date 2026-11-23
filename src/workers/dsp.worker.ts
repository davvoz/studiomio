import { DspEngine } from '../dsp/engine';
import type { DspProtocol } from './dsp-protocol';
import { serveRpc, type MessagePortLike } from './rpc';

const engine = new DspEngine();

// The WebAssembly versions are enabled with VITE_DSP_WASM=1. Today on Complex the TypeScript
// in V8 is faster (`npm run bench`), so by default the engine stays in TypeScript.
async function useWasm(): Promise<void> {
  try {
    const m = await import('../dsp/wasm/wasm-stretchers');
    engine.override(await m.loadWasmStretchers(), 'wasm');
  } catch (err) {
    console.warn('DSP: WebAssembly not available, using TypeScript.', err);
  }
}
const ready = import.meta.env.VITE_DSP_WASM === '1' ? useWasm() : Promise.resolve();

serveRpc<DspProtocol>(self as unknown as MessagePortLike, {
  loadSource: ({ sourceId, channels, sampleRate }) => {
    engine.loadSource(sourceId, { channels, sampleRate });
    return null;
  },
  dropSource: ({ sourceId }) => {
    engine.dropSource(sourceId);
    return null;
  },
  renderWarp: ({ sourceId, job }) => engine.renderWarp(sourceId, job),
  analyze: ({ sourceId, sensitivity }) => engine.analyze(sourceId, sensitivity),
  trackBeats: ({ sourceId, bpm }) => engine.trackBeats(sourceId, bpm),
  info: () => engine.info,
}, ready);
