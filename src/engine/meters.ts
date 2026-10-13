import type { AudioGraph, AudioNodeLike } from './audio-graph';

/** Livelli di un canale stereo, lineari (1 = 0 dBFS): il picco dall'ultima lettura e l'RMS
 *  (media mobile, costante di 120 ms). */
export interface MeterReading {
  readonly peak: readonly [number, number];
  readonly rms: readonly [number, number];
}

export const SILENT: MeterReading = { peak: [0, 0], rms: [0, 0] };

/** Un misuratore di livello nel grafo: il suono passa da `input` a `output` senza cambiare. */
export interface Meter {
  readonly input: AudioNodeLike;
  readonly output: AudioNodeLike;
  /** Legge i livelli e riparte da zero con il picco. */
  read(): MeterReading;
  dispose(): void;
}

/** Dove nascono i misuratori: nel browser l'AudioWorklet, nei test un registratore. Nell'export
 *  non servono, e il mixer va avanti senza. */
export interface MeterHost {
  create(graph: AudioGraph): Meter;
}
