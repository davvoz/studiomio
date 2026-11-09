import { analyzeAudio, type AudioAnalysis } from './analysis/analyze';
import { trackBeats } from './analysis/beat-tracker';
import { onsetEnvelope } from './analysis/onset';
import { mixMono } from './signal';
import type { StretcherTable } from './stretch/stretcher';
import { WarpRenderer, defaultStretchers, type WarpJob } from './stretch/warp-renderer';
import type { AudioData } from './types';

/** A thread's DSP engine: keeps the loaded samples and processes them. It knows nothing of workers
 *  or messages, so it's used the same way in tests, in a worker or in the main thread. */
export class DspEngine {
  private readonly sources = new Map<string, AudioData>();
  private stretchers: StretcherTable;
  private renderer: WarpRenderer;
  private implementations: Record<keyof StretcherTable, string>;

  constructor(stretchers: StretcherTable = defaultStretchers()) {
    this.stretchers = stretchers;
    this.renderer = new WarpRenderer(stretchers);
    this.implementations = Object.fromEntries(Object.keys(stretchers).map(m => [m, 'js'])) as Record<keyof StretcherTable, string>;
  }

  /** Replaces some algorithms (e.g. with the WebAssembly versions). */
  override(stretchers: Partial<StretcherTable>, implementation: string): void {
    this.stretchers = { ...this.stretchers, ...stretchers };
    this.renderer = new WarpRenderer(this.stretchers);
    for (const mode of Object.keys(stretchers) as (keyof StretcherTable)[]) this.implementations[mode] = implementation;
  }

  /** Which implementation each warp mode uses. */
  get info(): Readonly<Record<keyof StretcherTable, string>> {
    return { ...this.implementations };
  }

  loadSource(id: string, audio: AudioData): void {
    this.sources.set(id, audio);
  }

  dropSource(id: string): void {
    this.sources.delete(id);
  }

  renderWarp(sourceId: string, job: WarpJob): Float32Array[] {
    return this.renderer.render(this.source(sourceId), job);
  }

  analyze(sourceId: string, sensitivity: number): AudioAnalysis {
    return analyzeAudio(this.source(sourceId), sensitivity);
  }

  /** Beat positions (in samples) following the tempo `bpm` (beat tracking). */
  trackBeats(sourceId: string, bpm: number): number[] {
    const { channels, sampleRate } = this.source(sourceId);
    return trackBeats(onsetEnvelope(mixMono(channels), sampleRate), bpm);
  }

  private source(id: string): AudioData {
    const s = this.sources.get(id);
    if (!s) throw new Error(`sample "${id}" not loaded`);
    return s;
  }
}
