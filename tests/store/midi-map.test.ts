import { describe, expect, it } from 'vitest';
import { faderToDb, SILENT_DB } from '../../src/control/mixer-scale';
import { DEFAULT_INSTRUMENT } from '../../src/model/device';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { decodeMidiTarget, encodeMidiTarget, midiLabel, type MidiControl, type MidiTarget } from '../../src/model/midi-map';
import { MASTER } from '../../src/model/project';
import { SEND_OFF_DB, type MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addBus, addEffect, removeEffect, removeTrack, setInstrument } from '../../src/store/edits';
import { holdMidi, moveMidi, pressMidi, setMidi } from '../../src/store/midi-edits';
import { groupDevices, mapMacro, setMacroMode } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

const cc = (number: number, channel = 0): MidiControl => ({ type: 'cc', channel, number });
const note = (number: number, channel = 0): MidiControl => ({ type: 'note', channel, number });

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
  const macroAt = (index: number): MidiTarget => ({ kind: 'macro', owner: t, rack, index });
  const paramAt = (device: string, param: string): MidiTarget => ({ kind: 'param', owner: t, device: device as never, param });
  const mixer = (control: 'volume' | 'pan' | 'mute' | 'solo', owner: typeof t | typeof MASTER = t): MidiTarget => ({ kind: 'mixer', owner, control });
  return { ...s, t, track, delay, stop, rack, fx, macro, macroAt, paramAt, mixer };
}

describe('MIDI: le macro e i parametri', () => {
  it('un CC porta una manopola al punto della sua corsa; una corsa unita è un solo annullamento', () => {
    const r = rig();
    r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
    r.store.apply(setMidi(r.macroAt(0), cc(21)));
    expect(r.store.project.midiMap).toEqual([{ control: cc(21), target: r.macroAt(0) }]);
    const start = r.macro(0).value;
    for (const v of [10, 40, 127]) r.store.apply(moveMidi(cc(21), v), { mergeKey: 'midi' });
    expect([r.macro(0).value, r.fx(r.delay).params.mix]).toEqual([127, 100]);
    r.store.apply(moveMidi(cc(21), 0), { mergeKey: 'midi' });
    r.store.undo();
    expect(r.macro(0).value).toBe(start);
    expect(r.store.undoLabel).toBe('Mappa sul MIDI');
    // un altro canale è un altro controllo
    expect(r.store.apply(moveMidi(cc(21, 1), 127))).toBe(r.store.project);
  });

  it('interruttori e pulsanti: un CC li accende da 64 in su; una nota fa come un tasto', () => {
    const r = rig();
    r.store.apply(mapMacro(r.t, r.rack, 0, r.stop, 'stop')); // diventa interruttore
    r.store.apply(mapMacro(r.t, r.rack, 1, r.delay, 'mix'));
    r.store.apply(setMacroMode(r.t, r.rack, 1, 'button'));
    r.store.apply(setMidi(r.macroAt(0), note(36)));
    r.store.apply(setMidi(r.macroAt(1), cc(64)));
    r.store.apply(pressMidi(note(36)));
    expect(r.fx(r.stop).params.stop).toBe(1);
    r.store.apply(pressMidi(note(36)));
    expect(r.fx(r.stop).params.stop).toBe(0);
    // il pulsante lo accende il CC tenuto su, senza entrare nella cronologia
    const label = r.store.undoLabel;
    expect(r.store.apply(moveMidi(cc(64), 127))).toBe(r.store.project);
    r.store.apply(holdMidi(cc(64), true), { transient: true });
    expect([r.macro(1).value, r.fx(r.delay).params.mix]).toEqual([127, 100]);
    r.store.apply(holdMidi(cc(64), false), { transient: true });
    expect(r.macro(1).value).toBe(0);
    expect(r.store.undoLabel).toBe(label);
  });

  it('un parametro segue il CC (un menu sceglie dalla sua posizione); mosso da una macro, il CC non lo muove', () => {
    const r = rig();
    r.store.apply(setMidi(r.paramAt(r.delay, 'mix'), cc(1)));
    r.store.apply(setMidi(r.paramAt(r.stop, 'curve'), cc(2)));
    r.store.apply(moveMidi(cc(1), 127));
    expect(r.fx(r.delay).params.mix).toBe(100);
    r.store.apply(moveMidi(cc(1), 0));
    expect(r.fx(r.delay).params.mix).toBe(0);
    expect([0, 64, 127].map(v => (r.store.apply(moveMidi(cc(2), v)), r.fx(r.stop).params.curve))).toEqual([0, 1, 2]);
    r.store.apply(setMidi(r.paramAt(INSTRUMENT_DEVICE, 'cutoff'), cc(3)));
    const before = r.track().instrument.params.cutoff;
    r.store.apply(moveMidi(cc(3), 0));
    expect(r.track().instrument.params.cutoff).not.toBe(before);
    r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
    const mix = r.fx(r.delay).params.mix;
    expect(r.store.apply(moveMidi(cc(1), 127))).toBe(r.store.project);
    expect(r.fx(r.delay).params.mix).toBe(mix);
  });

  it('un controllo muove più bersagli; un bersaglio ha un controllo solo; null lo toglie', () => {
    const r = rig();
    r.store.apply(setMidi(r.macroAt(0), cc(7)));
    r.store.apply(setMidi(r.macroAt(1), cc(7)));
    r.store.apply(moveMidi(cc(7), 127));
    expect([r.macro(0).value, r.macro(1).value]).toEqual([127, 127]);
    r.store.apply(setMidi(r.macroAt(0), note(60)));
    expect(r.store.project.midiMap.map(m => midiLabel(m.control))).toEqual(['CC 7', 'C3']);
    r.store.apply(setMidi(r.macroAt(0), null));
    expect(r.store.undoLabel).toBe('Togli il MIDI');
    expect(r.store.project.midiMap).toEqual([{ control: cc(7), target: r.macroAt(1) }]);
  });
});

describe('MIDI: il mixer', () => {
  it('volume come il fader di Live, pan con il centro a 64, mute e solo da 64 in su', () => {
    const r = rig();
    r.store.apply(setMidi(r.mixer('volume'), cc(7)));
    r.store.apply(setMidi(r.mixer('pan'), cc(10)));
    r.store.apply(setMidi(r.mixer('mute'), cc(20)));
    r.store.apply(setMidi(r.mixer('solo'), cc(21)));
    r.store.apply(moveMidi(cc(7), 108));
    r.store.apply(moveMidi(cc(10), 0));
    r.store.apply(moveMidi(cc(20), 127));
    r.store.apply(moveMidi(cc(21), 127));
    expect(r.track().mixer).toEqual({ volumeDb: faderToDb(108), pan: -1, mute: true, solo: true });
    r.store.apply(moveMidi(cc(10), 64));
    r.store.apply(moveMidi(cc(20), 0));
    expect([r.track().mixer.pan, r.track().mixer.mute]).toEqual([0, false]);
    // lo stesso valore non è un cambio
    expect(r.store.apply(moveMidi(cc(20), 10))).toBe(r.store.project);
  });

  it('una nota: mute e solo cambiano, il volume va da 0 dB a −∞, il pan torna al centro', () => {
    const r = rig();
    r.store.apply(setMidi(r.mixer('mute'), note(40)));
    r.store.apply(setMidi(r.mixer('volume'), note(41)));
    r.store.apply(setMidi(r.mixer('pan'), note(42)));
    r.store.apply(pressMidi(note(40)));
    expect(r.track().mixer.mute).toBe(true);
    r.store.apply(pressMidi(note(40)));
    expect(r.track().mixer.mute).toBe(false);
    r.store.apply(pressMidi(note(41)));
    expect(r.track().mixer.volumeDb).toBe(SILENT_DB);
    r.store.apply(pressMidi(note(41)));
    expect(r.track().mixer.volumeDb).toBe(0);
    r.store.apply(moveMidi(note(42), 0)); // una nota non è un CC
    expect(r.store.apply(pressMidi(note(42)))).toBe(r.store.project); // già al centro
  });

  it('il master ha volume e mute; una mandata va da chiusa a 0 dB', () => {
    const r = rig();
    r.store.apply(setMidi(r.mixer('volume', MASTER), cc(7, 15)));
    r.store.apply(setMidi(r.mixer('mute', MASTER), note(0, 15)));
    expect(() => r.store.apply(setMidi(r.mixer('solo', MASTER), cc(8)))).toThrow(/non c'è/);
    r.store.apply(moveMidi(cc(7, 15), 0));
    r.store.apply(pressMidi(note(0, 15)));
    expect(r.store.project.master).toMatchObject({ volumeDb: SILENT_DB, mute: true });
    r.store.apply(addBus());
    const bus = r.store.project.buses[0].id;
    const send: MidiTarget = { kind: 'send', owner: r.t, bus };
    r.store.apply(setMidi(send, cc(30)));
    expect(() => r.store.apply(setMidi({ kind: 'send', owner: bus, bus }, cc(31)))).toThrow(/non c'è/);
    r.store.apply(moveMidi(cc(30), 127));
    expect(r.track().send(bus)).toBe(0);
    r.store.apply(moveMidi(cc(30), 64));
    expect(r.track().send(bus)).toBe(-20);
    r.store.apply(moveMidi(cc(30), 0));
    expect(r.track().send(bus)).toBe(SEND_OFF_DB);
    expect(midiLabel(cc(7, 15))).toBe('CC 7 · 16');
  });
});

describe('MIDI: nel progetto', () => {
  it('i controlli di bersagli tolti non valgono, e tornano con "Annulla"', () => {
    const r = rig();
    r.store.apply(setMidi(r.paramAt(r.delay, 'mix'), cc(1)));
    r.store.apply(setMidi(r.mixer('volume'), cc(7)));
    r.store.apply(removeEffect(r.t, r.delay));
    expect(r.store.project.midiMap.map(m => m.control.number)).toEqual([7]);
    r.store.apply(removeTrack(r.t));
    expect(r.store.project.midiMap).toEqual([]);
    r.store.undo();
    r.store.undo();
    expect(r.store.project.midiMap.map(m => m.control.number)).toEqual([1, 7]);
  });

  it('un altro strumento toglie i controlli dei parametri dello strumento', () => {
    const r = rig();
    r.store.apply(setMidi(r.paramAt(INSTRUMENT_DEVICE, 'cutoff'), cc(74)));
    r.store.apply(setInstrument(r.t, { ...r.track().instrument, preset: null }));
    expect(r.store.project.midiMap).toHaveLength(1);
    r.store.apply(setInstrument(r.t, { ...DEFAULT_INSTRUMENT, type: 'wavetable', preset: null }));
    expect(r.store.project.midiMap).toEqual([]);
  });

  it('si salvano solo se ci sono, e solo quelli che valgono', () => {
    const r = rig();
    const codec = new ProjectCodec();
    expect('midiMap' in JSON.parse(codec.stringify(r.store.project))).toBe(false);
    r.store.apply(addBus());
    const bus = r.store.project.buses[0].id;
    r.store.apply(setMidi(r.macroAt(2), cc(21)));
    r.store.apply(setMidi(r.paramAt(r.stop, 'stop'), note(36, 9)));
    r.store.apply(setMidi(r.mixer('pan'), cc(10)));
    r.store.apply(setMidi(r.mixer('volume', MASTER), cc(7)));
    r.store.apply(setMidi({ kind: 'send', owner: r.t, bus }, cc(12)));
    r.store.apply(addEffect(r.t, 'delay', 'Delay'));
    const extra = r.track().effects[2].id;
    r.store.apply(setMidi(r.paramAt(extra, 'mix'), cc(13)));
    r.store.apply(removeEffect(r.t, extra));
    const back = codec.parse(codec.stringify(r.store.project));
    expect(back.midiMap).toEqual(r.store.project.midiMap);
    expect(back.midiMap.map(m => midiLabel(m.control))).toEqual(['CC 21', 'C1 · 10', 'CC 10', 'CC 7', 'CC 12']);
  });

  it('un file con un controllo che non va si rifiuta', () => {
    const r = rig();
    const codec = new ProjectCodec();
    r.store.apply(setMidi(r.mixer('volume'), cc(7)));
    const json = JSON.parse(codec.stringify(r.store.project));
    json.midiMap[0].number = 300;
    expect(() => codec.parse(JSON.stringify(json))).toThrow(/non valido/);
  });

  it('il bersaglio scritto nel DOM torna uguale', () => {
    const r = rig();
    const targets: MidiTarget[] = [r.macroAt(3), r.paramAt(INSTRUMENT_DEVICE, 'cutoff'), r.mixer('solo'), r.mixer('volume', MASTER), { kind: 'send', owner: r.t, bus: r.t }];
    expect(targets.map(t => decodeMidiTarget(encodeMidiTarget(t)))).toEqual(targets);
    expect(decodeMidiTarget('mixer|x|gain')).toBeNull();
  });
});
