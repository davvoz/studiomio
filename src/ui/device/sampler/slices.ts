/* Le fette del Sampler trovate ai transienti, con la stessa analisi che mette i marker di warp
 * sulle clip audio. Si calcolano nell'interfaccia (quando si sceglie Slice, si cambia la
 * sensibilità o si carica un sample) e si salvano nei parametri nascosti dello strumento: così
 * si possono anche spostare a mano, e il motore non deve analizzare nulla. */
import type { SampleData } from '../../../devices/dsp/core';
import { MAX_SLICES } from '../../../devices/instruments/sampler/sampler';
import { onsetEnvelope } from '../../../dsp/analysis/onset';
import { detectTransients } from '../../../dsp/analysis/transients';

/** Un transiente più vicino di così (in secondi) all'inizio o alla fine della regione è il suo bordo. */
const EDGE = 0.03;

/** I transienti del sample tra `from` e `to` (frazioni), come lo si sente: rovesciato con
 *  Reverse. `sensitivity` 0…1: più alta, più fette. L'inizio della regione è già la prima
 *  fetta, e non sta nell'elenco. */
export function findTransients(data: SampleData, reverse: boolean, sensitivity: number, from = 0, to = 1): number[] {
  const n = data.channels[0]?.length ?? 0;
  if (n < 2) return [];
  const mono = new Float32Array(n), k = 1 / data.channels.length;
  for (const c of data.channels) for (let i = 0; i < n; i++) mono[reverse ? n - 1 - i : i] += c[i] * k;
  const found = detectTransients(mono, onsetEnvelope(mono, data.sampleRate), sensitivity);
  const gap = (EDGE * data.sampleRate) / n;
  return found.map(p => p / n).filter(x => x > from + gap && x < to - gap).slice(0, MAX_SLICES - 1);
}
