import { it } from 'vitest';
import { onsetEnvelope } from '../src/dsp/analysis/onset';
import { detectTransients } from '../src/dsp/analysis/transients';
import { mixMono } from '../src/dsp/signal';
import type { StretchSettings } from '../src/dsp/stretch/stretcher';
import { WarpRenderer, defaultStretchers, type WarpJob } from '../src/dsp/stretch/warp-renderer';
import { WasmComplexStretcher } from '../src/dsp/wasm/wasm-stretchers';
import { drumLoop, SR } from './helpers/signals';
import { pv_stretch } from './wasm-pkg/studiomio_dsp.js';

// 8 battute a 120 BPM (16 s stereo) portate a 128 BPM
const src = drumLoop(8, 120);
const len = src[0].length, seconds = len / SR;
const audio = { channels: src, sampleRate: SR };
const transients = detectTransients(mixMono(src), onsetEnvelope(mixMono(src), SR), 0.5);
const job = (settings: StretchSettings): WarpJob => ({
  points: [[0, 0], [(len * 120) / 128, len]], outLength: Math.round((len * 120) / 128), transpose: 0, settings,
});

/** Mediana dei tempi di `runs` esecuzioni, dopo un giro di riscaldamento. */
function time(fn: () => void, runs = 5): number {
  fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  return t.sort((a, b) => a - b)[runs >> 1];
}

it('benchmark DSP', () => {
  const js = new WarpRenderer();
  const wasm = new WarpRenderer({ ...defaultStretchers(), complex: new WasmComplexStretcher(pv_stretch) });
  const complex = job({ mode: 'complex', fftSize: 4096, transients });
  const rows: [string, number][] = [
    ['complex · TypeScript', time(() => js.render(audio, complex))],
    ['complex · WebAssembly', time(() => wasm.render(audio, complex))],
    ['beats · TypeScript', time(() => js.render(audio, job({ mode: 'beats', slices: transients, loopMode: 'forward', envelope: 100 })))],
    ['tones · TypeScript', time(() => js.render(audio, job({ mode: 'tones', grainMs: 50 })))],
    ['texture · TypeScript', time(() => js.render(audio, job({ mode: 'texture', grainMs: 80, flux: 0.2 })))],
    ['repitch · TypeScript', time(() => js.render(audio, job({ mode: 'repitch' })))],
    ['analisi · TypeScript', time(() => { const m = mixMono(src); detectTransients(m, onsetEnvelope(m, SR), 0.5); })],
  ];
  console.log(`\nAudio di prova: ${seconds.toFixed(1)} s stereo a ${SR} Hz (mediana di 5 esecuzioni)\n`);
  console.table(Object.fromEntries(rows.map(([name, ms]) => [name, {
    ms: Math.round(ms), 'x tempo reale': Math.round((seconds * 1000) / ms),
  }])));
  const [, tsMs] = rows[0], [, wasmMs] = rows[1];
  console.log(`WebAssembly è ${(tsMs / wasmMs).toFixed(2)}x rispetto a TypeScript sulla modalità Complex\n`);
}, 300_000);
