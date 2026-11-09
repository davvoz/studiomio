/* Messages from the main thread to the instrument and effect processors. The times are seconds
 * of the audio context: the processor turns them into the exact sample. */
import type { SampleData } from '../dsp/core';
import type { TransportAnchor } from './transport-clock';

/** A parameter's modulation event (see mod-timeline.ts): step, ramp, or "hold
 *  the current value and forget the rest" from `time`. */
export interface ModMessage {
  readonly type: 'mod';
  readonly param: string;
  readonly kind: 'set' | 'ramp' | 'hold';
  readonly value: number;
  readonly time: number;
  /** The source (absent: the clip curves): offsets of different sources are summed. */
  readonly channel?: string;
}

export const INSTRUMENT_PROCESSOR = 'studiomio-instrument';

export interface InstrumentProcessorOptions {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
  /** The loaded samples, by slot (see SamplePlayer). */
  readonly samples: Readonly<Record<string, SampleData>>;
  readonly bpm: number;
  /** Where the transport is (null if stopped), for the instruments that follow the bar. */
  readonly transport: TransportAnchor | null;
}

export type InstrumentMessage =
  | { readonly type: 'note'; readonly pitch: number; readonly velocity: number; readonly on: number; readonly off: number }
  /** A note held by hand: starts right away and plays until `release` arrives. */
  | { readonly type: 'press'; readonly pitch: number; readonly velocity: number }
  | { readonly type: 'release'; readonly pitch: number }
  /** With `at` they apply from that instant (the sound of a starting clip), otherwise right away. */
  | { readonly type: 'params'; readonly params: Readonly<Record<string, number>>; readonly at?: number }
  | ModMessage
  /** A new sample (or null: removed) in slot `slot`, from `at` if given. */
  | { readonly type: 'sample'; readonly slot: string; readonly sample: SampleData | null; readonly at?: number }
  | { readonly type: 'tempo'; readonly bpm: number }
  /** A new transport anchor, or null: it stopped. */
  | { readonly type: 'transport'; readonly anchor: TransportAnchor | null }
  /** Removes the scheduled notes and turns off the playing ones. */
  | { readonly type: 'stop' }
  /** Cuts at instant `at`: the notes after vanish, those straddling it end there. */
  | { readonly type: 'cut'; readonly at: number }
  /** Removes the notes that would start from `at`; those already started continue. */
  | { readonly type: 'retake'; readonly at: number }
  /** Answers with 'pong' when all the previous messages have been received. */
  | { readonly type: 'ping'; readonly id: number }
  | { readonly type: 'dispose' };

/** The engine broke (a non-finite sample, or an error: the message) and the processor
 *  restarted it (see guard.ts). */
export interface FaultReply {
  readonly type: 'fault';
  readonly error: string | null;
}

export type InstrumentReply =
  | { readonly type: 'pong'; readonly id: number }
  /** Where the voices read (see InstrumentCore.playheads), about 30 times a second while
   *  they play, and once empty when they stop. */
  | { readonly type: 'playheads'; readonly positions: Float32Array }
  | FaultReply;

export const EFFECT_PROCESSOR = 'studiomio-effect';

export interface EffectProcessorOptions {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
  readonly enabled: boolean;
  readonly bpm: number;
  /** The detector listens to the second input (sidechain) instead of the first. */
  readonly keyed: boolean;
  /** Where the transport is (null if stopped): see transport-clock.ts. */
  readonly transport: TransportAnchor | null;
}

export type EffectMessage =
  | { readonly type: 'params'; readonly params: Readonly<Record<string, number>> }
  | ModMessage
  | { readonly type: 'enabled'; readonly enabled: boolean }
  | { readonly type: 'tempo'; readonly bpm: number }
  /** The detector switches to the second input (sidechain) or goes back to the first. */
  | { readonly type: 'keyed'; readonly keyed: boolean }
  /** A new transport anchor, or null: it stopped. */
  | { readonly type: 'transport'; readonly anchor: TransportAnchor | null }
  /** Starts or stops sending 'dynamics' (the panel asks for it while it's open). */
  | { readonly type: 'watch'; readonly on: boolean }
  /** Answers with 'pong' when all the previous messages have been received. */
  | { readonly type: 'ping'; readonly id: number }
  | { readonly type: 'dispose' };

export type EffectReply =
  | { readonly type: 'pong'; readonly id: number }
  /** What a dynamics effect is doing (see DynamicsMeter), about 30 times a second. */
  | { readonly type: 'dynamics'; readonly input: number; readonly reduction: number }
  | FaultReply;

export const METER_PROCESSOR = 'studiomio-meter';

export interface MeterProcessorOptions {
  /** The values of all the meters, shared with the main thread; null if the browser doesn't
   *  allow shared memory (then the processor sends the values by message). */
  readonly buffer: SharedArrayBuffer | null;
  /** Position of this meter's first value in the buffer. */
  readonly offset: number;
}

export type MeterMessage = { readonly type: 'dispose' };

/** Without shared memory: the values (as METER_VALUES) about 30 times a second. */
export type MeterReply = { readonly type: 'levels'; readonly values: Float32Array };
