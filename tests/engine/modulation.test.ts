import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { DRUMS } from '../../src/devices/instruments/drums/drums';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import { paramSpec } from '../../src/devices/device-type';
import type { NumberParam } from '../../src/devices/params';
import { paramFromUnit, paramToUnit } from '../../src/devices/params';
import { ModTimeline, ParamModulation } from '../../src/devices/worklet/mod-timeline';
import { PlaybackEngine } from '../../src/engine/playback-engine';
import { switchSink, type ModSink } from '../../src/engine/modulation';
import {
  envelopeValueAt, INSTRUMENT_DEVICE, parseTargetKey, targetKey, withEnvelope, type ModTarget,
} from '../../src/model/envelope';
import { MidiClip } from '../../src/model/midi-clip';
import { MASTER, Project } from '../../src/model/project';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, addMidiClip, addTrack, resizePlacement, setEffectParam, setLoopRegion, setMasterAutomation, setSlot, updateClip } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { groupDevices, mapMacro, setMacroMode, setMappingRange } from '../../src/store/rack-edits';
import { macroParam } from '../../src/model/rack';
import { paintStep, simplify } from '../../src/ui/envelopes/envelope-lane';
import { choiceTarget, formatModValue, masterChain, masterTargetDevices, targetDevices, trackChain } from '../../src/ui/envelopes/mod-targets';
import { BRAKE_CURVES, TAPE_STOP } from '../../src/devices/effects/tape-stop/tape-stop';
import { FakeEffects, FakeGraph, FakeInstruments, type FakeParam } from '../helpers/fake-audio';

const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };
const PAN: ModTarget = { kind: 'mixer', param: 'pan' };
const CUTOFF: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'cutoff' };
const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

/** A parameter's value at instant `t`, replaying its events with the AudioParam rules. */
function replay(events: readonly { type: string; value: number; time: number }[], neutral: number, t: number): number {
  const line = new ModTimeline(neutral);
  for (const e of events) {
    if (e.type === 'set' || e.type === 'ramp') line.add({ kind: e.type, value: e.value, time: e.time });
    else if (e.type === 'hold') line.hold(e.time);
  }
  return line.valueAt(t);
}

describe('modulations: the model', () => {
  it('curve value: before, in between, after, steps', () => {
    const p = pts([1, 0.2], [3, 0.6], [3, 1], [4, 0]);
    expect(envelopeValueAt(p, 0)).toBe(0.2);
    expect(envelopeValueAt(p, 2)).toBeCloseTo(0.4, 9);
    expect(envelopeValueAt(p, 3)).toBe(1); // on the step it's already the next point
    expect(envelopeValueAt(p, 3.5)).toBeCloseTo(0.5, 9);
    expect(envelopeValueAt(p, 9)).toBe(0);
  });

  it('one curve per target: it\'s added, replaced, disappears without points; values in the scale', () => {
    let envs = withEnvelope([], VOLUME, pts([2, 0.5], [0, 3]));
    expect(envs[0].points).toEqual(pts([0, 1], [2, 0.5])); // in order and inside 0..1
    envs = withEnvelope(envs, PAN, pts([0, -2]));
    envs = withEnvelope(envs, VOLUME, pts([1, 0]));
    expect(envs.map(e => targetKey(e.target))).toEqual(['mixer:volume', 'mixer:pan']);
    expect(envs[1].points[0].value).toBe(-1);
    expect(withEnvelope(envs, VOLUME, []).map(e => targetKey(e.target))).toEqual(['mixer:pan']);
    expect(parseTargetKey('instrument:cutoff')).toEqual(CUTOFF);
    expect(parseTargetKey('mixer:tempo')).toBeNull();
  });

  it('they\'re saved with the clip; a v5 file opens', () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('t', ids, 2), ids);
    store.apply(addTrack('midi'));
    const t = store.project.tracks[0].id;
    store.apply(setSlot(t, 0, MidiClip.empty(ids.next('clip'), 'A', '#fff').withEnvelope(CUTOFF, pts([0, 0.5], [2, -0.25]))));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project));
    expect(back.tracks[0].slots[0]!.envelope(CUTOFF)?.points).toEqual(pts([0, 0.5], [2, -0.25]));
    const json = JSON.parse(codec.stringify(store.project));
    json.version = 5;
    delete json.tracks[0].slots[0].envelopes;
    expect(codec.decode(json).tracks[0].slots[0]!.envelopes).toEqual([]);
  });
});

describe('step drawing', () => {
  it('a step in a cell: outside the curve stays as it was; the useless points disappear', () => {
    const ramp = pts([0, 0], [4, 1]);
    expect(paintStep(ramp, 1, 2, 0.9, 0)).toEqual(pts([0, 0], [1, 0.25], [1, 0.9], [2, 0.9], [2, 0.5], [4, 1]));
    // neighbouring cells with the same value: a single step
    let p = paintStep([], 0, 1, -1, 0);
    p = paintStep(p, 1, 2, -1, 0);
    expect(p).toEqual(pts([0, -1], [2, -1], [2, 0]));
    expect(simplify(pts([0, 1], [0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5], [3, 0.5]))).toEqual(pts([0, 0.5], [3, 0.5]));
  });
});

describe('modulations in the AudioWorklet', () => {
  it('steps and ramps like the AudioParams; "hold" halfway through a ramp', () => {
    const line = new ModTimeline(0);
    line.add({ kind: 'set', value: 0.2, time: 1 });
    line.add({ kind: 'ramp', value: 1, time: 2 });
    line.add({ kind: 'set', value: 0, time: 3 });
    line.add({ kind: 'set', value: 0.7, time: 3 }); // same instant: the last wins
    expect(line.valueAt(0.5)).toBe(0);
    expect(line.valueAt(1.5)).toBeCloseTo(0.6, 9);
    expect(line.valueAt(3)).toBe(0.7);
    const held = new ModTimeline(0);
    held.add({ kind: 'set', value: 0, time: 0 });
    held.add({ kind: 'ramp', value: 1, time: 1 });
    held.hold(0.25);
    expect(held.valueAt(0.9)).toBeCloseTo(0.25, 9);
    expect(held.pending).toBe(false);
  });

  it('the offset adds to the knob in its scale (the cutoff in octaves)', () => {
    const cutoff = paramSpec(ANALOG, 'cutoff') as NumberParam;
    const mod = new ParamModulation(new Map([['cutoff', cutoff]]), { cutoff: 1000, resonance: 20 });
    expect(mod.paramsAt(0)).toEqual({ cutoff: 1000, resonance: 20 }); // the first time, the knobs' values
    expect(mod.paramsAt(0.1)).toBeNull(); // nothing changed
    mod.event('cutoff', 'set', 0.1, 1);
    mod.event('resonance', 'set', 0.5, 1); // it isn't in the specs: ignored
    const p = mod.paramsAt(1)!;
    expect(p.cutoff).toBeCloseTo(paramFromUnit(cutoff, paramToUnit(cutoff, 1000) + 0.1), 6);
    expect(p.resonance).toBe(20);
    mod.event('cutoff', 'set', 0, 2);
    expect(mod.paramsAt(2)!.cutoff).toBe(1000);
    expect(mod.paramsAt(3)).toBeNull();
  });

  it('a switch snaps when the curve moves it past halfway, up or down', () => {
    const stop = paramSpec(TAPE_STOP, 'stop')!;
    const mod = new ParamModulation(new Map([['stop', stop]]), { stop: 0 });
    mod.paramsAt(0);
    // a ramp from 0 to +1 in a second: Off until halfway, then On
    mod.event('stop', 'set', 0, 0);
    mod.event('stop', 'ramp', 1, 1);
    expect(mod.paramsAt(0.49)?.stop ?? 0).toBe(0);
    expect(mod.paramsAt(0.51)!.stop).toBe(1);
    // with the knob on On a downward offset is needed
    mod.setBase({ stop: 1 });
    mod.event('stop', 'set', -0.6, 2);
    expect(mod.paramsAt(2)!.stop).toBe(0);
  });

  it('a menu moves along its options', () => {
    const curve = paramSpec(TAPE_STOP, 'curve')!;
    expect(BRAKE_CURVES).toHaveLength(3);
    const mod = new ParamModulation(new Map([['curve', curve]]), { curve: 0 });
    mod.event('curve', 'set', 0.5, 1);
    expect(mod.paramsAt(1)!.curve).toBe(1);
    mod.event('curve', 'set', 1, 2);
    expect(mod.paramsAt(2)!.curve).toBe(2);
  });
});

/** 120 BPM (a beat = 0.5 s, beat b plays at 0.05 + b/2): a MIDI track with a 4-beat
 *  looping clip placed for 8, and a second MIDI track. */
function rig() {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, 2), ids);
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  store.apply(addMidiClip(t(0), 0, 4));
  const pl = store.project.tracks[0].arrangement[0];
  store.apply(resizePlacement(t(0), pl.id, { end: 8 }));
  const graph = new FakeGraph(), instruments = new FakeInstruments(), effects = new FakeEffects();
  let tick: (() => void) | null = null;
  const engine = new PlaybackEngine(graph, { clips: { playable: () => null }, instruments, effects }, {
    timer: { every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } }, startLatency: 0.05, lookahead: 0.2,
  });
  store.onChange(p => engine.setProject(p));
  engine.setProject(store.project);
  const runUntil = (time: number) => {
    while (graph.currentTime < time - 1e-9) {
      graph.currentTime = Math.min(time, graph.currentTime + 0.025);
      tick?.();
    }
  };
  const editClip = (fn: (c: MidiClip) => MidiClip) => store.apply(updateClip<MidiClip>('m', t(0), pl.id, fn));
  /** The gain of the volume modulation and the pan offset of track `i`. */
  const volume = (i: number) => graph.gains.find(g => g.outputs.includes(graph.panners[i]))!.gain;
  const pan = (i: number) => graph.constants[i].offset as FakeParam;
  const at = (beat: number) => 0.05 + beat / 2;
  return { store, engine, graph, instruments, effects, t, runUntil, editClip, volume, pan, at, ids };
}

describe('modulations in the engine', () => {
  it('the volume follows the curve in the clip\'s time, at every round of the loop, and goes back to neutral after the clip', () => {
    const r = rig();
    r.editClip(c => c.withEnvelope(VOLUME, pts([0, 1], [2, 0])));
    r.engine.play(0);
    r.runUntil(4.3);
    const ev = r.volume(0).events;
    const v = (beat: number) => replay(ev, 1, r.at(beat));
    expect(v(0)).toBeCloseTo(1, 3);
    expect(v(1)).toBeCloseTo(0.25, 2); // half curve: gain 0.5² (≈ −12 dB)
    expect(v(2.5)).toBeCloseTo(0, 6);
    expect(v(4.5)).toBeCloseTo(0.5625, 2); // second round: 0.75²
    expect(v(8.2)).toBe(1); // the clip is over
    // the second track has no curves: its volume doesn't move
    expect(r.volume(1).events).toEqual([]);
  });

  it('removing the curve while playing: after the rescheduling the volume goes back to neutral', () => {
    const r = rig();
    r.editClip(c => c.withEnvelope(VOLUME, pts([0, 0])));
    r.engine.play(0);
    r.runUntil(1);
    expect(replay(r.volume(0).events, 1, 1)).toBe(0);
    r.editClip(c => c.withEnvelope(VOLUME, [])); // like a Ctrl+Z
    r.runUntil(2);
    const ev = r.volume(0).events;
    expect(replay(ev, 1, 1.02)).toBe(0); // until the restart it holds the value: no jump
    expect(replay(ev, 1, 1.2)).toBe(1);
  });

  it('parameters of the instrument and of an effect: offsets in fractions of the knob', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    r.editClip(c => c.withEnvelope(CUTOFF, pts([0, 0], [4, 0.4])).withEnvelope({ kind: 'device', device: fx, param: 'feedback' }, pts([0, -0.5])));
    r.engine.play(0);
    r.runUntil(2);
    const synth = r.instruments.created[0].modulation.events.filter(e => e.param === 'cutoff');
    expect(replay(synth, 0, r.at(2))).toBeCloseTo(0.2, 4);
    const delay = r.effects.created[0].modulation.events.filter(e => e.param === 'feedback');
    expect(replay(delay, 0, r.at(1))).toBe(-0.5);
  });

  it('a curve on a macro moves the mapped parameters, each by its part of the travel', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    r.store.apply(groupDevices(r.t(0), [INSTRUMENT_DEVICE, fx]));
    const rack = r.store.project.tracks[0].racks[0].id;
    r.store.apply(mapMacro(r.t(0), rack, 0, INSTRUMENT_DEVICE, 'cutoff'));
    r.store.apply(mapMacro(r.t(0), rack, 0, fx, 'mix'));
    r.store.apply(setMappingRange(r.t(0), fx, 'mix', { min: 100, max: 50 })); // half travel, reversed
    r.editClip(c => c.withEnvelope({ kind: 'device', device: rack, param: macroParam(0) }, pts([0, 0], [4, 0.4])));
    r.engine.play(0);
    r.runUntil(2);
    const synth = r.instruments.created[0].modulation.events.filter(e => e.param === 'cutoff');
    expect(replay(synth, 0, r.at(2))).toBeCloseTo(0.2, 4);
    const delay = r.effects.created[0].modulation.events.filter(e => e.param === 'mix');
    expect(replay(delay, 0, r.at(2))).toBeCloseTo(-0.1, 4);
  });

  it('a curve on a macro of an outer rack goes through the macro of the inner rack down to its parameters', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    r.store.apply(groupDevices(r.t(0), [fx]));
    const inner = r.store.project.tracks[0].racks[0].id;
    r.store.apply(groupDevices(r.t(0), [fx]));
    const outer = r.store.project.tracks[0].racks.find(x => x.id !== inner)!.id;
    r.store.apply(mapMacro(r.t(0), inner, 0, fx, 'mix'));
    r.store.apply(setMappingRange(r.t(0), fx, 'mix', { min: 100, max: 50 })); // half travel, reversed
    r.store.apply(mapMacro(r.t(0), outer, 0, inner, macroParam(0)));
    r.store.apply(setMappingRange(r.t(0), inner, macroParam(0), { min: 0, max: 63.5 })); // half of the inner macro
    r.editClip(c => c.withEnvelope({ kind: 'device', device: outer, param: macroParam(0) }, pts([0, 0], [4, 0.4])));
    r.engine.play(0);
    r.runUntil(2);
    const delay = r.effects.created[0].modulation.events.filter(e => e.param === 'mix');
    expect(replay(delay, 0, r.at(2))).toBeCloseTo(-0.05, 4);
  });

  it('a curve on a toggle macro makes it snap halfway, like pressing it', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    r.store.apply(groupDevices(r.t(0), [fx]));
    const rack = r.store.project.tracks[0].racks[0].id;
    r.store.apply(mapMacro(r.t(0), rack, 0, fx, 'mix'));
    r.store.apply(setMacroMode(r.t(0), rack, 0, 'toggle')); // mix 30: off (0 %)
    // from 0 to +1 in 4 beats: it crosses the half at 2 beats, and there the mix goes all the way up
    r.editClip(c => c.withEnvelope({ kind: 'device', device: rack, param: macroParam(0) }, pts([0, 0], [4, 1])));
    r.engine.play(0);
    r.runUntil(3);
    const mix = r.effects.created[0].modulation.events.filter(e => e.param === 'mix');
    expect(replay(mix, 0, r.at(1.9))).toBe(0);
    expect(replay(mix, 0, r.at(2.1))).toBe(1);
    expect(mix.some(e => e.type === 'ramp')).toBe(false); // steps only
  });

  it('a clip launched in place of another: the pan goes back to neutral at the boundary; the stop brings everything back to neutral', () => {
    const r = rig();
    const clip = (name: string) => MidiClip.empty(r.ids.next('clip'), name, '#fff', 4);
    r.store.apply(setSlot(r.t(1), 0, clip('Left').withEnvelope(PAN, pts([0, -1]))));
    r.store.apply(setSlot(r.t(1), 1, clip('Niente')));
    r.engine.launchSlot(r.t(1), 0);
    r.runUntil(1);
    r.engine.launchSlot(r.t(1), 1); // at the next bar boundary: beat 4
    r.runUntil(3);
    const ev = r.pan(1).events;
    expect(replay(ev, 0, r.at(1))).toBe(-1);
    expect(replay(ev, 0, r.at(3.9))).toBe(-1);
    expect(replay(ev, 0, r.at(4.1))).toBe(0);
    r.engine.launchSlot(r.t(1), 0);
    r.runUntil(5);
    expect(replay(r.pan(1).events, 0, 5)).toBe(-1);
    r.engine.stop();
    expect(replay(r.pan(1).events, 0, 5.01)).toBe(0);
  });

  it('the Drum Machine\'s clip modulates a pad', () => {
    // any parameter of another instrument: the engine doesn't know the parameters
    const r = rig();
    const target: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'p1decay' };
    expect(paramSpec(DRUMS, 'p1decay')?.kind).toBe('number');
    r.editClip(c => c.withEnvelope(target, pts([0, 0.3])));
    r.engine.play(0);
    r.runUntil(0.5);
    expect(r.instruments.created[0].modulation.events.some(e => e.param === 'p1decay' && e.value === 0.3)).toBe(true);
  });
});

describe('the knobs follow the curves', () => {
  it('the engine says where a curve takes a parameter now; stop: neutral again', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    const feedback: ModTarget = { kind: 'device', device: fx, param: 'feedback' };
    r.editClip(c => c.withEnvelope(CUTOFF, pts([0, 0], [4, 0.4])).withEnvelope(VOLUME, pts([0, 1], [2, 0])));
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBeNull(); // never played
    r.engine.play(0);
    r.runUntil(r.at(2));
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBeCloseTo(0.2, 4);
    expect(r.engine.modulationAt(r.t(0), VOLUME)).toBeCloseTo(0, 4);
    r.runUntil(r.at(5)); // second round of the clip's loop
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBeCloseTo(0.1, 4);
    expect(r.engine.modulationAt(r.t(0), feedback)).toBeNull(); // without curve
    expect(r.engine.modulationAt(r.t(1), CUTOFF)).toBeNull(); // another track
    r.engine.stop();
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBe(0);
  });

  it('a curve on a macro: the macro and the mapped parameters, each by its part of the travel', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    r.store.apply(groupDevices(r.t(0), [INSTRUMENT_DEVICE, fx]));
    const rack = r.store.project.tracks[0].racks[0].id;
    r.store.apply(mapMacro(r.t(0), rack, 0, INSTRUMENT_DEVICE, 'cutoff'));
    r.store.apply(mapMacro(r.t(0), rack, 0, fx, 'mix'));
    r.store.apply(setMappingRange(r.t(0), fx, 'mix', { min: 100, max: 50 }));
    const macro: ModTarget = { kind: 'device', device: rack, param: macroParam(0) };
    r.editClip(c => c.withEnvelope(macro, pts([0, 0], [4, 0.4])));
    r.engine.play(0);
    r.runUntil(r.at(2));
    expect(r.engine.modulationAt(r.t(0), macro)).toBeCloseTo(0.2, 4);
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBeCloseTo(0.2, 4);
    expect(r.engine.modulationAt(r.t(0), { kind: 'device', device: fx, param: 'mix' })).toBeCloseTo(-0.1, 4);
  });

  it('the curve removed while playing: the knob goes back to where it is after the rescheduling', () => {
    const r = rig();
    r.editClip(c => c.withEnvelope(CUTOFF, pts([0, 0.5])));
    r.engine.play(0);
    r.runUntil(1);
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBe(0.5);
    r.editClip(c => c.withEnvelope(CUTOFF, []));
    r.runUntil(1.5);
    expect(r.engine.modulationAt(r.t(0), CUTOFF)).toBe(0);
  });

  it('the master\'s curves move the master\'s effects', () => {
    const r = rig();
    r.store.apply(addEffect(MASTER, 'delay', 'Delay'));
    const fx = r.store.project.masterEffects[0].id;
    const mix: ModTarget = { kind: 'device', device: fx, param: 'mix' };
    r.store.apply(setMasterAutomation(mix, pts([0, 0], [8, -0.8])));
    r.engine.play(0);
    r.runUntil(r.at(4));
    expect(r.engine.modulationAt(MASTER, mix)).toBeCloseTo(-0.4, 4);
  });
});

describe('modulations of the choices in the editor', () => {
  function withTapeStop() {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'tapeStop', 'Tape Stop'));
    r.store.apply(addEffect(r.t(0), 'gate', 'Gate'));
    const [tape, gate] = r.store.project.tracks[0].effects.map(e => e.id);
    return { r, tape, gate, track: () => r.store.project.tracks[0], chain: () => trackChain(r.store.project.tracks[0]) };
  }

  it('the envelope menus also show the choices, not the parameters of the graphic panel only', () => {
    const { tape, gate, track } = withTapeStop();
    const devices = targetDevices(track());
    const params = (key: string) => devices.find(d => d.key === key)!.sections.flatMap(s => s.params.map(p => (p.target as { param: string }).param));
    expect(params(tape)).toEqual(expect.arrayContaining(['stop', 'start', 'curve', 'time']));
    expect(params(gate)).toContain('rate');
    expect(params(gate).some(p => p.startsWith('step'))).toBe(false);
  });

  it('the value under the pointer also says the option that\'s heard, from the current knob', () => {
    const { r, tape, chain } = withTapeStop();
    const stop: ModTarget = { kind: 'device', device: tape, param: 'stop' };
    expect(formatModValue(stop, 0.6, chain())).toBe('On · +60 %');
    expect(formatModValue(stop, 0.3, chain())).toBe('Off · +30 %');
    r.store.apply(setEffectParam(r.t(0), tape, 'stop', 1));
    expect(formatModValue(stop, -0.6, chain())).toBe('Off · −60 %');
    expect(choiceTarget(chain(), stop)!.heard(0.2)).toBe(1);
    // the numbers and the mixer stay as before
    expect(formatModValue({ kind: 'device', device: tape, param: 'spin' }, 0.6, chain())).toBe('+60 %');
    expect(choiceTarget(chain(), VOLUME)).toBeNull();
  });

  it('in the engine a choice\'s curve reaches the effect like a number\'s', () => {
    const { r, tape } = withTapeStop();
    r.editClip(c => c.withEnvelope({ kind: 'device', device: tape, param: 'stop' }, pts([0, 0], [2, 0], [2, 1])));
    r.engine.play(0);
    r.runUntil(2);
    const events = r.effects.created[0].modulation.events.filter(e => e.param === 'stop');
    expect(replay(events, 0, r.at(1))).toBe(0);
    expect(replay(events, 0, r.at(3))).toBe(1);
  });
});

describe('snapping modulation (toggle and button macro)', () => {
  /** Records the events reaching a target. */
  const recorder = () => {
    const events: { type: string; value: number; time: number }[] = [];
    const sink: ModSink = {
      set: (value, time) => events.push({ type: 'set', value, time }),
      ramp: (value, time) => events.push({ type: 'ramp', value, time }),
      hold: time => events.push({ type: 'hold', value: 0, time }),
    };
    return { events, sink };
  };

  it('off: a ramp crossing +½ becomes a step to +1 at the exact instant', () => {
    const { events, sink } = recorder();
    const s = switchSink(sink, false);
    s.set(0, 0);
    s.ramp(1, 4); // ½ passes at 2 s
    s.ramp(0.2, 7); // ripassa ½ a 4 + 3·(0.5/0.8)
    expect(events).toEqual([
      { type: 'set', value: 0, time: 0 },
      { type: 'set', value: 1, time: 2 },
      { type: 'set', value: 0, time: 4 + 3 * (0.5 / 0.8) },
    ]);
  });

  it('on: it snaps down only below −½', () => {
    const { events, sink } = recorder();
    const s = switchSink(sink, true);
    s.set(0.3, 0);
    s.ramp(-0.4, 1);
    s.ramp(-1, 2);
    expect(events.map(e => [e.value, +e.time.toFixed(6)])).toEqual([[0, 0], [-1, +(1 + 0.1 / 0.6).toFixed(6)]]);
  });
});

describe('master curves on the timeline', () => {
  /** The rig with a delay on the master (feedback and mix); `fx` its id. */
  function masterRig() {
    const r = rig();
    r.store.apply(addEffect(MASTER, 'delay', 'Delay'));
    const fx = r.store.project.masterEffects[0].id;
    // the last effect created is the master's (the tracks have none)
    const delay = (param: string) => r.effects.created.at(-1)!.modulation.events.filter(e => e.param === param);
    return { ...r, fx, delay };
  }

  it('in the model: one curve per target, in the scale; without points it disappears; not the mixer', () => {
    const { store, fx } = masterRig();
    const target: ModTarget = { kind: 'device', device: fx, param: 'feedback' };
    store.apply(setMasterAutomation(target, pts([4, -2], [0, 0])));
    expect(store.project.masterCurve(target)?.points).toEqual(pts([0, 0], [4, -1]));
    store.apply(setMasterAutomation(target, []));
    expect(store.project.masterAutomation).toEqual([]);
    expect(() => store.project.withMasterAutomation(VOLUME, pts([0, 0]))).toThrow();
  });

  it('in the automation menus: the master\'s effects and the macros of its racks, without mixer', () => {
    const { store, fx } = masterRig();
    store.apply(addEffect(MASTER, 'tapeStop', 'Tape Stop'));
    const tape = store.project.masterEffects[1].id;
    store.apply(groupDevices(MASTER, [fx]));
    const rack = store.project.masterRacks[0].id;
    expect(masterTargetDevices(store.project).map(d => d.key)).toEqual([rack, fx, tape]);
    expect(masterTargetDevices(store.project)[0].sections[0].params[0].target).toEqual({ kind: 'device', device: rack, param: macroParam(0) });
    // a master choice says the option that's heard, as on the tracks
    expect(formatModValue({ kind: 'device', device: tape, param: 'stop' }, 0.6, masterChain(store.project))).toBe('On · +60 %');
  });

  it('they\'re saved with the project; a file without opens', () => {
    const { store, fx } = masterRig();
    const target: ModTarget = { kind: 'device', device: fx, param: 'mix' };
    store.apply(setMasterAutomation(target, pts([0, 0], [16, 0.5])));
    const codec = new ProjectCodec();
    const json = JSON.parse(codec.stringify(store.project));
    expect(json.masterAutomation).toEqual({ [`${fx}:mix`]: [[0, 0], [16, 0.5]] });
    expect(codec.decode(json).masterCurve(target)?.points).toEqual(pts([0, 0], [16, 0.5]));
    delete json.masterAutomation;
    expect(codec.decode(json).masterAutomation).toEqual([]);
  });

  it('a parameter of a master effect follows the curve in the timeline\'s beats, even without clips', () => {
    const r = masterRig();
    r.store.apply(setMasterAutomation({ kind: 'device', device: r.fx, param: 'feedback' }, pts([2, 0], [6, 0.8])));
    r.engine.play(0);
    r.runUntil(4);
    const ev = r.delay('feedback');
    expect(replay(ev, 0, r.at(1))).toBe(0); // before the first point it's the first
    expect(replay(ev, 0, r.at(4))).toBeCloseTo(0.4, 4);
    expect(replay(ev, 0, r.at(7))).toBeCloseTo(0.8, 4); // after the last it stays the last
    r.engine.stop();
    expect(replay(r.delay('feedback'), 0, 99)).toBe(0); // stopped: neutral
  });

  it('with the timeline loop the curve restarts from the start of the loop at every round', () => {
    const r = masterRig();
    r.store.apply(setLoopRegion({ enabled: true, start: 0, end: 4 }));
    r.store.apply(setMasterAutomation({ kind: 'device', device: r.fx, param: 'feedback' }, pts([0, 0], [4, 1])));
    r.engine.play(0);
    r.runUntil(4.3);
    const ev = r.delay('feedback');
    expect(replay(ev, 0, r.at(3))).toBeCloseTo(0.75, 4);
    expect(replay(ev, 0, r.at(5))).toBeCloseTo(0.25, 4); // second round: again at beat 1
  });

  it('removing the curve while playing: after the rescheduling the parameter goes back to neutral', () => {
    const r = masterRig();
    const target: ModTarget = { kind: 'device', device: r.fx, param: 'feedback' };
    r.store.apply(setMasterAutomation(target, pts([0, -0.5])));
    r.engine.play(0);
    r.runUntil(1);
    expect(replay(r.delay('feedback'), 0, 1)).toBe(-0.5);
    r.store.apply(setMasterAutomation(target, []));
    r.runUntil(2);
    const ev = r.delay('feedback');
    expect(replay(ev, 0, 1.02)).toBe(-0.5); // until the restart it holds the value: no jump
    expect(replay(ev, 0, 1.2)).toBe(0);
  });

  it('a curve on a button macro of a master rack makes it snap, like pressing it', () => {
    const r = masterRig();
    r.store.apply(groupDevices(MASTER, [r.fx]));
    const rack = r.store.project.masterRacks[0].id;
    r.store.apply(mapMacro(MASTER, rack, 0, r.fx, 'mix'));
    r.store.apply(setMacroMode(MASTER, rack, 0, 'button'));
    // pressed from beat 2 to 3, like Ripeti or Stop nastro before a drop
    r.store.apply(setMasterAutomation({ kind: 'device', device: rack, param: macroParam(0) }, pts([0, 0], [2, 0], [2, 1], [3, 1], [3, 0])));
    r.engine.play(0);
    r.runUntil(3);
    const mix = r.delay('mix');
    expect(replay(mix, 0, r.at(1.9))).toBe(0);
    expect(replay(mix, 0, r.at(2.5))).toBe(1);
    expect(replay(mix, 0, r.at(3.5))).toBe(0);
  });
});
