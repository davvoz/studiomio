/* Quantizzazione del lancio delle clip della session: una clip lanciata parte al prossimo
 * confine (es. la prossima battuta), così resta a tempo con quello che suona già. */
import type { Beats, TimeSignature } from '../core/music-time';

export interface LaunchQuantum {
  readonly id: string;
  readonly label: string;
  /** Lunghezza del passo in battiti (0 = subito). */
  readonly beats: (signature: TimeSignature) => Beats;
}

export const LAUNCH_QUANTA: readonly LaunchQuantum[] = [
  { id: 'none', label: 'Nessuna', beats: () => 0 },
  { id: '1/16', label: '1/16', beats: () => 0.25 },
  { id: '1/8', label: '1/8', beats: () => 0.5 },
  { id: '1/4', label: '1/4', beats: () => 1 },
  { id: '1/2', label: '1/2', beats: () => 2 },
  { id: '1bar', label: '1 battuta', beats: s => s.beatsPerBar },
  { id: '2bar', label: '2 battute', beats: s => 2 * s.beatsPerBar },
  { id: '4bar', label: '4 battute', beats: s => 4 * s.beatsPerBar },
];

export const DEFAULT_LAUNCH_QUANTUM = '1bar';

/** Il passo di quantizzazione `id` in battiti (quello predefinito se `id` è sconosciuto). */
export function launchQuantumBeats(id: string, signature: TimeSignature): Beats {
  const q = LAUNCH_QUANTA.find(x => x.id === id) ?? LAUNCH_QUANTA.find(x => x.id === DEFAULT_LAUNCH_QUANTUM)!;
  return q.beats(signature);
}
