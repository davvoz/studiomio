/* The Sampler's slices found at the transients, with the same analysis that puts the warp markers
 * on the audio clips. They're computed in the interface (when Slice is chosen, the
 * sensitivity is changed or a sample is loaded) and saved in the instrument's hidden parameters: so
 * they can also be moved by hand, and the engine doesn't have to analyse anything. */
import type { SampleData } from '../../../devices/dsp/core';
import { MAX_SLICES } from '../../../devices/instruments/sampler/sampler';
import { onsetEnvelope } from '../../../dsp/analysis/onset';
import { detectTransients } from '../../../dsp/analysis/transients';

/** A transient closer than this (in seconds) to the start or the end of the region is its edge. */
const EDGE = 0.03;

/** The sample's transients between `from` and `to` (fractions), as it's heard: reversed with
 *  Reverse. `sensitivity` 0…1: higher, more slices. The start of the region is already the first
 *  slice, and isn't in the list. */
export function findTransients(data: SampleData, reverse: boolean, sensitivity: number, from = 0, to = 1): number[] {
  const n = data.channels[0]?.length ?? 0;
  if (n < 2) return [];
  const mono = new Float32Array(n), k = 1 / data.channels.length;
  for (const c of data.channels) for (let i = 0; i < n; i++) mono[reverse ? n - 1 - i : i] += c[i] * k;
  const found = detectTransients(mono, onsetEnvelope(mono, data.sampleRate), sensitivity);
  const gap = (EDGE * data.sampleRate) / n;
  return found.map(p => p / n).filter(x => x > from + gap && x < to - gap).slice(0, MAX_SLICES - 1);
}
