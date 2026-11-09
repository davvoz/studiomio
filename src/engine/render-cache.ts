import type { SampleId } from '../core/id';
import type { WarpJob } from '../dsp/stretch/warp-renderer';

export type RenderFn = (sampleId: SampleId, job: WarpJob, supersedeKey?: string) => Promise<Float32Array[]>;

/** Key of a render: two clips with the same sample and the same warp share the result. */
export const renderKey = (sampleId: SampleId, job: WarpJob): string => `${sampleId}|${JSON.stringify(job)}`;

const bytesOf = (channels: readonly Float32Array[]) => channels.reduce((s, c) => s + c.byteLength, 0);

/** Warp renders already computed, by job content. Equal requests in progress are
 *  merged; beyond the memory budget the least recently used renders are discarded. */
export class RenderCache {
  /** In order of use: the last is the most recent. */
  private readonly done = new Map<string, Float32Array[]>();
  private readonly pending = new Map<string, Promise<Float32Array[]>>();
  private bytes = 0;

  constructor(private readonly render: RenderFn, private readonly budgetBytes = 768 * 1024 * 1024) {}

  get size(): number {
    return this.done.size;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  /** The render, if it's ready. */
  get(key: string): Float32Array[] | undefined {
    const v = this.done.get(key);
    if (v) {
      this.done.delete(key);
      this.done.set(key, v);
    }
    return v;
  }

  /** The render ready or on its way. `supersedeKey` (e.g. the clip's id): a new request
   *  with the same key makes the old one useless, and it's no longer awaited. */
  ensure(key: string, sampleId: SampleId, job: WarpJob, supersedeKey?: string): Promise<Float32Array[]> {
    const ready = this.get(key);
    if (ready) return Promise.resolve(ready);
    let p = this.pending.get(key);
    if (!p) {
      p = this.render(sampleId, job, supersedeKey).then(
        channels => {
          this.pending.delete(key);
          this.store(key, channels);
          return channels;
        },
        err => {
          this.pending.delete(key);
          throw err;
        },
      );
      this.pending.set(key, p);
    }
    return p;
  }

  clear(): void {
    this.done.clear();
    this.bytes = 0;
  }

  private store(key: string, channels: Float32Array[]): void {
    this.done.set(key, channels);
    this.bytes += bytesOf(channels);
    for (const [k, v] of this.done) {
      if (this.bytes <= this.budgetBytes || k === key) break;
      this.done.delete(k);
      this.bytes -= bytesOf(v);
    }
  }
}
