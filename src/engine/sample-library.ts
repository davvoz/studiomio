import type { SampleId } from '../core/id';
import type { WarpJob } from '../dsp/stretch/warp-renderer';
import type { AudioData } from '../dsp/types';

/** La parte del DSP che serve ai sample e ai render (DspService la soddisfa). */
export interface DspBackend {
  loadSource(sourceId: string, audio: AudioData): Promise<void>;
  dropSource(sourceId: string): Promise<void>;
  renderWarp(sourceId: string, job: WarpJob, key?: string): Promise<Float32Array[]>;
}

/** Audio decodificato dei sample del progetto, caricato anche nei worker DSP. */
export class SampleLibrary {
  private readonly audio = new Map<SampleId, AudioData>();

  constructor(private readonly dsp: DspBackend) {}

  has(id: SampleId): boolean {
    return this.audio.has(id);
  }

  get(id: SampleId): AudioData | undefined {
    return this.audio.get(id);
  }

  async add(id: SampleId, data: AudioData): Promise<void> {
    await this.dsp.loadSource(id, data);
    this.audio.set(id, data);
  }

  async remove(id: SampleId): Promise<void> {
    this.audio.delete(id);
    await this.dsp.dropSource(id);
  }

  /** Render di warp di un sample caricato. */
  render(id: SampleId, job: WarpJob, supersedeKey?: string): Promise<Float32Array[]> {
    if (!this.audio.has(id)) return Promise.reject(new Error(`sample ${id} non caricato`));
    return this.dsp.renderWarp(id, job, supersedeKey);
  }
}
