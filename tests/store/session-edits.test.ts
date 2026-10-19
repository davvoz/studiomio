import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { MidiClip } from '../../src/model/midi-clip';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { findClip, placementRef, scaleMidiClipAt, setClipColor, setTrackColor, slotRef, updateClipAt } from '../../src/store/clip-ref';
import { copySlotClip, pasteClips, pasteToSlot } from '../../src/store/clipboard';
import { addMidiClip, setLaunchQuantization } from '../../src/store/edits';
import {
  captureScene, clearSlot, deleteScene, duplicateScene, duplicateSlotClip, importSampleToSlot, insertScene, moveSlotClip, newSlotMidiClip,
  renameScene, setSceneColor,
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

  it('colore delle scene: si sceglie, si toglie, si annulla, passa alla copia e si salva', () => {
    const { store } = setup({ midi: 1 });
    const s0 = store.project.scenes[0].id;
    expect(store.project.scenes[0].color).toBeUndefined();
    store.apply(setSceneColor(s0, '#5b8def'));
    expect(store.project.scenes[0].color).toBe('#5b8def');
    expect(store.undoLabel).toBe('Colore della scena');
    store.apply(duplicateScene(s0));
    expect(store.project.scenes[1].color).toBe('#5b8def');
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project));
    expect(back.scenes.map(s => s.color)).toEqual(['#5b8def', '#5b8def', undefined, undefined, undefined]);
    expect('color' in JSON.parse(codec.stringify(store.project)).scenes[2]).toBe(false); // senza colore: niente campo
    store.apply(setSceneColor(s0));
    expect('color' in store.project.scenes[0]).toBe(false);
    store.undo();
    expect(store.project.scenes[0].color).toBe('#5b8def');
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

describe('MIDI :2 e ×2', () => {
  const notes = [{ pitch: 60, start: 1, duration: 0.5, velocity: 100 }, { pitch: 64, start: 2.5, duration: 1, velocity: 90 }];

  it('scala note, regione, loop e modulazioni', () => {
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
    // :2 dopo ×2 torna com'era
    expect(twice.scaledTime(0.5).notes).toEqual(clip.notes);
    expect(() => clip.scaledTime(0)).toThrow();
  });

  it('sulla timeline cambia anche la durata della clip; nella session solo il contenuto; si annulla', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 8, 4));
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    const pl = store.project.tracks[0].arrangement[0], slotClip = store.project.tracks[0].slots[0]!;
    const onTimeline = placementRef(track(0), pl.id), inSlot = slotRef(track(0), slotClip.id);
    store.apply(updateClipAt<MidiClip>('n', onTimeline, c => c.withNotes(notes)));

    store.apply(scaleMidiClipAt('Durata ×2', onTimeline, 2));
    const scaled = store.project.tracks[0].arrangement[0];
    expect([scaled.start, scaled.length]).toEqual([8, 8]);
    expect((scaled.clip as MidiClip).notes.map(n => n.start)).toEqual([2, 5]);

    store.apply(scaleMidiClipAt('Durata :2', inSlot, 0.5));
    const half = store.project.tracks[0].slots[0]!;
    expect([half.region.end, half.loop.end]).toEqual([slotClip.region.end / 2, slotClip.loop.end / 2]);

    store.undo();
    store.undo();
    expect(store.project.tracks[0].arrangement[0].length).toBe(4);
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

describe('colore delle clip', () => {
  it('colora insieme clip della timeline e degli slot; senza colore torna quello della traccia', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(newSlotMidiClip({ track: track(1), slot: 0 }));
    const p0 = store.project;
    const refs = [placementRef(track(0), p0.tracks[0].arrangement[0].id), slotRef(track(1), p0.tracks[1].slots[0]!.id)];
    const colors = () => refs.map(r => findClip(store.project, r)!.clip.color);

    store.apply(setClipColor(refs, '#5b8def'));
    expect(colors()).toEqual(['#5b8def', '#5b8def']);
    expect(store.undoLabel).toBe('Colore delle clip');

    store.apply(setClipColor(refs));
    expect(colors()).toEqual([store.project.tracks[0].color, store.project.tracks[1].color]);

    store.undo();
    store.undo(); // un solo passo per tutte le clip
    expect(colors()).toEqual(refs.map(r => findClip(p0, r)!.clip.color));
  });

  it('il colore della traccia: le clip con il suo colore lo seguono, quelle colorate a mano no', () => {
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

    store.undo(); // un solo passo per traccia e clip
    expect(store.project.tracks[0].color).toBe(t0.color);
    expect([color(a), color(slot)]).toEqual([t0.color, t0.color]);
  });
});
