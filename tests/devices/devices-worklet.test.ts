import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EFFECT_CORES, INSTRUMENT_CORES } from '../../src/devices/worklet/cores';
import { resolveParams } from '../../src/devices/device-type';
import { SAMPLE_SLOT } from '../../src/devices/instruments/sampler/sampler';
import { EFFECT_PROCESSOR, INSTRUMENT_PROCESSOR, METER_PROCESSOR } from '../../src/devices/worklet/protocol';
import { EFFECT_TYPES, INSTRUMENT_TYPES, instrumentType } from '../../src/devices/registry';

const SR = 48000;
const BLOCK = 128;

interface FakePort {
  posted: any[];
  postMessage(m: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
type Processor = {
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
type Ctor = new (options: unknown) => Processor;

const processors = new Map<string, Ctor>();

class FakeAudioWorkletProcessor {
  readonly port: FakePort = {
    posted: [],
    postMessage(m: unknown) { this.posted.push(m); },
    onmessage: null,
  };
}

const setFrame = (frame: number) => vi.stubGlobal('currentFrame', frame);
const send = (p: Processor, data: Record<string, unknown>) => p.port.onmessage!({ data });
const make = (name: string, processorOptions: Record<string, unknown>) =>
  new (processors.get(name)!)({ processorOptions });
const block = (fill = 0) => new Float32Array(BLOCK).fill(fill);
const run = (p: Processor, inputs: Float32Array[][] = [], frame = 0) => {
  setFrame(frame);
  const outputs = [[block(), block()]];
  const alive = p.process(inputs, outputs);
  return { alive, left: outputs[0][0], right: outputs[0][1] };
};
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

beforeAll(async () => {
  vi.stubGlobal('sampleRate', SR);
  vi.stubGlobal('currentFrame', 0);
  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
  vi.stubGlobal('registerProcessor', (name: string, ctor: Ctor) => processors.set(name, ctor));
  await import('../../src/devices/worklet/devices.worklet');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => setFrame(0));

describe('devices.worklet: registration', () => {
  it('registers the three processors', () => {
    expect([...processors.keys()].sort()).toEqual([EFFECT_PROCESSOR, INSTRUMENT_PROCESSOR, METER_PROCESSOR].sort());
  });
});

describe('instrument processor', () => {
  const defaults = (type: string) => {
    const t = instrumentType(type);
    return t ? resolveParams(t, {}) : {};
  };
  const opts = (type: string, extra: Record<string, unknown> = {}) =>
    ({ type, params: defaults(type), samples: {}, bpm: 120, transport: null, ...extra });

  it('plays a scheduled note: silent before it starts, sound while it lasts', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('kick'));
    send(p, { type: 'note', pitch: 36, velocity: 1, on: 0.1, off: 0.5 });
    expect(peak(run(p, [], 0).left)).toBe(0);
    let max = 0;
    for (let f = Math.round(0.1 * SR); f < Math.round(0.2 * SR); f += BLOCK) max = Math.max(max, peak(run(p, [], f).left));
    expect(max).toBeGreaterThan(0.01);
  });

  it('press and release play a held note; stop silences it', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('analog'));
    setFrame(0);
    send(p, { type: 'press', pitch: 60, velocity: 1 });
    let max = 0;
    for (let f = 0; f < 4000; f += BLOCK) max = Math.max(max, peak(run(p, [], f).left));
    expect(max).toBeGreaterThan(0.001);
    send(p, { type: 'release', pitch: 60 });
    send(p, { type: 'stop' });
    for (let f = 4096; f < 4096 + 48000; f += BLOCK) run(p, [], f);
    expect(peak(run(p, [], 4096 + 48000).left)).toBe(0);
  });

  it('cut and retake drop scheduled notes', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('kick'));
    send(p, { type: 'note', pitch: 36, velocity: 1, on: 1, off: 2 });
    send(p, { type: 'note', pitch: 38, velocity: 1, on: 3, off: 4 });
    send(p, { type: 'cut', at: 0.5 });
    send(p, { type: 'retake', at: 0.5 });
    let max = 0;
    for (let f = SR; f < SR + 4800; f += BLOCK) max = Math.max(max, peak(run(p, [], f).left));
    for (let f = 3 * SR; f < 3 * SR + 4800; f += BLOCK) max = Math.max(max, peak(run(p, [], f).left));
    expect(max).toBe(0);
  });

  it('answers pings, applies tempo and transport messages, and dies on dispose', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('analog', { transport: { time: 0, beat: 0, bpm: 120, beatsPerBar: 4 } }));
    send(p, { type: 'ping', id: 7 });
    send(p, { type: 'tempo', bpm: 100 });
    send(p, { type: 'transport', anchor: null });
    send(p, { type: 'transport', anchor: { time: 0, beat: 0, bpm: 100, beatsPerBar: 4 } });
    expect(p.port.posted).toEqual([{ type: 'pong', id: 7 }]);
    expect(run(p).alive).toBe(true);
    send(p, { type: 'dispose' });
    expect(run(p).alive).toBe(false);
  });

  it('applies params now, or in the block that contains `at`', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('analog'));
    send(p, { type: 'params', params: { cutoff: 800 } });
    send(p, { type: 'params', params: { cutoff: 900 }, at: 2 });
    send(p, { type: 'params', params: { cutoff: 700 }, at: 1 });
    send(p, { type: 'mod', param: 'cutoff', kind: 'set', value: 1000, time: 0 });
    // the late changes are queued in order and run as their block arrives, without throwing
    for (const f of [0, SR, 2 * SR]) expect(run(p, [], f).alive).toBe(true);
    expect(p.port.posted).toEqual([]);
  });

  it('sample messages reach engines that play samples, now or later', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('sampler', {
      samples: { a: { sampleRate: SR, channels: [new Float32Array(100).fill(0.5)] } },
    }));
    send(p, { type: 'sample', slot: 'b', sample: null });
    send(p, { type: 'sample', slot: 'c', sample: { sampleRate: SR, channels: [new Float32Array(10)] }, at: 1 });
    expect(run(p, [], 0).alive).toBe(true);
    expect(run(p, [], SR).alive).toBe(true);
    // an engine without samples ignores them
    const q = make(INSTRUMENT_PROCESSOR, opts('kick'));
    send(q, { type: 'sample', slot: 'a', sample: null });
    expect(run(q).alive).toBe(true);
  });

  it('an unknown type is silent', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('does-not-exist'));
    send(p, { type: 'note', pitch: 60, velocity: 1, on: 0, off: 1 });
    send(p, { type: 'press', pitch: 60, velocity: 1 });
    send(p, { type: 'release', pitch: 60 });
    send(p, { type: 'stop' });
    const out = run(p);
    expect(peak(out.left)).toBe(0);
    expect(out.alive).toBe(true);
  });

  it('posts playheads for engines that expose them, then one empty report when they stop', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('sampler', {
      samples: { [SAMPLE_SLOT]: { sampleRate: SR, channels: [new Float32Array(SR).fill(0.1)] } },
    }));
    send(p, { type: 'note', pitch: 60, velocity: 1, on: 0, off: 0.05 });
    for (let f = 0; f < SR / 2; f += BLOCK) run(p, [], f);
    const heads = p.port.posted.filter(m => m.type === 'playheads');
    expect(heads.length).toBeGreaterThanOrEqual(2);
    expect(heads[0].positions.length).toBeGreaterThan(0);
    expect(heads.at(-1).positions).toHaveLength(0);
  });

  it('a broken engine is zeroed, restarted and reported once, then rate-limited', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('kick')) as any;
    const original = INSTRUMENT_CORES.kick;
    const boom = { setParams() {}, noteOn() {}, noteOff() {}, silence() {}, render() { throw new Error('exploded'); } };
    p.arp = { inner: boom, noteOn() {}, noteOff() {}, setTempo() {}, setParams() {}, setTransport() {}, silence() {}, render() { throw new Error('exploded'); } };
    const out = run(p, [], 0);
    expect(out.alive).toBe(true);
    expect(peak(out.left)).toBe(0);
    const faults = p.port.posted.filter((m: any) => m.type === 'fault');
    expect(faults).toHaveLength(1);
    expect(faults[0].error).toContain('exploded');
    expect(INSTRUMENT_CORES.kick).toBe(original);
    // the restarted engine works
    send(p, { type: 'note', pitch: 36, velocity: 1, on: 0, off: 1 });
    let max = 0;
    for (let f = 0; f < 2400; f += BLOCK) max = Math.max(max, peak(run(p, [], 1000 + f).left));
    expect(max).toBeGreaterThan(0);
  });

  it('a non-finite output is reported as a fault with a null error', () => {
    const p = make(INSTRUMENT_PROCESSOR, opts('kick')) as any;
    const nan = {
      setParams() {}, setTempo() {}, setTransport() {}, silence() {}, noteOn() {}, noteOff() {},
      inner: { setParams() {}, noteOn() {}, noteOff() {}, silence() {}, render() {} },
      render(l: Float32Array) { l[0] = Number.NaN; },
    };
    p.arp = nan;
    // the queue calls arp.render only with active notes: schedule one
    send(p, { type: 'note', pitch: 36, velocity: 1, on: 0, off: 1 });
    const out = run(p, [], 0);
    expect(peak(out.left)).toBe(0);
    expect(p.port.posted.find((m: any) => m.type === 'fault')).toEqual({ type: 'fault', error: null });
  });
});

describe('effect processor', () => {
  const opts = (type: string, extra: Record<string, unknown> = {}) =>
    ({ type, params: {}, enabled: true, bpm: 120, keyed: false, transport: null, ...extra });
  const tone = () => Float32Array.from({ length: BLOCK }, (_, i) => 0.5 * Math.sin(i / 5));

  it('an unknown type passes the sound through unchanged', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope'));
    const input = tone();
    const out = run(p, [[input, input]]);
    expect(Array.from(out.left)).toEqual(Array.from(input));
    expect(Array.from(out.right)).toEqual(Array.from(input));
  });

  it('a mono input feeds both channels; with nothing connected it renders silence', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope'));
    const input = tone();
    const out = run(p, [[input]]);
    expect(Array.from(out.right)).toEqual(Array.from(input));
    expect(peak(run(p, []).left)).toBe(0);
    expect(peak(run(p, [[]]).left)).toBe(0);
  });

  it('a non-finite input is cleaned before it comes in', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope')) as any;
    const input = tone();
    input[3] = Number.NaN;
    const out = run(p, [[input, input]]);
    expect(out.left.every(Number.isFinite)).toBe(true);
    expect(p.port.posted).toEqual([]);
  });

  it('the enabled message bypasses a real effect: disabled passes the dry sound', () => {
    const p = make(EFFECT_PROCESSOR, opts('drive', { params: { drive: 1 } }));
    const input = tone();
    send(p, { type: 'enabled', enabled: false });
    let out = run(p, [[input, input]]);
    for (let f = BLOCK; f < SR / 4; f += BLOCK) out = run(p, [[input, input]], f);
    expect(Array.from(out.left)).toEqual(Array.from(input));
  });

  it('forwards params, tempo, keyed, transport and ping messages', () => {
    const p = make(EFFECT_PROCESSOR, opts('compressor', { keyed: true, transport: { time: 0, beat: 0, bpm: 120, beatsPerBar: 4 } }));
    send(p, { type: 'params', params: { threshold: -20 } });
    send(p, { type: 'tempo', bpm: 90 });
    send(p, { type: 'transport', anchor: { time: 0, beat: 0, bpm: 90, beatsPerBar: 4 } });
    send(p, { type: 'ping', id: 3 });
    expect(p.port.posted).toEqual([{ type: 'pong', id: 3 }]);
    const input = tone(), key = tone();
    expect(run(p, [[input, input], [key, key]]).alive).toBe(true);
    send(p, { type: 'keyed', keyed: false });
    expect(run(p, [[input]]).alive).toBe(true);
    send(p, { type: 'keyed', keyed: true });
    expect(run(p, [[input], []]).alive).toBe(true);
    expect(p.port.posted).toHaveLength(1);
  });

  it('modulations go to the on/off curves first, otherwise to the parameter', () => {
    const p = make(EFFECT_PROCESSOR, opts('drive'));
    send(p, { type: 'mod', param: 'drive', kind: 'set', value: 0.5, time: 0 });
    send(p, { type: 'mod', param: 'on', kind: 'set', value: 0, time: 0 });
    send(p, { type: 'mod', param: 'drive', kind: 'ramp', value: 0.9, time: 1 });
    send(p, { type: 'mod', param: 'drive', kind: 'hold', value: 0, time: 2 });
    expect(run(p, [[tone(), tone()]], SR).alive).toBe(true);
  });

  it('a dynamics effect reports its state about 30 times a second while watched', () => {
    const p = make(EFFECT_PROCESSOR, opts('compressor', { params: { threshold: -30, ratio: 8 } }));
    const input = tone();
    for (let f = 0; f < 3 * BLOCK; f += BLOCK) run(p, [[input, input]], f);
    expect(p.port.posted).toEqual([]);
    send(p, { type: 'watch', on: true });
    const blocks = Math.round(SR / 10 / BLOCK);
    for (let i = 0; i < blocks; i++) run(p, [[input, input]], i * BLOCK);
    const reports = p.port.posted.filter(m => m.type === 'dynamics');
    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports.length).toBeLessThanOrEqual(5);
    expect(Number.isFinite(reports[0].input)).toBe(true);
    // an effect that doesn't meter dynamics never reports
    const q = make(EFFECT_PROCESSOR, opts('nope'));
    send(q, { type: 'watch', on: true });
    for (let i = 0; i < blocks; i++) run(q, [[input, input]], i * BLOCK);
    expect(q.port.posted).toEqual([]);
  });

  it('grows its scratch buffers for larger blocks', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope'));
    const big = Float32Array.from({ length: 256 }, (_, i) => i / 256);
    setFrame(0);
    const outputs = [[new Float32Array(256), new Float32Array(256)]];
    p.process([[big, big]], outputs);
    expect(Array.from(outputs[0][0])).toEqual(Array.from(big));
  });

  it('a throwing engine is zeroed, restarted and reported with its error', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope')) as any;
    p.runner = { setEnabled() {}, process() { throw new TypeError('bad dsp'); } };
    const out = run(p, [[tone(), tone()]], 0);
    expect(peak(out.left)).toBe(0);
    expect(p.port.posted).toEqual([{ type: 'fault', error: 'TypeError: bad dsp' }]);
    // the restarted engine passes the sound again
    const input = tone();
    expect(Array.from(run(p, [[input, input]], SR * 10).left)).toEqual(Array.from(input));
  });

  it('a non-Error throw is reported as text', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope')) as any;
    p.runner = { setEnabled() {}, process() { throw { code: 5 }; } };
    run(p, [[tone(), tone()]], 0);
    expect(p.port.posted).toEqual([{ type: 'fault', error: '{"code":5}' }]);
    const q = make(EFFECT_PROCESSOR, opts('nope')) as any;
    q.runner = { setEnabled() {}, process() { throw 'plain'; } };
    run(q, [[tone(), tone()]], 0);
    expect(q.port.posted).toEqual([{ type: 'fault', error: 'plain' }]);
  });

  it('dispose stops the processor', () => {
    const p = make(EFFECT_PROCESSOR, opts('nope'));
    send(p, { type: 'dispose' });
    expect(run(p, [[tone(), tone()]]).alive).toBe(false);
  });
});

describe('meter processor', () => {
  it('passes the sound unchanged and posts levels by message without shared memory', () => {
    const p = make(METER_PROCESSOR, { buffer: null, offset: 0 });
    const input = Float32Array.from({ length: BLOCK }, (_, i) => (i % 2 ? 0.5 : -0.5));
    const out = run(p, [[input, input]]);
    expect(Array.from(out.left)).toEqual(Array.from(input));
    expect(Array.from(out.right)).toEqual(Array.from(input));
    expect(p.port.posted).toHaveLength(1);
    const { type, values } = p.port.posted[0];
    expect(type).toBe('levels');
    expect(values[0]).toBeCloseTo(0.5, 5);
    // not again until ~1/30 s has passed
    run(p, [[input, input]]);
    expect(p.port.posted).toHaveLength(1);
    for (let i = 0; i < 12; i++) run(p, [[input, input]]);
    expect(p.port.posted.length).toBeGreaterThan(1);
  });

  it('writes into the shared buffer at its offset and posts nothing', () => {
    const buffer = new SharedArrayBuffer(8 * 4 * 4);
    const p = make(METER_PROCESSOR, { buffer, offset: 4 });
    const input = block(0.25);
    run(p, [[input, input]]);
    const all = new Float32Array(buffer);
    expect(all[4]).toBeCloseTo(0.25, 5);
    expect(all[5]).toBeCloseTo(0.25, 5);
    expect(all[0]).toBe(0);
    expect(p.port.posted).toEqual([]);
  });

  it('treats a missing or mono input as silence / both channels, cleans NaN, and dies on dispose', () => {
    const p = make(METER_PROCESSOR, { buffer: null, offset: 0 });
    const silent = run(p, []);
    expect(peak(silent.left)).toBe(0);
    const bad = block(0.5);
    bad[1] = Infinity;
    const out = run(p, [[bad]]);
    expect(out.left.every(Number.isFinite)).toBe(true);
    expect(Array.from(out.right)).toEqual(Array.from(out.left));
    send(p, { type: 'dispose' });
    expect(run(p, []).alive).toBe(false);
  });

  it('grows its buffers for larger blocks', () => {
    const p = make(METER_PROCESSOR, { buffer: null, offset: 0 });
    const big = new Float32Array(256).fill(0.3);
    setFrame(0);
    const outputs = [[new Float32Array(256), new Float32Array(256)]];
    expect(p.process([[big, big]], outputs)).toBe(true);
    expect(outputs[0][0][255]).toBeCloseTo(0.3, 5);
  });
});

describe('cores registry', () => {
  it('has an engine for every registered instrument and effect, and every engine has a description', () => {
    expect(Object.keys(INSTRUMENT_CORES).sort()).toEqual(INSTRUMENT_TYPES.map(t => t.type).sort());
    // the modulators and the arpeggiator are effect-chain entries without a DSP engine
    const described = new Set(EFFECT_TYPES.map(t => t.type));
    for (const id of Object.keys(EFFECT_CORES)) expect(described.has(id), id).toBe(true);
  });

  it('every instrument factory builds an engine that renders finite audio', () => {
    for (const [type, factory] of Object.entries(INSTRUMENT_CORES)) {
      const core = factory(SR);
      core.noteOn(1, 60, 1);
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      core.render(l, r, 0, BLOCK);
      expect(l.every(Number.isFinite) && r.every(Number.isFinite), type).toBe(true);
    }
  });

  it('every effect factory builds an engine that processes finite audio', () => {
    for (const [type, factory] of Object.entries(EFFECT_CORES)) {
      const core = factory(SR);
      core.setTempo(120);
      const input = Float32Array.from({ length: BLOCK }, (_, i) => 0.4 * Math.sin(i / 7));
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      core.process(input, input, l, r, BLOCK);
      expect(l.every(Number.isFinite) && r.every(Number.isFinite), type).toBe(true);
    }
  });
});
