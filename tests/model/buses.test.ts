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

/** Due tracce audio (a b) e due bus (A B). */
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
  it('un progetto nuovo ha una traccia MIDI, una audio e due bus', () => {
    const p = starterProject('Nuovo', sequentialIds());
    expect(p.tracks.map(t => [t.kind, t.name])).toEqual([['midi', '1 MIDI'], ['audio', '1 Audio']]);
    expect(p.buses.map(b => b.name)).toEqual(['A Bus', 'B Bus']);
    expect(p.channels).toHaveLength(4);
  });

  it('stanno a parte, dopo le tracce: niente slot, niente clip', () => {
    const r = withBuses();
    const p = r.store.project;
    expect(p.tracks).toHaveLength(2);
    expect(p.visibleTracks.map(t => t.id)).toEqual([r.a, r.b]);
    expect(p.track(r.busA)).toBeInstanceOf(BusTrack);
    expect(p.track(r.busA)!.slots).toHaveLength(0);
    // si rinominano e hanno una catena come le tracce
    r.store.apply(renameTrack(r.busA, 'Riverbero'));
    r.store.apply(addEffect(r.busA, 'reverb', 'Reverb'));
    expect(r.store.project.track(r.busA)!.name).toBe('Riverbero');
    expect(r.store.project.effectsOf(r.busA)).toHaveLength(1);
  });

  it('le mandate: aperte con un livello, chiuse fino a −∞', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    expect(r.store.project.track(r.a)!.send(r.busA)).toBe(-6);
    expect(r.store.project.track(r.a)!.sends).toEqual({ [r.busA]: -6 });
    r.store.apply(setSend(r.a, r.busA, SEND_OFF_DB));
    expect(r.store.project.track(r.a)!.sends).toEqual({});
    // un bus non manda ad altri bus, e si manda solo ai bus
    expect(() => r.store.apply(setSend(r.busA, r.busB, -3))).toThrow();
    expect(() => r.store.apply(setSend(r.a, r.b, -3))).toThrow();
  });

  it('eliminato un bus, le mandate verso di lui si chiudono', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    r.store.apply(setSend(r.a, r.busB, -12));
    r.store.apply(removeTrack(r.busA));
    expect(r.store.project.buses.map(b => b.id)).toEqual([r.busB]);
    expect(r.store.project.track(r.a)!.sends).toEqual({ [r.busB]: -12 });
    // il prossimo bus prende una lettera libera
    r.store.apply(addBus());
    expect(r.store.project.buses.map(b => b.name)).toEqual(['B Bus', 'C Bus']);
  });

  it('si salvano e si rileggono, con le mandate', () => {
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

  it('si spostano tra i bus; le mandate restano', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    r.store.apply(moveBus(r.busA, 1));
    expect(r.store.project.buses.map(b => b.id)).toEqual([r.busB, r.busA]);
    expect(r.store.project.track(r.a)!.send(r.busA)).toBe(-6);
    const before = r.store.project;
    r.store.apply(moveBus(r.busA, 1));
    expect(r.store.project).toBe(before);
  });

  it('si comprimono e si espandono; compressi si salvano così', () => {
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

  it('i progetti di prima (formato 10, senza bus) si aprono come erano', () => {
    const r = setup({ audio: 2 });
    const json = JSON.parse(codec.stringify(r.store.project));
    expect(json).not.toHaveProperty('buses');
    expect(json.tracks.some((t: object) => 'sends' in t)).toBe(false);
    json.version = 10;
    const back = codec.decode(json);
    expect(back.buses).toHaveLength(0);
    expect(back.tracks.map(t => t.name)).toEqual(['1 Audio', '2 Audio']);
  });

  it('un bus tra le tracce o una mandata verso un bus che non c\'è non si aprono', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    const good = JSON.parse(codec.stringify(r.store.project));
    const misplaced = structuredClone(good);
    misplaced.tracks.push(misplaced.buses.pop());
    expect(() => codec.decode(misplaced)).toThrow(/sta tra le tracce/);
    const dangling = structuredClone(good);
    dangling.buses.shift();
    expect(() => codec.decode(dangling)).toThrow(/bus che non c'è/);
  });
});

describe('bus nel mixer', () => {
  it('le mandate portano il suono della traccia nel bus, il bus esce nel master', () => {
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
    // cambia il livello: stessa mandata, guadagno nuovo
    mixer.sync(r.store.project.updatingTrack(r.a, t => t.withSend(r.busA, 0)));
    expect(sendsTo(mixer.input(r.busA))).toEqual([send]);
    expect(send.gain.value).toBeCloseTo(1);
    // chiusa, la mandata si stacca
    mixer.sync(r.store.project.updatingTrack(r.a, t => t.withSend(r.busA, SEND_OFF_DB)));
    expect(sendsTo(mixer.input(r.busA))).toHaveLength(0);
  });

  it('solo e mute: i bus restano aperti al solo di una traccia, le mandate seguono la traccia', () => {
    const r = withBuses();
    const gates = () => mixerGates(r.store.project.tracks, r.store.project.buses);
    expect(gates().audible).toEqual(new Set([r.a, r.b, r.busA, r.busB]));
    // solo di a: si sentono a e i bus; b non manda più
    r.store.apply(setMixer(r.a, { solo: true }));
    expect(gates().audible).toEqual(new Set([r.a, r.busA, r.busB]));
    expect(gates().sending).toEqual(new Set([r.a]));
    // solo di un bus: si sente solo lui, ma le tracce continuano a mandargli il suono
    r.store.apply(setMixer(r.a, { solo: false }));
    r.store.apply(setMixer(r.busA, { solo: true }));
    expect(gates().audible).toEqual(new Set([r.busA]));
    expect(gates().sending).toEqual(new Set([r.a, r.b]));
    // il mute di una traccia chiude anche le sue mandate
    r.store.apply(setMixer(r.busA, { solo: false }));
    r.store.apply(setMixer(r.b, { mute: true }));
    expect(gates().sending).toEqual(new Set([r.a]));
  });

  it('il sidechain non chiude anelli passando per le mandate', () => {
    const r = withBuses();
    r.store.apply(setSend(r.a, r.busA, -6));
    r.store.apply(addEffect(r.a, 'compressor', 'Compressor'));
    r.store.apply(addEffect(r.busA, 'compressor', 'Compressor'));
    const p = r.store.project;
    const onA = p.effectsOf(r.a)[0].id, onBus = p.effectsOf(r.busA)[0].id;
    // a manda nel bus: il compressore di a non può ascoltare il bus, quello del bus può ascoltare a
    expect(sidechainSources(p, r.a, onA)).not.toContain(r.busA);
    expect(sidechainSources(p, r.busA, onBus)).toContain(r.a);
    expect(sidechainSources(p, r.b, onA)).toContain(r.busA);
    r.store.apply(setEffectSidechain(r.busA, onBus, r.a));
    expect(r.store.project.effectsOf(r.busA)[0].sidechain).toBe(r.a);
  });
});
