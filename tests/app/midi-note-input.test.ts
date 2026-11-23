import { describe, expect, it } from 'vitest';
import { MidiNoteInput } from '../../src/app/midi-note-input';
import type { TrackId } from '../../src/core/id';

const A = 'track-a' as TrackId, B = 'track-b' as TrackId;

function harness(mapped: (channel: number, pitch: number) => boolean = () => false) {
  let armed: TrackId[] = [A];
  const played: string[] = [];
  const input = new MidiNoteInput(() => armed, mapped, {
    press: (t, p, v) => played.push(`on ${t} ${p} ${v}`),
    release: (t, p) => played.push(`off ${t} ${p}`),
  });
  return { input, played, arm: (...tracks: TrackId[]) => { armed = tracks; } };
}

describe('MidiNoteInput', () => {
  it('note on and note off play the armed tracks, with the velocity', () => {
    const h = harness();
    h.arm(A, B);
    h.input.receive([0x90, 60, 100]);
    h.input.receive([0x80, 60, 0]);
    expect(h.played).toEqual(['on track-a 60 100', 'on track-b 60 100', 'off track-a 60', 'off track-b 60']);
  });

  it('a note on with velocity 0 is a note off, on any channel', () => {
    const h = harness();
    h.input.receive([0x93, 62, 90]);
    h.input.receive([0x93, 62, 0]);
    expect(h.played).toEqual(['on track-a 62 90', 'off track-a 62']);
  });

  it('releasing a key stops what it started, even if the armed tracks changed', () => {
    const h = harness();
    h.input.receive([0x90, 60, 100]);
    h.arm(B);
    h.input.receive([0x80, 60, 0]);
    expect(h.played).toEqual(['on track-a 60 100', 'off track-a 60']);
  });

  it('a track no longer armed stops its notes right away', () => {
    const h = harness();
    h.input.receive([0x90, 60, 100]);
    h.input.keepTracks(new Set());
    h.input.receive([0x80, 60, 0]);
    expect(h.played).toEqual(['on track-a 60 100', 'off track-a 60']);
  });

  it('a mapped note doesn\'t play; CCs and the rest are ignored', () => {
    const h = harness((channel, pitch) => channel === 0 && pitch === 36);
    h.input.receive([0x90, 36, 100]);
    h.input.receive([0x80, 36, 0]);
    h.input.receive([0xb0, 7, 100]);
    h.input.receive([0xf8]);
    expect(h.played).toEqual([]);
  });

  it('the same key again without its note off ends the first note', () => {
    const h = harness();
    h.input.receive([0x90, 60, 100]);
    h.input.receive([0x90, 60, 50]);
    expect(h.played).toEqual(['on track-a 60 100', 'off track-a 60', 'on track-a 60 50']);
  });
});
