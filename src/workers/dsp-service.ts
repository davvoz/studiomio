import type { AudioAnalysis } from '../dsp/analysis/analyze';
import type { WarpJob } from '../dsp/stretch/warp-renderer';
import type { AudioData } from '../dsp/types';
import type { DspProtocol } from './dsp-protocol';
import { WorkerPool, type WorkerFactory } from './worker-pool';

/** Copia i canali in memoria condivisa, se la pagina lo permette (cross-origin isolated):
 *  così tutti i worker leggono lo stesso sample senza duplicarlo. */
export function toSharedChannels(channels: readonly Float32Array[]): Float32Array[] {
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) return channels.map(c => c.slice());
  return channels.map(c => {
    const shared = new Float32Array(new SharedArrayBuffer(c.byteLength));
    shared.set(c);
    return shared;
  });
}

const browserWorker: WorkerFactory = () =>
  new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module', name: 'dsp' });

/** Facciata del DSP per il resto dell'app: tutto il lavoro pesante gira nei worker. */
export class DspService {
  private readonly pool: WorkerPool<DspProtocol>;

  constructor(factory: WorkerFactory = browserWorker, size = DspService.defaultSize()) {
    this.pool = new WorkerPool<DspProtocol>(factory, size);
  }

  /** Un worker per core, lasciandone uno all'interfaccia e all'audio (al massimo 8). */
  static defaultSize(): number {
    const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
    return Math.max(1, Math.min(8, cores - 1));
  }

  get workers(): number {
    return this.pool.size;
  }

  async loadSource(sourceId: string, audio: AudioData): Promise<void> {
    await this.pool.broadcast('loadSource', { sourceId, channels: toSharedChannels(audio.channels), sampleRate: audio.sampleRate });
  }

  async dropSource(sourceId: string): Promise<void> {
    await this.pool.broadcast('dropSource', { sourceId });
  }

  /** `key` identifica chi chiede il render (es. l'id della clip): una nuova richiesta con la
   *  stessa chiave sostituisce quella vecchia, che viene rifiutata con SupersededError. */
  renderWarp(sourceId: string, job: WarpJob, key?: string): Promise<Float32Array[]> {
    return this.pool.call('renderWarp', { sourceId, job }, { key });
  }

  analyze(sourceId: string, sensitivity = 0.5): Promise<AudioAnalysis> {
    return this.pool.call('analyze', { sourceId, sensitivity });
  }

  /** Battiti (in campioni) trovati seguendo il tempo `bpm`. */
  trackBeats(sourceId: string, bpm: number): Promise<number[]> {
    return this.pool.call('trackBeats', { sourceId, bpm });
  }

  info(): Promise<DspProtocol['info']['res']> {
    return this.pool.call('info', null);
  }

  dispose(): void {
    this.pool.dispose();
  }
}
