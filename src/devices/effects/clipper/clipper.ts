/* "Clipper": taglia i picchi sopra il Tetto, senza tempi (né attacco né rilascio): la forma
 * d'onda si appiattisce solo dove supera. Sulla cassa e sul bus della batteria toglie i picchi
 * dell'attacco e lascia il corpo; prima del Limiter del master si prende i picchi più brevi (la
 * cassa, i clap), così il limiter lavora meno e il mix suona forte senza pompare. Il Ginocchio
 * ammorbidisce l'ingresso nella curva (0 = taglio netto, 100 = saturazione tanh). Gira
 * sovracampionato: le armoniche del taglio non si ripiegano. Il suono è in clipper-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** I fattori di sovracampionamento, nell'ordine dei valori del parametro "Qualità". */
export const CLIPPER_OVERSAMPLING = [2, 4, 8] as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def: number): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const CLIPPER: DeviceType = {
  type: 'clipper',
  label: 'Clipper',
  sections: [
    {
      label: 'Taglio',
      params: [
        num('drive', 'Ingresso', 0, 24, 0, 'dB', { step: 0.1 }),
        num('ceiling', 'Tetto', -24, 0, -0.3, 'dB', { step: 0.1 }),
        num('knee', 'Ginocchio', 0, 100, 30, '%', { step: 1 }),
      ],
    },
    {
      label: 'Uscita',
      params: [
        num('output', 'Uscita', -24, 12, 0, 'dB', { step: 0.1 }),
        choice('oversampling', 'Oversampling', CLIPPER_OVERSAMPLING.map(f => `${f}×`), 1),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Cassa', params: { drive: 4, ceiling: -3, knee: 20 } },
    { name: 'Batteria', params: { drive: 3, ceiling: -1, knee: 40 } },
    { name: 'Master', params: { drive: 2, ceiling: -0.8, knee: 25 } },
    { name: 'Saturazione', params: { drive: 9, ceiling: -6, knee: 100, output: 3 } },
  ],
};
