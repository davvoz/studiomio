import { analyzeAudio, type AudioAnalysis } from './analysis/analyze';
import type { StretcherTable } from './stretch/stretcher';
import { WarpRenderer, defaultStretchers, type WarpJob } from './stretch/warp-renderer';
import type { AudioData } from './types';

/** Motore DSP di un thread: tiene i sample caricati e li elabora. Non sa nulla di worker
 *  o messaggi, così si usa uguale nei test, in un worker o nel thread principale. */
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

  /** Sostituisce alcuni algoritmi (es. con le versioni WebAssembly). */
  override(stretchers: Partial<StretcherTable>, implementation: string): void {
    this.stretchers = { ...this.stretchers, ...stretchers };
    this.renderer = new WarpRenderer(this.stretchers);
    for (const mode of Object.keys(stretchers) as (keyof StretcherTable)[]) this.implementations[mode] = implementation;
  }

  /** Quale implementazione usa ogni modalità di warp. */
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

  private source(id: string): AudioData {
    const s = this.sources.get(id);
    if (!s) throw new Error(`sample "${id}" non caricato`);
    return s;
  }
}
