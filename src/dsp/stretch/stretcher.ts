import type { Channels } from '../types';
import type { TimeMap } from '../time-map';

export type BeatsLoopMode = 'off' | 'forward' | 'pingpong';

/** Impostazioni di ogni modalità di warp: un'unione discriminata dal campo `mode`. */
export type StretchSettings =
  | { readonly mode: 'repitch' }
  | {
      readonly mode: 'beats';
      /** Inizi delle fette, in campioni di ingresso. */
      readonly slices: readonly number[];
      readonly loopMode: BeatsLoopMode;
      /** 0..100: oltre questa percentuale dello spazio disponibile la fetta sfuma. */
      readonly envelope: number;
    }
  | { readonly mode: 'tones'; readonly grainMs: number }
  | { readonly mode: 'texture'; readonly grainMs: number; /** 0..1 */ readonly flux: number }
  | {
      readonly mode: 'complex';
      /** Dimensione FFT di base (raddoppiata oltre i 60 kHz). */
      readonly fftSize: number;
      /** Transienti in campioni di ingresso, dove la fase si azzera; null = nessun reset. */
      readonly transients: readonly number[] | null;
    };

export type WarpMode = StretchSettings['mode'];
export type SettingsOf<M extends WarpMode> = Extract<StretchSettings, { mode: M }>;

export interface StretchInput {
  readonly channels: Channels;
  readonly sampleRate: number;
  readonly map: TimeMap;
  readonly outLength: number;
}

/** Un algoritmo che porta l'audio sulla nuova griglia temporale descritta da `map`. */
export interface TimeStretcher<S extends StretchSettings = StretchSettings> {
  /** Vero se l'algoritmo cambia già l'intonazione (niente ricampionamento per il transpose). */
  readonly shiftsPitch: boolean;
  stretch(input: StretchInput, settings: S): Float32Array[];
}

/** Tabella completa modalità → algoritmo: se si aggiunge una modalità a `StretchSettings`
 *  il compilatore pretende anche il suo algoritmo. */
export type StretcherTable = { readonly [M in WarpMode]: TimeStretcher<SettingsOf<M>> };
