import { describe, expect, it } from 'vitest';
import { dragLoop, loopPartAt } from '../../src/ui/loop-drag';

const loop = { start: 4, end: 8 };
const x = (b: number) => b * 20; // 20 px per battito

describe('trascinamento del loop (come Ableton)', () => {
  it('riconosce bordi, corpo e fuori', () => {
    expect(loopPartAt(loop, 82, x)).toBe('start');
    expect(loopPartAt(loop, 157, x)).toBe('end');
    expect(loopPartAt(loop, 120, x)).toBe('body');
    expect(loopPartAt(loop, 20, x)).toBe('outside');
    expect(loopPartAt(loop, 200, x)).toBe('outside');
    // loop strettissimo: vince il bordo dalla parte del puntatore
    const tiny = { start: 4, end: 4.25 };
    expect(loopPartAt(tiny, 80, x)).toBe('start');
    expect(loopPartAt(tiny, 85, x)).toBe('end');
  });

  it('dal bordo sinistro la fine resta ferma, dal destro l\'inizio', () => {
    expect(dragLoop('start', loop, 4, 6)).toEqual({ start: 6, end: 8 });
    expect(dragLoop('start', loop, 4, 2)).toEqual({ start: 2, end: 8 });
    expect(dragLoop('end', loop, 8, 6)).toEqual({ start: 4, end: 6 });
    expect(dragLoop('end', loop, 8, 12)).toEqual({ start: 4, end: 12 });
    // oltre l'altro estremo: quello resta fermo e il loop si ribalta
    expect(dragLoop('start', loop, 4, 10)).toEqual({ start: 8, end: 10 });
    expect(dragLoop('end', loop, 8, 4)).toBeNull();
  });

  it('dal corpo si sposta tutto, senza andare sotto il minimo', () => {
    expect(dragLoop('body', loop, 5, 7)).toEqual({ start: 6, end: 10 });
    expect(dragLoop('body', loop, 5, 0, 0)).toEqual({ start: 0, end: 4 });
  });

  it('fuori se ne disegna uno nuovo in entrambe le direzioni', () => {
    expect(dragLoop('outside', loop, 12, 16)).toEqual({ start: 12, end: 16 });
    expect(dragLoop('outside', loop, 2, 0)).toEqual({ start: 0, end: 2 });
  });
});
