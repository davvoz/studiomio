import { describe, expect, it } from 'vitest';
import { onsetEnvelope } from '../src/dsp/analysis/onset';
import { detectTransients } from '../src/dsp/analysis/transients';
import { mixMono } from '../src/dsp/signal';
import { ComplexStretcher } from '../src/dsp/stretch/phase-vocoder';
import type { SettingsOf } from '../src/dsp/stretch/stretcher';
import { WarpRenderer, defaultStretchers, type WarpJob } from '../src/dsp/stretch/warp-renderer';
import { WasmComplexStretcher } from '../src/dsp/wasm/wasm-stretchers';
import { drumLoop, maxAbsDiff, SR } from './helpers/signals';
// build per Node: `npm run wasm:test`
import { pv_stretch } from './wasm-pkg/studiomio_dsp.js';

const src = drumLoop(2, 120);
const mono = mixMono(src);
const transients = detectTransients(mono, onsetEnvelope(mono, SR), 0.5);

describe('WebAssembly: Complex coincide con la versione TypeScript', () => {
  it('trova dei transienti nel segnale di prova', () => {
    expect(transients.length).toBeGreaterThan(8);
  });

  const cases: [string, SettingsOf<'complex'>, number][] = [
    ['stereo, reset sui transienti', { mode: 'complex', fftSize: 4096, transients }, 0],
    ['stereo, senza reset, FFT 2048', { mode: 'complex', fftSize: 2048, transients: null }, 0],
    ['stereo, trasposto +7', { mode: 'complex', fftSize: 4096, transients }, 7],
  ];

  it.each(cases)('%s', (_, settings, transpose) => {
    const len = src[0].length;
    const job: WarpJob = {
      points: [[0, 0], [len * 0.4, len / 2], [len * 0.9, len]],
      outLength: Math.round(len * 0.9), transpose, settings,
    };
    const js = new WarpRenderer().render({ channels: src, sampleRate: SR }, job);
    const wasm = new WarpRenderer({ ...defaultStretchers(), complex: new WasmComplexStretcher(pv_stretch) })
      .render({ channels: src, sampleRate: SR }, job);
    // le funzioni matematiche di Rust e di V8 differiscono nell'ultima cifra
    expect(maxAbsDiff(js, wasm)).toBeLessThan(1e-4);
  });

  it('mono, rallentato', () => {
    const mono = { channels: [src[0]], sampleRate: SR };
    const len = src[0].length, outLength = Math.round(len * 1.3);
    const job: WarpJob = {
      points: [[0, 0], [outLength, len]], outLength, transpose: 0,
      settings: { mode: 'complex', fftSize: 4096, transients: null },
    };
    const js = new WarpRenderer({ ...defaultStretchers(), complex: new ComplexStretcher() }).render(mono, job);
    const wasm = new WarpRenderer({ ...defaultStretchers(), complex: new WasmComplexStretcher(pv_stretch) }).render(mono, job);
    expect(js).toHaveLength(1);
    expect(maxAbsDiff(js, wasm)).toBeLessThan(1e-4);
  });
});
