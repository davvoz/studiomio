import { describe, expect, it } from 'vitest';
import { NoteTake, takeLength } from '../../src/model/note-take';

describe('NoteTake', () => {
  it('times the notes from the take\'s start, with their velocity', () => {
    const take = new NoteTake(8);
    take.press(60, 100, 8.5);
    take.release(60, 9.5);
    take.press(64, 40, 10);
    take.release(64, 10.25);
    expect(take.notes(4)).toEqual([
      { pitch: 60, start: 0.5, duration: 1, velocity: 100 },
      { pitch: 64, start: 2, duration: 0.25, velocity: 40 },
    ]);
  });

  it("a note pressed a little early goes at the start, as long as it was held; much earlier it's left out", () => {
    const take = new NoteTake(8);
    take.press(60, 100, 7.9);
    take.release(60, 9);
    take.press(62, 100, 7);
    take.release(62, 8.5);
    expect(take.notes(4)).toEqual([{ pitch: 60, start: 0, duration: expect.closeTo(1.1, 9), velocity: 100 }]);
  });

  it('the first sixteenth, moved early by the latency compensation, stays a sixteenth', () => {
    const take = new NoteTake(0);
    take.press(60, 100, -0.12);
    take.release(60, 0.13);
    expect(take.notes(4)[0].duration).toBeCloseTo(0.25, 9);
  });

  it('the notes still held end with the clip, those after its end are left out', () => {
    const take = new NoteTake(0);
    take.press(60, 90, 3);
    take.press(67, 90, 4);
    take.release(67, 4.5);
    expect(take.notes(4)).toEqual([{ pitch: 60, start: 3, duration: 1, velocity: 90 }]);
  });

  it('a note longer than the clip is cut at its end', () => {
    const take = new NoteTake(0);
    take.press(60, 90, 2);
    take.release(60, 9);
    expect(take.notes(4)).toEqual([{ pitch: 60, start: 2, duration: 2, velocity: 90 }]);
  });

  it('the same key pressed again ends the first note there', () => {
    const take = new NoteTake(0);
    take.press(60, 90, 1);
    take.press(60, 50, 2);
    take.release(60, 3);
    expect(take.notes(4)).toEqual([
      { pitch: 60, start: 1, duration: 1, velocity: 90 },
      { pitch: 60, start: 2, duration: 1, velocity: 50 },
    ]);
  });

  it('a note pressed and released in the same instant keeps a minimal length', () => {
    const take = new NoteTake(0);
    take.press(60, 90, 1);
    take.release(60, 1);
    expect(take.notes(4)[0].duration).toBeGreaterThan(0);
  });

  it('remembers the last press or release', () => {
    const take = new NoteTake(0);
    expect(take.lastEvent).toBeNull();
    take.press(60, 90, 1);
    take.release(60, 2.5);
    expect(take.lastEvent).toBe(2.5);
  });
});

describe('takeLength', () => {
  it('whole launch quanta, at least one', () => {
    expect(takeLength(4, 4)).toBe(4);
    expect(takeLength(4.1, 4)).toBe(8);
    expect(takeLength(0.5, 4)).toBe(4);
    expect(takeLength(0, 4)).toBe(4);
  });

  it('without quantization, whole beats', () => {
    expect(takeLength(2.3, 0)).toBe(3);
    expect(takeLength(0, 0)).toBe(1);
  });
});
