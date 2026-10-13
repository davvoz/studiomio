/* Messaggi dal thread principale ai processori di strumenti ed effetti. I tempi sono secondi
 * del contesto audio: il processore li trasforma nel campione esatto. */

export const INSTRUMENT_PROCESSOR = 'studiomio-instrument';

export interface InstrumentProcessorOptions {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
}

export type InstrumentMessage =
  | { readonly type: 'note'; readonly pitch: number; readonly velocity: number; readonly on: number; readonly off: number }
  | { readonly type: 'params'; readonly params: Readonly<Record<string, number>> }
  /** Toglie le note programmate e spegne quelle che suonano. */
  | { readonly type: 'stop' }
  /** Risponde con 'pong' quando tutti i messaggi precedenti sono stati ricevuti. */
  | { readonly type: 'ping'; readonly id: number }
  | { readonly type: 'dispose' };

export type InstrumentReply = { readonly type: 'pong'; readonly id: number };

export const EFFECT_PROCESSOR = 'studiomio-effect';

export interface EffectProcessorOptions {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
  readonly enabled: boolean;
  readonly bpm: number;
}

export type EffectMessage =
  | { readonly type: 'params'; readonly params: Readonly<Record<string, number>> }
  | { readonly type: 'enabled'; readonly enabled: boolean }
  | { readonly type: 'tempo'; readonly bpm: number }
  | { readonly type: 'dispose' };

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
