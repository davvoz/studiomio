import { describe, expect, it } from 'vitest';
import { TimeSignature } from '../../src/core/music-time';
import { addMidiClip, placeSample, resizePlacement } from '../../src/store/edits';
import {
  addedPlacements, deleteMany, duplicateMany, importSample, cutOutRange, relocate, resizeMany, splitMany, splitRange,
} from '../../src/store/selection-edits';
import { gridStep, hitTest, placementsInBox, TimelineGeometry } from '../../src/ui/timeline/geometry';
import { planMove, planResize, planResizeMany, resolveSelection, snappedDelta } from '../../src/ui/timeline/planning';
import { sampleRef, setup } from '../helpers/fixtures';

describe('timeline geometry', () => {
  it('beats ↔ pixels, zoom around the pointer', () => {
    const g = new TimelineGeometry(20, 4, 0);
    expect(g.beatToX(5)).toBe(20);
    expect(g.xToBeat(40)).toBe(6);
    const z = g.zoomed(40, 40); // beat 6 stays at x=40
    expect(z.xToBeat(40)).toBeCloseTo(6, 12);
    expect(z.pxPerBeat).toBe(40);
    expect(g.zoomed(1e6, 0).pxPerBeat).toBe(600);
  });

  it('the grid adapts to the zoom', () => {
    const sig = TimeSignature.COMMON;
    expect(gridStep(200, sig)).toBe(1 / 8);
    expect(gridStep(24, sig)).toBe(1);
    expect(gridStep(3, sig)).toBe(8);
    expect(gridStep(24, new TimeSignature(6, 8))).toBe(1);
  });

  it('what\'s under the pointer: edges, body, lane, empty', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(1), 4, 4)); // beats 4–8 on the second track
    const g = new TimelineGeometry(20, 0, 0, 70);
    const p = store.project;
    expect(hitTest(p, g, 82, 100)).toMatchObject({ kind: 'clip', zone: 'start', trackIndex: 1 });
    expect(hitTest(p, g, 120, 100)).toMatchObject({ kind: 'clip', zone: 'body' });
    expect(hitTest(p, g, 157, 100)).toMatchObject({ kind: 'clip', zone: 'end' });
    expect(hitTest(p, g, 120, 10)).toMatchObject({ kind: 'lane', trackIndex: 0 });
    expect(hitTest(p, g, 120, 500)).toMatchObject({ kind: 'empty' });
    expect(placementsInBox(p, 0, 5, 0, 1)).toHaveLength(1);
    expect(placementsInBox(p, 0, 3.9, 0, 5)).toHaveLength(0);
  });
});

describe('planning the gestures', () => {
  it('the move snaps the grabbed clip to the grid', () => {
    expect(snappedDelta(4, 1.3, 1)).toBe(1);
    expect(snappedDelta(4.5, 1.3, 1)).toBe(1.5);
    expect(snappedDelta(4, -10, 1)).toBe(-4); // never before the start
    expect(snappedDelta(4, 1.3, null)).toBeCloseTo(1.3, 12);
  });

  it('moving onto another track only if it\'s of the same kind', () => {
    const { store, track, sampleId } = setup({ audio: 2, midi: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const refs = resolveSelection(store.project, new Set([store.project.tracks[0].arrangement[0].id]));
    expect(planMove(store.project, refs, 2, 1, false)[0]).toMatchObject({ to: track(1), start: 2 });
    expect(planMove(store.project, refs, 2, 2, false)[0]).toMatchObject({ to: track(0) }); // the MIDI doesn't go
    expect(planMove(store.project, refs, 2, -1, false)[0]).toMatchObject({ to: track(0) }); // outside the list
  });

  it('resizing respects the content\'s limits', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 4)); // 8 beats, without loop
    const pl = store.project.tracks[0].arrangement[0];
    expect(planResize(pl, 'start', 0, 1)).toEqual({ start: 4, end: 12 }); // not before the content
    expect(planResize(pl, 'start', 11.9, 1)).toEqual({ start: 11, end: 12 }); // minimum length
    expect(planResize(pl, 'end', 30, 1)).toEqual({ start: 4, end: 12 }); // not past the end of the sample
    expect(planResize(pl, 'end', 6, 1)).toEqual({ start: 4, end: 6 });
  });

  it('resizing the selection moves the same edge of all the clips', () => {
    const { store, track, sampleId } = setup({ audio: 1, midi: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0)); // 8 beats, without loop
    store.apply(resizePlacement(track(0), store.project.tracks[0].arrangement[0].id, { end: 6 }));
    store.apply(addMidiClip(track(1), 2, 4)); // in loop
    const [audio, midi] = store.project.tracks.map(t => t.arrangement[0]);
    const refs = resolveSelection(store.project, new Set([audio.id, midi.id]));
    // the MIDI lengthened by 3, the audio stops at the end of the sample
    const longer = planResizeMany(store.project, refs, midi, 'end', 9, 1);
    expect(longer).toEqual([{ ...refs[0], start: 0, end: 8 }, { ...refs[1], start: 2, end: 9 }]);
    store.apply(resizeMany(longer));
    expect(store.project.tracks.map(t => t.arrangement[0].length)).toEqual([8, 7]);
    // shortening from the left by 1 beat they all shorten
    const shorter = planResizeMany(store.project, refs, store.project.tracks[1].arrangement[0], 'start', 3, 1);
    expect(shorter.map(r => r.start)).toEqual([1, 3]);
  });
});

describe('edits on the selection', () => {
  it('moving two adjacent clips together doesn\'t make them cut each other', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(0), 4, 4));
    const refs = resolveSelection(store.project, new Set(store.project.tracks[0].arrangement.map(p => p.id)));
    store.apply(relocate('Move', planMove(store.project, refs, 2, 0, false)));
    expect(store.project.tracks[0].arrangement.map(p => [p.start, p.length])).toEqual([[2, 4], [6, 4]]);
  });

  it('duplicating puts the copy after the selection; the copies are new clips', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(1), 2, 4));
    const before = store.project;
    const refs = resolveSelection(store.project, new Set(store.project.tracks.flatMap(t => t.arrangement.map(p => p.id))));
    store.apply(duplicateMany(refs));
    const added = addedPlacements(before, store.project);
    expect(added).toHaveLength(2);
    expect(store.project.tracks.map(t => t.arrangement.map(p => p.start))).toEqual([[0, 6], [2, 8]]);
    expect(store.undoLabel).toBe('Duplicate');
  });

  it('splitting and deleting', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 8));
    const refs = resolveSelection(store.project, new Set([store.project.tracks[0].arrangement[0].id]));
    store.apply(splitMany(refs, 3));
    expect(store.project.tracks[0].arrangement.map(p => p.start)).toEqual([0, 3]);
    store.apply(deleteMany(resolveSelection(store.project, new Set(store.project.tracks[0].arrangement.map(p => p.id)))));
    expect(store.project.tracks[0].arrangement).toHaveLength(0);
  });

  it('splitting at the edges of a range, like the time selection in Live', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 8));
    const refs = () => resolveSelection(store.project, new Set(store.project.tracks[0].arrangement.map(p => p.id)));
    store.apply(splitRange(refs(), 2, 5));
    expect(store.project.tracks[0].arrangement.map(p => [p.start, p.length])).toEqual([[0, 2], [2, 3], [5, 3]]);
    expect(store.undoLabel).toBe('Split');
    store.apply(splitRange(refs(), 6, 12)); // the end beyond the clip: a single cut
    expect(store.project.tracks[0].arrangement.map(p => p.start)).toEqual([0, 2, 5, 6]);
  });

  it('detaching a range: the pieces inside, one per clip', () => {
    const { store, track, ids } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(0), 4, 4));
    const before = store.project;
    const cut = cutOutRange(before, ids, resolveSelection(before, new Set(before.tracks[0].arrangement.map(p => p.id))), { start: 2, end: 6 });
    expect(before.tracks[0].arrangement).toHaveLength(2); // the starting project doesn't change
    const lane = cut.project.tracks[0].arrangement;
    expect(lane.map(p => [p.start, p.length])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2]]);
    expect(cut.pieces.map(r => lane.find(p => p.id === r.id)!.start)).toEqual([2, 4]);
  });

  it('importing a sample: on the indicated audio track, otherwise on a new one', () => {
    const { store, track, ids } = setup({ audio: 1, midi: 1 });
    store.apply(importSample(sampleRef(ids, { name: 'kick' }), track(0), 4));
    expect(store.project.tracks[0].arrangement[0].start).toBe(4);
    store.apply(importSample(sampleRef(ids, { name: 'snare', file: 'audio/snare.wav' }), track(1), 0));
    expect(store.project.tracks).toHaveLength(3);
    expect(store.project.tracks[2].name).toBe('snare');
    expect(store.undoLabel).toBe('Import audio');
  });
});
