import { describe, expect, it } from 'vitest';
import { MidiClip } from '../../src/model/midi-clip';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { findClip, placementRef, slotRef, updateClipAt } from '../../src/store/clip-ref';
import { copySlotClip, pasteClips, pasteToSlot } from '../../src/store/clipboard';
import { addMidiClip, setLaunchQuantization } from '../../src/store/edits';
import {
  captureScene, clearSlot, deleteScene, duplicateScene, duplicateSlotClip, importSampleToSlot, insertScene, moveSlotClip, newSlotMidiClip,
  renameScene,
} from '../../src/store/session-edits';
import { setup } from '../helpers/fixtures';

const names = (slots: readonly ({ name: string } | null)[]) => slots.map(c => c?.name ?? null);

describe('session: clip negli slot', () => {
  it('clip MIDI nuova di una battuta, in loop; spostare, copiare, svuotare', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    const clip = store.project.tracks[0].slots[1] as MidiClip;
    expect(clip).toBeInstanceOf(MidiClip);
    expect([clip.region.end - clip.region.start, clip.loop.enabled]).toEqual([4, true]);

    store.apply(moveSlotClip({ track: track(0), slot: 1 }, { track: track(1), slot: 3 }, false));
    expect(store.project.tracks[0].slots[1]).toBeNull();
    expect(store.project.tracks[1].slots[3]?.id).toBe(clip.id);
    store.apply(moveSlotClip({ track: track(1), slot: 3 }, { track: track(1), slot: 0 }, true));
    expect(store.project.tracks[1].slots[0]?.id).not.toBe(clip.id); // la copia ha un id suo
    expect(store.project.tracks[1].slots[3]?.id).toBe(clip.id);
    store.apply(clearSlot({ track: track(1), slot: 3 }));
    expect(names(store.project.tracks[1].slots)).toEqual(['Clip MIDI', null, null, null]);
    store.undo();
    store.undo();
    expect(store.project.tracks[1].slots[0]).toBeNull();
  });

  it('una clip audio non va su una traccia MIDI', () => {
    const { store, track, sampleId } = setup({ audio: 1, midi: 1, sample: true });
    store.apply(importSampleToSlot(store.project.sample(sampleId)!, track(0), 0));
    expect(() => store.apply(moveSlotClip({ track: track(0), slot: 0 }, { track: track(1), slot: 0 }, false))).toThrow(TypeError);
  });

  it('un audio importato in uno slot è in loop; senza traccia audio ne nasce una', () => {
    const { store, track, sampleId } = setup({ midi: 1, sample: true });
    const sample = store.project.sample(sampleId)!;
    store.apply(importSampleToSlot(sample, track(0), 2)); // la traccia è MIDI: ne serve una audio
    const audio = store.project.tracks[1];
    expect(audio.kind).toBe('audio');
    expect(audio.slots[2]?.loop.enabled).toBe(true);
    expect(store.project.tracks[0].slots[2]).toBeNull();
  });

  it('Ctrl+D: copia nello slot sotto, inserendo una scena se è occupato', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    store.apply(newSlotMidiClip({ track: track(0), slot: 1 }));
    store.apply(duplicateSlotClip({ track: track(0), slot: 0 }));
    expect(store.project.scenes).toHaveLength(5);
    expect(names(store.project.tracks[0].slots)).toEqual(['Clip MIDI', 'Clip MIDI', 'Clip MIDI', null, null]);
    expect(store.undoLabel).toBe('Duplica clip');
  });

  it('scene: inserisci, rinomina, duplica con copie delle clip, elimina', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    const s0 = store.project.scenes[0].id;
    store.apply(renameScene(s0, 'Strofa'));
    store.apply(duplicateScene(s0));
    expect(store.project.scenes.map(s => s.name).slice(0, 2)).toEqual(['Strofa', 'Strofa copia']);
    const [a, b] = store.project.tracks[0].slots;
    expect(a && b && a.id !== b.id).toBe(true);
    store.apply(insertScene(0));
    expect(store.project.scenes).toHaveLength(6);
    expect(store.project.tracks[0].slots[0]).toBeNull();
    store.apply(deleteScene(s0));
    expect(store.project.scenes.map(s => s.name)).toEqual(['6', 'Strofa copia', '2', '3', '4']);
  });

  it('cattura e inserisci scena: le clip che suonano vanno nella scena nuova, al loro posto restano copie', () => {
    const { store, track } = setup({ midi: 3 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    store.apply(newSlotMidiClip({ track: track(1), slot: 2 }));
    store.apply(newSlotMidiClip({ track: track(2), slot: 1 }));
    const [a, b] = [store.project.tracks[0].slots[0]!, store.project.tracks[1].slots[2]!];
    store.apply(captureScene(0, new Map([[track(0), a.id], [track(1), b.id]]))); // la traccia 2 non suona
    expect(store.project.scenes).toHaveLength(5);
    const [t0, t1, t2] = store.project.tracks;
    expect([t0.slots[1], t1.slots[1], t2.slots[1]]).toEqual([a, b, null]); // le clip stesse
    expect(t0.slots[0]?.id).not.toBe(a.id); // dove erano, delle copie
    expect(t1.slots[3]?.id).not.toBe(b.id);
    expect(t1.slots[3]?.name).toBe(b.name);
    expect(t2.slots[2]).not.toBeNull(); // la riga sotto è scesa di uno
    expect(store.undoLabel).toBe('Cattura e inserisci scena');
    store.undo();
    expect(store.project.tracks[0].slots[0]).toBe(a);
  });

  it('si salvano: clip negli slot, scene e quantizzazione del lancio; un file v4 si apre', () => {
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

describe('ClipRef: la stessa clip, sulla timeline o in uno slot', () => {
  it('trova e modifica la clip dovunque stia', () => {
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
    // la clip dello slot si trova per id anche se le scene si spostano
    store.apply(insertScene(0));
    expect(findClip(store.project, inSlot)?.clip.name).toBe('Slot');
  });
});

describe('appunti tra session e timeline', () => {
  it('una clip copiata da uno slot si incolla in un altro slot o sulla timeline', () => {
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
