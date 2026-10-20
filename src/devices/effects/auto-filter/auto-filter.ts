/* "Auto Filter": come l'Auto Filter di Live. Un filtro risonante (passa-basso, passa-alto,
 * passa-banda o notch, a 12 o 24 dB, con un po' di drive prima) il cui cutoff si muove da solo:
 * con un LFO a tempo agganciato alla battuta (il wobble, il filtro che respira con il brano) e
 * con l'inviluppo del suono (si apre sui colpi, l'auto-wah). Col sidechain l'inviluppo ascolta
 * un'altra traccia: la cassa che apre o chiude il filtro del basso. Qui c'è solo la
 * descrizione; il suono è in auto-filter-core.ts. */
import type { DeviceType } from '../../device-type';
import { FILTER_SLOPES, FILTER_TYPE, FILTER_TYPES } from '../../dsp/multimode-filter';
import { LFO_SHAPE, LFO_SHAPES } from '../../dsp/lfo';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const AUTO_FILTER_SYNC = { tempo: 0, hz: 1 } as const;

/** Di quante ottave si sposta il cutoff, sopra e sotto, con l'LFO al 100%. */
export const LFO_OCTAVES = 4;
/** Di quante ottave si apre (o si chiude) il cutoff con l'inviluppo al ±100% e un suono a 0 dB. */
export const ENV_OCTAVES = 6;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const AUTO_FILTER: DeviceType = {
  type: 'autoFilter',
  label: 'Auto Filter',
  sidechain: true,
  sections: [
    {
      label: 'Filtro',
      params: [
        choice('type', 'Tipo', FILTER_TYPES),
        choice('slope', 'Pendenza', FILTER_SLOPES),
        num('freq', 'Frequenza', 20, 20000, 2000, 'Hz', { scale: 'log', step: 1 }),
        num('resonance', 'Risonanza', 0, 100, 20, '%', { step: 1 }),
        num('drive', 'Drive', 0, 24, 0, 'dB', { step: 0.1 }),
      ],
    },
    {
      label: 'LFO',
      params: [
        num('lfoAmount', 'Quantità', 0, 100, 0, '%', { step: 1 }),
        choice('lfoShape', 'Onda', LFO_SHAPES),
        choice('lfoSync', 'Sincro', ['Tempo', 'Hz']),
        choice('lfoDivision', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'lfoSync', is: AUTO_FILTER_SYNC.tempo } }),
        num('lfoRate', 'Velocità', 0.01, 20, 1, 'Hz', { scale: 'log', step: 0.01, when: { param: 'lfoSync', is: AUTO_FILTER_SYNC.hz } }),
        num('lfoPhase', 'Fase', 0, 360, 0, '°', { step: 1 }),
        num('lfoStereo', 'Stereo', 0, 180, 0, '°', { step: 1 }),
      ],
    },
    {
      label: 'Inviluppo',
      params: [
        num('envAmount', 'Quantità', -100, 100, 0, '%', { step: 1 }),
        num('envAttack', 'Attacco', 0.1, 100, 6, 'ms', { scale: 'log', step: 0.1 }),
        num('envRelease', 'Rilascio', 10, 2000, 200, 'ms', { scale: 'log', step: 1 }),
      ],
    },
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
    { name: 'Wobble 1/8', params: { freq: 400, resonance: 55, slope: 1, drive: 6, lfoAmount: 60, lfoShape: LFO_SHAPE.sine, lfoDivision: TEMPO_RATE['1/8'] } },
    { name: 'Apertura di 4 battute', params: { freq: 300, resonance: 35, slope: 1, lfoAmount: 70, lfoShape: LFO_SHAPE.sawUp, lfoDivision: TEMPO_RATE['4 battute'] } },
    { name: 'Respiro', params: { type: FILTER_TYPE.highPass, freq: 150, resonance: 25, lfoAmount: 35, lfoShape: LFO_SHAPE.triangle, lfoDivision: TEMPO_RATE['2 battute'], lfoStereo: 90 } },
    { name: 'Auto-wah', params: { type: FILTER_TYPE.bandPass, freq: 350, resonance: 60, envAmount: 70, envAttack: 4, envRelease: 120 } },
    { name: 'Gradini casuali', params: { freq: 900, resonance: 45, lfoAmount: 45, lfoShape: LFO_SHAPE.sampleHold, lfoDivision: TEMPO_RATE['1/16'] } },
    { name: 'Telefono', params: { type: FILTER_TYPE.bandPass, slope: 1, freq: 1600, resonance: 10, drive: 9 } },
  ],
};
