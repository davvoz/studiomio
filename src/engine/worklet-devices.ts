/* Instruments and effects in the browser: each is an AudioWorkletNode of one of the two processors
 * (devices/worklet), with its type's engine. The main thread sends notes and parameters
 * by message, with the time in context seconds. */
import { resolveActiveParams, resolveParams } from '../devices/device-type';
import { effectType, instrumentType } from '../devices/registry';
import workletUrl from '../devices/worklet/devices.worklet.ts?worker&url';
import { METER_VALUES } from '../devices/worklet/meter-core';
import {
  EFFECT_PROCESSOR, INSTRUMENT_PROCESSOR, METER_PROCESSOR, type EffectMessage, type EffectProcessorOptions, type EffectReply,
  type InstrumentMessage, type InstrumentProcessorOptions, type InstrumentReply, type MeterMessage,
  type MeterProcessorOptions, type MeterReply, type ModMessage,
} from '../devices/worklet/protocol';
import type { TransportAnchor } from '../devices/worklet/transport-clock';
import type { SampleId } from '../core/id';
import type { SampleData } from '../devices/dsp/core';
import type { DeviceSamples, EffectSettings, InstrumentSettings } from '../model/device';
import type { AudioGraph } from './audio-graph';
import type { DynamicsListener, Effect, EffectHost, EffectMonitor } from './effect-chain';
import type { Meter, MeterHost, MeterReading } from './meters';
import type { DeviceModulation } from './modulation';
import type { Instrument, InstrumentHost } from './players/instrument';

const contextOf = (graph: AudioGraph) => graph as unknown as BaseAudioContext;

/** A device's modulations in the AudioWorklet: each event is a message to the processor,
 *  which applies it at the right moment (see devices/worklet/mod-timeline.ts). */
const workletModulation = (send: (m: ModMessage) => void): DeviceModulation => ({
  sink: (param, channel) => {
    const extra = channel ? { channel } : {};
    return {
      set: (value, time) => send({ type: 'mod', param, kind: 'set', value, time, ...extra }),
      ramp: (value, time) => send({ type: 'mod', param, kind: 'ramp', value, time, ...extra }),
      hold: time => send({ type: 'mod', param, kind: 'hold', value: 0, time, ...extra }),
    };
  },
});

/** Where the samples of the project's samples are (the SampleLibrary). */
export type SampleSource = (id: SampleId) => SampleData | undefined;

/** The samples of a device's samples, by slot (those not loaded yet are missing). */
const samplesOf = (samples: DeviceSamples | undefined, source: SampleSource): Record<string, SampleData> =>
  Object.fromEntries(Object.entries(samples ?? {}).flatMap(([slot, id]) => {
    const data = source(id);
    return data ? [[slot, { sampleRate: data.sampleRate, channels: [...data.channels] }]] : [];
  }));

/** The complete parameters to send to the engine (unknown types play silent), without those
 *  of the sections that aren't there (the instruments of the pads playing something else). */
const fullParams = (s: InstrumentSettings) => {
  const t = instrumentType(s.type);
  return t ? resolveActiveParams(t, s.params) : {};
};

class WorkletInstrument implements Instrument {
  readonly type: string;
  readonly output: GainNode;
  readonly modulation = workletModulation(m => this.send(m));
  private node: AudioWorkletNode | null = null;
  private settings: InstrumentSettings;
  /** The arpeggiator's parameters: they travel with the instrument's. */
  private arp: Readonly<Record<string, number>> = {};
  private bpm: number;
  private anchor: TransportAnchor | null;
  private pings = 0;
  private readonly waiting = new Map<number, () => void>();
  private heads: readonly number[] = [];

  constructor(
    private readonly ctx: BaseAudioContext, settings: InstrumentSettings, bpm: number, transport: TransportAnchor | null,
    ready: Promise<void> | null, private readonly source: SampleSource, private readonly onDispose: () => void,
    private readonly onFault: (error: string | null) => void,
  ) {
    this.type = settings.type;
    this.settings = settings;
    this.bpm = bpm;
    this.anchor = transport;
    this.output = ctx.createGain();
    if (ready) ready.then(() => this.build(), e => console.error('instrument not available', e));
    else this.build();
  }

  play(pitch: number, velocity: number, when: number, duration: number): void {
    // before the module is loaded the notes are lost (it happens only at startup)
    this.send({ type: 'note', pitch, velocity, on: when, off: when + duration });
  }

  press(pitch: number, velocity: number): void {
    this.send({ type: 'press', pitch, velocity });
  }

  release(pitch: number): void {
    this.send({ type: 'release', pitch });
  }

  update(settings: InstrumentSettings, at?: number): void {
    const prev = this.settings;
    this.settings = settings;
    if (settings.params !== prev.params) this.send({ type: 'params', params: this.allParams(), at });
    if (settings.samples !== prev.samples) this.sendSamples(prev.samples, settings.samples, at);
  }

  setArp(params: Readonly<Record<string, number>>): void {
    this.arp = params;
    this.send({ type: 'params', params: this.allParams() });
  }

  private allParams(): Readonly<Record<string, number>> {
    return { ...fullParams(this.settings), ...this.arp };
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.send({ type: 'tempo', bpm });
  }

  setTransport(anchor: TransportAnchor | null): void {
    this.anchor = anchor;
    this.send({ type: 'transport', anchor });
  }

  stopAll(): void {
    this.send({ type: 'stop' });
  }

  playheads(): readonly number[] {
    return this.heads;
  }

  cut(at: number): void {
    this.send({ type: 'cut', at });
  }

  retake(at: number): void {
    this.send({ type: 'retake', at });
  }

  dispose(): void {
    this.send({ type: 'dispose' });
    this.node?.disconnect();
    this.output.disconnect();
    for (const resolve of this.waiting.values()) resolve();
    this.waiting.clear();
    this.onDispose();
  }

  /** Resolves when the processor has received the messages sent so far. */
  settle(): Promise<void> {
    if (!this.node) return Promise.resolve();
    const id = ++this.pings;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.send({ type: 'ping', id });
    });
  }

  /** Only the changed slots: a sample already in the engine isn't sent again. */
  private sendSamples(prev: DeviceSamples | undefined, next: DeviceSamples | undefined, at?: number): void {
    for (const slot of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
      const id = next?.[slot];
      if (id === prev?.[slot]) continue;
      const sample = id ? samplesOf({ [slot]: id }, this.source)[slot] ?? null : null;
      this.send({ type: 'sample', slot, sample, at });
    }
  }

  private build(): void {
    const processorOptions: InstrumentProcessorOptions = {
      type: this.settings.type, params: this.allParams(), samples: samplesOf(this.settings.samples, this.source),
      bpm: this.bpm, transport: this.anchor,
    };
    this.node = new AudioWorkletNode(this.ctx, INSTRUMENT_PROCESSOR, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions,
    });
    this.node.port.onmessage = (e: MessageEvent<InstrumentReply>) => {
      const m = e.data;
      if (m.type === 'playheads') {
        this.heads = Array.from(m.positions);
        return;
      }
      if (m.type === 'fault') return this.onFault(m.error);
      this.waiting.get(m.id)?.();
      this.waiting.delete(m.id);
    };
    this.node.connect(this.output);
  }

  private send(m: InstrumentMessage): void {
    this.node?.port.postMessage(m);
  }
}

/** Who listens to the engines' failures: the device type and the error (null: a non-finite
 *  sample). */
export type FaultListener = (type: string, error: string | null) => void;

/** The devices' AudioWorklet module, loaded once per audio context. It also receives
 *  the engines' failures, which the processor has already zeroed and restarted (see worklet/guard.ts). */
export class DeviceWorklet {
  private readonly loading = new WeakMap<BaseAudioContext, Promise<void>>();
  private readonly loaded = new WeakSet<BaseAudioContext>();
  private readonly faultListeners = new Set<FaultListener>();

  onFault(fn: FaultListener): () => void {
    this.faultListeners.add(fn);
    return () => this.faultListeners.delete(fn);
  }

  fault(type: string, error: string | null): void {
    console.error(`engine "${type}" broke, restarted`, error ?? 'non-finite sample (NaN)');
    for (const fn of this.faultListeners) fn(type, error);
  }

  prepare(graph: AudioGraph): Promise<void> {
    const ctx = contextOf(graph);
    let p = this.loading.get(ctx);
    if (!p) {
      p = ctx.audioWorklet.addModule(workletUrl).then(() => { this.loaded.add(ctx); });
      this.loading.set(ctx, p);
    }
    return p;
  }

  /** null if the module is already ready (it's created right away), otherwise the wait. */
  pending(graph: AudioGraph): Promise<void> | null {
    return this.loaded.has(contextOf(graph)) ? null : this.prepare(graph);
  }
}

/** A context's live instruments and where its transport is. */
interface InstrumentContext {
  readonly instruments: Set<WorkletInstrument>;
  transport: TransportAnchor | null;
}

/** AudioWorklet instruments, for any context (live or offline). */
export class WorkletInstruments implements InstrumentHost {
  private readonly contexts = new WeakMap<BaseAudioContext, InstrumentContext>();

  constructor(private readonly worklet: DeviceWorklet, private readonly samples: SampleSource = () => undefined) {}

  prepare(graph: AudioGraph): Promise<void> {
    return this.worklet.prepare(graph);
  }

  create(graph: AudioGraph, settings: InstrumentSettings, bpm: number): Instrument {
    const c = this.context(graph);
    const instrument: WorkletInstrument = new WorkletInstrument(
      contextOf(graph), settings, bpm, c.transport, this.worklet.pending(graph), this.samples, () => c.instruments.delete(instrument),
      error => this.worklet.fault(settings.type, error),
    );
    c.instruments.add(instrument);
    return instrument;
  }

  transport(graph: AudioGraph, anchor: TransportAnchor | null): void {
    const c = this.context(graph);
    c.transport = anchor;
    for (const i of c.instruments) i.setTransport(anchor);
  }

  async settle(graph: AudioGraph): Promise<void> {
    await Promise.all([...this.context(graph).instruments].map(i => i.settle()));
  }

  private context(graph: AudioGraph): InstrumentContext {
    const ctx = contextOf(graph);
    let c = this.contexts.get(ctx);
    if (!c) this.contexts.set(ctx, (c = { instruments: new Set(), transport: null }));
    return c;
  }
}

// ------------------------------------------------------------------ effects

const fullEffectParams = (s: EffectSettings) => {
  const t = effectType(s.type);
  return t ? resolveParams(t, s.params) : {};
};

/** An effect: an AudioWorkletNode of the effects processor between two fixed nodes, so it
 *  can be connected right away (it passes the direct sound until the module is ready). In the middle there's
 *  `post`, the point to listen to the processed sound from:
 *  input → processor → post → output. The types with sidechain also have `sidechain`, a fixed
 *  node going into the processor's second input. */
class WorkletEffect implements Effect {
  readonly type: string;
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly post: GainNode;
  readonly sidechain: GainNode | undefined;
  readonly monitor: EffectMonitor;
  readonly modulation = workletModulation(m => this.send(m));
  private node: AudioWorkletNode | null = null;
  private settings: EffectSettings;
  private bpm: number;
  private anchor: TransportAnchor | null;
  private disposed = false;
  private pings = 0;
  private readonly waiting = new Map<number, () => void>();
  private watcher: DynamicsListener | null = null;

  constructor(
    private readonly ctx: BaseAudioContext, settings: EffectSettings, bpm: number, transport: TransportAnchor | null,
    ready: Promise<void> | null, private readonly onDispose: () => void, private readonly onFault: (error: string | null) => void,
  ) {
    this.type = settings.type;
    this.settings = settings;
    this.bpm = bpm;
    this.anchor = transport;
    this.input = ctx.createGain();
    this.post = ctx.createGain();
    this.output = ctx.createGain();
    this.sidechain = effectType(settings.type)?.sidechain ? ctx.createGain() : undefined;
    this.post.connect(this.output);
    this.monitor = {
      pre: this.input, post: this.post,
      watch: listener => {
        this.watcher = listener;
        this.send({ type: 'watch', on: !!listener });
      },
    };
    // direct sound until the processor is there
    this.input.connect(this.post);
    if (!ready) this.build();
    else ready.then(() => this.build(), e => console.error('effect not available', e));
  }

  update(settings: EffectSettings): void {
    const prev = this.settings;
    this.settings = settings;
    if (settings.params !== prev.params) this.send({ type: 'params', params: fullEffectParams(settings) });
    if (settings.enabled !== prev.enabled) this.send({ type: 'enabled', enabled: settings.enabled });
    if (!settings.sidechain !== !prev.sidechain) this.send({ type: 'keyed', keyed: !!settings.sidechain });
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.send({ type: 'tempo', bpm });
  }

  setTransport(anchor: TransportAnchor | null): void {
    this.anchor = anchor;
    this.send({ type: 'transport', anchor });
  }

  /** Resolves when the processor has received the messages sent so far. */
  settle(): Promise<void> {
    if (!this.node) return Promise.resolve();
    const id = ++this.pings;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.send({ type: 'ping', id });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.send({ type: 'dispose' });
    this.node?.disconnect();
    for (const n of [this.input, this.post, this.output]) n.disconnect();
    this.sidechain?.disconnect();
    for (const resolve of this.waiting.values()) resolve();
    this.waiting.clear();
    this.onDispose();
  }

  private build(): void {
    if (this.disposed) return;
    const s = this.settings;
    const processorOptions: EffectProcessorOptions = {
      type: s.type, params: fullEffectParams(s), enabled: s.enabled, bpm: this.bpm, keyed: !!s.sidechain, transport: this.anchor,
    };
    this.node = new AudioWorkletNode(this.ctx, EFFECT_PROCESSOR, {
      numberOfInputs: this.sidechain ? 2 : 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions,
    });
    this.node.port.onmessage = (e: MessageEvent<EffectReply>) => {
      const m = e.data;
      if (m.type === 'fault') return this.onFault(m.error);
      if (m.type === 'dynamics') return this.watcher?.(m.input, m.reduction);
      this.waiting.get(m.id)?.();
      this.waiting.delete(m.id);
    };
    if (this.watcher) this.send({ type: 'watch', on: true });
    // only the direct connection: those towards the spectrum stay
    this.input.disconnect(this.post);
    this.input.connect(this.node);
    this.sidechain?.connect(this.node, 0, 1);
    this.node.connect(this.post);
  }

  private send(m: EffectMessage): void {
    this.node?.port.postMessage(m);
  }
}

/** A context's live effects and where its transport is. */
interface EffectContext {
  readonly effects: Set<WorkletEffect>;
  transport: TransportAnchor | null;
}

/** AudioWorklet effects, for any context. */
export class WorkletEffects implements EffectHost {
  private readonly contexts = new WeakMap<BaseAudioContext, EffectContext>();

  constructor(private readonly worklet: DeviceWorklet) {}

  create(graph: AudioGraph, settings: EffectSettings, bpm: number): Effect {
    const c = this.context(graph);
    const effect: WorkletEffect = new WorkletEffect(
      contextOf(graph), settings, bpm, c.transport, this.worklet.pending(graph), () => c.effects.delete(effect),
      error => this.worklet.fault(settings.type, error),
    );
    c.effects.add(effect);
    return effect;
  }

  transport(graph: AudioGraph, anchor: TransportAnchor | null): void {
    const c = this.context(graph);
    c.transport = anchor;
    for (const e of c.effects) e.setTransport(anchor);
  }

  async settle(graph: AudioGraph): Promise<void> {
    await Promise.all([...this.context(graph).effects].map(e => e.settle()));
  }

  private context(graph: AudioGraph): EffectContext {
    const ctx = contextOf(graph);
    let c = this.contexts.get(ctx);
    if (!c) this.contexts.set(ctx, (c = { effects: new Set(), transport: null }));
    return c;
  }
}

// ------------------------------------------------------------------ meters

/** How many meters fit in shared memory (beyond that, they go by message). */
const METER_CAPACITY = 512;

/** The values of all of a context's meters: in memory shared with the AudioWorklet if
 *  the browser allows it (isolated page, COOP/COEP), so reading them costs nothing. */
class MeterBank {
  readonly buffer = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated
    ? new SharedArrayBuffer(METER_CAPACITY * METER_VALUES * 4) : null;
  private readonly values = this.buffer ? new Float32Array(this.buffer) : null;
  private readonly free = Array.from({ length: this.buffer ? METER_CAPACITY : 0 }, (_, i) => METER_CAPACITY - 1 - i);

  /** A slot in shared memory, or null (then the values arrive by message). */
  take(): { offset: number; values: Float32Array } | null {
    const slot = this.free.pop();
    if (slot === undefined || !this.values) return null;
    const offset = slot * METER_VALUES;
    const values = this.values.subarray(offset, offset + METER_VALUES);
    values.fill(0);
    return { offset, values };
  }

  give(offset: number): void {
    this.free.push(offset / METER_VALUES);
  }
}

/** A meter: the meters' processor between two fixed nodes (like the effects). */
class WorkletMeter implements Meter {
  readonly input: GainNode;
  readonly output: GainNode;
  private node: AudioWorkletNode | null = null;
  private readonly slot: { offset: number; values: Float32Array } | null;
  private readonly values: Float32Array;
  private disposed = false;

  constructor(private readonly ctx: BaseAudioContext, private readonly bank: MeterBank, ready: Promise<void> | null) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.slot = bank.take();
    this.values = this.slot?.values ?? new Float32Array(METER_VALUES);
    if (!ready) this.build();
    else {
      this.input.connect(this.output);
      ready.then(() => this.build(), e => console.error('meter not available', e));
    }
  }

  read(): MeterReading {
    const v = this.values;
    const reading: MeterReading = { peak: [v[0], v[1]], rms: [Math.sqrt(v[2]), Math.sqrt(v[3])] };
    v[0] = v[1] = 0;
    return reading;
  }

  dispose(): void {
    this.disposed = true;
    this.node?.port.postMessage({ type: 'dispose' } satisfies MeterMessage);
    this.node?.disconnect();
    this.input.disconnect();
    this.output.disconnect();
    if (this.slot) this.bank.give(this.slot.offset);
  }

  private build(): void {
    if (this.disposed) return;
    const processorOptions: MeterProcessorOptions = { buffer: this.slot ? this.bank.buffer : null, offset: this.slot?.offset ?? 0 };
    this.node = new AudioWorkletNode(this.ctx, METER_PROCESSOR, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions,
    });
    if (!this.slot) {
      this.node.port.onmessage = (e: MessageEvent<MeterReply>) => {
        const [pl, pr, ml, mr] = e.data.values, v = this.values;
        v[0] = Math.max(v[0], pl);
        v[1] = Math.max(v[1], pr);
        v[2] = ml;
        v[3] = mr;
      };
    }
    this.input.disconnect();
    this.input.connect(this.node);
    this.node.connect(this.output);
  }
}

/** AudioWorklet meters for the live context. */
export class WorkletMeters implements MeterHost {
  private readonly banks = new WeakMap<BaseAudioContext, MeterBank>();

  constructor(private readonly worklet: DeviceWorklet) {}

  create(graph: AudioGraph): Meter {
    const ctx = contextOf(graph);
    let bank = this.banks.get(ctx);
    if (!bank) this.banks.set(ctx, (bank = new MeterBank()));
    return new WorkletMeter(ctx, bank, this.worklet.pending(graph));
  }
}
