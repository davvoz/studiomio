import { describe, expect, it } from 'vitest';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { MidiTrack } from '../../src/model/track';
import { MASTER } from '../../src/model/project';
import { copyDevices, copyRack, pasteDevices, removeDevices } from '../../src/store/device-clipboard';
import { addEffect, setEffectParam, setEffectSidechain, setInstrumentParam, setModTarget } from '../../src/store/edits';
import { groupDevices, mapMacro } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

const types = (list: readonly { type: string }[]) => list.map(e => e.type);

describe('devices on the clipboard', () => {
  const chain = () => {
    const s = setup({ midi: 3 });
    s.store.apply(addEffect(s.track(0), 'delay', 'Delay'));
    s.store.apply(addEffect(s.track(0), 'reverb', 'Reverb'));
    const effects = () => s.store.project.effectsOf(s.track(0));
    return { ...s, effects };
  };

  it('an effect is pasted on another track with its values and a new id', () => {
    const { store, track, effects } = chain();
    const delay = effects()[0];
    store.apply(setEffectParam(track(0), delay.id, 'mix', 33));
    const copied = copyDevices(store.project, track(0), [delay.id])!;
    store.apply(pasteDevices(copied, track(1)));
    const [pasted] = store.project.effectsOf(track(1));
    expect(pasted.type).toBe('delay');
    expect(pasted.params.mix).toBe(33);
    expect(pasted.id).not.toBe(delay.id);
    store.undo();
    expect(store.project.effectsOf(track(1))).toHaveLength(0);
  });

  it('it\'s pasted after the chosen device, and on the master', () => {
    const { store, track, effects } = chain();
    const [delay, reverb] = effects();
    store.apply(pasteDevices(copyDevices(store.project, track(0), [reverb.id])!, track(0), delay.id));
    expect(types(effects())).toEqual(['delay', 'reverb', 'reverb']);
    store.apply(pasteDevices(copyDevices(store.project, track(0), [delay.id])!, MASTER));
    expect(types(store.project.masterEffects)).toEqual(['delay']);
  });

  it('after the instrument the effects go at the start of the chain', () => {
    const { store, track, effects } = chain();
    store.apply(pasteDevices(copyDevices(store.project, track(0), [effects()[1].id])!, track(0), INSTRUMENT_DEVICE));
    expect(types(effects())).toEqual(['reverb', 'delay', 'reverb']);
  });

  it('it doesn\'t end up in the middle of a rack', () => {
    const { store, track, effects } = chain();
    const [delay, reverb] = effects();
    store.apply(groupDevices(track(0), [delay.id, reverb.id]));
    store.apply(pasteDevices(copyDevices(store.project, track(0), [delay.id])!, track(0), delay.id));
    expect(types(effects())).toEqual(['delay', 'reverb', 'delay']);
    expect(store.project.racksOf(track(0))[0].devices).toEqual([delay.id, reverb.id]);
  });

  it('the instrument takes the place of the track\'s; on an audio track it doesn\'t go', () => {
    const s = setup({ midi: 2, audio: 1 });
    const audio = s.store.project.tracks.find(t => !(t instanceof MidiTrack))!.id;
    const [from, to] = s.store.project.tracks.filter(t => t instanceof MidiTrack).map(t => t.id);
    s.store.apply(setInstrumentParam(from, 'cutoff', 321));
    const copied = copyDevices(s.store.project, from, [INSTRUMENT_DEVICE])!;
    s.store.apply(pasteDevices(copied, to));
    expect((s.store.project.track(to) as MidiTrack).instrument.params.cutoff).toBe(321);
    expect(() => s.store.apply(pasteDevices(copied, audio))).toThrow('MIDI');
  });

  it('a modulator carries along the target copied with it, the others are lost elsewhere', () => {
    const { store, track, effects } = chain();
    store.apply(addEffect(track(0), 'lfo', 'LFO'));
    const [delay, , lfo] = effects();
    store.apply(setModTarget(track(0), lfo.id, 0, { kind: 'device', device: delay.id, param: 'mix' }));
    store.apply(setModTarget(track(0), lfo.id, 1, { kind: 'mixer', param: 'pan' }));
    const both = copyDevices(store.project, track(0), [delay.id, lfo.id])!;
    store.apply(pasteDevices(both, track(1)));
    const [newDelay, newLfo] = store.project.effectsOf(track(1));
    expect(newLfo.targets?.[0]).toEqual({ kind: 'device', device: newDelay.id, param: 'mix' });
    expect(newLfo.targets?.[1]).toEqual({ kind: 'mixer', param: 'pan' });
    store.apply(pasteDevices(copyDevices(store.project, track(0), [lfo.id])!, track(2)));
    expect(store.project.effectsOf(track(2))[0].targets?.[0]).toBeNull();
    // in the same chain it stays
    store.apply(pasteDevices(copyDevices(store.project, track(0), [lfo.id])!, track(0)));
    expect(effects().at(-1)!.targets?.[0]).toEqual({ kind: 'device', device: delay.id, param: 'mix' });
  });

  it('a track doesn\'t listen to itself', () => {
    const { store, track } = chain();
    store.apply(addEffect(track(1), 'compressor', 'Compressor'));
    const [comp] = store.project.effectsOf(track(1));
    store.apply(setEffectSidechain(track(1), comp.id, track(0)));
    const copied = copyDevices(store.project, track(1), [comp.id])!;
    store.apply(pasteDevices(copied, track(0)));
    store.apply(pasteDevices(copied, track(2)));
    expect(store.project.effectsOf(track(0)).at(-1)!.sidechain).toBeUndefined();
    expect(store.project.effectsOf(track(2))[0].sidechain).toBe(track(0));
  });

  it('a rack is copied with the macros and the sidechain', () => {
    const { store, track, effects } = chain();
    const [delay, reverb] = effects();
    store.apply(setEffectSidechain(track(0), delay.id, track(2)));
    store.apply(groupDevices(track(0), [delay.id, reverb.id]));
    const rack = store.project.racksOf(track(0))[0];
    store.apply(mapMacro(track(0), rack.id, 0, delay.id, 'mix'));
    store.apply(pasteDevices(copyRack(store.project, track(0), rack.id)!, track(1)));
    const [newRack] = store.project.racksOf(track(1));
    const added = store.project.effectsOf(track(1));
    expect(types(added)).toEqual(['delay', 'reverb']);
    expect(newRack.id).not.toBe(rack.id);
    expect(newRack.macros[0].mappings[0].device).toBe(added[0].id);
    expect(added[0].sidechain).toBe(track(2));
  });

  it('cutting removes the effects in a single step and leaves the instrument', () => {
    const { store, track, effects } = chain();
    const [delay, reverb] = effects();
    store.apply(removeDevices(track(0), [INSTRUMENT_DEVICE, delay.id, reverb.id]));
    expect(effects()).toHaveLength(0);
    expect(store.project.track(track(0))).toBeInstanceOf(MidiTrack);
    store.undo();
    expect(effects()).toHaveLength(2);
  });

});
