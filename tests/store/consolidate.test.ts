import { describe, expect, it } from 'vitest';
import type { ClipId, PlacementId } from '../../src/core/id';
import type { Placement } from '../../src/model/arrangement';
import { fullRange } from '../../src/model/clip';
import { MidiClip, type Note } from '../../src/model/midi-clip';
import { addMidiClip } from '../../src/store/edits';
import {
  consolidatedEnvelopes, consolidatedMidiClip, consolidatedNotes, consolidateSpans, placementsIn, withConsolidated,
} from '../../src/store/consolidate';
import { resolveSelection } from '../../src/ui/timeline/planning';
import { setup } from '../helpers/fixtures';

const note = (pitch: number, start: number, duration = 0.5): Note => ({ pitch, start, duration, velocity: 100 });
const VOLUME = { kind: 'mixer', param: 'volume' } as const;

/** Una clip di `length` battiti (in loop se `loop`) posata da `start` per `placed` battiti. */
function placed(id: string, notes: Note[], start: number, length: number, placed = length, loop = false): Placement<MidiClip> {
  const clip = MidiClip.create({ id: `clip-${id}` as ClipId, name: id, color: '#ff0000', ...fullRange(0, length, loop), notes });
  return { id: `placement-${id}` as PlacementId, clip, start, length: placed, offset: 0 };
}

describe('consolida', () => {
  it('le note in fila, i giri di loop diventano note vere', () => {
    const a = placed('a', [note(60, 0), note(62, 1.5, 2)], 0, 2); // la seconda nota esce dalla clip: si accorcia
    const b = placed('b', [note(64, 0)], 4, 1, 3, true); // un battito in loop, posato per tre
    expect(consolidatedNotes([a, b], 0)).toEqual([
      note(60, 0), note(62, 1.5), note(64, 4), note(64, 5), note(64, 6),
    ]);
  });

  it('le modulazioni in fila, neutre dove non suona niente', () => {
    const a = placed('a', [], 0, 2);
    const withCurve = { ...a, clip: a.clip.withEnvelope(VOLUME, [{ beat: 0, value: 0.5 }, { beat: 2, value: 1 }]) };
    const b = placed('b', [], 3, 1);
    const [env] = consolidatedEnvelopes([withCurve, b], 0, 5);
    expect(env.points).toEqual([
      { beat: 0, value: 0.5 }, { beat: 2, value: 1 }, // la curva di a
      { beat: 2, value: 1 }, { beat: 3, value: 1 }, // il vuoto: neutro (volume pieno)
      { beat: 3, value: 1 }, { beat: 4, value: 1 }, // b non ha curva: neutro
      { beat: 4, value: 1 }, // dopo l'ultima clip
    ]);
    expect(consolidatedEnvelopes([b], 0, 4)).toEqual([]);
  });

  it('su ogni traccia una clip dalla prima all\'ultima selezionata, comprese quelle in mezzo', () => {
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
});
