import { describe, expect, it } from 'vitest';
import { ProjectCodec } from '../../src/persistence/project-codec';
import {
  addEffect, loadEffectPreset, moveEffect, removeEffect, setEffectEnabled, setEffectParam,
} from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

describe('catena degli effetti', () => {
  const rig = () => {
    const s = setup({ audio: 1, midi: 1 });
    const fx = (t = 0) => s.store.project.tracks[t].effects;
    return { ...s, fx };
  };

  it('aggiungere, regolare, spegnere: ogni passo si annulla', () => {
    const { store, track, fx } = rig();
    store.apply(addEffect(track(0), 'delay', 'Delay'));
    expect(fx()).toEqual([{ id: fx()[0].id, type: 'delay', enabled: true, preset: null, params: {} }]);
    expect(store.undoLabel).toBe('Aggiungi Delay');
    const id = fx()[0].id;
    store.apply(setEffectParam(track(0), id, 'feedback', 60));
    store.apply(setEffectEnabled(track(0), id, false));
    expect(fx()[0]).toMatchObject({ enabled: false, params: { feedback: 60 } });
    store.undo();
    store.undo();
    expect(fx()[0]).toMatchObject({ enabled: true, params: {} });
  });

  it('su tracce audio e MIDI; preset; ordine e rimozione', () => {
    const { store, track, fx } = rig();
    store.apply(addEffect(track(1), 'delay', 'Delay'));
    store.apply(addEffect(track(1), 'delay', 'Delay'));
    const [a, b] = fx(1).map(e => e.id);
    store.apply(loadEffectPreset(track(1), b, 'Dub', { feedback: 75 }));
    expect(fx(1)[1]).toMatchObject({ preset: 'Dub', params: { feedback: 75 } });
    store.apply(moveEffect(track(1), b, 0));
    expect(fx(1).map(e => e.id)).toEqual([b, a]);
    store.apply(removeEffect(track(1), b));
    expect(fx(1).map(e => e.id)).toEqual([a]);
    expect(() => store.apply(removeEffect(track(1), b))).toThrow(/non trovato/);
  });

  it('si salvano; un file della versione 2 si apre senza effetti', () => {
    const { store, track } = rig();
    store.apply(addEffect(track(0), 'delay', 'Delay'));
    const id = store.project.tracks[0].effects[0].id;
    store.apply(setEffectParam(track(0), id, 'mix', 45));
    store.apply(setEffectEnabled(track(0), id, false));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project));
    expect(back.tracks[0].effects).toEqual(store.project.tracks[0].effects);

    const json = JSON.parse(codec.stringify(store.project));
    json.version = 2;
    for (const t of json.tracks) delete t.effects;
    expect(codec.decode(json).tracks.map(t => t.effects)).toEqual([[], []]);
  });
});
