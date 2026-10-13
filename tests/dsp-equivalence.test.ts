import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackBeats } from '../src/dsp/analysis/beat-tracker';
import { onsetEnvelope } from '../src/dsp/analysis/onset';
import { estimateTempo } from '../src/dsp/analysis/tempo';
import { detectTransients } from '../src/dsp/analysis/transients';
import { encodeWav } from '../src/dsp/codec/wav';
import { makeZip } from '../src/dsp/codec/zip';
import { mixMono } from '../src/dsp/signal';
import type { StretchSettings } from '../src/dsp/stretch/stretcher';
import { WarpRenderer, type WarpJob } from '../src/dsp/stretch/warp-renderer';
import type { MapPoint } from '../src/dsp/time-map';
import { loadLegacyDsp, type LegacyDsp } from './helpers/legacy';
import { drumLoop, maxAbsDiff, SR } from './helpers/signals';

// Calcolati subito: servono già quando vitest raccoglie i casi di test.
const legacy: LegacyDsp = loadLegacyDsp();
const src = drumLoop(1, 120);
const transients = detectTransients(mixMono(src), onsetEnvelope(mixMono(src), SR), 0.5);

/** Warp da 120 a 128 BPM con un marker spostato a metà: un caso non banale. */
function warpPoints(len: number): MapPoint[] {
  const ratio = 120 / 128, mid = len / 2;
  return [[0, 0], [mid * ratio * 1.05, mid], [len * ratio, len]];
}

/** Lo stesso lavoro nel formato del vecchio WarpMio. */
function legacyJob(job: WarpJob): unknown {
  const s = job.settings;
  const opts: Record<string, unknown> = {};
  if (s.mode === 'beats') Object.assign(opts, { slices: s.slices, loopMode: s.loopMode, envelope: s.envelope });
  if (s.mode === 'tones') Object.assign(opts, { grainMs: s.grainMs });
  if (s.mode === 'texture') Object.assign(opts, { grainMs: s.grainMs, flux: s.flux });
  if (s.mode === 'complex') Object.assign(opts, { pvFft: s.fftSize, pvTransients: s.transients !== null });
  return {
    mode: s.mode, points: job.points.map(p => [...p]), outLen: job.outLength, transpose: job.transpose,
    transients: s.mode === 'complex' && s.transients ? [...s.transients] : [], opts,
  };
}

const cases = (): [string, StretchSettings][] => [
  ['repitch', { mode: 'repitch' }],
  ['beats, loop off', { mode: 'beats', slices: transients, loopMode: 'off', envelope: 100 }],
  ['beats, loop forward, envelope 60', { mode: 'beats', slices: transients, loopMode: 'forward', envelope: 60 }],
  ['beats, loop pingpong', { mode: 'beats', slices: transients, loopMode: 'pingpong', envelope: 100 }],
  ['tones', { mode: 'tones', grainMs: 50 }],
  ['texture', { mode: 'texture', grainMs: 80, flux: 0.2 }],
  ['complex, reset sui transienti', { mode: 'complex', fftSize: 4096, transients }],
  ['complex, senza reset', { mode: 'complex', fftSize: 2048, transients: null }],
];

describe('warp: TypeScript uguale al WarpMio originale', () => {
  for (const transpose of [0, 3, -5.25]) {
    it.each(cases())(`%s (transpose ${transpose})`, (_, settings) => {
      const points = warpPoints(src[0].length);
      const job: WarpJob = { points, outLength: Math.round(points[points.length - 1][0]), transpose, settings };
      const ours = new WarpRenderer().render({ channels: src, sampleRate: SR }, job);
      const ref = legacy.render(src, SR, legacyJob(job));
      expect(ours.length).toBe(ref.length);
      expect(ours[0].length).toBe(ref[0].length);
      // Complex usa una formula equivalente ma più veloce (rotazione col fasore invece di
      // atan2/sin/cos): differisce solo per errori di arrotondamento. Le altre sono identiche.
      if (settings.mode === 'complex') expect(maxAbsDiff(ours, ref)).toBeLessThan(1e-5);
      else expect(maxAbsDiff(ours, ref)).toBe(0);
    });
  }
});

describe('analisi: TypeScript identico al WarpMio originale', () => {
  it('onset, transienti, tempo e beat tracking', () => {
    const loop = drumLoop(4, 97);
    const mono = mixMono(loop);
    const ours = onsetEnvelope(mono, SR);
    const ref = legacy.onsetEnvelope(mono, SR);
    expect(ours.flux).toEqual(ref.flux);
    for (const sens of [0.2, 0.5, 0.9]) {
      expect(detectTransients(mono, ours, sens)).toEqual(legacy.detectTransients(mono, ref, sens));
    }
    const tempo = estimateTempo(ours, mono.length / SR);
    expect(tempo).toBe(legacy.estimateTempo(ref, mono.length / SR));
    expect(tempo).toBeCloseTo(97, 0);
    expect(trackBeats(ours, tempo)).toEqual(legacy.trackBeats(ref, tempo));
  });
});

describe('file: TypeScript identico al WarpMio originale', () => {
  afterEach(() => vi.useRealTimers());

  it.each([16, 24, 32] as const)('WAV a %i bit', bits => {
    const loud = src.map(c => c.map(v => v * 1.7)); // anche campioni oltre ±1
    expect(new Uint8Array(encodeWav(loud, SR, bits))).toEqual(new Uint8Array(legacy.encodeWav(loud, SR, bits)));
  });

  it('ZIP', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 10, 30, 12));
    const files = [
      { name: 'uno.wav', data: new Uint8Array(encodeWav(src, SR, 16)) },
      { name: 'àèì.txt', data: new TextEncoder().encode('ciao') },
    ];
    expect(makeZip(files)).toEqual(legacy.makeZip(files));
  });
});
