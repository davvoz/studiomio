/* Strumenti ed effetti nel browser: ognuno è un AudioWorkletNode di uno dei due processori
 * (devices/worklet), con il motore del suo tipo. Il thread principale manda note e parametri
 * per messaggio, con il tempo in secondi del contesto. */
import { resolveParams } from '../devices/device-type';
import { effectType, instrumentType } from '../devices/registry';
import workletUrl from '../devices/worklet/devices.worklet.ts?worker&url';
import {
  EFFECT_PROCESSOR, INSTRUMENT_PROCESSOR, type EffectMessage, type EffectProcessorOptions,
  type InstrumentMessage, type InstrumentProcessorOptions, type InstrumentReply,
} from '../devices/worklet/protocol';
import type { EffectSettings, InstrumentSettings } from '../model/device';
import type { AudioGraph } from './audio-graph';
import type { Effect, EffectHost } from './effect-chain';
import type { Instrument, InstrumentHost } from './players/instrument';

const contextOf = (graph: AudioGraph) => graph as unknown as BaseAudioContext;

/** I parametri completi da mandare al motore (i tipi sconosciuti suonano muti). */
const fullParams = (s: InstrumentSettings) => {
  const t = instrumentType(s.type);
  return t ? resolveParams(t, s.params) : {};
};

class WorkletInstrument implements Instrument {
  readonly type: string;
  readonly output: GainNode;
  private node: AudioWorkletNode | null = null;
  private settings: InstrumentSettings;
  private pings = 0;
  private readonly waiting = new Map<number, () => void>();

  constructor(
    private readonly ctx: BaseAudioContext, settings: InstrumentSettings, ready: Promise<void> | null,
    private readonly onDispose: () => void,
  ) {
    this.type = settings.type;
    this.settings = settings;
    this.output = ctx.createGain();
    if (ready) ready.then(() => this.build(), e => console.error('strumento non disponibile', e));
    else this.build();
  }

  play(pitch: number, velocity: number, when: number, duration: number): void {
    // prima che il modulo sia caricato le note si perdono (succede solo all'avvio)
    this.send({ type: 'note', pitch, velocity, on: when, off: when + duration });
  }

  update(settings: InstrumentSettings): void {
    this.settings = settings;
    this.send({ type: 'params', params: fullParams(settings) });
  }

  stopAll(): void {
    this.send({ type: 'stop' });
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

  private build(): void {
    const processorOptions: InstrumentProcessorOptions = { type: this.settings.type, params: fullParams(this.settings) };
    this.node = new AudioWorkletNode(this.ctx, INSTRUMENT_PROCESSOR, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions,
    });
    this.node.port.onmessage = (e: MessageEvent<InstrumentReply>) => {
      this.waiting.get(e.data.id)?.();
      this.waiting.delete(e.data.id);
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

/** Strumenti AudioWorklet, per qualunque contesto (dal vivo o offline). */
export class WorkletInstruments implements InstrumentHost {
  private readonly live = new WeakMap<BaseAudioContext, Set<WorkletInstrument>>();

  constructor(private readonly worklet: DeviceWorklet) {}

  prepare(graph: AudioGraph): Promise<void> {
    return this.worklet.prepare(graph);
  }

  create(graph: AudioGraph, settings: InstrumentSettings): Instrument {
    const ctx = contextOf(graph);
    let set = this.live.get(ctx);
    if (!set) this.live.set(ctx, (set = new Set()));
    const all = set;
    const instrument: WorkletInstrument = new WorkletInstrument(ctx, settings, this.worklet.pending(graph), () => all.delete(instrument));
    all.add(instrument);
    return instrument;
  }

  async settle(graph: AudioGraph): Promise<void> {
    await Promise.all([...(this.live.get(contextOf(graph)) ?? [])].map(i => i.settle()));
  }
}

// ------------------------------------------------------------------ effetti

const fullEffectParams = (s: EffectSettings) => {
  const t = effectType(s.type);
  return t ? resolveParams(t, s.params) : {};
};

/** Un effetto: un AudioWorkletNode del processore degli effetti tra due nodi fissi, così si
 *  può collegare subito (passa il suono diretto finché il modulo non è pronto). */
class WorkletEffect implements Effect {
  readonly type: string;
  readonly input: GainNode;
  readonly output: GainNode;
  private node: AudioWorkletNode | null = null;
  private settings: EffectSettings;
  private bpm: number;
  private disposed = false;

  constructor(private readonly ctx: BaseAudioContext, settings: EffectSettings, bpm: number, ready: Promise<void> | null) {
    this.type = settings.type;
    this.settings = settings;
    this.bpm = bpm;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    if (!ready) this.build();
    else {
      this.input.connect(this.output);
      ready.then(() => this.build(), e => console.error('effetto non disponibile', e));
    }
  }

  update(settings: EffectSettings): void {
    const prev = this.settings;
    this.settings = settings;
    if (settings.params !== prev.params) this.send({ type: 'params', params: fullEffectParams(settings) });
    if (settings.enabled !== prev.enabled) this.send({ type: 'enabled', enabled: settings.enabled });
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.send({ type: 'tempo', bpm });
  }

  dispose(): void {
    this.disposed = true;
    this.send({ type: 'dispose' });
    this.node?.disconnect();
    this.input.disconnect();
    this.output.disconnect();
  }

  private build(): void {
    if (this.disposed) return;
    const s = this.settings;
    const processorOptions: EffectProcessorOptions = { type: s.type, params: fullEffectParams(s), enabled: s.enabled, bpm: this.bpm };
    this.node = new AudioWorkletNode(this.ctx, EFFECT_PROCESSOR, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions,
    });
    this.input.disconnect();
    this.input.connect(this.node);
    this.node.connect(this.output);
  }

  private send(m: EffectMessage): void {
    this.node?.port.postMessage(m);
  }
}

/** Effetti AudioWorklet, per qualunque contesto. */
export class WorkletEffects implements EffectHost {
  constructor(private readonly worklet: DeviceWorklet) {}

  create(graph: AudioGraph, settings: EffectSettings, bpm: number): Effect {
    return new WorkletEffect(contextOf(graph), settings, bpm, this.worklet.pending(graph));
  }
}
