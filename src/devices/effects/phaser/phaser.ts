/* "Phaser": il movimento che gira. Da Phaser è una fila di allpass che sposta la fase, e
 * risommata al suono fa delle buche nello spettro che salgono e scendono; da Flanger è un
 * ritardo cortissimo che oscilla (il "jet" sui reese, sugli hi-hat, sui pad). Velocità a tempo
 * o in Hz, profondità, feedback (anche negativo: buche al posto delle creste), canale destro
 * sfasato per lo stereo, mix. Qui c'è solo la descrizione; il suono è in phaser-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const PHASER_MODES = ['Phaser', 'Flanger'] as const;
export const PHASER_MODE = { phaser: 0, flanger: 1 } as const;
export const PHASER_SYNC = { tempo: 0, hz: 1 } as const;
export const PHASER_STAGES = [2, 4, 6, 8, 12] as const;
export const MAX_FLANGER_MS = 15;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const PHASER: DeviceType = {
  type: 'phaser',
  label: 'Phaser',
  sections: [
    {
      label: 'Modo',
      params: [
        choice('mode', 'Modo', PHASER_MODES),
        choice('stages', 'Stadi', PHASER_STAGES.map(String), 2, { when: { param: 'mode', is: PHASER_MODE.phaser } }),
        num('center', 'Centro', 100, 8000, 900, 'Hz', { scale: 'log', step: 1, when: { param: 'mode', is: PHASER_MODE.phaser } }),
        num('delay', 'Ritardo', 0.2, MAX_FLANGER_MS, 2.5, 'ms', { scale: 'log', step: 0.01, when: { param: 'mode', is: PHASER_MODE.flanger } }),
      ],
    },
    {
      label: 'Movimento',
      params: [
        choice('sync', 'Sincro', ['Tempo', 'Hz']),
        choice('division', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1 battuta'], { when: { param: 'sync', is: PHASER_SYNC.tempo } }),
        num('rate', 'Velocità', 0.01, 10, 0.3, 'Hz', { scale: 'log', step: 0.01, when: { param: 'sync', is: PHASER_SYNC.hz } }),
        num('depth', 'Profondità', 0, 100, 70, '%', { step: 1 }),
        num('stereo', 'Stereo', 0, 180, 90, '°', { step: 1 }),
      ],
    },
    {
      label: 'Uscita',
      params: [
        num('feedback', 'Feedback', -95, 95, 40, '%', { step: 1 }),
        num('mix', 'Dry/Wet', 0, 100, 50, '%', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Phaser lento', params: { division: TEMPO_RATE['4 battute'], depth: 80, feedback: 55, center: 700 } },
    { name: 'Jet', params: { mode: PHASER_MODE.flanger, delay: 1.8, division: TEMPO_RATE['2 battute'], depth: 85, feedback: 70, mix: 50 } },
    { name: 'Reese che gira', params: { mode: PHASER_MODE.flanger, delay: 4, division: TEMPO_RATE['1 battuta'], depth: 60, feedback: -60, stereo: 120, mix: 40 } },
    { name: 'Hat metallici', params: { mode: PHASER_MODE.flanger, delay: 0.8, division: TEMPO_RATE['8 battute'], depth: 90, feedback: 75, mix: 45 } },
    { name: 'Gola', params: { stages: 4, center: 1200, division: TEMPO_RATE['1/2'], depth: 60, feedback: 70, mix: 50 } },
  ],
};
