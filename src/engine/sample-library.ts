import type { SampleId } from '../core/id';
import type { WarpJob } from '../dsp/stretch/warp-renderer';
import type { AudioData } from '../dsp/types';

/** The part of the DSP needed by the samples and the renders (DspService satisfies it). */
export interface DspBackend {
  loadSource(sourceId: string, audio: AudioData): Promise<void>;
  dropSource(sourceId: string): Promise<void>;
  renderWarp(sourceId: string, job: WarpJob, key?: string): Promise<Float32Array[]>;
}

/** Decoded audio of the project's samples, also loaded in the DSP workers. */
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

  /** Warp render of a loaded sample. */
  render(id: SampleId, job: WarpJob, supersedeKey?: string): Promise<Float32Array[]> {
    if (!this.audio.has(id)) return Promise.reject(new Error(`sample ${id} not loaded`));
    return this.dsp.renderWarp(id, job, supersedeKey);
  }
}
