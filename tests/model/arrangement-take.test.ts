import { describe, expect, it } from 'vitest';
import type { TrackId } from '../../src/core/id';
import { playingLoop, TimelineTake, type Moment } from '../../src/model/arrangement-take';

const A = 'track-a' as TrackId, B = 'track-b' as TrackId;
/** A moment of a run whose clock is `beat + shift`. */
const at = (beat: number, shift = 0): Moment => ({ beat, clock: beat + shift });

describe('take on the timeline', () => {
  it('a clip from the punch-in to where the playhead got, with the notes where they were heard', () => {
    const take = new TimelineTake(at(8), null);
    take.press(A, 60, 100, at(9));
    take.release(A, 60, at(9.5));
    take.press(A, 64, 90, at(10));
    expect(take.follow(at(12))).toBe(true);
    // the note still held ends where the take ends
    expect(take.clips(at(12))).toEqual([{
      track: A, start: 8, length: 4,
      notes: [{ pitch: 60, velocity: 100, start: 1, duration: 0.5 }, { pitch: 64, velocity: 90, start: 2, duration: 2 }],
    }]);
  });

  it('only the tracks that got notes get a clip; the same key again ends the first note', () => {
    const take = new TimelineTake(at(0), null);
    take.press(B, 60, 100, at(1));
    take.press(B, 60, 80, at(2));
    take.release(B, 60, at(3));
    take.follow(at(4));
    const clips = take.clips(at(4));
    expect(clips.map(c => c.track)).toEqual([B]);
    expect(clips[0].notes.map(n => [n.start, n.duration, n.velocity])).toEqual([[1, 1, 100], [2, 1, 80]]);
  });

  it('round after round of the loop the notes add up; the clip covers the whole loop', () => {
    const loop = { start: 4, end: 8 };
    const take = new TimelineTake(at(6), loop);
    take.press(A, 60, 100, at(7));
    // held across the loop's end: it stops there, where the playhead goes back
    expect(take.follow(at(7.9))).toBe(true);
    take.release(A, 60, at(4.5, 4));
    expect(take.follow(at(4.5, 4))).toBe(true);
    take.press(A, 62, 100, at(5, 4));
    take.release(A, 62, at(5.25, 4));
    expect(take.span).toEqual({ start: 4, end: 8 });
    expect(take.clips(at(6, 4))[0].notes.map(n => [n.pitch, n.start, n.duration])).toEqual([[60, 3, 1], [62, 1, 0.25]]);
  });

  it('several rounds between two moments are still rounds; a jump elsewhere ends the take', () => {
    const take = new TimelineTake(at(0), { start: 0, end: 2 });
    expect(take.follow(at(1, 6))).toBe(true); // three rounds
    expect(take.follow(at(1.5, 6))).toBe(true); // the same round goes on
    expect(take.span).toEqual({ start: 0, end: 2 });
    expect(new TimelineTake(at(0), null).follow(at(1, 3))).toBe(false);
    expect(new TimelineTake(at(0), { start: 0, end: 4 }).follow(at(1, 3))).toBe(false);
  });

  it('an empty stretch gives no clip', () => {
    const take = new TimelineTake(at(3), null);
    take.press(A, 60, 100, at(3));
    expect(take.clips(at(3))).toEqual([]);
  });

  it('the loop counts only if it is on and the punch-in is before its end', () => {
    const loop = { enabled: true, start: 4, end: 8 };
    expect(playingLoop(loop, 2)).toEqual({ start: 4, end: 8 });
    expect(playingLoop(loop, 8)).toBeNull();
    expect(playingLoop({ ...loop, enabled: false }, 2)).toBeNull();
  });
});
