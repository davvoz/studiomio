import { describe, expect, it } from 'vitest';
import { dragLoop, loopPartAt } from '../../src/ui/loop-drag';

const loop = { start: 4, end: 8 };
const x = (b: number) => b * 20; // 20 px per beat

describe('dragging the loop (like Ableton)', () => {
  it('recognizes edges, body and outside', () => {
    expect(loopPartAt(loop, 82, x)).toBe('start');
    expect(loopPartAt(loop, 157, x)).toBe('end');
    expect(loopPartAt(loop, 120, x)).toBe('body');
    expect(loopPartAt(loop, 20, x)).toBe('outside');
    expect(loopPartAt(loop, 200, x)).toBe('outside');
    // very narrow loop: the edge on the pointer's side wins
    const tiny = { start: 4, end: 4.25 };
    expect(loopPartAt(tiny, 80, x)).toBe('start');
    expect(loopPartAt(tiny, 85, x)).toBe('end');
  });

  it('from the left edge the end stays still, from the right the start', () => {
    expect(dragLoop('start', loop, 4, 6)).toEqual({ start: 6, end: 8 });
    expect(dragLoop('start', loop, 4, 2)).toEqual({ start: 2, end: 8 });
    expect(dragLoop('end', loop, 8, 6)).toEqual({ start: 4, end: 6 });
    expect(dragLoop('end', loop, 8, 12)).toEqual({ start: 4, end: 12 });
    // beyond the other end: that one stays still and the loop flips
    expect(dragLoop('start', loop, 4, 10)).toEqual({ start: 8, end: 10 });
    expect(dragLoop('end', loop, 8, 4)).toBeNull();
  });

  it('from the body it all moves, without going below the minimum', () => {
    expect(dragLoop('body', loop, 5, 7)).toEqual({ start: 6, end: 10 });
    expect(dragLoop('body', loop, 5, 0, 0)).toEqual({ start: 0, end: 4 });
  });

  it('outside a new one is drawn in both directions', () => {
    expect(dragLoop('outside', loop, 12, 16)).toEqual({ start: 12, end: 16 });
    expect(dragLoop('outside', loop, 2, 0)).toEqual({ start: 0, end: 2 });
  });
});
