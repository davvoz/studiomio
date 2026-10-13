import { describe, expect, it, vi } from 'vitest';
import { asId } from '../../src/core/id';
import type { WarpJob } from '../../src/dsp/stretch/warp-renderer';
import { RenderCache, renderKey } from '../../src/engine/render-cache';

const job = (outLength: number): WarpJob => ({ points: [[0, 0], [outLength, 100]], outLength, transpose: 0, settings: { mode: 'repitch' } });
const sid = asId<'sample'>('sample-1');

describe('RenderCache', () => {
  it('le richieste uguali in corso si uniscono, poi il risultato è pronto', async () => {
    const render = vi.fn(async (_s, j: WarpJob) => [new Float32Array(j.outLength)]);
    const cache = new RenderCache(render);
    const k = renderKey(sid, job(10));
    const [a, b] = await Promise.all([cache.ensure(k, sid, job(10)), cache.ensure(k, sid, job(10))]);
    expect(a).toBe(b);
    expect(render).toHaveBeenCalledTimes(1);
    expect(cache.get(k)).toBe(a);
  });

  it('oltre il budget scarta i render usati meno di recente', async () => {
    const cache = new RenderCache(async (_s, j) => [new Float32Array(j.outLength)], 1300); // ci stanno tre render da ~400 byte, non quattro
    const keys = [100, 101, 102].map(n => renderKey(sid, job(n)));
    for (const [i, n] of [100, 101, 102].entries()) await cache.ensure(keys[i], sid, job(n));
    cache.get(keys[0]); // il primo torna il più recente
    await cache.ensure(renderKey(sid, job(103)), sid, job(103));
    expect(cache.get(keys[0])).toBeDefined();
    expect(cache.get(keys[1])).toBeUndefined();
    expect(cache.usedBytes).toBeLessThanOrEqual(1300);
  });

  it('un errore non resta in cache', async () => {
    let fail = true;
    const cache = new RenderCache(async () => { if (fail) throw new Error('no'); return [new Float32Array(1)]; });
    const k = renderKey(sid, job(1));
    await expect(cache.ensure(k, sid, job(1))).rejects.toThrow('no');
    fail = false;
    await expect(cache.ensure(k, sid, job(1))).resolves.toHaveLength(1);
  });

  it('la chiave dipende da tutto il lavoro', () => {
    expect(renderKey(sid, job(1))).not.toBe(renderKey(sid, { ...job(1), transpose: 1 }));
    expect(renderKey(sid, job(1))).toBe(renderKey(sid, job(1)));
  });
});
