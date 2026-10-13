import { describe, expect, it } from 'vitest';
import { asId, sequentialIds, type PlacementId } from '../../src/core/id';
import { place, split, update, type Placement } from '../../src/model/arrangement';
import { fullRange } from '../../src/model/clip';
import { MidiClip } from '../../src/model/midi-clip';

const loopClip = MidiClip.create({ id: asId('clip-x'), name: 'x', color: '#fff', ...fullRange(0, 4, true), notes: [] });
const oneShot = MidiClip.create({ id: asId('clip-y'), name: 'y', color: '#fff', ...fullRange(0, 4), notes: [] });

const pl = (id: string, start: number, length: number, offset = 0, clip = loopClip): Placement => ({
  id: asId<'placement'>(id), clip, start, length, offset,
});

const shape = (lane: readonly Placement[]) => lane.map(p => [p.id, p.start, p.length, p.offset]);

describe('arrangement: posare clip', () => {
  const base = [pl('a', 0, 8), pl('b', 10, 4)];

  it('senza sovrapposizioni le clip restano e la corsia è ordinata', () => {
    expect(shape(place(base, pl('n', 8, 2), sequentialIds()))).toEqual([['a', 0, 8, 0], ['n', 8, 2, 0], ['b', 10, 4, 0]]);
  });

  it('la clip nuova accorcia quella sotto (fine)', () => {
    expect(shape(place(base, pl('n', 6, 3), sequentialIds()))).toEqual([['a', 0, 6, 0], ['n', 6, 3, 0], ['b', 10, 4, 0]]);
  });

  it('la clip nuova taglia l\'inizio di quella sotto, che conserva il contenuto (offset)', () => {
    expect(shape(place(base, pl('n', 9, 3), sequentialIds()))).toEqual([['a', 0, 8, 0], ['n', 9, 3, 0], ['b', 12, 2, 2]]);
  });

  it('una clip dentro un\'altra la divide in due', () => {
    expect(shape(place(base, pl('n', 2, 2), sequentialIds())))
      .toEqual([['a', 0, 2, 0], ['n', 2, 2, 0], ['placement-1', 4, 4, 4], ['b', 10, 4, 0]]);
  });

  it('una clip che ne copre un\'altra la sostituisce', () => {
    expect(shape(place(base, pl('n', 9, 6), sequentialIds()))).toEqual([['a', 0, 8, 0], ['n', 9, 6, 0]]);
  });

  it('una clip senza loop non dura più del suo contenuto', () => {
    expect(shape(place([], pl('n', 0, 10, 1, oneShot), sequentialIds()))).toEqual([['n', 0, 3, 1]]);
    expect(() => place([], pl('n', 0, 2, 4, oneShot), sequentialIds())).toThrow(RangeError);
  });

  it('spostare una clip la riposa (e copre le vicine)', () => {
    const moved = update(base, asId<'placement'>('b'), p => ({ ...p, start: 6 }), sequentialIds());
    expect(shape(moved)).toEqual([['a', 0, 6, 0], ['b', 6, 4, 0]]);
  });

  it('dividere una clip', () => {
    const lane = split(base, 'a' as PlacementId, 3, sequentialIds());
    expect(shape(lane)).toEqual([['a', 0, 3, 0], ['placement-1', 3, 5, 3], ['b', 10, 4, 0]]);
    expect(split(base, 'a' as PlacementId, 0, sequentialIds())).toEqual(base); // sul bordo: niente
  });
});
