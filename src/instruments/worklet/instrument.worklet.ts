/* Processore AudioWorklet unico per tutti gli strumenti: crea il motore del tipo richiesto,
 * riceve note e parametri dalla porta e fa suonare il motore al campione giusto. */
import type { InstrumentCore } from '../dsp/core';
import { CORES } from './cores';
import { NoteQueue } from './note-queue';
import { INSTRUMENT_PROCESSOR, type InstrumentMessage, type InstrumentProcessorOptions } from './protocol';

// globali dell'AudioWorkletGlobalScope (non sono nelle librerie DOM di TypeScript)
declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

/** Motore muto per un tipo sconosciuto: il progetto si apre lo stesso. */
const silent: InstrumentCore = { setParams() {}, noteOn() {}, noteOff() {}, silence() {}, render() {} };

class InstrumentProcessor extends AudioWorkletProcessor {
  private readonly core: InstrumentCore;
  private readonly queue = new NoteQueue();
  private alive = true;

  private readonly handlers: { readonly [K in InstrumentMessage['type']]: (m: Extract<InstrumentMessage, { type: K }>) => void } = {
    note: m => this.queue.add(m.pitch, m.velocity, Math.round(m.on * sampleRate), Math.round(m.off * sampleRate)),
    params: m => this.core.setParams(m.params),
    stop: () => {
      this.queue.clear();
      this.core.silence();
    },
    ping: m => this.port.postMessage({ type: 'pong', id: m.id }),
    dispose: () => { this.alive = false; },
  };

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as InstrumentProcessorOptions;
    const factory = CORES[o.type];
    this.core = factory ? factory(sampleRate) : silent;
    this.core.setParams(o.params);
    this.port.onmessage = (e: MessageEvent<InstrumentMessage>) =>
      (this.handlers[e.data.type] as (m: InstrumentMessage) => void)(e.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right = left] = outputs[0];
    this.queue.renderBlock(this.core, left, right, currentFrame);
    return this.alive;
  }
}

registerProcessor(INSTRUMENT_PROCESSOR, InstrumentProcessor);
