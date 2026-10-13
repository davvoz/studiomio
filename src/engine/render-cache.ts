import type { SampleId } from '../core/id';
import type { WarpJob } from '../dsp/stretch/warp-renderer';

export type RenderFn = (sampleId: SampleId, job: WarpJob, supersedeKey?: string) => Promise<Float32Array[]>;

/** Chiave di un render: due clip con lo stesso sample e lo stesso warp condividono il risultato. */
export const renderKey = (sampleId: SampleId, job: WarpJob): string => `${sampleId}|${JSON.stringify(job)}`;

const bytesOf = (channels: readonly Float32Array[]) => channels.reduce((s, c) => s + c.byteLength, 0);

/** Render di warp già calcolati, per contenuto del lavoro. Le richieste uguali in corso si
 *  uniscono; oltre il budget di memoria si scartano i render usati meno di recente. */
export class RenderCache {
  /** In ordine di uso: l'ultimo è il più recente. */
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

  /** Il render, se è pronto. */
  get(key: string): Float32Array[] | undefined {
    const v = this.done.get(key);
    if (v) {
      this.done.delete(key);
      this.done.set(key, v);
    }
    return v;
  }

  /** Il render pronto o in arrivo. `supersedeKey` (es. l'id della clip): una richiesta nuova
   *  con la stessa chiave rende inutile quella vecchia, che non viene più attesa. */
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
