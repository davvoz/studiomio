import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { EffectChain } from '../../src/engine/effect-chain';
import { MixerGraph } from '../../src/engine/mixer-graph';
import { newEffect, withParam, type EffectSettings } from '../../src/model/device';
import { MASTER } from '../../src/model/project';
import { addEffect, setMasterMixer } from '../../src/store/edits';
import { FakeEffects, FakeGain, FakeGraph } from '../helpers/fake-audio';
import { setup } from '../helpers/fixtures';

function rig() {
  const graph = new FakeGraph(), host = new FakeEffects();
  const input = new FakeGain(), output = new FakeGain();
  const chain = new EffectChain(graph, host, input, output);
  return { graph, host, chain, input, output };
}

const fx = (n: number, type = 'delay'): EffectSettings => newEffect(asId(`device-${n}`), type);

describe('EffectChain', () => {
  it('without effects the input goes straight to the output', () => {
    const { input, output } = rig();
    expect(input.outputs).toEqual([output]);
  });

  it('creates the effects and connects them in order', () => {
    const { chain, host, input } = rig();
    const [a, b] = [fx(1), fx(2)];
    chain.sync([a, b], 120);
    expect(host.created.map(e => [e.type, e.bpm])).toEqual([['delay', 120], ['delay', 120]]);
    const [ea, eb] = host.created;
    expect(input.outputs).toEqual([ea.input]);
    expect(ea.output.outputs).toEqual([eb.input]);
    expect(chain.size).toBe(2);
  });

  it('new parameters: updates without recreating or reconnecting', () => {
    const { chain, host, input } = rig();
    const a = fx(1);
    chain.sync([a], 120);
    const before = [...input.outputs];
    const a2 = withParam(a, 'feedback', 70);
    chain.sync([a2], 120);
    expect(host.created).toHaveLength(1);
    expect(host.created[0].updates).toEqual([a2]);
    expect(input.outputs).toEqual(before);
    chain.sync([a2], 120); // same settings: nothing
    expect(host.created[0].updates).toHaveLength(1);
  });

  it('reordering reconnects; removing destroys', () => {
    const { chain, host, input, output } = rig();
    const [a, b] = [fx(1), fx(2)];
    chain.sync([a, b], 120);
    const [ea, eb] = host.created;
    chain.sync([b, a], 120);
    expect(input.outputs).toEqual([eb.input]);
    expect(eb.output.outputs).toEqual([ea.input]);
    expect(ea.output.outputs).toEqual([output]);
    chain.sync([b], 120);
    expect(ea.disposed).toBe(true);
    expect(eb.output.outputs).toEqual([output]);
    expect(host.created).toHaveLength(2);
  });

  it('the tempo reaches all the effects when it changes', () => {
    const { chain, host } = rig();
    chain.sync([fx(1), fx(2)], 120);
    chain.sync(host.created.map(e => e.settings), 90);
    expect(host.created.map(e => e.tempos)).toEqual([[90], [90]]);
  });

  it('a different type with the same id: new effect', () => {
    const { chain, host } = rig();
    chain.sync([fx(1)], 120);
    chain.sync([fx(1, 'reverb')], 120);
    expect(host.created[0].disposed).toBe(true);
    expect(host.created[1].type).toBe('reverb');
  });
});

describe('MixerGraph: the master', () => {
  it('the tracks add up in the bus, which goes through the master\'s effects and then through its volume', () => {
    const { store, track } = setup({ audio: 1, midi: 0 });
    const graph = new FakeGraph(), host = new FakeEffects();
    const mixer = new MixerGraph(graph, host);
    mixer.sync(store.project);
    const [bus, master] = graph.gains;
    expect(bus.outputs).toEqual([master]);
    expect(master.outputs).toEqual([graph.destination]);

    store.apply(addEffect(MASTER, 'delay', 'Delay'));
    store.apply(setMasterMixer({ volumeDb: -6 }));
    mixer.sync(store.project);
    const [effect] = host.created;
    expect(bus.outputs).toEqual([effect.input]);
    expect(effect.output.outputs).toEqual([master]);
    expect(master.gain.value).toBeCloseTo(0.501, 3);

    // the track's channel ends in the bus, not after the master's effects
    const gate = graph.gains.at(-2)!; // the last is the sends' gate
    expect(mixer.input(track(0))).toBe(graph.gains[2]);
    expect(gate.outputs).toEqual([bus]);

    store.apply(setMasterMixer({ mute: true }));
    mixer.sync(store.project);
    expect(master.gain.value).toBe(0);
  });
});
