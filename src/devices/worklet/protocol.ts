/* Messaggi dal thread principale ai processori di strumenti ed effetti. I tempi sono secondi
 * del contesto audio: il processore li trasforma nel campione esatto. */
import type { SampleData } from '../dsp/core';
import type { TransportAnchor } from './transport-clock';

/** Un evento di modulazione di un parametro (vedi mod-timeline.ts): scalino, rampa, o "tieni
 *  il valore che c'è e dimentica il resto" da `time`. */
export interface ModMessage {
  readonly type: 'mod';
  readonly param: string;
  readonly kind: 'set' | 'ramp' | 'hold';
  readonly value: number;
  readonly time: number;
}

export const INSTRUMENT_PROCESSOR = 'studiomio-instrument';

export interface InstrumentProcessorOptions {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
  /** I sample caricati, per posto (vedi SamplePlayer). */
  readonly samples: Readonly<Record<string, SampleData>>;
  readonly bpm: number;
  /** Dove si trova il trasporto (null se fermo), per gli strumenti che seguono la battuta. */
  readonly transport: TransportAnchor | null;
}

export type InstrumentMessage =
  | { readonly type: 'note'; readonly pitch: number; readonly velocity: number; readonly on: number; readonly off: number }
  | { readonly type: 'params'; readonly params: Readonly<Record<string, number>> }
  | ModMessage
  /** Un sample nuovo (o null: tolto) al posto `slot`. */
  | { readonly type: 'sample'; readonly slot: string; readonly sample: SampleData | null }
  | { readonly type: 'tempo'; readonly bpm: number }
  /** Un ancoraggio nuovo del trasporto, o null: si è fermato. */
  | { readonly type: 'transport'; readonly anchor: TransportAnchor | null }
  /** Toglie le note programmate e spegne quelle che suonano. */
  | { readonly type: 'stop' }
  /** Taglia all'istante `at`: le note dopo spariscono, quelle a cavallo finiscono lì. */
  | { readonly type: 'cut'; readonly at: number }
  /** Toglie le note che partirebbero da `at`; quelle già partite continuano. */
  | { readonly type: 'retake'; readonly at: number }
  /** Risponde con 'pong' quando tutti i messaggi precedenti sono stati ricevuti. */
  | { readonly type: 'ping'; readonly id: number }
  | { readonly type: 'dispose' };

export type InstrumentReply =
  | { readonly type: 'pong'; readonly id: number }
  /** Dove leggono le voci (vedi InstrumentCore.playheads), circa 30 volte al secondo mentre
   *  suonano, e una volta vuoto quando smettono. */
  | { readonly type: 'playheads'; readonly positions: Float32Array };

export const EFFECT_PROCESSOR = 'studiomio-effect';

export interface EffectProcessorOptions {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
  readonly enabled: boolean;
  readonly bpm: number;
  /** Il rilevatore ascolta il secondo ingresso (sidechain) invece del primo. */
  readonly keyed: boolean;
  /** Dove si trova il trasporto (null se fermo): vedi transport-clock.ts. */
  readonly transport: TransportAnchor | null;
}

export type EffectMessage =
  | { readonly type: 'params'; readonly params: Readonly<Record<string, number>> }
  | ModMessage
  | { readonly type: 'enabled'; readonly enabled: boolean }
  | { readonly type: 'tempo'; readonly bpm: number }
  /** Il rilevatore passa al secondo ingresso (sidechain) o torna al primo. */
  | { readonly type: 'keyed'; readonly keyed: boolean }
  /** Un ancoraggio nuovo del trasporto, o null: si è fermato. */
  | { readonly type: 'transport'; readonly anchor: TransportAnchor | null }
  /** Risponde con 'pong' quando tutti i messaggi precedenti sono stati ricevuti. */
  | { readonly type: 'ping'; readonly id: number }
  | { readonly type: 'dispose' };

export type EffectReply = { readonly type: 'pong'; readonly id: number };

export const METER_PROCESSOR = 'studiomio-meter';

export interface MeterProcessorOptions {
  /** I valori di tutti i misuratori, condivisi con il thread principale; null se il browser non
   *  permette la memoria condivisa (allora il processore manda i valori per messaggio). */
  readonly buffer: SharedArrayBuffer | null;
  /** Posizione del primo valore di questo misuratore nel buffer. */
  readonly offset: number;
}

export type MeterMessage = { readonly type: 'dispose' };

/** Senza memoria condivisa: i valori (come METER_VALUES) circa 30 volte al secondo. */
export type MeterReply = { readonly type: 'levels'; readonly values: Float32Array };
