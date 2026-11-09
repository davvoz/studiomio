import { describe, expect, it } from 'vitest';
import type { MidiClip, Note } from '../../src/model/midi-clip';
import { copyClips, copyNotes, pasteClips, pasteNotes } from '../../src/store/clipboard';
import { addMidiClip, placeSample, updateClip } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

describe('clipboard: clips', () => {
  /** Track 0 audio (clip at 2), track 1 MIDI (clip at 4), track 2 empty MIDI. */
  function rig() {
    const s = setup({ audio: 1, midi: 2, sample: true });
    s.store.apply(placeSample(s.track(0), s.sampleId, 2));
    s.store.apply(addMidiClip(s.track(1), 4, 4));
    const refs = [0, 1].map(i => ({ track: s.track(i), id: s.store.project.tracks[i].arrangement[0].id }));
    return { ...s, refs };
  }

  it('copies with relative positions: tracks and beats', () => {
    const { store, refs } = rig();
    const c = copyClips(store.project, refs)!;
    expect(c.items.map(i => [i.trackOffset, i.placement.start])).toEqual([[0, 0], [1, 2]]);
    expect(c.span).toBe(8); // from beat 2 to the end of the audio clip (4 s at 120 BPM = 8 beats → 10)
    expect(c.sourceTrack).toBe(store.project.tracks[0].id);
  });

  it('pastes at the given beat, with new ids, keeping the layout', () => {
    const { store, refs } = rig();
    const c = copyClips(store.project, refs)!;
    store.apply(pasteClips(c, 0, 16));
    const [audio, midi] = store.project.tracks;
    expect(audio.arrangement.map(p => p.start)).toEqual([2, 16]);
    expect(midi.arrangement.map(p => p.start)).toEqual([4, 18]);
    expect(audio.arrangement[1].id).not.toBe(audio.arrangement[0].id);
    expect(audio.arrangement[1].clip.id).not.toBe(audio.arrangement[0].clip.id);
  });

  it('the clips that would end up on a track of another kind, or that doesn\'t exist, are skipped', () => {
    const { store, refs } = rig();
    const c = copyClips(store.project, refs)!;
    store.apply(pasteClips(c, 1, 20)); // audio → MIDI (no), MIDI → track 2 MIDI (yes)
    expect(store.project.tracks[1].arrangement).toHaveLength(1);
    expect(store.project.tracks[2].arrangement.map(p => p.start)).toEqual([22]);
    store.apply(pasteClips(c, 2, 30)); // the second would end up beyond the last track
    expect(store.project.tracks[2].arrangement).toHaveLength(1);
  });
});

describe('clipboard: notes', () => {
  const n = (pitch: number, start: number, duration = 1): Note => ({ pitch, start, duration, velocity: 100 });

  it('relative copy and paste at another point', () => {
    const notes = [n(60, 2), n(64, 3, 2), n(67, 8)];
    const c = copyNotes(notes, new Set([notes[0], notes[1]]))!;
    expect(c).toMatchObject({ origin: 2, span: 3 });
    const r = pasteNotes(notes, c, 10);
    expect(r.selected).toEqual([n(60, 10), n(64, 11, 2)]);
    expect(r.notes).toHaveLength(5);
    expect(copyNotes(notes, new Set())).toBeNull();
  });

  it('the pasted notes stay selectable in the clip', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    const id = store.project.tracks[0].arrangement[0].id;
    const r = pasteNotes([], { kind: 'notes', notes: [n(60, 0)], span: 1, origin: 0 }, 1);
    store.apply(updateClip<MidiClip>('x', track(0), id, c => c.withNotes(r.notes)));
    expect((store.project.tracks[0].arrangement[0].clip as MidiClip).notes.includes(r.selected[0])).toBe(true);
  });
});
