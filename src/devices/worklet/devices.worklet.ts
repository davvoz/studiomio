/* The devices' AudioWorklet processors: one for all the instruments, one for all the
 * effects. Each creates the engine of the requested type and receives parameters (and notes) from the port. */
import { ARP } from '../arp/arp';
import { Arpeggiator } from '../arp/arpeggiator';
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

// AudioWorkletGlobalScope globals (they're not in TypeScript's DOM libraries)
declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

type Handlers<M extends { type: string }> = { readonly [K in M['type']]: (m: Extract<M, { type: K }>) => void };

/** The type's parameters that can be modulated: all of them, numbers and choices (a choice moves
 *  along its options and snaps halfway, as when turning its knob). */
const modSpecs = (...types: (DeviceType | undefined)[]): Map<string, ParamSpec> =>
  new Map(types.flatMap(type => (type ? paramsOf(type) : [])).map(p => [p.id, p] as const));

/** Connects the port to the message table. */
function listen<M extends { type: string }>(port: MessagePort, handlers: Handlers<M>): void {
  port.onmessage = (e: MessageEvent<M>) => (handlers[e.data.type as M['type']] as (m: M) => void)(e.data);
}

// ------------------------------------------------------------------ strumenti

/** Silent engine for an unknown type: the project opens anyway. */
const silentInstrument: InstrumentCore = { setParams() {}, noteOn() {}, noteOff() {}, silence() {}, render() {} };

/** Every how many seconds the voices' positions are sent (for whoever has them). */
const PLAYHEADS_POST = 1 / 30;

class InstrumentProcessor extends AudioWorkletProcessor {
  private readonly type: string;
  /** The instrument's engine, with the arpeggiator in front: the notes go through it. */
  private arp: Arpeggiator;
  private readonly queue = new NoteQueue();
  private readonly mod: ParamModulation;
  /** The engine, if it follows the bar (the sequencer), and where the transport is. */
  private follower: TransportFollower | null = null;
  private readonly clock = new TransportClock();
  /** What the engine received, to recreate it identical if it breaks. */
  private params: Readonly<Record<string, number>>;
  private readonly samples = new Map<string, SampleData | null>();
  private bpm: number;
  private readonly faults = new FaultGate();
  private readonly heads = new Float32Array(32);
  private headCount = 0;
  private untilHeads = 0;
  /** Changes applying from an instant (sample), in order. */
  private readonly later: { readonly frame: number; readonly run: () => void }[] = [];
  private alive = true;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = options.processorOptions as InstrumentProcessorOptions;
    this.type = o.type;
    this.params = o.params;
    this.bpm = o.bpm;
    for (const [slot, sample] of Object.entries(o.samples ?? {})) this.samples.set(slot, sample);
    this.arp = this.build();
    this.mod = new ParamModulation(modSpecs(instrumentType(o.type), ARP), o.params);
    this.clock.set(o.transport);
    listen<InstrumentMessage>(this.port, {
      note: m => this.queue.add(m.pitch, m.velocity, Math.round(m.on * sampleRate), Math.round(m.off * sampleRate)),
      press: m => this.queue.press(m.pitch, m.velocity, currentFrame),
      release: m => this.queue.release(m.pitch, currentFrame),
      params: m => this.at(m.at, () => this.mod.setBase(m.params)),
      mod: m => this.mod.event(m.param, m.kind, m.value, m.time, m.channel),
      sample: m => this.at(m.at, () => {
        this.samples.set(m.slot, m.sample);
        if (playsSamples(this.core)) this.core.setSample(m.slot, m.sample);
      }),
      tempo: m => {
        this.bpm = m.bpm;
        this.arp.setTempo(m.bpm);
      },
      transport: m => this.clock.set(m.anchor),
      stop: () => {
        this.queue.clear();
        this.arp.silence();
      },
      cut: m => this.queue.cutAt(Math.round(m.at * sampleRate)),
      retake: m => this.queue.dropFrom(Math.round(m.at * sampleRate)),
      ping: m => this.port.postMessage({ type: 'pong', id: m.id }),
      dispose: () => { this.alive = false; },
    });
  }

  private get core(): InstrumentCore {
    return this.arp.inner;
  }

  /** A new engine with the parameters, the samples and the tempo the previous one received. */
  private build(): Arpeggiator {
    const core = INSTRUMENT_CORES[this.type]?.(sampleRate) ?? silentInstrument;
    if (playsSamples(core)) for (const [slot, sample] of this.samples) core.setSample(slot, sample);
    const arp = new Arpeggiator(core, sampleRate);
    arp.setTempo(this.bpm);
    arp.setParams(this.params);
    this.follower = followsTransport(core) ? core : null;
    return arp;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right = left] = outputs[0];
    let error: unknown = null;
    try {
      // the knobs and the modulations apply from the start of the block
      const now = currentFrame / sampleRate;
      while (this.later.length && this.later[0].frame < currentFrame + left.length) this.later.shift()!.run();
      const params = this.mod.paramsAt(now);
      if (params) this.arp.setParams((this.params = params));
      const position = this.clock.at(now);
      this.follower?.setTransport(position);
      this.arp.setTransport(position);
      this.queue.renderBlock(this.arp, left, right, currentFrame);
      if (this.core.playheads) this.postHeads(left.length);
    } catch (e) {
      error = e;
    }
    if (error !== null || hasInvalid(left) || hasInvalid(right)) {
      left.fill(0);
      right.fill(0);
      if (this.faults.restart(currentFrame / sampleRate)) {
        this.arp = this.build();
        this.port.postMessage({ type: 'fault', error: error === null ? null : String(error) } satisfies InstrumentReply);
      }
    }
    return this.alive;
  }

  /** `run` right away, or in the block containing the instant `at` (context seconds). */
  private at(at: number | undefined, run: () => void): void {
    const frame = at === undefined ? -Infinity : Math.round(at * sampleRate);
    if (frame < currentFrame) return run();
    let i = this.later.length;
    while (i > 0 && this.later[i - 1].frame > frame) i--;
    this.later.splice(i, 0, { frame, run });
  }

  /** The voices' positions, every PLAYHEADS_POST seconds while they play; once empty
   *  when they stop. */
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

// ------------------------------------------------------------------ effects

/** Effect of unknown type: lets the sound through. */
const passThrough: EffectCore = {
  setParams() {}, setTempo() {},
  process: (inL, inR, outL, outR, n) => { outL.set(inL.subarray(0, n)); outR.set(inR.subarray(0, n)); },
};

/** Every how many seconds a dynamics effect tells the panel what it's doing. */
const DYNAMICS_POST = 1 / 30;

class EffectProcessor extends AudioWorkletProcessor {
  private readonly type: string;
  private core: EffectCore;
  private runner: EffectRunner;
  private readonly mod: ParamModulation;
  /** The engine, if its detector listens to the second input (sidechain). */
  private keyed: KeyedEffect | null = null;
  /** The engine, if it follows the bar, and where the transport is. */
  private follower: TransportFollower | null = null;
  private readonly clock = new TransportClock();
  /** What the engine received, to recreate it identical if it breaks. */
  private params: Readonly<Record<string, number>>;
  private bpm: number;
  private enabled: boolean;
  private keyedOn: boolean;
  private readonly faults = new FaultGate();
  private silence = new Float32Array(128);
  /** The cleaned copies of the inputs (see `cleaned`). */
  private spare = [new Float32Array(128), new Float32Array(128), new Float32Array(128), new Float32Array(128)];
  private alive = true;
  /** The panel is watching: every DYNAMICS_POST seconds it's told what the effect is doing. */
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

  /** A new engine with the parameters, the tempo and the listening the previous one received. */
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
      // with nothing connected the input is empty: the tails (echo, reverb) continue on silence;
      // a broken input (from a node that isn't ours) is cleaned before it comes in
      const [inL = this.silence, inR = inL] = inputs[0] ?? [];
      const l = cleaned(inL, spare[0]), r = inR === inL ? l : cleaned(inR, spare[1]);
      if (this.keyed) {
        // the listened-to track being silent (or none connected) is silence: the detector hears nothing
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

// ------------------------------------------------------------------ meters

/** Every how many seconds, without shared memory, the levels are sent. */
const METER_POST = 1 / 30;

/** Level meter: the sound passes unchanged, peak and RMS go into shared memory
 *  (or, if it's missing, into a message every METER_POST seconds). */
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
    // when nothing plays the input has no channels: it's silence, and the RMS must fall; a
    // broken input is cleaned (the meter would let it through)
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
