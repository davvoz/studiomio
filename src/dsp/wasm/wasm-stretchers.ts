import { pvFftSize } from '../stretch/phase-vocoder';
import type { SettingsOf, StretchInput, StretcherTable, TimeStretcher } from '../stretch/stretcher';
import init, { pv_stretch } from './pkg/studiomio_dsp';

/** Firma della funzione esportata dal crate Rust (`crates/dsp/src/lib.rs`). */
export type PvStretchFn = typeof pv_stretch;

const toPlanar = (channels: readonly Float32Array[]): Float32Array => {
  const len = channels[0].length, planar = new Float32Array(len * channels.length);
  channels.forEach((c, i) => planar.set(c, i * len));
  return planar;
};

const fromPlanar = (planar: Float32Array, count: number): Float32Array[] => {
  const len = planar.length / count;
  return Array.from({ length: count }, (_, i) => planar.slice(i * len, (i + 1) * len));
};

/** Modalità Complex calcolata in WebAssembly: stessi ingressi e stesso risultato della
 *  versione TypeScript, che resta il riferimento nei test. */
export class WasmComplexStretcher implements TimeStretcher<SettingsOf<'complex'>> {
  readonly shiftsPitch = false;

  constructor(private readonly pvStretch: PvStretchFn) {}

  stretch({ channels, sampleRate, map, outLength }: StretchInput, s: SettingsOf<'complex'>): Float32Array[] {
    const { output, input } = map.toArrays();
    const out = this.pvStretch(
      toPlanar(channels), channels.length, output, input, outLength,
      pvFftSize(sampleRate, s.fftSize), Float64Array.from(s.transients ?? []),
    );
    return fromPlanar(out, channels.length);
  }
}

/** Inizializza il modulo WebAssembly e restituisce gli algoritmi che sostituisce. */
export async function loadWasmStretchers(): Promise<Partial<StretcherTable>> {
  await init();
  return { complex: new WasmComplexStretcher(pv_stretch) };
}
