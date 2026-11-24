import { describe, expect, it } from 'vitest';
import { atMost, oneAtATime } from '../../src/core/async';

const pause = () => new Promise<void>(resolve => { setTimeout(resolve, 1); });

describe('jobs in order', () => {
  it('one at a time: each starts when the one before has finished, the first right away', async () => {
    const log: string[] = [];
    const all = oneAtATime(['a', 'b', 'c'], async (x, i) => {
      log.push(`${x}${i} starts`);
      await pause();
      log.push(`${x}${i} ends`);
    });
    expect(log).toEqual(['a0 starts']);
    await all;
    expect(log).toEqual(['a0 starts', 'a0 ends', 'b1 starts', 'b1 ends', 'c2 starts', 'c2 ends']);
  });

  it('after an error the next ones don\'t start', async () => {
    const started: number[] = [];
    await expect(oneAtATime([1, 2, 3], async n => {
      started.push(n);
      if (n === 2) throw new Error('two');
    })).rejects.toThrow('two');
    expect(started).toEqual([1, 2]);
  });

  it('never more than the limit together, all done', async () => {
    let running = 0, most = 0;
    const done: number[] = [];
    await atMost(4, Array.from({ length: 11 }, (_, i) => i), async i => {
      most = Math.max(most, ++running);
      await pause();
      running--;
      done.push(i);
    });
    expect(most).toBe(4);
    expect(done.toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('an error waits for those running and starts no others', async () => {
    const started: number[] = [], ended: number[] = [];
    await expect(atMost(2, [0, 1, 2, 3], async i => {
      started.push(i);
      if (i === 0) throw new Error('zero');
      await pause();
      ended.push(i);
    })).rejects.toThrow('zero');
    expect(started).toEqual([0, 1]);
    expect(ended).toEqual([1]);
  });

  it('nothing to do, and very many things', async () => {
    await oneAtATime([], async () => { throw new Error('never'); });
    let count = 0;
    await oneAtATime(Array.from({ length: 50_000 }), async () => { count++; });
    expect(count).toBe(50_000);
  });
});
