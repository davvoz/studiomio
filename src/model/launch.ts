/* Launch quantization of the session clips: a launched clip starts at the next
 * boundary (e.g. the next bar), so it stays in time with what's already playing. */
import type { Beats, TimeSignature } from '../core/music-time';

export interface LaunchQuantum {
  readonly id: string;
  readonly label: string;
  /** Length of the step in beats (0 = immediately). */
  readonly beats: (signature: TimeSignature) => Beats;
}

export const LAUNCH_QUANTA: readonly LaunchQuantum[] = [
  { id: 'none', label: 'None', beats: () => 0 },
  { id: '1/16', label: '1/16', beats: () => 0.25 },
  { id: '1/8', label: '1/8', beats: () => 0.5 },
  { id: '1/4', label: '1/4', beats: () => 1 },
  { id: '1/2', label: '1/2', beats: () => 2 },
  { id: '1bar', label: '1 bar', beats: s => s.beatsPerBar },
  { id: '2bar', label: '2 bars', beats: s => 2 * s.beatsPerBar },
  { id: '4bar', label: '4 bars', beats: s => 4 * s.beatsPerBar },
];

export const DEFAULT_LAUNCH_QUANTUM = '1bar';

/** The quantization step `id` in beats (the default one if `id` is unknown). */
export function launchQuantumBeats(id: string, signature: TimeSignature): Beats {
  const q = LAUNCH_QUANTA.find(x => x.id === id) ?? LAUNCH_QUANTA.find(x => x.id === DEFAULT_LAUNCH_QUANTUM)!;
  return q.beats(signature);
}
