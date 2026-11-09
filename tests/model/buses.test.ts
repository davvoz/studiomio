import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { MixerGraph, mixerGates } from '../../src/engine/mixer-graph';
import { sidechainSources } from '../../src/model/sidechain';
import { BusTrack, SEND_OFF_DB } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import {
  addBus, addEffect, moveBus, removeTrack, renameTrack, setBusFolded, setEffectSidechain, setMixer, setSend, starterProject,
} from '../../src/store/edits';
import { FakeEffects, FakeGain, FakeGraph, FakeMeters } from '../helpers/fake-audio';
import { setup } from '../helpers/fixtures';

/** Two audio tracks (a b) and two buses (A B). */
function withBuses() {
  const r = setup({ audio: 2 });
  r.store.apply(addBus());
  r.store.apply(addBus());
  const [a, b] = [0, 1].map(r.track);
  const [busA, busB] = r.store.project.buses.map(x => x.id);
  return { ...r, a, b, busA, busB };
}

const codec = new ProjectCodec();

describe('bus', () => {
  it('a new project has a MIDI track, an audio one and two buses', () => {
    const p = starterProject('New', sequentialIds());
    expect(p.tracks.map(t => [t.kind, t.name])).toEqual([['midi', '1 MIDI'], ['audio', '1 Audio']]);
    expect(p.buses.map(b => b.name)).toEqual(['A Bus', 'B Bus']);
    expect(p.channels).toHaveLength(4);
  });

  it('they sit apart, after the tracks: no slots, no clips', () => {
    const r = withBuses();
    const p = r.store.project;
    expect(p.tracks).toHaveLength(2);
    expect(p.visibleTracks.map(t => t.id)).toEqual([r.a, r.b]);
    expect(p.track(r.busA)).toBeInstanceOf(BusTrack);
    expect(p.track(r.busA)!.slots).toHaveLength(0);
    // they're renamed and have a chain like the tracks
    r.store.apply(renameTrack(r.busA, 'Reverb'));
    r.store.apply(addEffect(r.busA, 'reverb', 'Reverb'));
    expect(r.store.project.track(r.busA)!.name).toBe('Reverb');
    expect(r.store.project.effectsOf(r.busA)).toHaveLength(1);
  });

  it('the sends: open with a level, closed down to −∞', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    expect(r.store.project.track(r.a)!.send(r.busA)).toBe(-6);
    expect(r.store.project.track(r.a)!.sends).toEqual({ [r.busA]: -6 });
    r.store.apply(setSend(r.a, r.busA, SEND_OFF_DB));
    expect(r.store.project.track(r.a)!.sends).toEqual({});
    // a bus doesn't send to other buses, and you send only to buses
    expect(() => r.store.apply(setSend(r.busA, r.busB, -3))).toThrow();
    expect(() => r.store.apply(setSend(r.a, r.b, -3))).toThrow();
  });

  it('a bus deleted, the sends to it close', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    r.store.apply(setSend(r.a, r.busB, -12));
    r.store.apply(removeTrack(r.busA));
    expect(r.store.project.buses.map(b => b.id)).toEqual([r.busB]);
    expect(r.store.project.track(r.a)!.sends).toEqual({ [r.busB]: -12 });
    // the next bus takes a free letter
    r.store.apply(addBus());
    expect(r.store.project.buses.map(b => b.name)).toEqual(['B Bus', 'C Bus']);
  });

  it('they\'re saved and read back, with the sends', () => {
    const r = withBuses();
    r.store.apply(setSend(r.b, r.busB, -3.5));
    r.store.apply(addEffect(r.busB, 'delay', 'Delay'));
    const text = codec.stringify(r.store.project);
    const back = codec.parse(text);
    expect(codec.stringify(back)).toBe(text);
    expect(back.buses.map(b => b.name)).toEqual(['A Bus', 'B Bus']);
    expect(back.track(r.b)!.send(r.busB)).toBe(-3.5);
    expect(back.effectsOf(r.busB)[0].type).toBe('delay');
  });

  it('they move among the buses; the sends stay', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    r.store.apply(moveBus(r.busA, 1));
    expect(r.store.project.buses.map(b => b.id)).toEqual([r.busB, r.busA]);
    expect(r.store.project.track(r.a)!.send(r.busA)).toBe(-6);
    const before = r.store.project;
    r.store.apply(moveBus(r.busA, 1));
    expect(r.store.project).toBe(before);
  });

  it('they collapse and expand; collapsed they\'re saved that way', () => {
    const r = withBuses();
    r.store.apply(setBusFolded(r.busB, true));
    expect((r.store.project.track(r.busB) as BusTrack).folded).toBe(true);
    expect((r.store.project.track(r.busA) as BusTrack).folded).toBe(false);
    const back = codec.parse(codec.stringify(r.store.project));
    expect(back.buses.map(b => b.folded)).toEqual([false, true]);
    r.store.apply(setBusFolded(r.busB, false));
    expect(JSON.parse(codec.stringify(r.store.project)).buses.some((b: object) => 'folded' in b)).toBe(false);
    expect(() => r.store.apply(setBusFolded(r.a, true))).toThrow();
  });

  it('the earlier projects (format 10, without buses) open as they were', () => {
    const r = setup({ audio: 2 });
    const json = JSON.parse(codec.stringify(r.store.project));
    expect(json).not.toHaveProperty('buses');
    expect(json.tracks.some((t: object) => 'sends' in t)).toBe(false);
    json.version = 10;
    const back = codec.decode(json);
    expect(back.buses).toHaveLength(0);
    expect(back.tracks.map(t => t.name)).toEqual(['1 Audio', '2 Audio']);
  });

  it('a bus among the tracks or a send to a bus that doesn\'t exist don\'t open', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    const good = JSON.parse(codec.stringify(r.store.project));
    const misplaced = structuredClone(good);
    misplaced.tracks.push(misplaced.buses.pop());
    expect(() => codec.decode(misplaced)).toThrow(/is among the tracks/);
    const dangling = structuredClone(good);
    dangling.buses.shift();
    expect(() => codec.decode(dangling)).toThrow(/bus that doesn't exist/);
  });
});

describe('buses in the mixer', () => {
  it('the sends carry the track\'s sound into the bus, the bus goes out into the master', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    const graph = new FakeGraph(), meters = new FakeMeters();
    const mixer = new MixerGraph(graph, new FakeEffects(), graph.destination, meters);
    mixer.sync(r.store.project);
    const bus = graph.gains[0];
    const [, , , busAMeter, busBMeter] = meters.created;
    expect(busAMeter.output.outputs).toEqual([bus]);
    expect(busBMeter.output.outputs).toEqual([bus]);
    const sendsTo = (target: unknown) => graph.gains.filter(g => g.outputs.includes(target as FakeGain));
    const [send] = sendsTo(mixer.input(r.busA));
    expect(send.gain.value).toBeCloseTo(10 ** (-6 / 20));
    expect(sendsTo(mixer.input(r.busB))).toHaveLength(0);
    // the level changes: same send, new gain
    mixer.sync(r.store.project.updatingTrack(r.a, t => t.withSend(r.busA, 0)));
    expect(sendsTo(mixer.input(r.busA))).toEqual([send]);
    expect(send.gain.value).toBeCloseTo(1);
    // closed, the send comes off
    mixer.sync(r.store.project.updatingTrack(r.a, t => t.withSend(r.busA, SEND_OFF_DB)));
    expect(sendsTo(mixer.input(r.busA))).toHaveLength(0);
  });

  it('solo and mute: the buses stay open on a track\'s solo, the sends follow the track', () => {
    const r = withBuses();
    const gates = () => mixerGates(r.store.project.tracks, r.store.project.buses);
    expect(gates().audible).toEqual(new Set([r.a, r.b, r.busA, r.busB]));
    // solo of a: a and the buses are heard; b no longer sends
    r.store.apply(setMixer(r.a, { solo: true }));
    expect(gates().audible).toEqual(new Set([r.a, r.busA, r.busB]));
    expect(gates().sending).toEqual(new Set([r.a]));
    // solo of a bus: only it is heard, but the tracks keep sending it sound
    r.store.apply(setMixer(r.a, { solo: false }));
    r.store.apply(setMixer(r.busA, { solo: true }));
    expect(gates().audible).toEqual(new Set([r.busA]));
    expect(gates().sending).toEqual(new Set([r.a, r.b]));
    // a track's mute also closes its sends
    r.store.apply(setMixer(r.busA, { solo: false }));
    r.store.apply(setMixer(r.b, { mute: true }));
    expect(gates().sending).toEqual(new Set([r.a]));
  });

  it('the sidechain doesn\'t close loops going through the sends', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    r.store.apply(addEffect(r.a, 'compressor', 'Compressor'));
    r.store.apply(addEffect(r.busA, 'compressor', 'Compressor'));
    const p = r.store.project;
    const onA = p.effectsOf(r.a)[0].id, onBus = p.effectsOf(r.busA)[0].id;
    // a sends to the bus: a's compressor can't listen to the bus, the bus's can listen to a
    expect(sidechainSources(p, r.a, onA)).not.toContain(r.busA);
    expect(sidechainSources(p, r.busA, onBus)).toContain(r.a);
    expect(sidechainSources(p, r.b, onA)).toContain(r.busA);
    r.store.apply(setEffectSidechain(r.busA, onBus, r.a));
    expect(r.store.project.effectsOf(r.busA)[0].sidechain).toBe(r.a);
  });
});
