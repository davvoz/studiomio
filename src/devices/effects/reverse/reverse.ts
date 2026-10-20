/* "Reverse": il suono al contrario, a pezzi a tempo. Il tempo è diviso in pezzi lunghi
 * Lunghezza, agganciati alla battuta: mentre passa un pezzo si sente quello prima, letto dalla
 * fine all'inizio (il risucchio prima del drop). "Reverse" lo accende e lo spegne al volo, con
 * una sfumatura; Dry/Wet mescola il suono diritto. Qui c'è solo la descrizione; il suono è in
 * reverse-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** Quanto è lungo un pezzo: quarti, o battute (che dipendono dal metro). */
export const REVERSE_LENGTHS: readonly (readonly [label: string, beats: number, bars: number])[] = [
  ['1/16', 1 / 4, 0], ['1/8', 1 / 2, 0], ['1/4', 1, 0], ['1/2', 2, 0], ['1 battuta', 0, 1],
];

/** Il pezzo più lungo, in quarti: con metri lunghissimi "1 battuta" si ferma qui (il nastro
 *  deve ricordarne due). */
export const MAX_REVERSE_BEATS = 16;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

const length = (label: string) => REVERSE_LENGTHS.findIndex(([l]) => l === label);

export const REVERSE: DeviceType = {
  type: 'reverse',
  label: 'Reverse',
  sections: [
    {
      label: 'Reverse',
      params: [
        choice('reverse', 'Reverse', ['Off', 'On'], 1),
        choice('length', 'Lunghezza', REVERSE_LENGTHS.map(([l]) => l), length('1/2')),
      ],
    },
    { label: 'Uscita', params: [num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Quarti al contrario', params: { length: length('1/4') } },
    { name: 'Risucchio di 1 battuta', params: { length: length('1 battuta') } },
    { name: 'Glitch in sedicesimi', params: { length: length('1/16') } },
    { name: 'Metà e metà', params: { length: length('1/8'), mix: 50 } },
  ],
};
