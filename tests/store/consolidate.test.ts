import { describe, expect, it } from 'vitest';
import type { ClipId, PlacementId } from '../../src/core/id';
import type { Placement } from '../../src/model/arrangement';
import { fullRange } from '../../src/model/clip';
import { MidiClip, type Note } from '../../src/model/midi-clip';
import { addMidiClip } from '../../src/store/edits';
import {
  consolidatedEnvelopes, consolidatedMidiClip, consolidatedNotes, consolidateSpans, placementsIn, sessionClip, withConsolidated,
} from '../../src/store/consolidate';
import { resolveSelection } from '../../src/ui/timeline/planning';
import { setup } from '../helpers/fixtures';

const note = (pitch: number, start: number, duration = 0.5): Note => ({ pitch, start, duration, velocity: 100 });
const VOLUME = { kind: 'mixer', param: 'volume' } as const;

/** A clip of `length` beats (looping if `loop`) placed from `start` for `placed` beats. */
function placed(id: string, notes: Note[], start: number, length: number, placed = length, loop = false): Placement<MidiClip> {
  const clip = MidiClip.create({ id: `clip-${id}` as ClipId, name: id, color: '#ff0000', ...fullRange(0, length, loop), notes });
  return { id: `placement-${id}` as PlacementId, clip, start, length: placed, offset: 0 };
}

describe('consolidate', () => {
  it('the notes in a row, the loop rounds become real notes', () => {
    const a = placed('a', [note(60, 0), note(62, 1.5, 2)], 0, 2); // the second note goes out of the clip: it's shortened
    const b = placed('b', [note(64, 0)], 4, 1, 3, true); // one beat looping, placed for three
    expect(consolidatedNotes([a, b], 0)).toEqual([
      note(60, 0), note(62, 1.5), note(64, 4), note(64, 5), note(64, 6),
    ]);
  });

  it('the modulations in a row, neutral where nothing plays', () => {
    const a = placed('a', [], 0, 2);
    const withCurve = { ...a, clip: a.clip.withEnvelope(VOLUME, [{ beat: 0, value: 0.5 }, { beat: 2, value: 1 }]) };
    const b = placed('b', [], 3, 1);
    const [env] = consolidatedEnvelopes([withCurve, b], 0, 5);
    expect(env.points).toEqual([
      { beat: 0, value: 0.5 }, { beat: 2, value: 1 }, // a's curve
      { beat: 2, value: 1 }, { beat: 3, value: 1 }, // the gap: neutral (full volume)
      { beat: 3, value: 1 }, { beat: 4, value: 1 }, // b has no curve: neutral
      { beat: 4, value: 1 }, // after the last clip
    ]);
    expect(consolidatedEnvelopes([b], 0, 4)).toEqual([]);
  });

  it('on each track a clip from the first to the last selected, including those in between', () => {
    const { store, track, ids } = setup({ midi: 1 });
    for (const start of [0, 4, 8]) store.apply(addMidiClip(track(0), start, 2));
    const p = store.project, lane = p.tracks[0].arrangement;
    const refs = resolveSelection(p, new Set([lane[0].id, lane[2].id]));
    const [span] = consolidateSpans(p, refs, null);
    expect(span).toMatchObject({ start: 0, end: 10 });
    expect(placementsIn(p, span)).toHaveLength(3);
    const clip = consolidatedMidiClip(ids.next('clip'), placementsIn(p, span) as Placement<MidiClip>[], span.start, span.end);
    const next = withConsolidated(p, [{ span, placement: ids.next('placement'), clip }], ids);
    expect(next.tracks[0].arrangement.map(pl => [pl.start, pl.length])).toEqual([[0, 10]]);
    expect(consolidateSpans(p, refs, { start: 1, end: 5 })[0]).toMatchObject({ start: 1, end: 5 });
  });

  it('in the session: a clip repeating its piece stays itself, the rest is lined up', () => {
    const id = 'clip-x' as ClipId;
    // one beat looping placed for four: the one-beat clip remains
    const loop = sessionClip(id, [placed('a', [note(60, 0)], 0, 1, 4, true)], 0, 4)!;
    expect([loop.id, loop.region, loop.loop]).toEqual([id, { start: 0, end: 1 }, { enabled: true, start: 0, end: 1 }]);
    // a clip shortened from the left: only the playing piece
    const trimmed = { ...placed('b', [note(60, 0), note(62, 2)], 4, 4, 2), offset: 2 };
    expect(sessionClip(id, [trimmed], 4, 6)!.loop).toEqual({ enabled: true, start: 2, end: 4 });
    // later than the stretch, or two clips: the notes in a row over the whole stretch
    const late = sessionClip(id, [placed('c', [note(60, 0)], 2, 2)], 0, 4) as MidiClip;
    expect([late.notes, late.loop]).toEqual([[note(60, 2)], { enabled: true, start: 0, end: 4 }]);
    expect((sessionClip(id, [placed('d', [note(60, 0)], 0, 2), placed('e', [note(62, 0)], 2, 2)], 0, 4) as MidiClip).notes)
      .toEqual([note(60, 0), note(62, 2)]);
  });
});
