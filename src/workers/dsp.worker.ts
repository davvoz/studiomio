import { DspEngine } from '../dsp/engine';
import type { DspProtocol } from './dsp-protocol';
import { serveRpc, type MessagePortLike } from './rpc';

const engine = new DspEngine();

// Le versioni WebAssembly si attivano con VITE_DSP_WASM=1. Oggi su Complex il TypeScript
// in V8 è più veloce (`npm run bench`), quindi di default il motore resta in TypeScript.
const ready = import.meta.env.VITE_DSP_WASM === '1'
  ? import('../dsp/wasm/wasm-stretchers')
    .then(m => m.loadWasmStretchers())
    .then(s => engine.override(s, 'wasm'))
    .catch(err => console.warn('DSP: WebAssembly non disponibile, uso TypeScript.', err))
  : Promise.resolve();

serveRpc<DspProtocol>(self as unknown as MessagePortLike, {
  loadSource: ({ sourceId, channels, sampleRate }) => (engine.loadSource(sourceId, { channels, sampleRate }), null),
  dropSource: ({ sourceId }) => (engine.dropSource(sourceId), null),
  renderWarp: ({ sourceId, job }) => engine.renderWarp(sourceId, job),
  analyze: ({ sourceId, sensitivity }) => engine.analyze(sourceId, sensitivity),
  info: () => engine.info,
}, ready);
