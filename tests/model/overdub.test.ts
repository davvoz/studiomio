import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { MidiClip } from '../../src/model/midi-clip';
import { clipEnd, overdubbedNote } from '../../src/model/overdub';
import { overdubNotes, recordedClip } from '../../src/store/session-edits';
import { setup } from '../helpers/fixtures';

const clip = (loop: boolean) => {
  const c = MidiClip.empty(sequentialIds().next('clip'), 'c', '#ff0000', 4);
  return c.withLoop({ enabled: loop, start: 1, end: 3 });
};

describe('overdub', () => {
  it('the clip ends at its loop\'s end when it loops, otherwise at its region\'s', () => {
    expect(clipEnd(clip(true))).toBe(3);
    expect(clipEnd(clip(false))).toBe(4);
  });

  it('a note lasts as long as it was held, up to the clip\'s end, never less than 1/64', () => {
    const c = clip(true);
    expect(overdubbedNote(c, 60, 90, 1.5, 0.5)).toEqual({ pitch: 60, velocity: 90, start: 1.5, duration: 0.5 });
    expect(overdubbedNote(c, 60, 90, 2.5, 4).duration).toBe(0.5);
    expect(overdubbedNote(c, 60, 90, 2, 0).duration).toBe(1 / 64);
    // pressed right at the end: still the shortest note
    expect(overdubbedNote(c, 60, 90, 3, 1).duration).toBe(1 / 64);
  });

  it('the notes go into the slot\'s clip only if it is still that clip', () => {
    const { store, track } = setup({ midi: 1 });
    const ref = { track: track(0), slot: 0 }, id = store.ids.next('clip');
    const note = { pitch: 60, velocity: 100, start: 0, duration: 1 };
    // an empty slot, then another clip: nothing changes
    store.apply(overdubNotes(ref, id, [note]));
    expect(store.project.track(ref.track)!.slots[0]).toBeNull();
    store.apply(recordedClip(ref, store.ids.next('clip'), [], 4));
    store.apply(overdubNotes(ref, id, [note]));
    expect((store.project.track(ref.track)!.slots[0] as MidiClip).notes).toEqual([]);
    store.apply(recordedClip(ref, id, [], 4));
    store.apply(overdubNotes(ref, id, [note]));
    const after = store.project.track(ref.track)!.slots[0] as MidiClip;
    expect(after.id).toBe(id);
    expect(after.notes).toEqual([note]);
  });
});
