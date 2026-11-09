import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { foldTail } from '../../src/engine/offline-mix';
import { fullRange } from '../../src/model/clip';
import { MidiClip } from '../../src/model/midi-clip';
import { sceneArrangement, sceneLength } from '../../src/model/scene-export';
import { addMidiClip } from '../../src/store/edits';
import { newSlotMidiClip, updateSlotClip } from '../../src/store/session-edits';
import { setup } from '../helpers/fixtures';

const clip = (start: number, end: number, loop: boolean) =>
  MidiClip.create({ id: asId('clip-x'), name: 'm', color: '#fff', notes: [], ...fullRange(start, end, loop) });

describe('scene: automatic length', () => {
  it('the loops come round together: 4 and 3 bars → 12', () => {
    expect(sceneLength([clip(0, 16, true), clip(0, 12, true)], 256)).toEqual({ length: 48, loops: true });
  });

  it('at least the longest clip without loop, in whole rounds of the loop', () => {
    expect(sceneLength([clip(0, 4, true), clip(0, 10, false)], 256)).toEqual({ length: 12, loops: true });
  });

  it('only clips without loop: the longest, once', () => {
    expect(sceneLength([clip(0, 6, false), clip(2, 5, false)], 256)).toEqual({ length: 6, loops: false });
  });

  it('if the loops come round too late the longest is enough', () => {
    expect(sceneLength([clip(0, 7, true), clip(0, 11, true)], 64)).toEqual({ length: 11, loops: true });
  });

  it('empty scene', () => {
    expect(sceneLength([], 256)).toBeNull();
  });
});

describe('scene as timeline', () => {
  it('each track plays only the scene\'s clip from beat 0; empty slot: nothing', () => {
    const { store, track, ids } = setup({ midi: 2 });
    store.apply(addMidiClip(track(1), 8, 4)); // on the timeline: it mustn't play
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    const slot = store.project.tracks[0].slots[1]!;
    store.apply(updateSlotClip<MidiClip>('loop', track(0), slot.id, c => c.withRegion({ start: 0, end: 8 }).withLoop({ enabled: true, start: 0, end: 8 })));

    const plan = sceneArrangement(store.project, 1, ids, 256)!;
    expect([plan.length, plan.loops]).toEqual([8, true]);
    const [a, b] = plan.project.tracks;
    expect(a.arrangement.map(p => [p.start, p.length, p.offset, p.clip.id])).toEqual([[0, 8, 0, slot.id]]);
    expect(b.arrangement).toEqual([]);
    expect(store.project.tracks[1].arrangement).toHaveLength(1); // the real project doesn't change
    expect(sceneArrangement(store.project, 0, ids, 256)).toBeNull();
  });
});

describe('foldTail', () => {
  it('the tail beyond the end is added to the start', () => {
    const out = foldTail([new Float32Array([1, 2, 3, 4, 0.5, 0.25, 0.125])], 3);
    expect(Array.from(out[0])).toEqual([1 + 4 + 0.125, 2 + 0.5, 3 + 0.25]);
  });
});
