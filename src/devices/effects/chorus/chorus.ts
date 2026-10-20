/* "Chorus": copie del suono appena ritardate, con il ritardo che ondeggia piano, così stonano un
 * poco e il suono si allarga. Chorus: due voci in controfase; Ensemble: tre voci sfasate di un
 * terzo di giro, più dense (gli archi dei synth anni '80); Vibrato: una voce sola, senza il
 * suono diritto, e il pitch che oscilla. Il destro ondeggia sfasato (Larghezza) per lo stereo;
 * il feedback rimanda le voci dentro (verso il flanger). L'LFO può andare a tempo, agganciato
 * alla battuta. Qui c'è solo la descrizione; il suono è in chorus-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const CHORUS_MODES = ['Chorus', 'Ensemble', 'Vibrato'] as const;
export const CHORUS_MODE = { chorus: 0, ensemble: 1, vibrato: 2 } as const;
export const CHORUS_SYNC = { tempo: 0, hz: 1 } as const;

/** Quanto ondeggia il ritardo, avanti e indietro, con Profondità al 100%. */
export const MAX_DEPTH_MS = 6;
export const MAX_DELAY_MS = 30;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const CHORUS: DeviceType = {
  type: 'chorus',
  label: 'Chorus',
  sections: [
    {
      label: 'Voci',
      params: [
        choice('mode', 'Modo', CHORUS_MODES),
        num('delay', 'Ritardo', 1, MAX_DELAY_MS, 10, 'ms', { scale: 'log', step: 0.1 }),
        num('feedback', 'Feedback', -90, 90, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Movimento',
      params: [
        choice('sync', 'Sincro', ['Tempo', 'Hz'], CHORUS_SYNC.hz),
        choice('division', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1 battuta'], { when: { param: 'sync', is: CHORUS_SYNC.tempo } }),
        num('rate', 'Velocità', 0.05, 10, 0.8, 'Hz', { scale: 'log', step: 0.01, when: { param: 'sync', is: CHORUS_SYNC.hz } }),
        num('depth', 'Profondità', 0, 100, 40, '%', { step: 1 }),
        num('width', 'Larghezza', 0, 100, 100, '%', { step: 1 }),
      ],
    },
    { label: 'Uscita', params: [num('mix', 'Dry/Wet', 0, 100, 50, '%', { step: 1, when: { param: 'mode', is: [CHORUS_MODE.chorus, CHORUS_MODE.ensemble] } })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Chorus largo', params: { delay: 14, rate: 0.5, depth: 55, mix: 50 } },
    { name: 'Ensemble archi', params: { mode: CHORUS_MODE.ensemble, delay: 9, rate: 0.6, depth: 45, mix: 60 } },
    { name: 'Vibrato', params: { mode: CHORUS_MODE.vibrato, delay: 4, rate: 5.5, depth: 30 } },
    { name: 'Chorus a tempo', params: { sync: CHORUS_SYNC.tempo, division: TEMPO_RATE['2 battute'], depth: 50, mix: 45 } },
    { name: 'Quasi flanger', params: { delay: 3, depth: 60, feedback: 60, rate: 0.25, mix: 50 } },
  ],
};
