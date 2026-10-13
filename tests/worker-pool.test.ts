import { describe, expect, it } from 'vitest';
import { serveRpc, type Handlers, type MessagePortLike } from '../src/workers/rpc';
import { SupersededError, WorkerPool, type PooledWorker } from '../src/workers/worker-pool';

type TestProtocol = {
  set: { req: { value: number }; res: null };
  get: { req: null; res: { worker: number; value: number } };
  slow: { req: { ms: number; tag: string }; res: string };
  fail: { req: null; res: never };
};

/** Worker finto nello stesso thread: due porte collegate, messaggi asincroni come quelli veri. */
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
      fail: () => { throw new Error('rotto'); },
    });
    workers.push(w);
    return w;
  }, size);
  return { pool, workers };
}

describe('WorkerPool', () => {
  it('divide i compiti tra i worker liberi', async () => {
    const { pool } = makePool(3);
    const started = Date.now();
    const out = await Promise.all([1, 2, 3].map(i => pool.call('slow', { ms: 60, tag: `t${i}` })));
    expect(out).toEqual(['t1', 't2', 't3']);
    expect(Date.now() - started).toBeLessThan(150); // in parallelo, non 180 ms in fila
  });

  it('mette in coda i compiti oltre il numero di worker', async () => {
    const { pool } = makePool(2);
    const out = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(tag => pool.call('slow', { ms: 5, tag })));
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('broadcast arriva a tutti prima dei compiti successivi', async () => {
    const { pool } = makePool(3);
    void pool.call('slow', { ms: 20, tag: 'occupato' });
    await pool.broadcast('set', { value: 42 });
    const res = await Promise.all([0, 1, 2].map(() => pool.call('get', null)));
    expect(res.map(r => r.value)).toEqual([42, 42, 42]);
    expect(new Set(res.map(r => r.worker)).size).toBe(3);
  });

  it('un compito con la stessa chiave sostituisce quello in coda e scarta quello in corso', async () => {
    const { pool } = makePool(1);
    const running = pool.call('slow', { ms: 30, tag: 'primo' }, { key: 'clip1' });
    const queued = pool.call('slow', { ms: 5, tag: 'secondo' }, { key: 'clip1' });
    const latest = pool.call('slow', { ms: 5, tag: 'terzo' }, { key: 'clip1' });
    await expect(running).rejects.toBeInstanceOf(SupersededError);
    await expect(queued).rejects.toBeInstanceOf(SupersededError);
    await expect(latest).resolves.toBe('terzo');
  });

  it('gli errori del worker arrivano al chiamante e il pool continua a funzionare', async () => {
    const { pool } = makePool(1);
    await expect(pool.call('fail', null)).rejects.toThrow('rotto');
    await expect(pool.call('slow', { ms: 1, tag: 'ok' })).resolves.toBe('ok');
  });

  it('dispose chiude i worker e rifiuta i compiti', async () => {
    const { pool, workers } = makePool(2);
    const pending = pool.call('slow', { ms: 50, tag: 'x' });
    pool.dispose();
    await expect(pending).rejects.toThrow('chiuso');
    await expect(pool.call('get', null)).rejects.toThrow('chiuso');
    expect(workers.every(w => w.terminated)).toBe(true);
  });
});
