import { DspEngine } from '../dsp/engine';
import type { DspProtocol } from './dsp-protocol';
import { serveRpc, type MessagePortLike } from './rpc';

const engine = new DspEngine();

// The WebAssembly versions are enabled with VITE_DSP_WASM=1. Today on Complex the TypeScript
// in V8 is faster (`npm run bench`), so by default the engine stays in TypeScript.
const ready = import.meta.env.VITE_DSP_WASM === '1'
  ? import('../dsp/wasm/wasm-stretchers')
    .then(m => m.loadWasmStretchers())
    .then(s => engine.override(s, 'wasm'))
    .catch(err => console.warn('DSP: WebAssembly not available, using TypeScript.', err))
  : Promise.resolve();

serveRpc<DspProtocol>(self as unknown as MessagePortLike, {
  loadSource: ({ sourceId, channels, sampleRate }) => (engine.loadSource(sourceId, { channels, sampleRate }), null),
  dropSource: ({ sourceId }) => (engine.dropSource(sourceId), null),
  renderWarp: ({ sourceId, job }) => engine.renderWarp(sourceId, job),
  analyze: ({ sourceId, sensitivity }) => engine.analyze(sourceId, sensitivity),
  trackBeats: ({ sourceId, bpm }) => engine.trackBeats(sourceId, bpm),
  info: () => engine.info,
}, ready);
