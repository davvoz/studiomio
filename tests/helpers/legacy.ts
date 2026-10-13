import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Il motore DSP originale di WarpMio (`tests/reference/warpdsp.legacy.js`), usato come
 *  riferimento: è una funzione autocontenuta, quindi basta valutarla. */
export interface LegacyDsp {
  render(channels: Float32Array[], sr: number, job: unknown): Float32Array[];
  onsetEnvelope(mono: Float32Array, sr: number): { flux: Float32Array; hop: number; frameRate: number };
  detectTransients(mono: Float32Array, envl: unknown, sensitivity: number): number[];
  estimateTempo(envl: unknown, durationSec: number): number;
  trackBeats(envl: unknown, bpm: number): number[];
  mixMono(channels: Float32Array[]): Float32Array;
  encodeWav(channels: Float32Array[], sr: number, bits: number): ArrayBuffer;
  makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array;
}

export function loadLegacyDsp(): LegacyDsp {
  const path = fileURLToPath(new URL('../reference/warpdsp.legacy.js', import.meta.url));
  const factory = new Function(`${readFileSync(path, 'utf8')}\nreturn WarpDSP;`)() as () => LegacyDsp;
  return factory();
}
