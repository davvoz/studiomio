import {
  type Command, type CommandMap, type MessagePortLike, type RequestOf, type ResultOf, type RpcResponse,
} from './rpc';

export interface PooledWorker extends MessagePortLike {
  terminate(): void;
}

export type WorkerFactory = () => PooledWorker;

/** Rifiuto di un compito sostituito da uno più recente con la stessa chiave. */
export class SupersededError extends Error {
  constructor(key: string) {
    super(`compito "${key}" sostituito da uno più recente`);
    this.name = 'SupersededError';
  }
}

export interface CallOptions {
  /** Compiti con la stessa chiave si sostituiscono: conta solo l'ultimo. */
  readonly key?: string;
  /** Buffer da trasferire invece di copiare: diventano inutilizzabili per il chiamante. */
  readonly transfer?: Transferable[];
}

interface Task {
  readonly command: string;
  readonly payload: unknown;
  readonly transfer: Transferable[];
  readonly key: string | undefined;
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: unknown) => void;
  stale: boolean;
}

interface Slot {
  readonly worker: PooledWorker;
  /** Compito in corso (al massimo uno: il worker elabora una richiesta per volta). */
  task: Task | null;
}

/** Un gruppo di worker che si dividono i compiti di un protocollo RPC.
 *  - `call`: un compito va al primo worker libero, gli altri aspettano in coda;
 *  - `broadcast`: un messaggio arriva a tutti i worker (es. caricare un sample). Ogni
 *    worker elabora i messaggi in ordine, quindi i compiti successivi lo trovano già fatto. */
export class WorkerPool<C extends CommandMap> {
  private readonly slots: Slot[];
  private readonly queue: Task[] = [];
  private readonly pending = new Map<number, { slot: Slot | null; settle: (r: RpcResponse) => void }>();
  private nextId = 1;
  private disposed = false;

  constructor(factory: WorkerFactory, size: number) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => {
      const slot: Slot = { worker: factory(), task: null };
      slot.worker.onmessage = ev => this.onResponse(ev.data as RpcResponse);
      return slot;
    });
  }

  get size(): number {
    return this.slots.length;
  }

  call<K extends Command<C>>(command: K, payload: RequestOf<C, K>, opts: CallOptions = {}): Promise<ResultOf<C, K>> {
    if (this.disposed) return Promise.reject(new Error('WorkerPool chiuso'));
    return new Promise<ResultOf<C, K>>((resolve, reject) => {
      if (opts.key !== undefined) this.supersede(opts.key);
      this.queue.push({
        command, payload, key: opts.key, stale: false,
        transfer: opts.transfer ?? [],
        resolve: resolve as (v: unknown) => void, reject,
      });
      this.pump();
    });
  }

  broadcast<K extends Command<C>>(command: K, payload: RequestOf<C, K>): Promise<ResultOf<C, K>[]> {
    if (this.disposed) return Promise.reject(new Error('WorkerPool chiuso'));
    return Promise.all(this.slots.map(slot => new Promise<ResultOf<C, K>>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { slot: null, settle: r => (r.ok ? resolve(r.result as ResultOf<C, K>) : reject(new Error(r.error))) });
      // niente transfer: lo stesso payload va a tutti (con SharedArrayBuffer è condiviso, non copiato)
      slot.worker.postMessage({ id, command, payload });
    })));
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.slots) s.worker.terminate();
    const err = new Error('WorkerPool chiuso');
    for (const t of this.queue.splice(0)) t.reject(err);
    for (const s of this.slots) s.task?.reject(err);
    this.pending.clear();
  }

  private supersede(key: string): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].key === key) this.queue.splice(i, 1)[0].reject(new SupersededError(key));
    }
    for (const s of this.slots) {
      if (s.task?.key === key && !s.task.stale) {
        // non si può interrompere un calcolo in corso: il risultato verrà scartato
        s.task.stale = true;
        s.task.reject(new SupersededError(key));
      }
    }
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.task || this.queue.length === 0) continue;
      const task = this.queue.shift()!;
      const id = this.nextId++;
      slot.task = task;
      this.pending.set(id, {
        slot,
        settle: r => {
          if (task.stale) return;
          if (r.ok) task.resolve(r.result); else task.reject(new Error(r.error));
        },
      });
      slot.worker.postMessage({ id, command: task.command, payload: task.payload }, task.transfer);
    }
  }

  private onResponse(r: RpcResponse): void {
    const p = this.pending.get(r.id);
    if (!p) return;
    this.pending.delete(r.id);
    if (p.slot) p.slot.task = null;
    p.settle(r);
    this.pump();
  }
}
