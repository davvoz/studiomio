/* Gli strumenti nel browser: ogni strumento è un AudioWorkletNode del processore unico
 * (instruments/worklet), con il motore del suo tipo. Il thread principale manda note e
 * parametri per messaggio, con il tempo in secondi del contesto. */
import { resolveParams } from '../instruments/instrument-type';
import { instrumentType } from '../instruments/registry';
import workletUrl from '../instruments/worklet/instrument.worklet.ts?worker&url';
import {
  INSTRUMENT_PROCESSOR, type InstrumentMessage, type InstrumentProcessorOptions, type InstrumentReply,
} from '../instruments/worklet/protocol';
import type { InstrumentSettings } from '../model/instrument';
import type { AudioGraph } from './audio-graph';
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

/** Strumenti AudioWorklet, per qualunque contesto (dal vivo o offline). */
export class WorkletInstruments implements InstrumentHost {
  private readonly loading = new WeakMap<BaseAudioContext, Promise<void>>();
  private readonly loaded = new WeakSet<BaseAudioContext>();
  private readonly live = new WeakMap<BaseAudioContext, Set<WorkletInstrument>>();

  prepare(graph: AudioGraph): Promise<void> {
    const ctx = contextOf(graph);
    let p = this.loading.get(ctx);
    if (!p) {
      p = ctx.audioWorklet.addModule(workletUrl).then(() => { this.loaded.add(ctx); });
      this.loading.set(ctx, p);
    }
    return p;
  }

  create(graph: AudioGraph, settings: InstrumentSettings): Instrument {
    const ctx = contextOf(graph);
    let set = this.live.get(ctx);
    if (!set) this.live.set(ctx, (set = new Set()));
    const all = set;
    const instrument: WorkletInstrument = new WorkletInstrument(ctx, settings, this.loaded.has(ctx) ? null : this.prepare(graph),
      () => all.delete(instrument));
    all.add(instrument);
    return instrument;
  }

  async settle(graph: AudioGraph): Promise<void> {
    await Promise.all([...(this.live.get(contextOf(graph)) ?? [])].map(i => i.settle()));
  }
}
