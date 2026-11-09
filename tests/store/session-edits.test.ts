import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { MidiClip } from '../../src/model/midi-clip';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { findClip, placementRef, scaleMidiClipAt, setClipColor, setTrackColor, slotRef, updateClipAt } from '../../src/store/clip-ref';
import { copySlotClip, copySlotClips, pasteClips, pasteSlots, pasteToSlot } from '../../src/store/clipboard';
import { addMidiClip, setLaunchQuantization } from '../../src/store/edits';
import {
  captureScene, clearSlots, deleteScene, duplicateScene, duplicateSlots, importSampleToSlot, insertScene, moveScene, moveSlots, newSlotMidiClip,
  arrangementToScene, renameScene, sceneToArrangement, setSceneColor, updateSlotClip,
} from '../../src/store/session-edits';
import { setup } from '../helpers/fixtures';

const names = (slots: readonly ({ name: string } | null)[]) => slots.map(c => c?.name ?? null);

describe('session: clips in the slots', () => {
  it('new one-bar MIDI clip, looping; moving, copying, emptying', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    const clip = store.project.tracks[0].slots[1] as MidiClip;
    expect(clip).toBeInstanceOf(MidiClip);
    expect([clip.region.end - clip.region.start, clip.loop.enabled]).toEqual([4, true]);

    store.apply(moveSlots([{ track: track(0), slot: 1 }], 1, 2, false));
    expect(store.project.tracks[0].slots[1]).toBeNull();
    expect(store.project.tracks[1].slots[3]?.id).toBe(clip.id);
    store.apply(moveSlots([{ track: track(1), slot: 3 }], 0, -3, true));
    expect(store.project.tracks[1].slots[0]?.id).not.toBe(clip.id); // the copy has its own id
    expect(store.project.tracks[1].slots[3]?.id).toBe(clip.id);
    store.apply(clearSlots([{ track: track(1), slot: 3 }]));
    expect(names(store.project.tracks[1].slots)).toEqual(['Clip MIDI', null, null, null]);
    store.undo();
    store.undo();
    expect(store.project.tracks[1].slots[0]).toBeNull();
  });

  it('an audio clip doesn\'t go on a MIDI track', () => {
    const { store, track, sampleId } = setup({ audio: 1, midi: 1, sample: true });
    store.apply(importSampleToSlot(store.project.sample(sampleId)!, track(0), 0));
    expect(() => store.apply(moveSlots([{ track: track(0), slot: 0 }], 1, 0, false))).toThrow(TypeError);
  });

  it('an audio imported into a slot loops; without an audio track one is created', () => {
    const { store, track, sampleId } = setup({ midi: 1, sample: true });
    const sample = store.project.sample(sampleId)!;
    store.apply(importSampleToSlot(sample, track(0), 2)); // the track is MIDI: an audio one is needed
    const audio = store.project.tracks[1];
    expect(audio.kind).toBe('audio');
    expect(audio.slots[2]?.loop.enabled).toBe(true);
    expect(store.project.tracks[0].slots[2]).toBeNull();
  });

  it('Ctrl+D: copies into the slot below, inserting a scene if it\'s taken', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    store.apply(duplicateSlots([{ track: track(0), slot: 0 }]));
    expect(store.project.scenes).toHaveLength(5);
    expect(names(store.project.tracks[0].slots)).toEqual(['Clip MIDI', 'Clip MIDI', 'Clip MIDI', null, null]);
    expect(store.undoLabel).toBe('Duplicate clip');
  });

  it('scenes: insert, rename, duplicate with copies of the clips, delete', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    const s0 = store.project.scenes[0].id;
    store.apply(renameScene(s0, 'Verse'));
    store.apply(duplicateScene(s0));
    expect(store.project.scenes.map(s => s.name).slice(0, 2)).toEqual(['Verse', 'Verse copy']);
    const [a, b] = store.project.tracks[0].slots;
    expect(a && b && a.id !== b.id).toBe(true);
    store.apply(insertScene(0));
    expect(store.project.scenes).toHaveLength(6);
    expect(store.project.tracks[0].slots[0]).toBeNull();
    store.apply(deleteScene(s0));
    expect(store.project.scenes.map(s => s.name)).toEqual(['6', 'Verse copy', '2', '3', '4']);
  });

  it('moves a scene with its clips, up and down, and it can be undone', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    store.apply(newSlotMidiClip({ track: track(1), slot: 2 }));
    const [a, , c] = [0, 1, 2].map(i => store.project.tracks.map(t => t.slots[i]?.id ?? null));
    const s0 = store.project.scenes[0].id;
    store.apply(moveScene(s0, 2));
    expect(store.project.scenes.map(s => s.name)).toEqual(['2', '3', '1', '4']);
    expect(store.project.tracks.map(t => t.slots[2]?.id ?? null)).toEqual(a);
    expect(store.project.tracks.map(t => t.slots[1]?.id ?? null)).toEqual(c);
    expect(store.undoLabel).toBe('Move scene');
    store.apply(moveScene(store.project.scenes[1].id, 0)); // number 3 to the top
    expect(store.project.scenes.map(s => s.name)).toEqual(['3', '2', '1', '4']);
    store.undo();
    store.undo();
    expect(store.project.scenes.map(s => s.name)).toEqual(['1', '2', '3', '4']);
    expect(store.project.tracks.map(t => t.slots[0]?.id ?? null)).toEqual(a);
  });

  it('scene colour: it\'s chosen, removed, undone, passed to the copy and saved', () => {
    const { store } = setup({ midi: 1 });
    const s0 = store.project.scenes[0].id;
    expect(store.project.scenes[0].color).toBeUndefined();
    store.apply(setSceneColor(s0, '#5b8def'));
    expect(store.project.scenes[0].color).toBe('#5b8def');
    expect(store.undoLabel).toBe('Scene colour');
    store.apply(duplicateScene(s0));
    expect(store.project.scenes[1].color).toBe('#5b8def');
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project));
    expect(back.scenes.map(s => s.color)).toEqual(['#5b8def', '#5b8def', undefined, undefined, undefined]);
    expect('color' in JSON.parse(codec.stringify(store.project)).scenes[2]).toBe(false); // without colour: no field
    store.apply(setSceneColor(s0));
    expect('color' in store.project.scenes[0]).toBe(false);
    store.undo();
    expect(store.project.scenes[0].color).toBe('#5b8def');
  });

  it('capture and insert scene: the playing clips go into the new scene, copies remain in their place', () => {
    const { store, track } = setup({ midi: 3 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    store.apply(newSlotMidiClip({ track: track(1), slot: 2 }));
    store.apply(newSlotMidiClip({ track: track(2), slot: 1 }));
    const [a, b] = [store.project.tracks[0].slots[0]!, store.project.tracks[1].slots[2]!];
    store.apply(captureScene(0, new Map([[track(0), a.id], [track(1), b.id]]))); // track 2 isn't playing
    expect(store.project.scenes).toHaveLength(5);
    const [t0, t1, t2] = store.project.tracks;
    expect([t0.slots[1], t1.slots[1], t2.slots[1]]).toEqual([a, b, null]); // the clips themselves
    expect(t0.slots[0]?.id).not.toBe(a.id); // where they were, some copies
    expect(t1.slots[3]?.id).not.toBe(b.id);
    expect(t1.slots[3]?.name).toBe(b.name);
    expect(t2.slots[2]).not.toBeNull(); // the row below went down by one
    expect(store.undoLabel).toBe('Capture and insert scene');
    store.undo();
    expect(store.project.tracks[0].slots[0]).toBe(a);
  });

  it("scene into the arrangement: copies of the clips from the cursor, as long as the scene", () => {
    const { store, track } = setup({ midi: 3 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    store.apply(newSlotMidiClip({ track: track(1), slot: 1 }));
    store.apply(addMidiClip(track(0), 0, 16)); // under the scene: it's shortened
    store.apply(addMidiClip(track(2), 0, 16));
    const slot = store.project.tracks[0].slots[1]!;
    store.apply(sceneToArrangement(1, 8, 8));
    const [t0, t1, t2] = store.project.tracks;
    expect(t0.arrangement.map(p => [p.start, p.length])).toEqual([[0, 8], [8, 8]]);
    expect(t0.arrangement[1].clip.id).not.toBe(slot.id); // a copy
    expect(t0.slots[1]).toBe(slot); // the slot stays as it is
    expect(t1.arrangement).toHaveLength(1);
    expect(t2.arrangement.map(p => [p.start, p.length])).toEqual([[0, 16]]); // track 2 has no clip in the scene
    expect(store.undoLabel).toBe('Scene to the arrangement');
    store.undo();
    expect(store.project.tracks[0].arrangement.map(p => [p.start, p.length])).toEqual([[0, 16]]);
  });

  it('the arrangement\'s clips in a new scene at the bottom, looping', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(1), 0, 4));
    const clip = store.project.tracks[1].arrangement[0].clip.withId(asId('clip-copy')).withLoop({ enabled: false, start: 0, end: 4 });
    const scenes = store.project.scenes.length;
    store.apply(arrangementToScene('Bars 1-2', [{ track: track(1), clip }]));
    const p = store.project;
    expect(p.scenes.map(s => s.name).at(-1)).toBe('Bars 1-2');
    expect(p.scenes).toHaveLength(scenes + 1);
    expect(p.tracks[0].slots[scenes]).toBeNull();
    expect([p.tracks[1].slots[scenes]?.id, p.tracks[1].slots[scenes]?.loop.enabled]).toEqual([clip.id, true]);
    expect(store.undoLabel).toBe('Arrangement to session');
    store.undo();
    expect(store.project.scenes).toHaveLength(scenes);
  });

  it('they\'re saved: clips in the slots, scenes and launch quantization; a v4 file opens', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 2 }));
    store.apply(setLaunchQuantization('1/4'));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project));
    expect(back.launchQuantization).toBe('1/4');
    expect(back.tracks[0].slots[2]?.id).toBe(store.project.tracks[0].slots[2]?.id);
    const json = JSON.parse(codec.stringify(store.project));
    json.version = 4;
    delete json.launchQuantization;
    expect(codec.decode(json).launchQuantization).toBe('1bar');
  });
});

describe('ClipRef: the same clip, on the timeline or in a slot', () => {
  it('finds and edits the clip wherever it is', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    const pl = store.project.tracks[0].arrangement[0];
    const slotClip = store.project.tracks[0].slots[1]!;
    const onTimeline = placementRef(track(0), pl.id), inSlot = slotRef(track(0), slotClip.id);
    expect(findClip(store.project, onTimeline)?.placement?.id).toBe(pl.id);
    expect(findClip(store.project, inSlot)?.placement).toBeNull();
    store.apply(updateClipAt<MidiClip>('n', inSlot, c => c.withName('Slot')));
    store.apply(updateClipAt<MidiClip>('n', onTimeline, c => c.withName('Timeline')));
    expect([store.project.tracks[0].slots[1]!.name, store.project.tracks[0].arrangement[0].clip.name]).toEqual(['Slot', 'Timeline']);
    // the slot's clip is found by id even if the scenes move
    store.apply(insertScene(0));
    expect(findClip(store.project, inSlot)?.clip.name).toBe('Slot');
  });
});

describe('MIDI :2 e ×2', () => {
  const notes = [{ pitch: 60, start: 1, duration: 0.5, velocity: 100 }, { pitch: 64, start: 2.5, duration: 1, velocity: 90 }];

  it('scales notes, region, loop and modulations', () => {
    const clip = MidiClip.create({
      id: asId('clip-1'), name: 'm', color: '#fff', notes,
      region: { start: 0, end: 4 }, loop: { enabled: true, start: 0, end: 4 },
      envelopes: [{ target: { kind: 'mixer', param: 'volume' }, points: [{ beat: 0, value: 1 }, { beat: 3, value: 0.5 }] }],
    });
    const twice = clip.scaledTime(2);
    expect(twice.notes.map(n => [n.start, n.duration, n.pitch, n.velocity])).toEqual([[2, 1, 60, 100], [5, 2, 64, 90]]);
    expect(twice.region).toEqual({ start: 0, end: 8 });
    expect(twice.loop).toEqual({ enabled: true, start: 0, end: 8 });
    expect(twice.envelopes[0].points.map(p => p.beat)).toEqual([0, 6]);
    // :2 after ×2 goes back to how it was
    expect(twice.scaledTime(0.5).notes).toEqual(clip.notes);
    expect(() => clip.scaledTime(0)).toThrow();
  });

  it('on the timeline the clip\'s length changes too; in the session only the content; it can be undone', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 8, 4));
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    const pl = store.project.tracks[0].arrangement[0], slotClip = store.project.tracks[0].slots[0]!;
    const onTimeline = placementRef(track(0), pl.id), inSlot = slotRef(track(0), slotClip.id);
    store.apply(updateClipAt<MidiClip>('n', onTimeline, c => c.withNotes(notes)));

    store.apply(scaleMidiClipAt('Length ×2', onTimeline, 2));
    const scaled = store.project.tracks[0].arrangement[0];
    expect([scaled.start, scaled.length]).toEqual([8, 8]);
    expect((scaled.clip as MidiClip).notes.map(n => n.start)).toEqual([2, 5]);

    store.apply(scaleMidiClipAt('Length :2', inSlot, 0.5));
    const half = store.project.tracks[0].slots[0]!;
    expect([half.region.end, half.loop.end]).toEqual([slotClip.region.end / 2, slotClip.loop.end / 2]);

    store.undo();
    store.undo();
    expect(store.project.tracks[0].arrangement[0].length).toBe(4);
  });
});

describe('several clips together', () => {
  /** Two tracks with clips 'a' and 'b' in scene 0 and 'c' in the first's scene 1. */
  const grid = () => {
    const s = setup({ midi: 3 });
    const add = (t: number, slot: number, name: string) => {
      s.store.apply(newSlotMidiClip({ track: s.track(t), slot }));
      const id = s.store.project.tracks[t].slots[slot]!.id;
      s.store.apply(updateSlotClip('name', s.track(t), id, c => c.withName(name)));
    };
    add(0, 0, 'a');
    add(1, 0, 'b');
    add(0, 1, 'c');
    return { ...s, refs: [{ track: s.track(0), slot: 0 }, { track: s.track(1), slot: 0 }, { track: s.track(0), slot: 1 }] };
  };
  const row = (store: ReturnType<typeof setup>['store'], t: number) => names(store.project.tracks[t].slots);

  it('they move together, with a single undo step', () => {
    const { store, refs } = grid();
    store.apply(moveSlots(refs, 1, 2, false));
    expect(row(store, 0)).toEqual([null, null, null, null]);
    expect(row(store, 1)).toEqual([null, null, 'a', 'c']);
    expect(row(store, 2)).toEqual([null, null, 'b', null]);
    store.undo();
    expect(row(store, 0)).toEqual(['a', 'c', null, null]);
  });

  it('moving them onto themselves nothing is lost', () => {
    const { store, track } = grid();
    store.apply(moveSlots([{ track: track(0), slot: 0 }, { track: track(0), slot: 1 }], 0, 1, false));
    expect(row(store, 0)).toEqual([null, 'a', 'c', null]);
  });

  it('if one would leave the grid nothing moves', () => {
    const { store, refs } = grid();
    expect(() => store.apply(moveSlots(refs, 2, 0, false))).toThrow('would leave');
    expect(() => store.apply(moveSlots(refs, 0, -1, false))).toThrow('would leave');
    expect(row(store, 0)).toEqual(['a', 'c', null, null]);
  });

  it('a copy has new ids', () => {
    const { store, refs } = grid();
    store.apply(moveSlots(refs, 0, 2, true));
    expect(row(store, 0)).toEqual(['a', 'c', 'a', 'c']);
    expect(store.project.tracks[0].slots[2]!.id).not.toBe(store.project.tracks[0].slots[0]!.id);
  });

  it('they empty together', () => {
    const { store, refs } = grid();
    store.apply(clearSlots(refs));
    expect([...row(store, 0), ...row(store, 1)].every(c => c === null)).toBe(true);
    store.undo();
    expect(row(store, 1)[0]).toBe('b');
  });

  it('Ctrl+D copies the block below; if there\'s no room it inserts the needed scenes', () => {
    const { store, refs } = grid();
    store.apply(duplicateSlots(refs));
    expect(row(store, 0)).toEqual(['a', 'c', 'a', 'c']);
    expect(row(store, 1)).toEqual(['b', null, 'b', null]);
    expect(store.project.scenes).toHaveLength(4);
    store.apply(duplicateSlots(refs));
    expect(store.project.scenes).toHaveLength(6);
    expect(row(store, 0)).toEqual(['a', 'c', 'a', 'c', 'a', 'c']);
  });

  it('in the clipboard they keep the shape of the grid, even pasted further on', () => {
    const { store, refs, track } = grid();
    const copied = copySlotClips(store.project, refs)!;
    expect(pasteSlots(store.project, copied, track(1), 3)).toHaveLength(3);
    store.apply(pasteToSlot(copied, track(1), 3)); // an extra scene is needed
    expect(store.project.scenes).toHaveLength(5);
    expect(row(store, 1)).toEqual(['b', null, null, 'a', 'c']);
    expect(row(store, 2)).toEqual([null, null, null, 'b', null]);
    expect(store.project.tracks[1].slots[4]!.loop.enabled).toBe(true);
  });

  it('those without a suitable track are skipped', () => {
    const { store, refs, track } = grid();
    store.apply(pasteToSlot(copySlotClips(store.project, refs)!, track(2), 2));
    expect(row(store, 2)).toEqual([null, null, 'a', 'c']);
  });

  it('on the timeline the scenes go one after the other', () => {
    const { store, refs } = grid();
    const copied = copySlotClips(store.project, refs)!;
    expect(copied.span).toBe(8);
    store.apply(pasteClips(copied, 0, 0));
    expect(store.project.tracks[0].arrangement.map(pl => [pl.start, pl.clip.name])).toEqual([[0, 'a'], [4, 'c']]);
    expect(store.project.tracks[1].arrangement.map(pl => pl.start)).toEqual([0]);
  });
});

describe('clipboard between session and timeline', () => {
  it('a clip copied from a slot is pasted in another slot or on the timeline', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    const copied = copySlotClip(store.project, track(0), 0)!;
    store.apply(pasteToSlot(copied, track(1), 2));
    expect(store.project.tracks[1].slots[2]?.loop.enabled).toBe(true);
    store.apply(pasteClips(copied, 1, 8));
    const pl = store.project.tracks[1].arrangement[0];
    expect([pl.start, pl.length]).toEqual([8, 4]);
  });
});

describe('clip colour', () => {
  it('colours timeline and slot clips together; without colour the track\'s comes back', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(newSlotMidiClip({ track: track(1), slot: 0 }));
    const p0 = store.project;
    const refs = [placementRef(track(0), p0.tracks[0].arrangement[0].id), slotRef(track(1), p0.tracks[1].slots[0]!.id)];
    const colors = () => refs.map(r => findClip(store.project, r)!.clip.color);

    store.apply(setClipColor(refs, '#5b8def'));
    expect(colors()).toEqual(['#5b8def', '#5b8def']);
    expect(store.undoLabel).toBe('Clip colours');

    store.apply(setClipColor(refs));
    expect(colors()).toEqual([store.project.tracks[0].color, store.project.tracks[1].color]);

    store.undo();
    store.undo(); // a single step for all the clips
    expect(colors()).toEqual(refs.map(r => findClip(p0, r)!.clip.color));
  });

  it('the track\'s colour: the clips with its colour follow it, those coloured by hand don\'t', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(0), 4, 4));
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    const t0 = store.project.tracks[0];
    const [a, b] = t0.arrangement.map(pl => placementRef(track(0), pl.id));
    const slot = slotRef(track(0), t0.slots[0]!.id);
    store.apply(setClipColor([b], '#e36bd0'));
    const color = (r: typeof a) => findClip(store.project, r)!.clip.color;

    store.apply(setTrackColor(track(0), '#4bc3d6'));
    expect(store.project.tracks[0].color).toBe('#4bc3d6');
    expect([color(a), color(b), color(slot)]).toEqual(['#4bc3d6', '#e36bd0', '#4bc3d6']);

    store.undo(); // a single step for track and clips
    expect(store.project.tracks[0].color).toBe(t0.color);
    expect([color(a), color(slot)]).toEqual([t0.color, t0.color]);
  });
});
