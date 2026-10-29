/* I processori AudioWorklet dei dispositivi: uno per tutti gli strumenti, uno per tutti gli
 * effetti. Ognuno crea il motore del tipo richiesto e riceve parametri (e note) dalla porta. */
import { paramsOf, type DeviceType } from '../device-type';
import { followsTransport, isKeyed, playsSamples, type EffectCore, type InstrumentCore, type KeyedEffect, type TransportFollower } from '../dsp/core';
import type { ParamSpec } from '../params';
import { effectType, instrumentType } from '../registry';
import { EFFECT_CORES, INSTRUMENT_CORES } from './cores';
import { EffectRunner } from './effect-runner';
import { METER_VALUES, MeterCore } from './meter-core';
import { ParamModulation } from './mod-timeline';
import { NoteQueue } from './note-queue';
import { TransportClock } from './transport-clock';
import {
  EFFECT_PROCESSOR, INSTRUMENT_PROCESSOR, METER_PROCESSOR, type EffectMessage, type EffectProcessorOptions, type EffectReply,
  type InstrumentMessage, type InstrumentProcessorOptions, type InstrumentReply, type MeterMessage, type MeterProcessorOptions, type MeterReply,
} from './protocol';

// globali dell'AudioWorkletGlobalScope (non sono nelle librerie DOM di TypeScript)
declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

type Handlers<M extends { type: string }> = { readonly [K in M['type']]: (m: Extract<M, { type: K }>) => void };

/** I parametri del tipo che si possono modulare: tutti, numeri e scelte (una scelta si sposta
 *  lungo le sue opzioni e scatta a metà strada, come quando si gira la sua manopola). */
const modSpecs = (type: DeviceType | undefined): Map<string, ParamSpec> =>
  new Map((type ? paramsOf(type) : []).map(p => [p.id, p] as const));

/** Collega la porta alla tabella dei messaggi. */
function listen<M extends { type: string }>(port: MessagePort, handlers: Handlers<M>): void {
  port.onmessage = (e: MessageEvent<M>) => (handlers[e.data.type as M['type']] as (m: M) => void)(e.data);
}

// ------------------------------------------------------------------ strumenti

/** Motore muto per un tipo sconosciuto: il progetto si apre lo stesso. */
const silentInstrument: InstrumentCore = { setParams() {}, noteOn() {}, noteOff() {}, silence() {}, render() {} };

/** Ogni quanti secondi si mandano le posizioni delle voci (per chi le ha). */
const PLAYHEADS_POST = 1 / 30;

class InstrumentProcessor extends AudioWorkletProcessor {
  private readonly core: InstrumentCore;
  private readonly queue = new NoteQueue();
  private readonly mod: ParamModulation;
  /** Il motore, se segue la battuta (il sequencer), e dove si trova il trasporto. */
  private readonly follower: TransportFollower | null;
  private readonly clock = new TransportClock();
  private readonly heads = new Float32Array(32);
  private headCount = 0;
  private untilHeads = 0;
  private alive = true;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as InstrumentProcessorOptions;
    this.core = INSTRUMENT_CORES[o.type]?.(sampleRate) ?? silentInstrument;
    this.mod = new ParamModulation(modSpecs(instrumentType(o.type)), o.params);
    const core = this.core;
    const setSample = playsSamples(core) ? core.setSample.bind(core) : () => {};
    for (const [slot, sample] of Object.entries(o.samples ?? {})) setSample(slot, sample);
    core.setTempo?.(o.bpm);
    this.follower = followsTransport(core) ? core : null;
    this.clock.set(o.transport);
    listen<InstrumentMessage>(this.port, {
      note: m => this.queue.add(m.pitch, m.velocity, Math.round(m.on * sampleRate), Math.round(m.off * sampleRate)),
      params: m => this.mod.setBase(m.params),
      mod: m => this.mod.event(m.param, m.kind, m.value, m.time, m.channel),
      sample: m => setSample(m.slot, m.sample),
      tempo: m => core.setTempo?.(m.bpm),
      transport: m => this.clock.set(m.anchor),
      stop: () => {
        this.queue.clear();
        this.core.silence();
      },
      cut: m => this.queue.cutAt(Math.round(m.at * sampleRate)),
      retake: m => this.queue.dropFrom(Math.round(m.at * sampleRate)),
      ping: m => this.port.postMessage({ type: 'pong', id: m.id }),
      dispose: () => { this.alive = false; },
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right = left] = outputs[0];
    // le manopole e le modulazioni valgono dall'inizio del blocco
    const now = currentFrame / sampleRate;
    const params = this.mod.paramsAt(now);
    if (params) this.core.setParams(params);
    this.follower?.setTransport(this.clock.at(now));
    this.queue.renderBlock(this.core, left, right, currentFrame);
    if (this.core.playheads) this.postHeads(left.length);
    return this.alive;
  }

  /** Le posizioni delle voci, ogni PLAYHEADS_POST secondi mentre suonano; una volta vuote
   *  quando smettono. */
  private postHeads(frames: number): void {
    if ((this.untilHeads -= frames / sampleRate) > 0) return;
    this.untilHeads = PLAYHEADS_POST;
    const n = this.core.playheads!(this.heads);
    if (!n && !this.headCount) return;
    this.headCount = n;
    const reply: InstrumentReply = { type: 'playheads', positions: this.heads.slice(0, n) };
    this.port.postMessage(reply);
  }
}

// ------------------------------------------------------------------ effetti

/** Effetto di tipo sconosciuto: lascia passare il suono. */
const passThrough: EffectCore = {
  setParams() {}, setTempo() {},
  process: (inL, inR, outL, outR, n) => { outL.set(inL.subarray(0, n)); outR.set(inR.subarray(0, n)); },
};

class EffectProcessor extends AudioWorkletProcessor {
  private readonly core: EffectCore;
  private readonly runner: EffectRunner;
  private readonly mod: ParamModulation;
  /** Il motore, se il suo rilevatore ascolta il secondo ingresso (sidechain). */
  private keyed: KeyedEffect | null = null;
  /** Il motore, se segue la battuta, e dove si trova il trasporto. */
  private readonly follower: TransportFollower | null;
  private readonly clock = new TransportClock();
  private silence = new Float32Array(128);
  private alive = true;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as EffectProcessorOptions;
    this.core = EFFECT_CORES[o.type]?.(sampleRate) ?? passThrough;
    this.setKeyed(o.keyed);
    this.core.setTempo(o.bpm);
    this.core.setParams(o.params);
    this.mod = new ParamModulation(modSpecs(effectType(o.type)), o.params);
    this.runner = new EffectRunner(this.core, sampleRate, o.enabled);
    this.follower = followsTransport(this.core) ? this.core : null;
    this.clock.set(o.transport);
    listen<EffectMessage>(this.port, {
      params: m => this.mod.setBase(m.params),
      mod: m => this.mod.event(m.param, m.kind, m.value, m.time, m.channel),
      enabled: m => this.runner.setEnabled(m.enabled),
      tempo: m => this.core.setTempo(m.bpm),
      keyed: m => this.setKeyed(m.keyed),
      transport: m => this.clock.set(m.anchor),
      ping: m => this.port.postMessage({ type: 'pong', id: m.id } satisfies EffectReply),
      dispose: () => { this.alive = false; },
    });
  }

  private setKeyed(on: boolean): void {
    const core = this.core;
    this.keyed = on && isKeyed(core) ? core : null;
    if (!this.keyed && isKeyed(core)) core.setKey(null, null);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [outL, outR = outL] = outputs[0];
    if (this.silence.length < outL.length) this.silence = new Float32Array(outL.length);
    // senza nulla collegato l'ingresso è vuoto: le code (eco, riverbero) continuano sul silenzio
    const [inL = this.silence, inR = inL] = inputs[0] ?? [];
    if (this.keyed) {
      // la traccia ascoltata che tace (o nessuna collegata) è silenzio: il rilevatore non sente niente
      const [keyL = this.silence, keyR = keyL] = inputs[1] ?? [];
      this.keyed.setKey(keyL, keyR);
    }
    const now = currentFrame / sampleRate;
    const params = this.mod.paramsAt(now);
    if (params) this.core.setParams(params);
    this.follower?.setTransport(this.clock.at(now));
    this.runner.process(inL, inR, outL, outR);
    return this.alive;
  }
}

// ------------------------------------------------------------------ misuratori

/** Ogni quanti secondi, senza memoria condivisa, si mandano i livelli. */
const METER_POST = 1 / 30;

/** Misuratore di livello: il suono passa invariato, picco e RMS vanno nella memoria condivisa
 *  (o, se manca, in un messaggio ogni METER_POST secondi). */
class MeterProcessor extends AudioWorkletProcessor {
  private readonly core: MeterCore;
  private readonly values: Float32Array;
  private readonly shared: boolean;
  private silence = new Float32Array(128);
  private untilPost = 0;
  private alive = true;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as MeterProcessorOptions;
    this.shared = o.buffer !== null;
    this.values = o.buffer ? new Float32Array(o.buffer, o.offset * 4, METER_VALUES) : new Float32Array(METER_VALUES);
    this.core = new MeterCore(sampleRate, this.values);
    listen<MeterMessage>(this.port, { dispose: () => { this.alive = false; } });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [outL, outR = outL] = outputs[0];
    if (this.silence.length < outL.length) this.silence = new Float32Array(outL.length);
    // quando non suona niente l'ingresso non ha canali: è silenzio, e l'RMS deve scendere
    const [inL = this.silence, inR = inL] = inputs[0] ?? [];
    outL.set(inL);
    if (outR !== outL) outR.set(inR);
    this.core.process(inL, inR, outL.length);
    if (!this.shared && (this.untilPost -= outL.length / sampleRate) <= 0) {
      this.untilPost = METER_POST;
      const reply: MeterReply = { type: 'levels', values: this.values.slice() };
      this.port.postMessage(reply);
      this.values[0] = this.values[1] = 0;
    }
    return this.alive;
  }
}

registerProcessor(INSTRUMENT_PROCESSOR, InstrumentProcessor);
registerProcessor(METER_PROCESSOR, MeterProcessor);
registerProcessor(EFFECT_PROCESSOR, EffectProcessor);
