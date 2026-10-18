import { describe, expect, it } from 'vitest';
import type { DeviceId } from '../../src/core/id';
import { paramSpec } from '../../src/devices/device-type';
import { paramFromUnit } from '../../src/devices/params';
import { instrumentType } from '../../src/devices/registry';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { MASTER } from '../../src/model/project';
import { chainItems, checkRacks, macroIndex, macroParam, moveDevice as layoutMove, newRack, type DeviceKey } from '../../src/model/rack';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, loadEffectPreset, moveEffect, removeEffect, setInstrument } from '../../src/store/edits';
import {
  addEffectToRack, groupDevices, mapMacro, moveDevice, moveRack, removeRack, renameMacro, setMacro, setMappingRange,
  ungroupRack, unmapParam,
} from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

/** Una traccia MIDI con tre Delay: [instrument, a, b, c]. */
function rig() {
  const s = setup({ midi: 1 });
  const t = s.track(0);
  for (let i = 0; i < 3; i++) s.store.apply(addEffect(t, 'delay', 'Delay'));
  const track = () => s.store.project.tracks[0] as MidiTrack;
  const [a, b, c] = track().effects.map(e => e.id);
  const fx = (id: DeviceId) => track().effects.find(e => e.id === id)!;
  const order = () => track().chainKeys;
  const racks = () => track().racks;
  return { ...s, t, track, a, b, c, fx, order, racks };
}

describe('rack: gruppi', () => {
  it('Ctrl+G: dispositivi di seguito diventano un rack con 8 macro; si annulla; si separa', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.b, r.a]));
    expect(r.racks()).toHaveLength(1);
    const rack = r.racks()[0];
    expect(rack.devices).toEqual([r.a, r.b]);
    expect(rack.macros).toHaveLength(8);
    expect(r.store.undoLabel).toBe('Raggruppa in un rack');
    expect(chainItems(r.order(), r.racks()).map(x => (x.kind === 'rack' ? 'rack' : x.key))).toEqual([INSTRUMENT_DEVICE, 'rack', r.c]);
    r.store.undo();
    expect(r.racks()).toEqual([]);
    r.store.redo();
    r.store.apply(ungroupRack(r.t, rack.id));
    expect(r.racks()).toEqual([]);
    expect(r.order()).toEqual([INSTRUMENT_DEVICE, r.a, r.b, r.c]); // i dispositivi restano dove sono
  });

  it('Instrument Rack: lo strumento con i suoi effetti', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [INSTRUMENT_DEVICE, r.a]));
    expect(r.racks()[0].devices).toEqual([INSTRUMENT_DEVICE, r.a]);
    expect(() => r.store.apply(removeRack(r.t, r.racks()[0].id))).toThrow(/strumento/);
  });

  it('◂: un effetto entra in un Instrument Rack con il solo strumento', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [INSTRUMENT_DEVICE]));
    r.store.apply(moveDevice(r.t, r.a, -1));
    expect([r.order(), r.racks()[0].devices]).toEqual([[INSTRUMENT_DEVICE, r.a, r.b, r.c], [INSTRUMENT_DEVICE, r.a]]);
    // fuori da un rack, invece, non si passa davanti allo strumento
    r.store.apply(ungroupRack(r.t, r.racks()[0].id));
    r.store.apply(moveDevice(r.t, r.a, -1));
    expect(r.order()).toEqual([INSTRUMENT_DEVICE, r.a, r.b, r.c]);
  });

  it('non si raggruppano dispositivi non di seguito, né dispositivi già in un rack', () => {
    const r = rig();
    expect(() => r.store.apply(groupDevices(r.t, [r.a, r.c]))).toThrow(/di seguito/);
    r.store.apply(groupDevices(r.t, [r.a]));
    expect(() => r.store.apply(groupDevices(r.t, [r.a, r.b]))).toThrow(/già in un rack/);
  });

  it('le regole: un rack con i dispositivi sparsi non è valido', () => {
    const rack = newRack('r' as DeviceId, ['a', 'c'] as DeviceKey[]);
    expect(() => checkRacks(['a', 'b', 'c'] as DeviceKey[], [rack])).toThrow(/di seguito/);
    expect(() => checkRacks(['a', 'c', 'b'] as DeviceKey[], [rack])).not.toThrow();
  });

  it('◂ ▸: dentro il rack si scambiano; dal bordo si esce, accanto si entra, e il suono non cambia ordine', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a, r.b]));
    const id = r.racks()[0].id;
    r.store.apply(moveDevice(r.t, r.a, 1));
    expect([r.order(), r.racks()[0].devices]).toEqual([[INSTRUMENT_DEVICE, r.b, r.a, r.c], [r.b, r.a]]);
    r.store.apply(moveDevice(r.t, r.a, 1)); // dal bordo destro: esce
    expect([r.order(), r.racks()[0].devices]).toEqual([[INSTRUMENT_DEVICE, r.b, r.a, r.c], [r.b]]);
    r.store.apply(moveDevice(r.t, r.c, -1)); // c scambia con a
    r.store.apply(moveDevice(r.t, r.c, -1)); // c accanto al rack: entra
    expect([r.order(), r.racks()[0].devices]).toEqual([[INSTRUMENT_DEVICE, r.b, r.c, r.a], [r.b, r.c]]);
    // il rack intero si sposta oltre l'elemento accanto, ma non prima dello strumento
    r.store.apply(moveRack(r.t, id, 1));
    expect(r.order()).toEqual([INSTRUMENT_DEVICE, r.a, r.b, r.c]);
    r.store.apply(moveRack(r.t, id, -1));
    r.store.apply(moveRack(r.t, id, -1));
    expect(r.order()).toEqual([INSTRUMENT_DEVICE, r.b, r.c, r.a]);
    // da solo in un rack, un dispositivo si porta dietro il rack
    const lone = layoutMove([INSTRUMENT_DEVICE, r.a, r.b] as DeviceKey[], [newRack('x' as DeviceId, [r.b])], r.b, -1);
    expect(lone.order).toEqual([INSTRUMENT_DEVICE, r.b, r.a]);
    expect(lone.racks[0].devices).toEqual([r.b]);
  });

  it('un effetto tolto esce dal rack e dalle macro; il rack vuoto sparisce', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a, r.b]));
    const id = r.racks()[0].id;
    r.store.apply(mapMacro(r.t, id, 0, r.a, 'mix'));
    r.store.apply(removeEffect(r.t, r.a));
    expect(r.racks()[0].devices).toEqual([r.b]);
    expect(r.racks()[0].macros[0].mappings).toEqual([]);
    r.store.apply(removeEffect(r.t, r.b));
    expect(r.racks()).toEqual([]);
  });

  it('un effetto aggiunto al rack ci va in fondo; un rack eliminato porta via i suoi effetti', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a]));
    const id = r.racks()[0].id;
    r.store.apply(addEffectToRack(r.t, id, 'delay', 'Delay'));
    const added = r.racks()[0].devices[1];
    expect(r.order()).toEqual([INSTRUMENT_DEVICE, r.a, added, r.b, r.c]);
    r.store.apply(removeRack(r.t, id));
    expect(r.order()).toEqual([INSTRUMENT_DEVICE, r.b, r.c]);
    expect(r.racks()).toEqual([]);
  });

  it('spostare un effetto per indice dentro un rack altrui non è permesso', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a, r.b]));
    expect(() => r.store.apply(moveEffect(r.t, r.c, 1))).toThrow(/di seguito/);
  });
});

describe('rack: macro', () => {
  it('una macro muove i parametri mappati tra minimo e massimo; il primo mappato non salta', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a, r.b]));
    const id = r.racks()[0].id;
    r.store.apply(mapMacro(r.t, id, 0, r.a, 'mix')); // mix 30 (0..100): la macro va a 30% di 127
    expect(r.racks()[0].macros[0].value).toBeCloseTo(0.3 * 127, 9);
    expect(r.fx(r.a).params.mix).toBe(30);
    r.store.apply(mapMacro(r.t, id, 0, r.b, 'feedback')); // il secondo segue la macro
    expect(r.fx(r.b).params.feedback).toBe(Math.round(0.3 * 95));
    r.store.apply(setMacro(r.t, id, 0, 127));
    expect([r.fx(r.a).params.mix, r.fx(r.b).params.feedback]).toEqual([100, 95]);
    r.store.apply(setMappingRange(r.t, r.a, 'mix', { min: 80, max: 20 })); // al contrario
    expect(r.fx(r.a).params.mix).toBe(20);
    r.store.apply(setMacro(r.t, id, 0, 0));
    expect([r.fx(r.a).params.mix, r.fx(r.b).params.feedback]).toEqual([80, 0]);
    r.store.apply(setMacro(r.t, id, 0, 63.5));
    expect(r.fx(r.a).params.mix).toBeCloseTo(50, 9);
    expect(r.store.undoLabel).toBe('Macro');
  });

  it('una macro su un parametro logaritmico segue la manopola (in ottave), e sulle scelte va a scatti', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [INSTRUMENT_DEVICE, r.a]));
    const id = r.racks()[0].id;
    const cutoff = paramSpec(instrumentType('analog')!, 'cutoff')!;
    r.store.apply(mapMacro(r.t, id, 1, INSTRUMENT_DEVICE, 'cutoff'));
    r.store.apply(setMacro(r.t, id, 1, 127 / 2));
    expect(r.track().instrument.params.cutoff).toBeCloseTo(paramFromUnit(cutoff, 0.5), 6);
    r.store.apply(mapMacro(r.t, id, 2, r.a, 'pingPong'));
    r.store.apply(setMacro(r.t, id, 2, 70));
    expect(r.fx(r.a).params.pingPong).toBe(1);
    r.store.apply(setMacro(r.t, id, 2, 50));
    expect(r.fx(r.a).params.pingPong).toBe(0);
  });

  it('un parametro va su una macro sola; si toglie; solo parametri del rack', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a]));
    const id = r.racks()[0].id;
    r.store.apply(mapMacro(r.t, id, 0, r.a, 'mix'));
    r.store.apply(mapMacro(r.t, id, 3, r.a, 'mix'));
    expect(r.racks()[0].macros.map(m => m.mappings.length)).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    r.store.apply(unmapParam(r.t, r.a, 'mix'));
    expect(r.racks()[0].macros[3].mappings).toEqual([]);
    expect(() => r.store.apply(mapMacro(r.t, id, 0, r.b, 'mix'))).toThrow(/dispositivi del rack/);
    expect(() => r.store.apply(mapMacro(r.t, id, 0, r.a, 'nessuno'))).toThrow(/non trovato/);
  });

  it('un preset non sposta i parametri mappati; un altro strumento perde le mappature', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [INSTRUMENT_DEVICE, r.a]));
    const id = r.racks()[0].id;
    r.store.apply(mapMacro(r.t, id, 0, r.a, 'feedback'));
    r.store.apply(mapMacro(r.t, id, 1, INSTRUMENT_DEVICE, 'cutoff'));
    r.store.apply(setMacro(r.t, id, 0, 0));
    r.store.apply(loadEffectPreset(r.t, r.a, 'Dub', { feedback: 75, mix: 40 }));
    expect(r.fx(r.a).params).toMatchObject({ feedback: 0, mix: 40 });
    r.store.apply(setInstrument(r.t, { type: 'drums', preset: null, params: {} }));
    expect(r.racks()[0].macros[1].mappings).toEqual([]);
    expect(r.racks()[0].macros[0].mappings).toHaveLength(1);
  });

  it('i nomi delle macro: il loro, o il primo parametro mappato; le macro come parametri', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [r.a]));
    const id = r.racks()[0].id;
    r.store.apply(renameMacro(r.t, id, 2, 'Spazio'));
    expect(r.racks()[0].macros[2].name).toBe('Spazio');
    expect([macroParam(0), macroIndex('macro8'), macroIndex('cutoff')]).toEqual(['macro1', 7, -1]);
  });

  it('anche il master ha i rack', () => {
    const r = rig();
    r.store.apply(addEffect(MASTER, 'delay', 'Delay'));
    const m = r.store.project.masterEffects[0].id;
    r.store.apply(groupDevices(MASTER, [m]));
    const id = r.store.project.masterRacks[0].id;
    r.store.apply(mapMacro(MASTER, id, 0, m, 'mix'));
    r.store.apply(setMacro(MASTER, id, 0, 127));
    expect(r.store.project.masterEffects[0].params.mix).toBe(100);
    r.store.apply(removeEffect(MASTER, m));
    expect(r.store.project.masterRacks).toEqual([]);
  });

  it('si salvano e si riaprono; un file della versione 7 si apre senza rack', () => {
    const r = rig();
    r.store.apply(groupDevices(r.t, [INSTRUMENT_DEVICE, r.a]));
    const id = r.racks()[0].id;
    r.store.apply(mapMacro(r.t, id, 0, r.a, 'mix'));
    r.store.apply(setMappingRange(r.t, r.a, 'mix', { min: 10, max: 60 }));
    r.store.apply(renameMacro(r.t, id, 0, 'Wet'));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(r.store.project));
    expect(back.tracks[0].racks).toEqual(r.racks());
    const json = JSON.parse(codec.stringify(r.store.project));
    json.version = 7;
    delete json.tracks[0].racks;
    expect(codec.decode(json).tracks[0].racks).toEqual([]);
  });
});
