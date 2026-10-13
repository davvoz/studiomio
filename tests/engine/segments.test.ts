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

describe('tratti continui di una clip posata', () => {
  it('senza loop: un tratto', () => {
    expect(placementSegments(pl(false, 8, 4, 1))).toEqual([{ start: 8, end: 12, contentStart: 1 }]);
  });

  it('con il loop: attacco fino alla fine del loop, poi un tratto per giro', () => {
    expect(placementSegments(pl(true, 10, 13))).toEqual([
      { start: 10, end: 16, contentStart: 0 }, // 0 → 6
      { start: 16, end: 20, contentStart: 2 }, // 2 → 6
      { start: 20, end: 23, contentStart: 2 }, // 2 → 5, tagliato
    ]);
  });

  it('con il loop e un offset dentro il loop', () => {
    // 7 battiti dopo l'inizio: 0→6 poi un giro da 2, quindi si è al battito 3
    expect(placementSegments(pl(true, 0, 5, 7))).toEqual([
      { start: 0, end: 3, contentStart: 3 },
      { start: 3, end: 5, contentStart: 2 },
    ]);
  });
});

describe('quando far partire un tratto', () => {
  const seg = { start: 4, end: 8, contentStart: 10 };
  const win = (from: number, to: number, runStart = 0, runEnd = Infinity) => ({ from, to, runStart, runEnd });

  it('parte nella finestra che contiene il suo inizio', () => {
    expect(segmentToStart(seg, win(3, 5))).toEqual(seg);
    expect(segmentToStart(seg, win(0, 4))).toBeNull();
    expect(segmentToStart(seg, win(4.5, 6))).toBeNull(); // già partito prima
  });

  it('se la corsa inizia a metà tratto parte da lì, con il contenuto spostato', () => {
    expect(segmentToStart(seg, win(6, 6.2, 6))).toEqual({ start: 6, end: 8, contentStart: 12 });
  });

  it('si ferma alla fine della corsa (fine del loop)', () => {
    expect(segmentToStart(seg, win(3, 5, 0, 7))).toEqual({ start: 4, end: 7, contentStart: 10 });
    expect(segmentToStart(seg, win(3, 5, 0, 4))).toBeNull();
  });
});
