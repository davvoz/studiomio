import { describe, expect, it } from 'vitest';
import { MixerGraph } from '../../src/engine/mixer-graph';
import { MeterCore } from '../../src/devices/worklet/meter-core';
import { MASTER } from '../../src/model/project';
import { addEffect } from '../../src/store/edits';
import { FakeEffects, FakeGain, FakeGraph, FakeMeters } from '../helpers/fake-audio';
import { setup } from '../helpers/fixtures';

const SR = 48000;

describe('MeterCore', () => {
  it('picco tenuto finché chi legge non lo azzera; RMS a media mobile, per canale', () => {
    const out = new Float32Array(4);
    const core = new MeterCore(SR, out);
    const sine = (amp: number) => Float32Array.from({ length: 128 }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / SR));
    // un secondo di seno a piena scala a sinistra, a metà a destra
    for (let t = 0; t < SR; t += 128) core.process(sine(1), sine(0.5), 128);
    expect(out[0]).toBeCloseTo(1, 2);
    expect(out[1]).toBeCloseTo(0.5, 2);
    expect(Math.sqrt(out[2])).toBeCloseTo(Math.SQRT1_2, 1);
    expect(Math.sqrt(out[3])).toBeCloseTo(Math.SQRT1_2 / 2, 1);
    // chi legge azzera il picco: il silenzio non lo rialza, l'RMS scende piano
    out[0] = out[1] = 0;
    const before = Math.sqrt(out[2]);
    const silence = new Float32Array(128);
    core.process(silence, silence, 128);
    expect([out[0], out[1]]).toEqual([0, 0]);
    expect(Math.sqrt(out[2]) / before).toBeGreaterThan(0.98); // un blocco: scende appena
    for (let t = 0; t < SR; t += 128) core.process(silence, silence, 128);
    expect(20 * Math.log10(Math.sqrt(out[2]) / before)).toBeCloseTo(-36.2, 0); // τ 120 ms sulla media dei quadrati: 10·log10(e^(−1/0.12))
  });

  it('un picco breve tra due letture non si perde', () => {
    const out = new Float32Array(4);
    const core = new MeterCore(SR, out);
    const click = new Float32Array(128);
    click[77] = -0.8;
    core.process(click, new Float32Array(128), 128);
    for (let i = 0; i < 20; i++) core.process(new Float32Array(128), new Float32Array(128), 128);
    expect(out[0]).toBeCloseTo(0.8, 5);
  });
});

describe('MixerGraph: misuratori', () => {
  it('uno per traccia dopo mute/solo e uno sul master dopo il suo volume', () => {
    const { store, track } = setup({ audio: 1, midi: 1 });
    const graph = new FakeGraph(), meters = new FakeMeters();
    const mixer = new MixerGraph(graph, new FakeEffects(), graph.destination, meters);
    mixer.sync(store.project);
    const [masterMeter, a, m] = meters.created;
    expect((mixer.master as FakeGain).outputs).toEqual([masterMeter.input]);
    expect(masterMeter.output.outputs).toEqual([graph.destination]);
    // traccia: … → gate → misuratore → bus del master
    const bus = graph.gains[0];
    expect(a.output.outputs).toEqual([bus]);
    expect(graph.gains.some(g => g.outputs.includes(a.input))).toBe(true);

    a.next = { peak: [0.5, 0.25], rms: [0.1, 0.05] };
    expect(mixer.levels(track(0))).toEqual(a.next);
    masterMeter.next = { peak: [1, 1], rms: [0.3, 0.3] };
    expect(mixer.levels(MASTER)).toEqual(masterMeter.next);

    mixer.sync(store.project.removingTrack(track(1)));
    expect(m.disposed).toBe(true);
    expect(mixer.levels(track(1))).toBeNull();
  });

  it('senza misuratori (export) il suono va dritto, e i livelli sono null', () => {
    const { store, track } = setup({ audio: 1, midi: 0 });
    const graph = new FakeGraph();
    const mixer = new MixerGraph(graph, new FakeEffects());
    mixer.sync(store.project);
    expect((mixer.master as FakeGain).outputs).toEqual([graph.destination]);
    expect(mixer.levels(track(0))).toBeNull();
    expect(mixer.levels(MASTER)).toBeNull();
  });

  it('trova un effetto che suona, di una traccia o del master', () => {
    const { store, track } = setup({ audio: 1, midi: 0 });
    const graph = new FakeGraph(), effects = new FakeEffects();
    const mixer = new MixerGraph(graph, effects);
    store.apply(addEffect(track(0), 'eq', 'EQ'));
    store.apply(addEffect(MASTER, 'delay', 'Delay'));
    mixer.sync(store.project);
    const [trackFx, masterFx] = effects.created;
    expect(mixer.effect(track(0), store.project.tracks[0].effects[0].id)).toBe(trackFx);
    expect(mixer.effect(MASTER, store.project.masterEffects[0].id)).toBe(masterFx);
    expect(mixer.effect(MASTER, store.project.tracks[0].effects[0].id)).toBeUndefined();
  });
});
