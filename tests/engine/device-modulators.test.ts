import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { LFO_SHAPE } from '../../src/devices/instruments/prisma/shapes';
import { envValue, lfoUnit } from '../../src/devices/modulators/mod-shapes';
import { ENV_TRIG, LFO_TRIG, linkAmount, POLARITY } from '../../src/devices/modulators/modulators';
import { TEMPO_RATE } from '../../src/devices/rates';
import { ModTimeline, ParamModulation } from '../../src/devices/worklet/mod-timeline';
import { paramSpec } from '../../src/devices/device-type';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import { paramFromUnit, paramToUnit } from '../../src/devices/params';
import { modChannel } from '../../src/engine/device-modulators';
import { PlaybackEngine } from '../../src/engine/playback-engine';
import { INSTRUMENT_DEVICE, type ModTarget } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { macroParam } from '../../src/model/rack';
import { Project } from '../../src/model/project';
import { ProjectCodec } from '../../src/persistence/project-codec';
import {
  addEffect, addMidiClip, addTrack, resizePlacement, setEffectEnabled, setEffectParams, setInstrument, setModTarget, updateClip,
} from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { groupDevices, mapMacro } from '../../src/store/rack-edits';
import { FakeEffects, FakeGraph, FakeInstruments } from '../helpers/fake-audio';

const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };
const CUTOFF: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'cutoff' };

/** The value at instant `t` replaying the events with the AudioParam rules. */
function replay(events: readonly { type: string; value: number; time: number }[], neutral: number, t: number): number {
  const line = new ModTimeline(neutral);
  for (const e of events) {
    if (e.type === 'set' || e.type === 'ramp') line.add({ kind: e.type, value: e.value, time: e.time });
    else if (e.type === 'hold') line.hold(e.time);
  }
  return line.valueAt(t);
}

/** 120 BPM (beat b plays at 0.05 + b/2): a MIDI track with a 4-beat looping clip
 *  placed for 8, and a modulator `type` at the end of the chain. */
function rig(type: 'lfo' | 'envelope', params: Record<string, number> = {}) {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, 2), ids);
  store.apply(addTrack('midi'));
  const t: TrackId = store.project.tracks[0].id;
  store.apply(addMidiClip(t, 0, 4));
  const pl = store.project.tracks[0].arrangement[0];
  store.apply(resizePlacement(t, pl.id, { end: 8 }));
  store.apply(addEffect(t, type, type));
  const mod = store.project.tracks[0].effects[0].id;
  store.apply(setEffectParams(t, mod, params));
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
  const at = (beat: number) => 0.05 + beat / 2;
  const editClip = (fn: (c: MidiClip) => MidiClip) => store.apply(updateClip<MidiClip>('m', t, pl.id, fn));
  /** The events of the channel of target `slot` on a parameter of the instrument. */
  const synth = (param: string, slot = 0) =>
    instruments.created[0].modulation.events.filter(e => e.param === param && e.channel === modChannel(mod, slot));
  return { store, engine, graph, instruments, effects, t, mod, runUntil, at, editClip, synth };
}

describe('modulators: the shapes', () => {
  it('the LFO uses Prisma\'s shapes (from 0 to 1) and the drawn one', () => {
    expect(lfoUnit(LFO_SHAPE.sine, [], 0)).toBeCloseTo(0, 9);
    expect(lfoUnit(LFO_SHAPE.sine, [], 2.5)).toBeCloseTo(1, 9);
    expect(lfoUnit(LFO_SHAPE.sawUp, [], 0.25)).toBeCloseTo(0.25, 9);
    expect(lfoUnit(LFO_SHAPE.square, [], 0.75)).toBe(0);
    const drawn = [{ x: 0, y: 1, curve: 0 }, { x: 1, y: 0, curve: 0 }];
    expect(lfoUnit(LFO_SHAPE.drawn, drawn, 3.5)).toBeCloseTo(0.5, 9);
    // the random shapes: the same cycle gives the same value, another seed other values
    expect(lfoUnit(LFO_SHAPE.sampleHold, [], 4.2)).toBe(lfoUnit(LFO_SHAPE.sampleHold, [], 4.9));
    expect(lfoUnit(LFO_SHAPE.sampleHold, [], 4.2, 3)).not.toBe(lfoUnit(LFO_SHAPE.sampleHold, [], 4.2));
  });

  it('the envelope: attack from the level there was, hold, decay to the sustain, release', () => {
    const times = { attack: 0.1, hold: 0.1, decay: 0.2, sustain: 0.5, release: 0.4, attackCurve: 0, decayCurve: 0, releaseCurve: 0 };
    const g = { on: 1, off: 2, from: 0.2, level: 1, times };
    expect(envValue(g, 1)).toBeCloseTo(0.2, 9);
    expect(envValue(g, 1.05)).toBeCloseTo(0.6, 9);
    expect(envValue(g, 1.15)).toBe(1);
    expect(envValue(g, 1.3)).toBeCloseTo(0.75, 9);
    expect(envValue(g, 1.9)).toBe(0.5);
    expect(envValue(g, 2.2)).toBeCloseTo(0.25, 9);
    expect(envValue(g, 2.5)).toBe(0);
    expect(envValue({ ...g, level: 0.5 }, 1.9)).toBe(0.25);
  });

  it('in the worklet the sources of a parameter add up: the curves and each target of a modulator', () => {
    const cutoff = paramSpec(ANALOG, 'cutoff')!;
    const m = new ParamModulation(new Map([['cutoff', cutoff]]), { cutoff: 1000 });
    m.event('cutoff', 'set', 0.1, 0);
    m.event('cutoff', 'set', 0.05, 0, 'lfo/0');
    m.event('cutoff', 'set', -0.02, 0, 'env/1');
    expect(m.paramsAt(0)!.cutoff).toBeCloseTo(paramFromUnit(cutoff, paramToUnit(cutoff, 1000) + 0.13), 6);
    // the curve goes back to neutral: the modulator remains
    m.event('cutoff', 'set', 0, 1);
    m.event('cutoff', 'set', 0, 1, 'env/1');
    expect(m.paramsAt(1)!.cutoff).toBeCloseTo(paramFromUnit(cutoff, paramToUnit(cutoff, 1000) + 0.05), 6);
  });
});

describe('modulators in the engine', () => {
  it('a synced LFO moves the cutoff locked to the bar, by its amount', () => {
    const r = rig('lfo', { division: TEMPO_RATE['1 bar'], [linkAmount(1)]: 40 });
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    r.engine.play(0);
    r.runUntil(2.2);
    const ev = r.synth('cutoff');
    // Prisma's sine starts from the bottom: bipolar it goes from −1 (beat 0) to +1 (beat 2)
    expect(replay(ev, 0, r.at(0))).toBeCloseTo(-0.4, 3);
    expect(replay(ev, 0, r.at(1))).toBeCloseTo(0, 2);
    expect(replay(ev, 0, r.at(2))).toBeCloseTo(0.4, 3);
    expect(replay(ev, 0, r.at(4))).toBeCloseTo(-0.4, 3);
    // the modulator isn't an effect in the sound
    expect(r.effects.created).toEqual([]);
  });

  it('the knob follows the sum of the sources; at the stop it goes back to neutral', () => {
    const r = rig('lfo', { division: TEMPO_RATE['1 bar'], pol: POLARITY.uni, [linkAmount(1)]: 50 });
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    r.engine.play(0);
    r.runUntil(r.at(2));
    expect(r.engine.modulationAt(r.t, CUTOFF)).toBeCloseTo(0.5, 2);
    r.engine.stop();
    expect(r.engine.modulationAt(r.t, CUTOFF)).toBe(0);
  });

  it('a synced envelope on the volume with amount −100 % makes the pump at every quarter', () => {
    const r = rig('envelope', { trig: ENV_TRIG.tempo, e1A: 0.001, e1H: 0.001, e1D: 0.2, e1S: 0, e1Dc: 0, [linkAmount(1)]: -100 });
    r.store.apply(setModTarget(r.t, r.mod, 0, VOLUME));
    r.engine.play(0);
    r.runUntil(2.4);
    // the gain of the modulator's channel: between the fader and the curves'
    const curves = r.graph.gains.find(g => g.outputs.includes(r.graph.panners[0]))!;
    const vol = r.graph.gains.find(g => g.outputs.includes(curves))!.gain;
    expect(curves.gain.events).toEqual([]);
    const v = (beat: number) => replay(vol.events, 1, r.at(beat));
    expect(v(0.004)).toBeLessThan(0.01); // just started: silence
    expect(v(0.2)).toBeCloseTo((1 - 0.5) ** 2, 1); // halfway through the decay
    expect(v(0.9)).toBe(1); // finished: the volume comes all back
    expect(v(1.004)).toBeLessThan(0.01); // the next quarter
  });

  it('a note envelope starts with the clip\'s notes and releases when they end', () => {
    const r = rig('envelope', { e1A: 0.001, e1H: 0.001, e1D: 0.001, e1S: 100, e1R: 0.1, e1Rc: 0, [linkAmount(1)]: 100 });
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    r.editClip(c => c.withNotes([{ pitch: 60, start: 1, duration: 1, velocity: 100 }]));
    r.engine.play(0);
    r.runUntil(2.4);
    const ev = r.synth('cutoff');
    expect(replay(ev, 0, r.at(0.5))).toBe(0);
    expect(replay(ev, 0, r.at(1.5))).toBeCloseTo(1, 3);
    expect(replay(ev, 0, r.at(2) + 0.05)).toBeCloseTo(0.5, 2);
    expect(replay(ev, 0, r.at(2) + 0.2)).toBe(0);
    // at the second round of the loop again
    expect(replay(ev, 0, r.at(5.5))).toBeCloseTo(1, 3);
  });

  it('an LFO restarting with the notes: at every note the cycle restarts', () => {
    const r = rig('lfo', { division: TEMPO_RATE['1 bar'], trig: LFO_TRIG.note, l1Shape: LFO_SHAPE.sawUp, pol: POLARITY.uni, [linkAmount(1)]: 100 });
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    r.editClip(c => c.withNotes([{ pitch: 60, start: 1, duration: 0.5, velocity: 100 }]));
    r.engine.play(0);
    r.runUntil(1.6);
    const ev = r.synth('cutoff');
    expect(replay(ev, 0, r.at(1) + 0.001)).toBeLessThan(0.02);
    expect(replay(ev, 0, r.at(3))).toBeCloseTo(0.5, 2);
  });

  it('a target on a macro moves the mapped parameters; another modulator adds up', () => {
    const r = rig('lfo', { division: TEMPO_RATE['1 bar'], pol: POLARITY.uni, [linkAmount(1)]: 100 });
    r.store.apply(groupDevices(r.t, [INSTRUMENT_DEVICE]));
    const rack = r.store.project.tracks[0].racks[0].id;
    r.store.apply(mapMacro(r.t, rack, 0, INSTRUMENT_DEVICE, 'cutoff'));
    r.store.apply(setModTarget(r.t, r.mod, 0, { kind: 'device', device: rack, param: macroParam(0) }));
    r.engine.play(0);
    r.runUntil(1.2);
    const ev = r.synth('cutoff');
    expect(replay(ev, 0, r.at(2))).toBeGreaterThan(0.1); // mapped over the whole travel: it moves
    expect(r.engine.modulationAt(r.t, { kind: 'device', device: rack, param: macroParam(0) })).not.toBeNull();
  });

  it('off or without the target: after the rescheduling the parameter goes back to neutral', () => {
    const r = rig('lfo', { division: TEMPO_RATE['1 bar'], pol: POLARITY.uni, [linkAmount(1)]: 100 });
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    r.engine.play(0);
    r.runUntil(1);
    r.store.apply(setEffectEnabled(r.t, r.mod, false));
    r.runUntil(2);
    expect(replay(r.synth('cutoff'), 0, 1.5)).toBe(0);
  });

  it('a clip curve on the amount of an LFO changes it while playing', () => {
    const r = rig('lfo', { division: TEMPO_RATE['1 bar'], pol: POLARITY.uni, [linkAmount(1)]: 0 });
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    // the amount goes from −100 to +100: half travel up takes it from 0 to +100
    r.editClip(c => c.withEnvelope({ kind: 'device', device: r.mod, param: linkAmount(1) }, [{ beat: 0, value: 0.5 }]));
    r.engine.play(0);
    r.runUntil(1.2);
    expect(replay(r.synth('cutoff'), 0, r.at(1))).toBeCloseTo(0.5, 2);
    expect(replay(r.synth('cutoff'), 0, r.at(2))).toBeCloseTo(1, 2);
  });

  it('changing the instrument, the targets on its parameters are freed', () => {
    const r = rig('lfo');
    r.store.apply(setModTarget(r.t, r.mod, 0, CUTOFF));
    r.store.apply(setInstrument(r.t, { type: 'wavetable', preset: null, params: {} }));
    expect(r.store.project.tracks[0].effects[0].targets).toBeUndefined();
  });

  it('the targets are saved with the project', () => {
    const r = rig('lfo');
    r.store.apply(setModTarget(r.t, r.mod, 2, VOLUME, -30));
    const codec = new ProjectCodec();
    const json = JSON.parse(codec.stringify(r.store.project));
    expect(json.tracks[0].effects[0].targets).toEqual([null, null, 'mixer:volume']);
    const back = codec.decode(json).tracks[0].effects[0];
    expect(back.targets).toEqual([null, null, VOLUME]);
    expect(back.params[linkAmount(3)]).toBe(-30);
  });
});
