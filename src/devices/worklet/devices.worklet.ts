/* I processori AudioWorklet dei dispositivi: uno per tutti gli strumenti, uno per tutti gli
 * effetti. Ognuno crea il motore del tipo richiesto e riceve parametri (e note) dalla porta. */
import { metersDynamics } from '../dsp/core';
import { paramsOf, type DeviceType } from '../device-type';
import {
  followsTransport, isKeyed, playsSamples, type EffectCore, type InstrumentCore, type KeyedEffect, type SampleData, type TransportFollower,
} from '../dsp/core';
import type { ParamSpec } from '../params';
import { effectType, instrumentType } from '../registry';
import { EFFECT_CORES, INSTRUMENT_CORES } from './cores';
import { EffectRunner } from './effect-runner';
import { cleaned, FaultGate, hasInvalid } from './guard';
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
  private readonly type: string;
  private core: InstrumentCore;
  private readonly queue = new NoteQueue();
  private readonly mod: ParamModulation;
  /** Il motore, se segue la battuta (il sequencer), e dove si trova il trasporto. */
  private follower: TransportFollower | null = null;
  private readonly clock = new TransportClock();
  /** Quello che il motore ha ricevuto, per ricrearlo uguale se si guasta. */
  private params: Readonly<Record<string, number>>;
  private readonly samples = new Map<string, SampleData | null>();
  private bpm: number;
  private readonly faults = new FaultGate();
  private readonly heads = new Float32Array(32);
  private headCount = 0;
  private untilHeads = 0;
  /** Cambi che valgono da un istante (campione), in ordine. */
  private readonly later: { readonly frame: number; readonly run: () => void }[] = [];
  private alive = true;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as InstrumentProcessorOptions;
    this.type = o.type;
    this.params = o.params;
    this.bpm = o.bpm;
    for (const [slot, sample] of Object.entries(o.samples ?? {})) this.samples.set(slot, sample);
    this.core = this.build();
    this.mod = new ParamModulation(modSpecs(instrumentType(o.type)), o.params);
    this.clock.set(o.transport);
    listen<InstrumentMessage>(this.port, {
      note: m => this.queue.add(m.pitch, m.velocity, Math.round(m.on * sampleRate), Math.round(m.off * sampleRate)),
      params: m => this.at(m.at, () => this.mod.setBase(m.params)),
      mod: m => this.mod.event(m.param, m.kind, m.value, m.time, m.channel),
      sample: m => this.at(m.at, () => {
        this.samples.set(m.slot, m.sample);
        if (playsSamples(this.core)) this.core.setSample(m.slot, m.sample);
      }),
      tempo: m => {
        this.bpm = m.bpm;
        this.core.setTempo?.(m.bpm);
      },
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

  /** Un motore nuovo con i parametri, i sample e il tempo che ha ricevuto quello di prima. */
  private build(): InstrumentCore {
    const core = INSTRUMENT_CORES[this.type]?.(sampleRate) ?? silentInstrument;
    if (playsSamples(core)) for (const [slot, sample] of this.samples) core.setSample(slot, sample);
    core.setTempo?.(this.bpm);
    core.setParams(this.params);
    this.follower = followsTransport(core) ? core : null;
    return core;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right = left] = outputs[0];
    let error: unknown = null;
    try {
      // le manopole e le modulazioni valgono dall'inizio del blocco
      const now = currentFrame / sampleRate;
      while (this.later.length && this.later[0].frame < currentFrame + left.length) this.later.shift()!.run();
      const params = this.mod.paramsAt(now);
      if (params) this.core.setParams((this.params = params));
      this.follower?.setTransport(this.clock.at(now));
      this.queue.renderBlock(this.core, left, right, currentFrame);
      if (this.core.playheads) this.postHeads(left.length);
    } catch (e) {
      error = e;
    }
    if (error !== null || hasInvalid(left) || hasInvalid(right)) {
      left.fill(0);
      right.fill(0);
      if (this.faults.restart(currentFrame / sampleRate)) {
        this.core = this.build();
        this.port.postMessage({ type: 'fault', error: error === null ? null : String(error) } satisfies InstrumentReply);
      }
    }
    return this.alive;
  }

  /** `run` subito, o nel blocco che contiene l'istante `at` (secondi del contesto). */
  private at(at: number | undefined, run: () => void): void {
    const frame = at === undefined ? -Infinity : Math.round(at * sampleRate);
    if (frame < currentFrame) return run();
    let i = this.later.length;
    while (i > 0 && this.later[i - 1].frame > frame) i--;
    this.later.splice(i, 0, { frame, run });
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

/** Ogni quanti secondi un effetto di dinamica dice al pannello cosa sta facendo. */
const DYNAMICS_POST = 1 / 30;

class EffectProcessor extends AudioWorkletProcessor {
  private readonly type: string;
  private core: EffectCore;
  private runner: EffectRunner;
  private readonly mod: ParamModulation;
  /** Il motore, se il suo rilevatore ascolta il secondo ingresso (sidechain). */
  private keyed: KeyedEffect | null = null;
  /** Il motore, se segue la battuta, e dove si trova il trasporto. */
  private follower: TransportFollower | null = null;
  private readonly clock = new TransportClock();
  /** Quello che il motore ha ricevuto, per ricrearlo uguale se si guasta. */
  private params: Readonly<Record<string, number>>;
  private bpm: number;
  private enabled: boolean;
  private keyedOn: boolean;
  private readonly faults = new FaultGate();
  private silence = new Float32Array(128);
  /** Le copie ripulite degli ingressi (vedi `cleaned`). */
  private spare = [new Float32Array(128), new Float32Array(128), new Float32Array(128), new Float32Array(128)];
  private alive = true;
  /** Il pannello guarda: ogni DYNAMICS_POST secondi gli si dice cosa fa l'effetto. */
  private watched = false;
  private untilDynamics = 0;
  private readonly dynamics = new Float32Array(2);

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as EffectProcessorOptions;
    this.type = o.type;
    this.params = o.params;
    this.bpm = o.bpm;
    this.enabled = o.enabled;
    this.keyedOn = o.keyed;
    [this.core, this.runner] = this.build();
    this.mod = new ParamModulation(modSpecs(effectType(o.type)), o.params);
    this.clock.set(o.transport);
    listen<EffectMessage>(this.port, {
      params: m => this.mod.setBase(m.params),
      mod: m => this.mod.event(m.param, m.kind, m.value, m.time, m.channel),
      enabled: m => this.runner.setEnabled((this.enabled = m.enabled)),
      tempo: m => this.core.setTempo((this.bpm = m.bpm)),
      keyed: m => this.setKeyed((this.keyedOn = m.keyed)),
      transport: m => this.clock.set(m.anchor),
      watch: m => { this.watched = m.on; },
      ping: m => this.port.postMessage({ type: 'pong', id: m.id } satisfies EffectReply),
      dispose: () => { this.alive = false; },
    });
  }

  /** Un motore nuovo con i parametri, il tempo e l'ascolto che ha ricevuto quello di prima. */
  private build(): [EffectCore, EffectRunner] {
    const core = EFFECT_CORES[this.type]?.(sampleRate) ?? passThrough;
    this.setKeyed(this.keyedOn, core);
    core.setTempo(this.bpm);
    core.setParams(this.params);
    this.follower = followsTransport(core) ? core : null;
    return [core, new EffectRunner(core, sampleRate, this.enabled)];
  }

  private setKeyed(on: boolean, core = this.core): void {
    this.keyed = on && isKeyed(core) ? core : null;
    if (!this.keyed && isKeyed(core)) core.setKey(null, null);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [outL, outR = outL] = outputs[0];
    if (this.silence.length < outL.length) {
      this.silence = new Float32Array(outL.length);
      this.spare = this.spare.map(() => new Float32Array(outL.length));
    }
    const spare = this.spare;
    let error: unknown = null;
    try {
      // senza nulla collegato l'ingresso è vuoto: le code (eco, riverbero) continuano sul silenzio;
      // un ingresso guasto (da un nodo che non è dei nostri) si ripulisce prima che entri
      const [inL = this.silence, inR = inL] = inputs[0] ?? [];
      const l = cleaned(inL, spare[0]), r = inR === inL ? l : cleaned(inR, spare[1]);
      if (this.keyed) {
        // la traccia ascoltata che tace (o nessuna collegata) è silenzio: il rilevatore non sente niente
        const [keyL = this.silence, keyR = keyL] = inputs[1] ?? [];
        const kl = cleaned(keyL, spare[2]);
        this.keyed.setKey(kl, keyR === keyL ? kl : cleaned(keyR, spare[3]));
      }
      const now = currentFrame / sampleRate;
      const params = this.mod.paramsAt(now);
      if (params) this.core.setParams((this.params = params));
      this.follower?.setTransport(this.clock.at(now));
      this.runner.process(l, r, outL, outR);
      if (this.watched) this.postDynamics(outL.length);
    } catch (e) {
      error = e;
    }
    if (error !== null || hasInvalid(outL) || hasInvalid(outR)) {
      outL.fill(0);
      outR.fill(0);
      if (this.faults.restart(currentFrame / sampleRate)) {
        [this.core, this.runner] = this.build();
        this.port.postMessage({ type: 'fault', error: error === null ? null : String(error) } satisfies EffectReply);
      }
    }
    return this.alive;
  }

  private postDynamics(frames: number): void {
    if ((this.untilDynamics -= frames / sampleRate) > 0 || !metersDynamics(this.core)) return;
    this.untilDynamics = DYNAMICS_POST;
    this.core.readDynamics(this.dynamics);
    this.port.postMessage({ type: 'dynamics', input: this.dynamics[0], reduction: this.dynamics[1] } satisfies EffectReply);
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
  private spare = [new Float32Array(128), new Float32Array(128)];
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
    if (this.silence.length < outL.length) {
      this.silence = new Float32Array(outL.length);
      this.spare = this.spare.map(() => new Float32Array(outL.length));
    }
    // quando non suona niente l'ingresso non ha canali: è silenzio, e l'RMS deve scendere; un
    // ingresso guasto si ripulisce (il misuratore lo lascerebbe passare)
    const [rawL = this.silence, rawR = rawL] = inputs[0] ?? [];
    const inL = cleaned(rawL, this.spare[0]), inR = rawR === rawL ? inL : cleaned(rawR, this.spare[1]);
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
