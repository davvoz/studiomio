import { mixMono } from '../signal';
import type { AudioData } from '../types';
import { onsetEnvelope } from './onset';
import { estimateTempo } from './tempo';
import { detectTransients } from './transients';

export interface AudioAnalysis {
  readonly tempo: number;
  /** Posizioni dei transienti in campioni. */
  readonly transients: number[];
}

/** Analisi completa di un sample appena caricato: tempo e transienti. */
export function analyzeAudio({ channels, sampleRate }: AudioData, sensitivity: number): AudioAnalysis {
  const mono = mixMono(channels);
  const envl = onsetEnvelope(mono, sampleRate);
  return {
    tempo: estimateTempo(envl, mono.length / sampleRate),
    transients: detectTransients(mono, envl, sensitivity),
  };
}
