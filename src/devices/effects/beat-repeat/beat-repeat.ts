/* "Beat Repeat": come il Beat Repeat di Live. A tempo, ogni Intervallo (spostato di Offset
 * sedicesimi) e con una certa Probabilità, cattura un pezzetto lungo Griglia e lo ripete per
 * la durata del Gate: stutter, roll, rullate. Le ripetizioni possono scendere di pitch e
 * calare di volume a ogni giro e passare per un filtro passa-banda; si sommano al suono (Mix),
 * lo sostituiscono mentre suonano (Inserisci) o restano sole (Gate). "Repeat" acceso ripete
 * da subito (sul prossimo pezzo di griglia) finché non si spegne: il pulsante da suonare dal
 * vivo. Con "Solo Repeat" ripete soltanto col pulsante: spento, il suono passa com'è, come
 * se l'effetto fosse spento. Segue la battuta del trasporto; da fermo ripete solo con Repeat.
 * Qui c'è solo la descrizione; il suono è in beat-repeat-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** Ogni quanto parte una ripetizione: quarti, o battute (che dipendono dal metro). */
export const INTERVALS: readonly (readonly [label: string, beats: number, bars: number])[] = [
  ['1/32', 1 / 8, 0], ['1/16', 1 / 4, 0], ['1/8', 1 / 2, 0], ['1/4', 1, 0], ['1/2', 2, 0],
  ['1 battuta', 0, 1], ['2 battute', 0, 2], ['4 battute', 0, 4],
];

/** Quanto è lungo il pezzo che si ripete, in quarti. */
export const GRIDS: readonly (readonly [label: string, beats: number])[] = [
  ['1/4', 1], ['1/8', 1 / 2], ['1/8T', 1 / 3], ['1/16', 1 / 4], ['1/16T', 1 / 6], ['1/32', 1 / 8], ['1/32T', 1 / 12], ['1/64', 1 / 16],
];

export const REPEAT_MODES = ['Mix', 'Inserisci', 'Gate'] as const;
export const REPEAT_MODE = { mix: 0, insert: 1, gate: 2 } as const;

/** Quante volte al massimo la Variazione dimezza la griglia (a 100%). */
export const MAX_VARIATION_HALVINGS = 3;

/** Il pitch più basso che le ripetizioni raggiungono, sommando la discesa, in semitoni. */
export const MIN_REPEAT_PITCH = -48;

const OFF_ON = ['Off', 'On'] as const;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

/** I parametri delle ripetizioni a tempo, che con "Solo Repeat" non servono. */
const AUTO = { when: { param: 'only', is: 0 } } as const;

const index = (list: readonly (readonly [string, ...unknown[]])[], label: string) => list.findIndex(([l]) => l === label);

export const BEAT_REPEAT: DeviceType = {
  type: 'beatRepeat',
  label: 'Beat Repeat',
  sections: [
    {
      label: 'Quando',
      params: [
        choice('interval', 'Intervallo', INTERVALS.map(([l]) => l), index(INTERVALS, '1 battuta'), AUTO),
        num('offset', 'Offset', 0, 15, 8, '/16', { step: 1, ...AUTO }),
        num('chance', 'Probabilità', 0, 100, 100, '%', { step: 1, ...AUTO }),
        num('gate', 'Gate', 1, 64, 8, '/16', { step: 1, ...AUTO }),
        choice('repeat', 'Repeat', OFF_ON),
        choice('only', 'Solo Repeat', OFF_ON),
      ],
    },
    {
      label: 'Griglia',
      params: [
        choice('grid', 'Griglia', GRIDS.map(([l]) => l), index(GRIDS, '1/16')),
        num('variation', 'Variazione', 0, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Ripetizioni',
      params: [
        num('pitch', 'Pitch', -24, 0, 0, 'st', { step: 1 }),
        num('pitchDecay', 'Discesa', 0, 4, 0, 'st', { step: 0.1 }),
        num('decay', 'Decadimento', 0, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Filtro',
      params: [
        choice('filter', 'Filtro', OFF_ON),
        num('freq', 'Frequenza', 50, 18000, 1000, 'Hz', { scale: 'log', step: 1, when: { param: 'filter', is: 1 } }),
        num('width', 'Larghezza', 0.5, 9, 3, 'ott', { step: 0.1, when: { param: 'filter', is: 1 } }),
      ],
    },
    {
      label: 'Uscita',
      params: [
        choice('mode', 'Modo', REPEAT_MODES),
        num('volume', 'Volume', -36, 6, 0, 'dB', { step: 0.1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Stutter', params: { interval: index(INTERVALS, '1/2'), offset: 4, gate: 4, grid: index(GRIDS, '1/32'), mode: REPEAT_MODE.insert } },
    { name: 'Roll di fine giro', params: { interval: index(INTERVALS, '4 battute'), offset: 12, gate: 4, grid: index(GRIDS, '1/16'), mode: REPEAT_MODE.insert } },
    { name: 'Tape stop', params: { gate: 8, grid: index(GRIDS, '1/8'), pitchDecay: 2, decay: 15, mode: REPEAT_MODE.insert } },
    { name: 'Glitch', params: { interval: index(INTERVALS, '1/4'), offset: 0, chance: 30, gate: 2, grid: index(GRIDS, '1/16'), variation: 100, mode: REPEAT_MODE.insert } },
    { name: 'Eco filtrato', params: { gate: 16, grid: index(GRIDS, '1/8T'), decay: 30, filter: 1, freq: 1800, width: 2, mode: REPEAT_MODE.mix, volume: -4 } },
  ],
};
