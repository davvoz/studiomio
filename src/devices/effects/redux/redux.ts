/* "Redux": il suono lo-fi dei campionatori vecchi e dei videogiochi. Abbassa la frequenza di
 * campionamento (ogni campione resta fermo finché non arriva il prossimo: la forma d'onda a
 * gradini e le frequenze che si ripiegano) e i bit (il volume a scalini, il fruscio granuloso).
 * Jitter rende irregolare il passo dei campioni; il filtro può togliere le frequenze che si
 * ripiegherebbero (Prima) o smussare i gradini (Dopo). Qui c'è solo la descrizione; il suono è
 * in redux-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const REDUX_FILTERS = ['Spento', 'Prima', 'Dopo'] as const;
export const REDUX_FILTER = { off: 0, pre: 1, post: 2 } as const;

/** La frequenza più alta: da qui in su (oltre la frequenza del progetto) non riduce più nulla. */
export const MAX_RATE = 48000;
export const MAX_BITS = 16;

const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const REDUX: DeviceType = {
  type: 'redux',
  label: 'Redux',
  sections: [
    {
      label: 'Campioni',
      params: [
        num('rate', 'Frequenza', 100, MAX_RATE, 8000, 'Hz', { scale: 'log' }),
        num('jitter', 'Jitter', 0, 100, 0, '%', { step: 1 }),
        choice('filter', 'Filtro', REDUX_FILTERS),
      ],
    },
    { label: 'Bit', params: [num('bits', 'Bit', 1, MAX_BITS, 8, 'bit', { step: 0.1 })] },
    {
      label: 'Uscita',
      params: [
        num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 }),
        num('output', 'Uscita', -24, 12, 0, 'dB', { step: 0.1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Campionatore 12 bit', params: { rate: 26000, bits: 12, filter: REDUX_FILTER.post } },
    { name: 'Videogioco', params: { rate: 5500, bits: 4 } },
    { name: 'Telefono rotto', params: { rate: 3000, bits: 6, jitter: 30, filter: REDUX_FILTER.pre } },
    { name: 'Polvere', params: { rate: 16000, bits: 10, mix: 40 } },
    { name: 'Distrutto', params: { rate: 800, bits: 2, jitter: 60, output: -6 } },
  ],
};
