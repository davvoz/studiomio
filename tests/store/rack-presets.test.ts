import { describe, expect, it } from 'vitest';
import type { DeviceId } from '../../src/core/id';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { MASTER } from '../../src/model/project';
import { captureRack, rackPresetFrom, type RackPreset } from '../../src/model/rack-preset';
import { AudioTrack, MidiTrack } from '../../src/model/track';
import { loadRack } from '../../src/store/browser-edits';
import { addEffect, addTrack, setEffectParam, setEffectSidechain, setInstrument, setInstrumentParam } from '../../src/store/edits';
import { groupDevices, mapMacro, renameMacro, setMacro, setMacroMode, setMappingRange } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

/** Una traccia MIDI con Analog e due effetti, tutti in un Instrument Rack con due macro mappate. */
function rig() {
  const s = setup({ midi: 1, audio: 1 });
  const t = s.track(1);
  const audio = s.track(0);
  s.store.apply(setInstrumentParam(t, 'cutoff', 800));
  s.store.apply(addEffect(t, 'delay', 'Delay'));
  s.store.apply(addEffect(t, 'compressor', 'Compressor'));
  const midi = () => s.store.project.track(t) as MidiTrack;
  const [delay, comp] = midi().effects.map(e => e.id);
  s.store.apply(setEffectParam(t, delay, 'feedback', 60));
  s.store.apply(setEffectSidechain(t, comp, audio));
  s.store.apply(groupDevices(t, [INSTRUMENT_DEVICE, delay, comp]));
  const rack = midi().racks[0].id;
  s.store.apply(mapMacro(t, rack, 0, INSTRUMENT_DEVICE, 'cutoff'));
  s.store.apply(mapMacro(t, rack, 0, delay, 'mix'));
  s.store.apply(setMappingRange(t, delay, 'mix', { min: 10, max: 90 }));
  s.store.apply(renameMacro(t, rack, 0, 'Apri'));
  s.store.apply(setMacro(t, rack, 0, 100));
  s.store.apply(mapMacro(t, rack, 1, comp, 'threshold'));
  s.store.apply(setMacroMode(t, rack, 1, 'toggle'));
  return { ...s, t, audio, midi, delay, comp, rack };
}

/** Come lo rilegge l'app da un file. */
const roundTrip = (r: RackPreset) => rackPresetFrom(JSON.parse(JSON.stringify(r)));

describe('rack salvati: cosa si salva', () => {
  it('dispositivi, parametri e macro; le mappature per posto nel rack; niente sidechain', () => {
    const r = rig();
    const saved = captureRack(r.store.project, r.t, r.rack, 'Basso sporco');
    expect(saved.name).toBe('Basso sporco');
    expect(saved.instrument).toMatchObject({ type: 'analog', params: { cutoff: expect.any(Number) } });
    expect(saved.effects.map(e => e.type)).toEqual(['delay', 'compressor']);
    expect(saved.effects[0].params.feedback).toBe(60);
    expect(saved.effects[1]).not.toHaveProperty('sidechain');
    expect(saved.macros).toHaveLength(8);
    expect(saved.macros[0]).toMatchObject({ name: 'Apri', value: 100 });
    expect(saved.macros[0].mappings.map(m => [m.device, m.param])).toEqual([[0, 'cutoff'], [1, 'mix']]);
    expect(saved.macros[0].mappings[1]).toMatchObject({ min: 10, max: 90 });
    expect(saved.macros[1]).toMatchObject({ mode: 'toggle', mappings: [{ device: 2, param: 'threshold' }] });
    // da un file si rilegge uguale
    expect(roundTrip(saved)).toEqual(saved);
  });

  it('Audio Effect Rack: senza strumento', () => {
    const r = rig();
    r.store.apply(addEffect(r.audio, 'delay', 'Delay'));
    const fx = (r.store.project.track(r.audio) as AudioTrack).effects[0].id;
    r.store.apply(groupDevices(r.audio, [fx]));
    const id = r.store.project.racksOf(r.audio)[0].id;
    const saved = captureRack(r.store.project, r.audio, id, 'Eco');
    expect([saved.instrument, saved.effects.length]).toEqual([null, 1]);
    expect(() => captureRack(r.store.project, r.t, 'nessuno' as DeviceId, 'x')).toThrow(/non trovato/);
  });

  it('dati letti da fuori: ciò che non vale si salta', () => {
    expect(rackPresetFrom(null)).toBeNull();
    expect(rackPresetFrom({ name: 'Vuoto', instrument: null, effects: [] })).toBeNull();
    expect(rackPresetFrom({ name: '', instrument: null, effects: [{ type: 'delay', params: {} }] })).toBeNull();
    expect(rackPresetFrom({ name: 'X', instrument: { params: {} }, effects: [] })).toBeNull();
    expect(rackPresetFrom({ name: 'X', instrument: null, effects: [{ type: 'delay' }] })).toBeNull();
    const r = rackPresetFrom({
      name: 'X', effects: [{ type: 'delay', params: { mix: 50, bad: 'no', inf: null }, enabled: false }],
      macros: [
        { name: 'M', value: 300, mappings: [{ device: 0, param: 'mix', min: 0, max: 100 }, { device: 1, param: 'mix', min: 0, max: 1 }, { device: 0, param: 'x' }] },
        { value: 100, mode: 'toggle', mappings: [] },
        { value: 50, mode: 'strano' },
      ],
    })!;
    expect(r.instrument).toBeNull();
    expect(r.effects).toEqual([{ type: 'delay', preset: null, params: { mix: 50 }, enabled: false }]);
    expect(r.macros).toHaveLength(8);
    expect(r.macros[0]).toEqual({ name: 'M', value: 127, mappings: [{ device: 0, param: 'mix', min: 0, max: 100 }] });
    expect(r.macros[1]).toEqual({ name: null, value: 127, mode: 'toggle', mappings: [] });
    expect(r.macros[2]).toEqual({ name: null, value: 50, mappings: [] });
    expect(r.macros[7]).toEqual({ name: null, value: 0, mappings: [] });
  });
});

describe('rack salvati: caricarli', () => {
  it('Instrument Rack su un\'altra traccia MIDI: strumento, effetti prima degli altri, macro sui dispositivi nuovi', () => {
    const r = rig();
    const saved = roundTrip(captureRack(r.store.project, r.t, r.rack, 'Basso sporco'))!;
    r.store.apply(addTrack('midi'));
    const other = r.track(2);
    r.store.apply(addEffect(other, 'reverb', 'Reverb'));
    const reverb = (r.store.project.track(other) as MidiTrack).effects[0].id;
    r.store.apply(groupDevices(other, [INSTRUMENT_DEVICE, reverb])); // il vecchio Instrument Rack si separa
    r.store.apply(loadRack(other, saved));
    expect(r.store.undoLabel).toBe('Carica Basso sporco');
    const t = r.store.project.track(other) as MidiTrack;
    expect(t.instrument).toMatchObject({ type: 'analog', params: saved.instrument!.params });
    expect(t.effects.map(e => e.type)).toEqual(['delay', 'compressor', 'reverb']);
    expect(t.effects.every(e => e.id !== r.delay && e.id !== r.comp)).toBe(true);
    expect(t.effects[1].sidechain).toBeUndefined();
    expect(t.racks).toHaveLength(1);
    const [rack] = t.racks;
    expect(rack.name).toBe('Basso sporco');
    expect(rack.devices).toEqual([INSTRUMENT_DEVICE, t.effects[0].id, t.effects[1].id]);
    expect(rack.macros[0].mappings.map(m => m.device)).toEqual([INSTRUMENT_DEVICE, t.effects[0].id]);
    expect(rack.macros[1].mode).toBe('toggle');
    // i parametri mappati sono dove la macro li porta, come nel rack di partenza
    expect(t.effects[0].params.mix).toBe(r.midi().effects[0].params.mix);
    expect(t.effects[0].params.mix).toBeCloseTo(10 + (100 / 127) * 80, 0);
    expect(t.instrument.params.cutoff).toBeCloseTo(r.midi().instrument.params.cutoff, 9);
    // un passo di annullamento
    r.store.undo();
    expect((r.store.project.track(other) as MidiTrack).racks[0].devices).toEqual([INSTRUMENT_DEVICE, reverb]);
  });

  it('Instrument Rack: senza traccia MIDI va su una nuova; il master no', () => {
    const r = rig();
    const saved = captureRack(r.store.project, r.t, r.rack, 'R');
    r.store.apply(loadRack(r.audio, saved));
    const tracks = r.store.project.tracks;
    expect(tracks.map(t => t.kind)).toEqual(['audio', 'midi', 'midi']); // subito dopo la traccia audio
    expect((tracks[1] as MidiTrack).racks[0].name).toBe('R');
    r.store.apply(loadRack(null, saved));
    expect(r.store.project.tracks).toHaveLength(4);
    expect(() => r.store.apply(loadRack(MASTER, saved))).toThrow(/strumento/);
  });

  it('Audio Effect Rack: in fondo alla catena, anche del master; senza traccia su una traccia audio nuova', () => {
    const r = rig();
    r.store.apply(addEffect(r.audio, 'delay', 'Delay'));
    r.store.apply(addEffect(r.audio, 'reverb', 'Reverb'));
    const [d, rv] = (r.store.project.track(r.audio) as AudioTrack).effects.map(e => e.id);
    r.store.apply(groupDevices(r.audio, [d, rv]));
    const id = r.store.project.racksOf(r.audio)[0].id;
    r.store.apply(mapMacro(r.audio, id, 0, rv, 'mix'));
    const saved = captureRack(r.store.project, r.audio, id, 'Spazio');

    r.store.apply(loadRack(r.t, saved));
    const t = r.store.project.track(r.t) as MidiTrack;
    expect(t.effects.map(e => e.type)).toEqual(['delay', 'compressor', 'delay', 'reverb']);
    expect(t.racks.map(x => x.devices.length)).toEqual([3, 2]);

    r.store.apply(loadRack(MASTER, saved));
    expect(r.store.project.masterEffects.map(e => e.type)).toEqual(['delay', 'reverb']);
    expect(r.store.project.masterRacks[0].macros[0].mappings[0].device).toBe(r.store.project.masterEffects[1].id);

    r.store.apply(loadRack(null, saved));
    const last = r.store.project.tracks.at(-1)!;
    expect(last).toBeInstanceOf(AudioTrack);
    expect(last.racks[0].name).toBe('Spazio');
  });

  it('sulla stessa traccia: il vecchio Instrument Rack si separa, i suoi effetti restano dopo', () => {
    const r = rig();
    const saved = captureRack(r.store.project, r.t, r.rack, 'R');
    r.store.apply(setInstrument(r.t, { type: 'wavetable', preset: null, params: {} }));
    r.store.apply(loadRack(r.t, saved));
    const t = r.midi();
    expect(t.instrument.type).toBe('analog');
    expect(t.racks.map(x => x.name)).toEqual(['R']);
    expect(t.effects.map(e => e.type)).toEqual(['delay', 'compressor', 'delay', 'compressor']);
    expect(t.racks[0].devices.slice(1)).toEqual(t.effects.slice(0, 2).map(e => e.id));
    expect(t.racks.find(x => x.name === 'R')!.macros[0].mappings[0].device).toBe(INSTRUMENT_DEVICE);
  });
});
