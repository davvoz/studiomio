/* "Delay": il primo effetto di studiomio. Eco a tempo (frazioni di battito, anche puntate e
 * terzine) o in millisecondi, feedback con filtri passa-alto e passa-basso, stereo o
 * ping-pong. Qui c'è solo la descrizione; il suono è in delay-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** Le divisioni del tempo, in battiti. */
export const DIVISIONS: readonly (readonly [label: string, beats: number])[] = [
  ['1/32', 1 / 8], ['1/16T', 1 / 6], ['1/16', 1 / 4], ['1/8T', 1 / 3], ['1/16.', 3 / 8], ['1/8', 1 / 2],
  ['1/4T', 2 / 3], ['1/8.', 3 / 4], ['1/4', 1], ['1/4.', 3 / 2], ['1/2', 2], ['1/1', 4],
];

/** Valori della scelta "Sincro". */
export const SYNC = { tempo: 0, ms: 1 } as const;

export const MAX_DELAY_SECONDS = 2.5;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const DELAY: DeviceType = {
  type: 'delay',
  label: 'Delay',
  sections: [
    {
      label: 'Tempo',
      params: [
        choice('sync', 'Sincro', ['Tempo', 'ms']),
        choice('division', 'Divisione', DIVISIONS.map(([l]) => l), 7, { when: { param: 'sync', is: SYNC.tempo } }),
        num('time', 'Tempo', 1, MAX_DELAY_SECONDS * 1000, 300, 'ms', { scale: 'log', step: 1, when: { param: 'sync', is: SYNC.ms } }),
        choice('pingPong', 'Modo', ['Stereo', 'Ping-pong']),
      ],
    },
    {
      label: 'Feedback',
      params: [
        num('feedback', 'Feedback', 0, 95, 35, '%', { step: 1 }),
        num('lowCut', 'Low cut', 20, 2000, 100, 'Hz', { scale: 'log' }),
        num('highCut', 'High cut', 500, 20000, 6000, 'Hz', { scale: 'log' }),
      ],
    },
    { label: 'Uscita', params: [num('mix', 'Dry/Wet', 0, 100, 30, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Ping-pong 1/8.', params: { pingPong: 1, division: 7, feedback: 45, mix: 30 } },
    { name: 'Slapback', params: { sync: SYNC.ms, time: 110, feedback: 0, mix: 25, highCut: 5000 } },
    { name: 'Eco lungo', params: { division: 8, feedback: 60, highCut: 3000, mix: 35 } },
    { name: 'Dub', params: { division: 9, pingPong: 1, feedback: 75, lowCut: 300, highCut: 1800, mix: 40 } },
  ],
};
