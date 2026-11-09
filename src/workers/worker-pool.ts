import {
  type Command, type CommandMap, type MessagePortLike, type RequestOf, type ResultOf, type RpcResponse,
} from './rpc';

export interface PooledWorker extends MessagePortLike {
  terminate(): void;
}

export type WorkerFactory = () => PooledWorker;

/** Rejection of a task replaced by a more recent one with the same key. */
export class SupersededError extends Error {
  constructor(key: string) {
    super(`task "${key}" replaced by a more recent one`);
    this.name = 'SupersededError';
  }
}

export interface CallOptions {
  /** Tasks with the same key replace each other: only the last counts. */
  readonly key?: string;
  /** Buffers to transfer instead of copy: they become unusable for the caller. */
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
  /** Task in progress (at most one: the worker processes one request at a time). */
  task: Task | null;
}

/** A group of workers sharing the tasks of an RPC protocol.
 *  - `call`: a task goes to the first free worker, the others wait in the queue;
 *  - `broadcast`: a message reaches all the workers (e.g. loading a sample). Each
 *    worker processes the messages in order, so the following tasks find it already done. */
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
    if (this.disposed) return Promise.reject(new Error('WorkerPool closed'));
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
    if (this.disposed) return Promise.reject(new Error('WorkerPool closed'));
    return Promise.all(this.slots.map(slot => new Promise<ResultOf<C, K>>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { slot: null, settle: r => (r.ok ? resolve(r.result as ResultOf<C, K>) : reject(new Error(r.error))) });
      // no transfer: the same payload goes to all (with SharedArrayBuffer it's shared, not copied)
      slot.worker.postMessage({ id, command, payload });
    })));
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.slots) s.worker.terminate();
    const err = new Error('WorkerPool closed');
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
        // a computation in progress can't be interrupted: the result will be discarded
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
