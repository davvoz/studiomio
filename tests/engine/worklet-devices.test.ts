import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceWorklet, WorkletEffects, WorkletInstruments, WorkletMeters,
} from '../../src/engine/worklet-devices';
import { METER_VALUES } from '../../src/devices/worklet/meter-core';
import { EFFECT_PROCESSOR, INSTRUMENT_PROCESSOR, METER_PROCESSOR } from '../../src/devices/worklet/protocol';
import type { AudioGraph } from '../../src/engine/audio-graph';
import type { SampleId } from '../../src/core/id';
import type { EffectSettings, InstrumentSettings } from '../../src/model/device';

class FakeNode {
  readonly links: unknown[] = [];
  disconnected = 0;
  connect(to: unknown) { this.links.push(to); return to; }
  disconnect(to?: unknown) {
    this.disconnected++;
    if (to) this.links.splice(this.links.indexOf(to), 1); else this.links.length = 0;
  }
}

/** settle() is on the worklet classes, not on the Instrument/Effect interfaces the hosts return. */
const settling = (device: unknown) => device as { settle(): Promise<void> };

class FakeWorkletNode extends FakeNode {
  static created: FakeWorkletNode[] = [];
  readonly sent: Record<string, unknown>[] = [];
  readonly port = {
    postMessage: (m: Record<string, unknown>) => { this.sent.push(m); },
    onmessage: null as ((e: { data: unknown }) => void) | null,
  };
  readonly connections: [unknown, number | undefined, number | undefined][] = [];
  constructor(readonly ctx: unknown, readonly name: string, readonly options: Record<string, any>) {
    super();
    FakeWorkletNode.created.push(this);
  }
  override connect(to: unknown, out?: number, inp?: number) { this.connections.push([to, out, inp]); return super.connect(to); }
  reply(data: unknown) { this.port.onmessage?.({ data }); }
  ofType(type: string) { return this.sent.filter(m => m.type === type); }
}

class FakeCtx {
  readonly gains: FakeNode[] = [];
  addModule = vi.fn((_url: string) => Promise.resolve());
  readonly audioWorklet = { addModule: this.addModule };
  createGain() { const g = new FakeNode(); this.gains.push(g); return g; }
}

const asGraph = (c: FakeCtx) => c as unknown as AudioGraph;
const settings = (type: string, params: Record<string, number> = {}): InstrumentSettings => ({ type, preset: null, params });
const effect = (type: string, over: Partial<EffectSettings> = {}): EffectSettings =>
  ({ id: 'e1', type, preset: null, params: {}, enabled: true, ...over }) as unknown as EffectSettings;
const flush = () => new Promise<void>(r => setTimeout(r, 0));

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  FakeWorkletNode.created = [];
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  errors.mockRestore();
});

describe('DeviceWorklet', () => {
  it('loads the module once per context and then is no longer pending', async () => {
    const w = new DeviceWorklet(), a = new FakeCtx(), b = new FakeCtx();
    const p = w.pending(asGraph(a));
    expect(p).not.toBeNull();
    expect(w.prepare(asGraph(a))).toBe(p);
    await p;
    expect(a.addModule).toHaveBeenCalledTimes(1);
    expect(w.pending(asGraph(a))).toBeNull();
    expect(w.pending(asGraph(b))).not.toBeNull();
    expect(b.addModule).toHaveBeenCalledTimes(1);
  });

  it('reports faults to listeners until they unsubscribe', () => {
    const w = new DeviceWorklet(), seen: [string, string | null][] = [];
    const off = w.onFault((t, e) => seen.push([t, e]));
    w.fault('delay', 'boom');
    w.fault('kick', null);
    off();
    w.fault('delay', 'again');
    expect(seen).toEqual([['delay', 'boom'], ['kick', null]]);
    expect(errors).toHaveBeenCalledTimes(3);
    expect(String(errors.mock.calls[1][1])).toContain('NaN');
  });
});

describe('WorkletInstruments', () => {
  const make = (samples?: (id: SampleId) => any) => {
    const worklet = new DeviceWorklet(), ctx = new FakeCtx();
    const host = new WorkletInstruments(worklet, samples);
    return { worklet, ctx, host };
  };

  it('builds the processor right away when the module is loaded, with the resolved params', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    host.create(asGraph(ctx), settings('kick'), 150);
    const [node] = FakeWorkletNode.created;
    expect(node.name).toBe(INSTRUMENT_PROCESSOR);
    expect(node.options.processorOptions).toMatchObject({ type: 'kick', bpm: 150, transport: null });
    expect(Object.keys(node.options.processorOptions.params).length).toBeGreaterThan(0);
    expect(node.options).toMatchObject({ numberOfInputs: 0, numberOfOutputs: 1 });
  });

  it('unknown types play silent (no params)', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    host.create(asGraph(ctx), settings('nope'), 120);
    expect(FakeWorkletNode.created[0].options.processorOptions.params).toEqual({});
  });

  it('waits for the module: notes are lost before, messages flow after', async () => {
    const { ctx, host } = make();
    const inst = host.create(asGraph(ctx), settings('kick'), 120);
    inst.play(60, 1, 0, 1);
    expect(FakeWorkletNode.created).toHaveLength(0);
    await flush();
    expect(FakeWorkletNode.created).toHaveLength(1);
    inst.play(60, 0.5, 2, 1.5);
    inst.press(61, 0.7);
    inst.release(61);
    inst.stopAll();
    inst.cut(3);
    inst.retake(4);
    inst.setTempo!(130);
    expect(FakeWorkletNode.created[0].sent).toEqual([
      { type: 'note', pitch: 60, velocity: 0.5, on: 2, off: 3.5 },
      { type: 'press', pitch: 61, velocity: 0.7 },
      { type: 'release', pitch: 61 },
      { type: 'stop' },
      { type: 'cut', at: 3 },
      { type: 'retake', at: 4 },
      { type: 'tempo', bpm: 130 },
    ]);
  });

  it('logs and stays silent if the module fails to load', async () => {
    const { ctx, host } = make();
    ctx.addModule.mockReturnValueOnce(Promise.reject(new Error('no module')));
    host.create(asGraph(ctx), settings('kick'), 120);
    await flush();
    expect(FakeWorkletNode.created).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith('instrument not available', expect.any(Error));
  });

  it('sends params only when they change, merged with the arp params', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const s = settings('kick');
    const inst = host.create(asGraph(ctx), s, 120);
    const node = FakeWorkletNode.created[0];
    inst.update({ ...s }, 1);
    expect(node.sent).toEqual([]);
    inst.setArp({ arpOn: 1 });
    expect((node.sent[0] as any).params.arpOn).toBe(1);
    inst.update({ ...s, params: { ...s.params } }, 5);
    expect(node.sent[1]).toMatchObject({ type: 'params', at: 5 });
    expect((node.sent[1] as any).params.arpOn).toBe(1);
  });

  it('sends only the changed sample slots, null for removed or not-yet-loaded ones', async () => {
    const data = { sampleRate: 44100, channels: [new Float32Array(4)] };
    const { worklet, ctx, host } = make(id => (id === ('s1' as SampleId) ? data : undefined));
    await worklet.prepare(asGraph(ctx));
    const s = { ...settings('sampler'), samples: { a: 's1' as SampleId, b: 's2' as SampleId } };
    expect(FakeWorkletNode.created.length).toBe(0);
    const inst = host.create(asGraph(ctx), s, 120);
    const node = FakeWorkletNode.created[0];
    expect(Object.keys(node.options.processorOptions.samples)).toEqual(['a']);
    inst.update({ ...s, samples: { a: 's1' as SampleId, b: 's3' as SampleId, c: 's1' as SampleId } }, 2);
    expect(node.ofType('sample')).toEqual([
      { type: 'sample', slot: 'b', sample: null, at: 2 },
      { type: 'sample', slot: 'c', sample: { sampleRate: 44100, channels: [data.channels[0]] }, at: 2 },
    ]);
    inst.update({ ...s, samples: { a: 's1' as SampleId } });
    expect(node.ofType('sample').slice(2)).toEqual([
      { type: 'sample', slot: 'b', sample: null, at: undefined },
      { type: 'sample', slot: 'c', sample: null, at: undefined },
    ]);
  });

  it('modulation sinks become mod messages, with the channel when given', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const inst = host.create(asGraph(ctx), settings('kick'), 120);
    const sink = inst.modulation!.sink('level', 'lfo1');
    sink.set(0.5, 1);
    sink.ramp(0.9, 2);
    sink.hold(3);
    inst.modulation!.sink('level').set(0.1, 4);
    expect(FakeWorkletNode.created[0].sent).toEqual([
      { type: 'mod', param: 'level', kind: 'set', value: 0.5, time: 1, channel: 'lfo1' },
      { type: 'mod', param: 'level', kind: 'ramp', value: 0.9, time: 2, channel: 'lfo1' },
      { type: 'mod', param: 'level', kind: 'hold', value: 0, time: 3, channel: 'lfo1' },
      { type: 'mod', param: 'level', kind: 'set', value: 0.1, time: 4 },
    ]);
  });

  it('keeps playheads from replies, reports faults and answers pings in settle()', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const faults: unknown[] = [];
    worklet.onFault((t, e) => faults.push([t, e]));
    const inst = host.create(asGraph(ctx), settings('kick'), 120);
    const node = FakeWorkletNode.created[0];
    expect(inst.playheads!()).toEqual([]);
    node.reply({ type: 'playheads', positions: new Float32Array([0.25, 0.5]) });
    expect(inst.playheads!()).toEqual([0.25, 0.5]);
    node.reply({ type: 'fault', error: 'bad' });
    expect(faults).toEqual([['kick', 'bad']]);
    let done = false;
    const settled = host.settle(asGraph(ctx)).then(() => { done = true; });
    await flush();
    expect(done).toBe(false);
    const ping = node.ofType('ping')[0] as { id: number };
    node.reply({ type: 'pong', id: ping.id });
    await settled;
    expect(done).toBe(true);
  });

  it('settle resolves at once before the processor exists and on dispose', async () => {
    const { ctx, host } = make();
    const inst = host.create(asGraph(ctx), settings('kick'), 120);
    await settling(inst).settle();
    await flush();
    const pending = settling(inst).settle();
    inst.dispose();
    await pending;
  });

  it('transport anchors reach existing instruments and seed new ones', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const anchor = { time: 1, beat: 0, bpm: 120, beatsPerBar: 4 };
    host.create(asGraph(ctx), settings('kick'), 120);
    host.transport(asGraph(ctx), anchor);
    expect(FakeWorkletNode.created[0].sent).toEqual([{ type: 'transport', anchor }]);
    host.create(asGraph(ctx), settings('kick'), 120);
    expect(FakeWorkletNode.created[1].options.processorOptions.transport).toBe(anchor);
    host.transport(asGraph(ctx), null);
    expect(FakeWorkletNode.created[1].sent).toEqual([{ type: 'transport', anchor: null }]);
  });

  it('dispose tells the processor, disconnects and forgets the instrument', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const inst = host.create(asGraph(ctx), settings('kick'), 120);
    const node = FakeWorkletNode.created[0];
    inst.dispose();
    expect(node.sent.at(-1)).toEqual({ type: 'dispose' });
    expect(node.disconnected).toBe(1);
    host.transport(asGraph(ctx), null);
    expect(node.sent.filter(m => m.type === 'transport')).toEqual([]);
    expect(await host.prepare(asGraph(ctx))).toBeUndefined();
  });
});

describe('WorkletEffects', () => {
  const make = () => {
    const worklet = new DeviceWorklet(), ctx = new FakeCtx();
    return { worklet, ctx, host: new WorkletEffects(worklet) };
  };

  it('passes the direct sound until the module is ready, then routes through the processor', async () => {
    const { ctx, host } = make();
    const fx = host.create(asGraph(ctx), effect('delay'), 120);
    expect((fx.input as unknown as FakeNode).links).toContain(fx.monitor!.post);
    await flush();
    const node = FakeWorkletNode.created[0];
    expect(node.name).toBe(EFFECT_PROCESSOR);
    expect(node.options).toMatchObject({ numberOfInputs: 1, channelCount: 2 });
    expect((fx.input as unknown as FakeNode).links).toEqual([node]);
    expect(node.links).toContain(fx.monitor!.post);
    expect(fx.sidechain).toBeUndefined();
  });

  it('types with sidechain get a second input wired from the sidechain node', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const fx = host.create(asGraph(ctx), effect('compressor', { sidechain: 't1' as any }), 120);
    const node = FakeWorkletNode.created[0];
    expect(fx.sidechain).toBeDefined();
    expect(node.options.numberOfInputs).toBe(2);
    expect(node.options.processorOptions.keyed).toBe(true);
    expect((fx.sidechain as unknown as { connections?: unknown }).connections).toBeUndefined();
    expect((fx.sidechain as unknown as FakeNode).links).toEqual([node]);
  });

  it('forwards only the changed settings', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const s = effect('compressor');
    const fx = host.create(asGraph(ctx), s, 120);
    const node = FakeWorkletNode.created[0];
    fx.update({ ...s });
    expect(node.sent).toEqual([]);
    fx.update({ ...s, params: { threshold: -10 }, enabled: false, sidechain: 't1' as any });
    expect(node.sent.map(m => m.type)).toEqual(['params', 'enabled', 'keyed']);
    expect(node.sent[1]).toEqual({ type: 'enabled', enabled: false });
    expect(node.sent[2]).toEqual({ type: 'keyed', keyed: true });
    expect((node.sent[0] as any).params.threshold).toBe(-10);
    fx.setTempo(90);
    expect(node.sent.at(-1)).toEqual({ type: 'tempo', bpm: 90 });
  });

  it('sends the watch flag and delivers dynamics to the listener; faults go to the worklet', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const faults: unknown[] = [];
    worklet.onFault((t, e) => faults.push([t, e]));
    const fx = host.create(asGraph(ctx), effect('compressor'), 120);
    const node = FakeWorkletNode.created[0];
    const got: number[][] = [];
    fx.monitor!.watch!(((i: number, r: number) => got.push([i, r])) as never);
    expect(node.sent.at(-1)).toEqual({ type: 'watch', on: true });
    node.reply({ type: 'dynamics', input: -12, reduction: 3 });
    expect(got).toEqual([[-12, 3]]);
    fx.monitor!.watch!(null as never);
    expect(node.sent.at(-1)).toEqual({ type: 'watch', on: false });
    node.reply({ type: 'dynamics', input: 0, reduction: 0 });
    expect(got).toHaveLength(1);
    node.reply({ type: 'fault', error: null });
    expect(faults).toEqual([['compressor', null]]);
  });

  it('re-sends watch when the processor is built after a listener was set', async () => {
    const { ctx, host } = make();
    const fx = host.create(asGraph(ctx), effect('compressor'), 120);
    fx.monitor!.watch!((() => undefined) as never);
    await flush();
    expect(FakeWorkletNode.created[0].sent).toEqual([{ type: 'watch', on: true }]);
  });

  it('settles through pings and transport anchors reach existing and new effects', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const anchor = { time: 2, beat: 1, bpm: 100, beatsPerBar: 4 };
    host.create(asGraph(ctx), effect('delay'), 120);
    host.transport(asGraph(ctx), anchor);
    const node = FakeWorkletNode.created[0];
    expect(node.ofType('transport')).toEqual([{ type: 'transport', anchor }]);
    host.create(asGraph(ctx), effect('delay'), 120);
    expect(FakeWorkletNode.created[1].options.processorOptions.transport).toBe(anchor);
    const settled = host.settle(asGraph(ctx));
    for (const n of FakeWorkletNode.created) n.reply({ type: 'pong', id: (n.ofType('ping')[0] as { id: number }).id });
    await settled;
  });

  it('dispose before the module is ready never builds the processor', async () => {
    const { ctx, host } = make();
    const fx = host.create(asGraph(ctx), effect('delay'), 120);
    fx.dispose();
    await flush();
    expect(FakeWorkletNode.created).toHaveLength(0);
  });

  it('dispose after build disconnects everything and releases pending settles', async () => {
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const fx = host.create(asGraph(ctx), effect('compressor', { sidechain: 't1' as any }), 120);
    const node = FakeWorkletNode.created[0];
    const pending = settling(fx).settle();
    fx.dispose();
    await pending;
    expect(node.sent.at(-1)).toEqual({ type: 'dispose' });
    expect(node.disconnected).toBe(1);
    expect((fx.output as unknown as FakeNode).disconnected).toBe(1);
    expect((fx.sidechain as unknown as FakeNode).disconnected).toBe(1);
  });

  it('logs when the module cannot load', async () => {
    const { ctx, host } = make();
    ctx.addModule.mockReturnValueOnce(Promise.reject(new Error('x')));
    host.create(asGraph(ctx), effect('delay'), 120);
    await flush();
    expect(errors).toHaveBeenCalledWith('effect not available', expect.any(Error));
    expect(FakeWorkletNode.created).toHaveLength(0);
  });
});

describe('WorkletMeters', () => {
  const make = () => {
    const worklet = new DeviceWorklet(), ctx = new FakeCtx();
    return { worklet, ctx, host: new WorkletMeters(worklet) };
  };

  it('without shared memory it reads values sent by message: peak is the max, reset on read', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const meter = host.create(asGraph(ctx));
    const node = FakeWorkletNode.created[0];
    expect(node.name).toBe(METER_PROCESSOR);
    expect(node.options.processorOptions).toEqual({ buffer: null, offset: 0 });
    node.reply({ type: 'levels', values: new Float32Array([0.2, 0.9, 0.25, 0.16]) });
    node.reply({ type: 'levels', values: new Float32Array([0.5, 0.3, 0.36, 0.04]) });
    expect(meter.read()).toEqual({ peak: [expect.closeTo(0.5), expect.closeTo(0.9)], rms: [expect.closeTo(0.6), expect.closeTo(0.2)] });
    expect(meter.read().peak).toEqual([0, 0]);
  });

  it('shares memory when allowed, handing each meter its own slot and recycling it on dispose', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    const { worklet, ctx, host } = make();
    await worklet.prepare(asGraph(ctx));
    const m1 = host.create(asGraph(ctx)), m2 = host.create(asGraph(ctx));
    const [n1, n2] = FakeWorkletNode.created;
    expect(n1.options.processorOptions.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(n2.options.processorOptions.buffer).toBe(n1.options.processorOptions.buffer);
    expect(n1.options.processorOptions.offset).toBe(0);
    expect(n2.options.processorOptions.offset).toBe(METER_VALUES);
    expect(n1.port.onmessage).toBeNull();
    // the processor writes into the shared buffer; the reader sees it
    const shared = new Float32Array(n2.options.processorOptions.buffer);
    shared.set([0.7, 0.8, 0.49, 0.64], METER_VALUES);
    expect(m2.read().peak).toEqual([expect.closeTo(0.7), expect.closeTo(0.8)]);
    expect(m2.read().rms).toEqual([expect.closeTo(0.7), expect.closeTo(0.8)]);
    expect(m2.read().peak).toEqual([0, 0]);
    m1.dispose();
    expect(n1.sent).toEqual([{ type: 'dispose' }]);
    host.create(asGraph(ctx));
    expect(FakeWorkletNode.created[2].options.processorOptions.offset).toBe(0);
  });

  it('passes the sound through while loading, and skips the build if disposed meanwhile', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    const { ctx, host } = make();
    const meter = host.create(asGraph(ctx));
    expect((meter.input as unknown as FakeNode).links).toEqual([meter.output]);
    meter.dispose();
    await flush();
    expect(FakeWorkletNode.created).toHaveLength(0);
    const m2 = host.create(asGraph(ctx));
    await flush();
    const node = FakeWorkletNode.created[0];
    expect((m2.input as unknown as FakeNode).links).toEqual([node]);
    expect(node.connections[0][0]).toBe(m2.output);
  });

  it('logs if the module cannot load', async () => {
    const { ctx, host } = make();
    ctx.addModule.mockReturnValueOnce(Promise.reject(new Error('x')));
    host.create(asGraph(ctx));
    await flush();
    expect(errors).toHaveBeenCalledWith('meter not available', expect.any(Error));
  });
});
