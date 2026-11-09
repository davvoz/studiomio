import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { placementSegments, segmentToStart } from '../../src/engine/segments';
import type { Placement } from '../../src/model/arrangement';
import { MidiClip } from '../../src/model/midi-clip';

const clip = (loop: boolean) => MidiClip.create({
  id: asId('clip-1'), name: 'c', color: '#fff', notes: [],
  region: { start: 0, end: 6 }, loop: { enabled: loop, start: 2, end: 6 },
});
const pl = (loop: boolean, start: number, length: number, offset = 0): Placement =>
  ({ id: asId('placement-1'), clip: clip(loop), start, length, offset });

describe('continuous stretches of a placed clip', () => {
  it('without loop: one stretch', () => {
    expect(placementSegments(pl(false, 8, 4, 1))).toEqual([{ start: 8, end: 12, contentStart: 1 }]);
  });

  it('with the loop: attack up to the end of the loop, then one stretch per round', () => {
    expect(placementSegments(pl(true, 10, 13))).toEqual([
      { start: 10, end: 16, contentStart: 0 }, // 0 → 6
      { start: 16, end: 20, contentStart: 2 }, // 2 → 6
      { start: 20, end: 23, contentStart: 2 }, // 2 → 5, cut
    ]);
  });

  it('with the loop and an offset inside the loop', () => {
    // 7 beats after the start: 0→6 then a round of 2, so we're at beat 3
    expect(placementSegments(pl(true, 0, 5, 7))).toEqual([
      { start: 0, end: 3, contentStart: 3 },
      { start: 3, end: 5, contentStart: 2 },
    ]);
  });
});

describe('when to start a stretch', () => {
  const seg = { start: 4, end: 8, contentStart: 10 };
  const win = (from: number, to: number, runStart = 0, runEnd = Infinity) => ({ from, to, runStart, runEnd });

  it('it starts in the window containing its start', () => {
    expect(segmentToStart(seg, win(3, 5))).toEqual(seg);
    expect(segmentToStart(seg, win(0, 4))).toBeNull();
    expect(segmentToStart(seg, win(4.5, 6))).toBeNull(); // already started earlier
  });

  it('if the run starts halfway through a stretch it starts from there, with the content shifted', () => {
    expect(segmentToStart(seg, win(6, 6.2, 6))).toEqual({ start: 6, end: 8, contentStart: 12 });
  });

  it('it stops at the end of the run (end of the loop)', () => {
    expect(segmentToStart(seg, win(3, 5, 0, 7))).toEqual({ start: 4, end: 7, contentStart: 10 });
    expect(segmentToStart(seg, win(3, 5, 0, 4))).toBeNull();
  });
});
