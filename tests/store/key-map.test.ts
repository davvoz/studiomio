import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTRUMENT } from '../../src/model/device';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { keyLabel, type KeyTarget } from '../../src/model/key-map';
import { MASTER } from '../../src/model/project';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, removeEffect, setInstrument } from '../../src/store/edits';
import { holdKey, pressKey, setKey } from '../../src/store/key-edits';
import { groupDevices, mapMacro, setMacroMode } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

/** Una traccia MIDI con un Delay e un Tape Stop in un rack: [instrument, rack(delay, stop)]. */
function rig() {
  const s = setup({ midi: 1 });
  const t = s.track(0);
  s.store.apply(addEffect(t, 'delay', 'Delay'));
  s.store.apply(addEffect(t, 'tapeStop', 'Tape Stop'));
  const track = () => s.store.project.tracks[0] as MidiTrack;
  const [delay, stop] = track().effects.map(e => e.id);
  s.store.apply(groupDevices(t, [delay, stop]));
  const rack = track().racks[0].id;
  const fx = (id: string) => track().effects.find(e => e.id === id)!;
  const macro = (i: number) => track().racks[0].macros[i];
  const macroKey = (index: number): KeyTarget => ({ kind: 'macro', owner: t, rack, index });
  const paramKey = (device: string, param: string): KeyTarget => ({ kind: 'param', owner: t, device: device as never, param });
  return { ...s, t, track, delay, stop, rack, fx, macro, macroKey, paramKey };
}

describe('tastiera del computer: le macro', () => {
  it('una manopola salta da un capo all\'altro; ogni pressione si annulla', () => {
    const r = rig();
    r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
    r.store.apply(setKey(r.macroKey(0), 'KeyQ'));
    expect(r.store.project.keyMap).toEqual([{ key: 'KeyQ', target: r.macroKey(0) }]);
    r.store.apply(pressKey('KeyQ'));
    expect([r.macro(0).value, r.fx(r.delay).params.mix]).toEqual([127, 100]);
    expect(r.store.undoLabel).toBe('Tasto');
    r.store.apply(pressKey('KeyQ'));
    expect(r.macro(0).value).toBe(0);
    r.store.undo();
    expect(r.macro(0).value).toBe(127);
  });

  it('un interruttore cambia a ogni pressione; un pulsante è acceso solo mentre il tasto è giù', () => {
    const r = rig();
    r.store.apply(mapMacro(r.t, r.rack, 0, r.stop, 'stop')); // diventa interruttore
    r.store.apply(mapMacro(r.t, r.rack, 1, r.delay, 'mix'));
    r.store.apply(setMacroMode(r.t, r.rack, 1, 'button'));
    r.store.apply(setKey(r.macroKey(0), 'KeyA'));
    r.store.apply(setKey(r.macroKey(1), 'KeyS'));
    r.store.apply(pressKey('KeyA'));
    expect(r.fx(r.stop).params.stop).toBe(1);
    r.store.apply(pressKey('KeyA'));
    expect(r.fx(r.stop).params.stop).toBe(0);
    // il pulsante non lo muove la pressione ma il tasto tenuto, senza entrare nella cronologia
    const label = r.store.undoLabel;
    expect(r.store.apply(pressKey('KeyS'))).toBe(r.store.project);
    r.store.apply(holdKey('KeyS', true), { transient: true });
    expect([r.macro(1).value, r.fx(r.delay).params.mix]).toEqual([127, 100]);
    r.store.apply(holdKey('KeyS', false), { transient: true });
    expect([r.macro(1).value, r.fx(r.delay).params.mix]).toEqual([0, 0]);
    expect(r.store.undoLabel).toBe(label);
  });

  it('un tasto muove più bersagli; un bersaglio ha un tasto solo; null lo toglie', () => {
    const r = rig();
    r.store.apply(setKey(r.macroKey(0), 'KeyQ'));
    r.store.apply(setKey(r.macroKey(1), 'KeyQ'));
    r.store.apply(pressKey('KeyQ'));
    expect([r.macro(0).value, r.macro(1).value]).toEqual([127, 127]);
    r.store.apply(setKey(r.macroKey(0), 'KeyW'));
    expect(r.store.project.keyMap.map(m => m.key)).toEqual(['KeyQ', 'KeyW']);
    r.store.apply(setKey(r.macroKey(0), null));
    expect(r.store.undoLabel).toBe('Togli il tasto');
    expect(r.store.project.keyMap).toEqual([{ key: 'KeyQ', target: r.macroKey(1) }]);
  });
});

describe('tastiera del computer: i parametri', () => {
  it('una manopola va dal massimo al minimo e ritorno, un menu passa alla scelta dopo', () => {
    const r = rig();
    r.store.apply(setKey(r.paramKey(r.delay, 'mix'), 'Digit1'));
    r.store.apply(setKey(r.paramKey(r.stop, 'curve'), 'Digit2'));
    expect(r.fx(r.delay).params.mix ?? 30).toBe(30);
    r.store.apply(pressKey('Digit1'));
    expect(r.fx(r.delay).params.mix).toBe(100);
    r.store.apply(pressKey('Digit1'));
    expect(r.fx(r.delay).params.mix).toBe(0);
    const curves = [1, 2, 0].map(() => (r.store.apply(pressKey('Digit2')), r.fx(r.stop).params.curve));
    expect(curves).toEqual([1, 2, 0]);
  });

  it('lo strumento e il master; un parametro mosso da una macro non lo muove il tasto', () => {
    const r = rig();
    r.store.apply(setKey(r.paramKey(INSTRUMENT_DEVICE, 'cutoff'), 'KeyZ'));
    const before = r.track().instrument.params.cutoff;
    r.store.apply(pressKey('KeyZ'));
    expect(r.track().instrument.params.cutoff).not.toBe(before);
    r.store.apply(addEffect(MASTER, 'delay', 'Delay'));
    const master = r.store.project.masterEffects[0].id;
    r.store.apply(setKey({ kind: 'param', owner: MASTER, device: master, param: 'mix' }, 'KeyX'));
    r.store.apply(pressKey('KeyX'));
    expect(r.store.project.masterEffects[0].params.mix).toBe(100);
    r.store.apply(setKey(r.paramKey(r.delay, 'mix'), 'KeyC'));
    r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
    const mix = r.fx(r.delay).params.mix;
    expect(r.store.apply(pressKey('KeyC'))).toBe(r.store.project);
    expect(r.fx(r.delay).params.mix).toBe(mix);
  });
});

describe('tastiera del computer: nel progetto', () => {
  it('i tasti di un dispositivo tolto non valgono, e tornano con "Annulla"', () => {
    const r = rig();
    r.store.apply(setKey(r.paramKey(r.delay, 'mix'), 'KeyQ'));
    r.store.apply(setKey(r.macroKey(0), 'KeyW'));
    r.store.apply(removeEffect(r.t, r.delay));
    expect(r.store.project.keyMap.map(m => m.key)).toEqual(['KeyW']);
    expect(() => r.store.apply(setKey(r.paramKey(r.delay, 'mix'), 'KeyE'))).toThrow(/non c'è/);
    r.store.undo();
    expect(r.store.project.keyMap.map(m => m.key)).toEqual(['KeyQ', 'KeyW']);
  });

  it('un altro strumento toglie i tasti dei parametri dello strumento', () => {
    const r = rig();
    r.store.apply(setKey(r.paramKey(INSTRUMENT_DEVICE, 'cutoff'), 'KeyQ'));
    r.store.apply(setInstrument(r.t, { ...r.track().instrument, preset: null }));
    expect(r.store.project.keyMap).toHaveLength(1); // stesso strumento: restano
    r.store.apply(setInstrument(r.t, { ...DEFAULT_INSTRUMENT, type: 'wavetable', preset: null }));
    expect(r.store.project.keyMap).toEqual([]);
  });

  it('si salvano solo se ci sono, e solo quelli che valgono', () => {
    const r = rig();
    const codec = new ProjectCodec();
    expect('keyMap' in JSON.parse(codec.stringify(r.store.project))).toBe(false);
    r.store.apply(setKey(r.macroKey(2), 'KeyQ'));
    r.store.apply(setKey(r.paramKey(r.stop, 'stop'), 'Space'));
    r.store.apply(addEffect(r.t, 'delay', 'Delay'));
    const extra = r.track().effects[2].id;
    r.store.apply(setKey(r.paramKey(extra, 'mix'), 'KeyE'));
    r.store.apply(removeEffect(r.t, extra));
    const back = codec.parse(codec.stringify(r.store.project));
    expect(back.keyMap).toEqual(r.store.project.keyMap);
    expect(back.keyMap.map(m => m.key)).toEqual(['KeyQ', 'Space']);
  });

  it('i nomi dei tasti', () => {
    expect(['KeyQ', 'Digit7', 'Numpad3', 'NumpadAdd', 'F5', 'Comma', 'BracketLeft'].map(keyLabel))
      .toEqual(['Q', '7', 'Num 3', 'Num +', 'F5', ',', '[']);
  });
});
