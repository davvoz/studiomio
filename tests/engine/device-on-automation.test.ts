import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { effectOn, ModTimeline, OnOffModulation } from '../../src/devices/worklet/mod-timeline';
import { PlaybackEngine } from '../../src/engine/playback-engine';
import { DEVICE_ON, INSTRUMENT_DEVICE, MOD_SCALES, ONOFF_REST, scaleKindOf, snapToScale, type ModTarget } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import { addEffect, addMidiClip, addTrack, updateClip } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { formatModValue, targetDevices } from '../../src/ui/envelopes/mod-targets';
import { FakeEffects, FakeGraph, FakeInstruments } from '../helpers/fake-audio';

const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

describe('an effect\'s on/off as a curve (Live\'s Device On)', () => {
  it('a target of its own, in steps: 1 on, 0 off', () => {
    const on: ModTarget = { kind: 'device', device: 'fx' as never, param: DEVICE_ON };
    expect(scaleKindOf(on)).toBe('onoff');
    expect(scaleKindOf({ ...on, param: 'feedback' })).toBe('param');
    expect(snapToScale(0.7, MOD_SCALES.onoff)).toBe(1);
    expect(snapToScale(0.3, MOD_SCALES.onoff)).toBe(0);
    expect(snapToScale(0.37, MOD_SCALES.param)).toBe(0.37); // the continuous ones stay as they are
    expect(formatModValue(on, 1)).toBe('On');
    expect(formatModValue(on, 0)).toBe('Off');
  });

  it('in the processor: outside the curves the button decides, on a curve the curve', () => {
    expect(effectOn(ONOFF_REST, true)).toBe(true);
    expect(effectOn(ONOFF_REST, false)).toBe(false);
    expect(effectOn(1, false)).toBe(true);
    expect(effectOn(0, true)).toBe(false);
    const m = new OnOffModulation();
    expect(m.event('feedback', 'set', 0, 1)).toBe(false); // the other parameters go on as before
    expect(m.event(DEVICE_ON, 'set', 0, 1)).toBe(true);
    expect(m.event(DEVICE_ON, 'set', 1, 3)).toBe(true);
    expect(m.event(DEVICE_ON, 'set', ONOFF_REST, 5)).toBe(true);
    // an LFO doesn't switch it: its events are taken but ignored
    expect(m.event(DEVICE_ON, 'set', 0, 6, 'lfo')).toBe(true);
    expect(m.onAt(0.5, true)).toBe(true);
    expect(m.onAt(2, true)).toBe(false);
    expect(m.onAt(4, false)).toBe(true);
    expect(m.onAt(5.5, false)).toBe(false);
    expect(m.onAt(7, true)).toBe(true);
  });

  it('in the menus: first in every effect, not for the instrument', () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('t', ids, 2), ids);
    store.apply(addTrack('midi'));
    store.apply(addEffect(store.project.tracks[0].id, 'beatRepeat', 'Beat Repeat'));
    const devices = targetDevices(store.project.tracks[0]);
    const fx = devices.find(d => d.key === store.project.tracks[0].effects[0].id)!;
    expect(fx.sections[0].params.map(p => p.label)).toEqual(['On/Off']);
    expect(fx.sections[0].params[0].target).toEqual({ kind: 'device', device: fx.key, param: DEVICE_ON });
    const synth = devices.find(d => d.key === INSTRUMENT_DEVICE)!;
    expect(synth.sections.flatMap(s => s.params).some(p => p.target.kind === 'device' && p.target.param === DEVICE_ON)).toBe(false);
  });

  it('in the engine: the curve reaches the effect, and after the clip the button decides again', () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('t', ids, 2), ids);
    store.apply(addTrack('midi'));
    const t: TrackId = store.project.tracks[0].id;
    store.apply(addMidiClip(t, 0, 4));
    store.apply(addEffect(t, 'beatRepeat', 'Beat Repeat'));
    const fx = store.project.tracks[0].effects[0].id, pl = store.project.tracks[0].arrangement[0];
    // off for the first two beats, on for the other two
    store.apply(updateClip<MidiClip>('m', t, pl.id, c => c.withEnvelope({ kind: 'device', device: fx, param: DEVICE_ON }, pts([0, 0], [2, 0], [2, 1]))));
    const graph = new FakeGraph(), effects = new FakeEffects();
    let tick: (() => void) | null = null;
    const engine = new PlaybackEngine(graph, { clips: { playable: () => null }, instruments: new FakeInstruments(), effects }, {
      timer: { every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } }, startLatency: 0.05, lookahead: 0.2,
    });
    const runUntil = (time: number) => {
      while (graph.currentTime < time) {
        graph.currentTime += 0.025;
        tick?.();
      }
    };
    engine.setProject(store.project);
    engine.play(0);
    runUntil(3);
    const line = new ModTimeline(ONOFF_REST);
    for (const e of effects.created[0].modulation.events.filter(x => x.param === DEVICE_ON)) {
      if (e.type === 'hold') line.hold(e.time);
      else line.add({ kind: e.type as 'set' | 'ramp', value: e.value, time: e.time });
    }
    const at = (beat: number) => 0.05 + beat / 2; // 120 BPM
    expect(effectOn(line.peek(at(1)), true)).toBe(false);
    expect(effectOn(line.peek(at(3)), false)).toBe(true);
    // after the 4-beat clip: the button again
    expect(line.peek(at(4.5))).toBe(ONOFF_REST);
  });
});
