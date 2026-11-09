import { mixMono } from '../signal';
import type { AudioData } from '../types';
import { onsetEnvelope } from './onset';
import { estimateTempo } from './tempo';
import { detectTransients } from './transients';

export interface AudioAnalysis {
  readonly tempo: number;
  /** Transient positions in samples. */
  readonly transients: number[];
}

/** Complete analysis of a newly loaded sample: tempo and transients. */
export function analyzeAudio({ channels, sampleRate }: AudioData, sensitivity: number): AudioAnalysis {
  const mono = mixMono(channels);
  const envl = onsetEnvelope(mono, sampleRate);
  return {
    tempo: estimateTempo(envl, mono.length / sampleRate),
    transients: detectTransients(mono, envl, sensitivity),
  };
}
