import type { SampleId } from '../core/id';
import type { Seconds } from '../core/music-time';

/** Risultato dell'analisi di un sample, salvato nel progetto per non ripeterla. */
export interface SampleAnalysis {
  readonly tempo: number;
  readonly transients: readonly Seconds[];
  /** Sensibilità usata per i transienti, 0..1 */
  readonly sensitivity: number;
}

/** Un file audio del progetto. I campioni non stanno nel modello: li tiene il motore,
 *  il modello conserva solo dove trovarli e cosa se ne sa. */
export interface SampleRef {
  readonly id: SampleId;
  readonly name: string;
  /** Percorso relativo alla cartella del progetto, es. "audio/kick.wav". */
  readonly file: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  readonly analysis: SampleAnalysis | null;
}

export const sampleDuration = (s: SampleRef): Seconds => s.frames / s.sampleRate;
