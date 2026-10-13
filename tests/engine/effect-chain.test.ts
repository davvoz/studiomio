import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { EffectChain } from '../../src/engine/effect-chain';
import { newEffect, withParam, type EffectSettings } from '../../src/model/device';
import { FakeEffects, FakeGain, FakeGraph } from '../helpers/fake-audio';

function rig() {
  const graph = new FakeGraph(), host = new FakeEffects();
  const input = new FakeGain(), output = new FakeGain();
  const chain = new EffectChain(graph, host, input, output);
  return { graph, host, chain, input, output };
}

const fx = (n: number, type = 'delay'): EffectSettings => newEffect(asId(`device-${n}`), type);

describe('EffectChain', () => {
  it('senza effetti l\'ingresso va dritto all\'uscita', () => {
    const { input, output } = rig();
    expect(input.outputs).toEqual([output]);
  });

  it('crea gli effetti e li collega in ordine', () => {
    const { chain, host, input } = rig();
    const [a, b] = [fx(1), fx(2)];
    chain.sync([a, b], 120);
    expect(host.created.map(e => [e.type, e.bpm])).toEqual([['delay', 120], ['delay', 120]]);
    const [ea, eb] = host.created;
    expect(input.outputs).toEqual([ea.input]);
    expect(ea.output.outputs).toEqual([eb.input]);
    expect(chain.size).toBe(2);
  });

  it('parametri nuovi: aggiorna senza ricreare né ricollegare', () => {
    const { chain, host, input } = rig();
    const a = fx(1);
    chain.sync([a], 120);
    const before = [...input.outputs];
    const a2 = withParam(a, 'feedback', 70);
    chain.sync([a2], 120);
    expect(host.created).toHaveLength(1);
    expect(host.created[0].updates).toEqual([a2]);
    expect(input.outputs).toEqual(before);
    chain.sync([a2], 120); // stesse impostazioni: niente
    expect(host.created[0].updates).toHaveLength(1);
  });

  it('riordinare ricollega; togliere distrugge', () => {
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

  it('il tempo arriva a tutti gli effetti quando cambia', () => {
    const { chain, host } = rig();
    chain.sync([fx(1), fx(2)], 120);
    chain.sync(host.created.map(e => e.settings), 90);
    expect(host.created.map(e => e.tempos)).toEqual([[90], [90]]);
  });

  it('un tipo diverso con lo stesso id: effetto nuovo', () => {
    const { chain, host } = rig();
    chain.sync([fx(1)], 120);
    chain.sync([fx(1, 'reverb')], 120);
    expect(host.created[0].disposed).toBe(true);
    expect(host.created[1].type).toBe('reverb');
  });
});
