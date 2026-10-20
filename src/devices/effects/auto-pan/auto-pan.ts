/* "Auto Pan": come l'Auto Pan di Live. Un LFO (le stesse onde dell'Auto Filter, agganciato alla
 * battuta se va a tempo) abbassa e alza il volume dei due canali: con Stereo a 180° i canali
 * vanno in controfase e il suono va da una parte all'altra; a 0° si muovono insieme ed è un
 * tremolo. Fase sposta il giro rispetto alla battuta. Qui c'è solo la descrizione; il suono è
 * in auto-pan-core.ts. */
import type { DeviceType } from '../../device-type';
import { LFO_SHAPE, LFO_SHAPES } from '../../dsp/lfo';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const AUTO_PAN_SYNC = { tempo: 0, hz: 1 } as const;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const AUTO_PAN: DeviceType = {
  type: 'autoPan',
  label: 'Auto Pan',
  sections: [
    {
      label: 'LFO',
      params: [
        num('amount', 'Quantità', 0, 100, 100, '%', { step: 1 }),
        choice('shape', 'Onda', LFO_SHAPES),
        choice('sync', 'Sincro', ['Tempo', 'Hz']),
        choice('division', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/2'], { when: { param: 'sync', is: AUTO_PAN_SYNC.tempo } }),
        num('rate', 'Velocità', 0.01, 20, 1, 'Hz', { scale: 'log', step: 0.01, when: { param: 'sync', is: AUTO_PAN_SYNC.hz } }),
      ],
    },
    {
      label: 'Fase',
      params: [
        num('stereo', 'Stereo', 0, 180, 180, '°', { step: 1 }),
        num('phase', 'Fase', 0, 360, 0, '°', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Pan lento', params: { division: TEMPO_RATE['2 battute'], amount: 70 } },
    { name: 'Pan in ottavi', params: { division: TEMPO_RATE['1/8'], shape: LFO_SHAPE.triangle, amount: 60 } },
    { name: 'Tremolo', params: { stereo: 0, division: TEMPO_RATE['1/16'], amount: 60 } },
    { name: 'Tremolo vintage', params: { stereo: 0, sync: AUTO_PAN_SYNC.hz, rate: 5, amount: 45 } },
    { name: 'Rimbalzi a quadra', params: { shape: LFO_SHAPE.square, division: TEMPO_RATE['1/8'], amount: 80 } },
    { name: 'Pan casuale', params: { shape: LFO_SHAPE.smoothRandom, division: TEMPO_RATE['1/4'], amount: 70 } },
  ],
};
