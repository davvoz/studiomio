import { describe, expect, it } from 'vitest';
import { TimeSignature } from '../../src/core/music-time';
import { RenderCache } from '../../src/engine/render-cache';
import { renderMix, type OfflineGraph } from '../../src/engine/offline-mix';
import { SampleLibrary } from '../../src/engine/sample-library';
import { LAUNCH_QUANTA, launchQuantumBeats } from '../../src/model/launch';
import { addMidiClip } from '../../src/store/edits';
import { newSlotMidiClip } from '../../src/store/session-edits';
import { findClip, placementRef, slotRef } from '../../src/store/clip-ref';
import { playheadIn, seekBeatOf, timelineBeatOf, type TransportView } from '../../src/ui/clip-editor/clip-geometry';
import { FakeEffects, FakeGraph, FakeInstruments } from '../helpers/fake-audio';
import { setup } from '../helpers/fixtures';

describe('launch quantization', () => {
  it('each choice in beats, in 4/4 and 3/4; an unknown one is a bar', () => {
    const four = TimeSignature.COMMON, three = new TimeSignature(3, 4);
    expect(LAUNCH_QUANTA.map(q => launchQuantumBeats(q.id, four))).toEqual([0, 0.25, 0.5, 1, 2, 4, 8, 16]);
    expect(launchQuantumBeats('2bar', three)).toBe(6);
    expect(launchQuantumBeats('??', three)).toBe(3);
  });
});

describe('the playhead in a clip editor', () => {
  it('on the timeline it follows the transport; in a slot, the launched clip; stopped, none', () => {
    const { store, track } = setup({ midi: 1 });
    const t = track(0);
    store.apply(addMidiClip(t, 8, 4));
    store.apply(newSlotMidiClip({ track: t, slot: 1 }));
    const p = store.project, pl = p.track(t)!.arrangement[0], slot = p.track(t)!.slots[1]!;
    const placed = findClip(p, placementRef(t, pl.id))!, inSlot = findClip(p, slotRef(t, slot.id))!;
    const transport = (playing: boolean, position: number, state: Partial<ReturnType<TransportView['sessionState']>> = {}): TransportView => ({
      playing, position, sessionState: () => ({ playing: null, queued: null, followsArrangement: true, ...state }),
    });
    expect(playheadIn(placed, transport(false, 9))).toBeNull();
    expect(playheadIn(placed, transport(true, 9))).toBe(1);
    expect(playheadIn(placed, transport(true, 9, { followsArrangement: false }))).toBeNull();
    expect(playheadIn(inSlot, transport(true, 0, { playing: { slot: 1, elapsed: 5 } }))).toBe(1);
    expect(playheadIn(inSlot, transport(true, 0, { playing: { slot: 0, elapsed: 5 } }))).toBeNull();
    expect(playheadIn(inSlot, transport(true, 0))).toBeNull();
    expect(seekBeatOf(placed, 2)).toBe(10);
    expect(seekBeatOf(inSlot, 2)).toBeNull();
    expect(timelineBeatOf(pl, 99)).toBeNull();
  });
});

describe('offline mixdown', () => {
  it('an empty range is refused; otherwise the graph renders the timeline plus the tail', async () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    let frames = 0;
    const createGraph = (n: number, rate: number): OfflineGraph => {
      frames = n;
      return Object.assign(new FakeGraph(), {
        sampleRate: rate,
        startRendering: async () => ({ numberOfChannels: 2, getChannelData: () => new Float32Array(n) }),
      }) as unknown as OfflineGraph;
    };
    const library = new SampleLibrary({ loadSource: async () => {}, dropSource: async () => {}, renderWarp: async () => [] });
    const deps = { createGraph, library, renders: new RenderCache(async () => []), instruments: new FakeInstruments(), effects: new FakeEffects() };
    await expect(renderMix(store.project, 4, 4, deps)).rejects.toThrow(RangeError);
    const out = await renderMix(store.project, 0, 4, deps, 1000, 0.5);
    expect(out).toHaveLength(2);
    expect(frames).toBe(Math.ceil((store.project.tempo.secondsAt(4) + 0.5) * 1000));
  });
});
