/* Strumenti ed effetti nel browser: ognuno è un AudioWorkletNode di uno dei due processori
 * (devices/worklet), con il motore del suo tipo. Il thread principale manda note e parametri
 * per messaggio, con il tempo in secondi del contesto. */
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
import type { Effect, EffectHost, EffectMonitor } from './effect-chain';
import type { Meter, MeterHost, MeterReading } from './meters';
import type { DeviceModulation } from './modulation';
import type { Instrument, InstrumentHost } from './players/instrument';

const contextOf = (graph: AudioGraph) => graph as unknown as BaseAudioContext;

/** Le modulazioni di un dispositivo nell'AudioWorklet: ogni evento è un messaggio al processore,
 *  che lo applica al momento giusto (vedi devices/worklet/mod-timeline.ts). */
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

/** Dove si trovano i campioni dei sample del progetto (la SampleLibrary). */
export type SampleSource = (id: SampleId) => SampleData | undefined;

/** I campioni dei sample di un dispositivo, per posto (quelli non ancora caricati mancano). */
const samplesOf = (samples: DeviceSamples | undefined, source: SampleSource): Record<string, SampleData> =>
  Object.fromEntries(Object.entries(samples ?? {}).flatMap(([slot, id]) => {
    const data = source(id);
    return data ? [[slot, { sampleRate: data.sampleRate, channels: [...data.channels] }]] : [];
  }));

/** I parametri completi da mandare al motore (i tipi sconosciuti suonano muti), senza quelli
 *  delle sezioni che non ci sono (gli strumenti dei pad che suonano altro). */
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
  private bpm: number;
  private anchor: TransportAnchor | null;
  private pings = 0;
  private readonly waiting = new Map<number, () => void>();
  private heads: readonly number[] = [];

  constructor(
    private readonly ctx: BaseAudioContext, settings: InstrumentSettings, bpm: number, transport: TransportAnchor | null,
    ready: Promise<void> | null, private readonly source: SampleSource, private readonly onDispose: () => void,
  ) {
    this.type = settings.type;
    this.settings = settings;
    this.bpm = bpm;
    this.anchor = transport;
    this.output = ctx.createGain();
    if (ready) ready.then(() => this.build(), e => console.error('strumento non disponibile', e));
    else this.build();
  }

  play(pitch: number, velocity: number, when: number, duration: number): void {
    // prima che il modulo sia caricato le note si perdono (succede solo all'avvio)
    this.send({ type: 'note', pitch, velocity, on: when, off: when + duration });
  }

  update(settings: InstrumentSettings): void {
    const prev = this.settings;
    this.settings = settings;
    if (settings.params !== prev.params) this.send({ type: 'params', params: fullParams(settings) });
    if (settings.samples !== prev.samples) this.sendSamples(prev.samples, settings.samples);
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

  /** Si risolve quando il processore ha ricevuto i messaggi mandati finora. */
  settle(): Promise<void> {
    if (!this.node) return Promise.resolve();
    const id = ++this.pings;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.send({ type: 'ping', id });
    });
  }

  /** Solo i posti cambiati: un sample già nel motore non si rimanda. */
  private sendSamples(prev: DeviceSamples | undefined, next: DeviceSamples | undefined): void {
    for (const slot of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
      const id = next?.[slot];
      if (id === prev?.[slot]) continue;
      const sample = id ? samplesOf({ [slot]: id }, this.source)[slot] ?? null : null;
      this.send({ type: 'sample', slot, sample });
    }
  }

  private build(): void {
    const processorOptions: InstrumentProcessorOptions = {
      type: this.settings.type, params: fullParams(this.settings), samples: samplesOf(this.settings.samples, this.source),
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
      this.waiting.get(m.id)?.();
      this.waiting.delete(m.id);
    };
    this.node.connect(this.output);
  }

  private send(m: InstrumentMessage): void {
    this.node?.port.postMessage(m);
  }
}

/** Il modulo AudioWorklet dei dispositivi, caricato una volta per contesto audio. */
export class DeviceWorklet {
  private readonly loading = new WeakMap<BaseAudioContext, Promise<void>>();
  private readonly loaded = new WeakSet<BaseAudioContext>();

  prepare(graph: AudioGraph): Promise<void> {
    const ctx = contextOf(graph);
    let p = this.loading.get(ctx);
    if (!p) {
      p = ctx.audioWorklet.addModule(workletUrl).then(() => { this.loaded.add(ctx); });
      this.loading.set(ctx, p);
    }
    return p;
  }

  /** null se il modulo è già pronto (si crea subito), altrimenti l'attesa. */
  pending(graph: AudioGraph): Promise<void> | null {
    return this.loaded.has(contextOf(graph)) ? null : this.prepare(graph);
  }
}

/** Gli strumenti vivi di un contesto e dove si trova il suo trasporto. */
interface InstrumentContext {
  readonly instruments: Set<WorkletInstrument>;
  transport: TransportAnchor | null;
}

/** Strumenti AudioWorklet, per qualunque contesto (dal vivo o offline). */
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

// ------------------------------------------------------------------ effetti

const fullEffectParams = (s: EffectSettings) => {
  const t = effectType(s.type);
  return t ? resolveParams(t, s.params) : {};
};

/** Un effetto: un AudioWorkletNode del processore degli effetti tra due nodi fissi, così si
 *  può collegare subito (passa il suono diretto finché il modulo non è pronto). In mezzo c'è
 *  `post`, il punto da cui ascoltare il suono elaborato:
 *  input → processore → post → output. I tipi con il sidechain hanno anche `sidechain`, un nodo
 *  fisso che va nel secondo ingresso del processore. */
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

  constructor(
    private readonly ctx: BaseAudioContext, settings: EffectSettings, bpm: number, transport: TransportAnchor | null,
    ready: Promise<void> | null, private readonly onDispose: () => void,
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
    this.monitor = { pre: this.input, post: this.post };
    // suono diretto finché il processore non c'è
    this.input.connect(this.post);
    if (!ready) this.build();
    else ready.then(() => this.build(), e => console.error('effetto non disponibile', e));
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

  /** Si risolve quando il processore ha ricevuto i messaggi mandati finora. */
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
      this.waiting.get(e.data.id)?.();
      this.waiting.delete(e.data.id);
    };
    // solo il collegamento diretto: quelli verso lo spettro restano
    this.input.disconnect(this.post);
    this.input.connect(this.node);
    this.sidechain?.connect(this.node, 0, 1);
    this.node.connect(this.post);
  }

  private send(m: EffectMessage): void {
    this.node?.port.postMessage(m);
  }
}

/** Gli effetti vivi di un contesto e dove si trova il suo trasporto. */
interface EffectContext {
  readonly effects: Set<WorkletEffect>;
  transport: TransportAnchor | null;
}

/** Effetti AudioWorklet, per qualunque contesto. */
export class WorkletEffects implements EffectHost {
  private readonly contexts = new WeakMap<BaseAudioContext, EffectContext>();

  constructor(private readonly worklet: DeviceWorklet) {}

  create(graph: AudioGraph, settings: EffectSettings, bpm: number): Effect {
    const c = this.context(graph);
    const effect: WorkletEffect = new WorkletEffect(
      contextOf(graph), settings, bpm, c.transport, this.worklet.pending(graph), () => c.effects.delete(effect),
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

// ------------------------------------------------------------------ misuratori

/** Quanti misuratori stanno nella memoria condivisa (oltre, vanno per messaggio). */
const METER_CAPACITY = 512;

/** I valori di tutti i misuratori di un contesto: in memoria condivisa con l'AudioWorklet se
 *  il browser lo permette (pagina isolata, COOP/COEP), così leggerli non costa nulla. */
class MeterBank {
  readonly buffer = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated
    ? new SharedArrayBuffer(METER_CAPACITY * METER_VALUES * 4) : null;
  private readonly values = this.buffer ? new Float32Array(this.buffer) : null;
  private readonly free = Array.from({ length: this.buffer ? METER_CAPACITY : 0 }, (_, i) => METER_CAPACITY - 1 - i);

  /** Un posto nella memoria condivisa, o null (allora i valori arrivano per messaggio). */
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

/** Un misuratore: il processore dei misuratori tra due nodi fissi (come gli effetti). */
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
      ready.then(() => this.build(), e => console.error('misuratore non disponibile', e));
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

/** Misuratori AudioWorklet per il contesto dal vivo. */
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
