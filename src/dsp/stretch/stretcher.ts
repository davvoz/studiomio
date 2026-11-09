import type { Channels } from '../types';
import type { TimeMap } from '../time-map';

export type BeatsLoopMode = 'off' | 'forward' | 'pingpong';

/** Settings of each warp mode: a union discriminated by the `mode` field. */
export type StretchSettings =
  | { readonly mode: 'repitch' }
  | {
      readonly mode: 'beats';
      /** Slice starts, in input samples. */
      readonly slices: readonly number[];
      readonly loopMode: BeatsLoopMode;
      /** 0..100: beyond this percentage of the available space the slice fades. */
      readonly envelope: number;
    }
  | { readonly mode: 'tones'; readonly grainMs: number }
  | { readonly mode: 'texture'; readonly grainMs: number; /** 0..1 */ readonly flux: number }
  | {
      readonly mode: 'complex';
      /** Base FFT size (doubled above 60 kHz). */
      readonly fftSize: number;
      /** Transients in input samples, where the phase is reset; null = no reset. */
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

/** An algorithm bringing the audio onto the new time grid described by `map`. */
export interface TimeStretcher<S extends StretchSettings = StretchSettings> {
  /** True if the algorithm already changes the pitch (no resampling for the transpose). */
  readonly shiftsPitch: boolean;
  stretch(input: StretchInput, settings: S): Float32Array[];
}

/** Complete mode → algorithm table: if a mode is added to `StretchSettings`
 *  the compiler also demands its algorithm. */
export type StretcherTable = { readonly [M in WarpMode]: TimeStretcher<SettingsOf<M>> };
