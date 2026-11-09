import { describe, expect, it } from 'vitest';
import { serveRpc, type Handlers, type MessagePortLike } from '../src/workers/rpc';
import { SupersededError, WorkerPool, type PooledWorker } from '../src/workers/worker-pool';

type TestProtocol = {
  set: { req: { value: number }; res: null };
  get: { req: null; res: { worker: number; value: number } };
  slow: { req: { ms: number; tag: string }; res: string };
  fail: { req: null; res: never };
};

/** Fake worker in the same thread: two connected ports, asynchronous messages like the real ones. */
class FakeWorker implements PooledWorker {
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  readonly inside: MessagePortLike;
  terminated = false;

  constructor(handlers: Handlers<TestProtocol>) {
    const self = this;
    this.inside = {
      onmessage: null,
      postMessage(message: unknown) {
        queueMicrotask(() => self.onmessage?.({ data: message } as MessageEvent));
      },
    };
    serveRpc<TestProtocol>(this.inside, handlers);
  }

  postMessage(message: unknown): void {
    queueMicrotask(() => this.inside.onmessage?.({ data: message } as MessageEvent));
  }

  terminate(): void {
    this.terminated = true;
  }
}

function makePool(size: number) {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool<TestProtocol>(() => {
    const n = workers.length;
    let value = 0;
    const w = new FakeWorker({
      set: ({ value: v }) => ((value = v), null),
      get: () => ({ worker: n, value }),
      slow: ({ ms, tag }) => new Promise(r => setTimeout(() => r(tag), ms)),
      fail: () => { throw new Error('broken'); },
    });
    workers.push(w);
    return w;
  }, size);
  return { pool, workers };
}

describe('WorkerPool', () => {
  it('splits the tasks among the free workers', async () => {
    const { pool } = makePool(3);
    const started = Date.now();
    const out = await Promise.all([1, 2, 3].map(i => pool.call('slow', { ms: 60, tag: `t${i}` })));
    expect(out).toEqual(['t1', 't2', 't3']);
    expect(Date.now() - started).toBeLessThan(150); // in parallel, not 180 ms in a row
  });

  it('queues the tasks beyond the number of workers', async () => {
    const { pool } = makePool(2);
    const out = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(tag => pool.call('slow', { ms: 5, tag })));
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('broadcast reaches all before the following tasks', async () => {
    const { pool } = makePool(3);
    void pool.call('slow', { ms: 20, tag: 'busy' });
    await pool.broadcast('set', { value: 42 });
    const res = await Promise.all([0, 1, 2].map(() => pool.call('get', null)));
    expect(res.map(r => r.value)).toEqual([42, 42, 42]);
    expect(new Set(res.map(r => r.worker)).size).toBe(3);
  });

  it('a task with the same key replaces the queued one and discards the running one', async () => {
    const { pool } = makePool(1);
    const running = pool.call('slow', { ms: 30, tag: 'first' }, { key: 'clip1' });
    const queued = pool.call('slow', { ms: 5, tag: 'second' }, { key: 'clip1' });
    const latest = pool.call('slow', { ms: 5, tag: 'third' }, { key: 'clip1' });
    await expect(running).rejects.toBeInstanceOf(SupersededError);
    await expect(queued).rejects.toBeInstanceOf(SupersededError);
    await expect(latest).resolves.toBe('third');
  });

  it('the worker\'s errors reach the caller and the pool keeps working', async () => {
    const { pool } = makePool(1);
    await expect(pool.call('fail', null)).rejects.toThrow('broken');
    await expect(pool.call('slow', { ms: 1, tag: 'ok' })).resolves.toBe('ok');
  });

  it('dispose closes the workers and rejects the tasks', async () => {
    const { pool, workers } = makePool(2);
    const pending = pool.call('slow', { ms: 50, tag: 'x' });
    pool.dispose();
    await expect(pending).rejects.toThrow('closed');
    await expect(pool.call('get', null)).rejects.toThrow('closed');
    expect(workers.every(w => w.terminated)).toBe(true);
  });
});
