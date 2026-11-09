/* "Auto Filter": like Live's Auto Filter. A resonant filter (low-pass, high-pass,
 * band-pass or notch, at 12 or 24 dB, with a bit of drive before it) whose cutoff moves by itself:
 * with a tempo-synced LFO locked to the bar (the wobble, the filter breathing with the track) and
 * with the sound's envelope (it opens on the hits, the auto-wah). With the sidechain the envelope listens to
 * another track: the kick opening or closing the bass's filter. Here there's only the
 * description; the sound is in auto-filter-core.ts. */
import type { DeviceType } from '../../device-type';
import { FILTER_SLOPES, FILTER_TYPE, FILTER_TYPES } from '../../dsp/multimode-filter';
import { LFO_SHAPE, LFO_SHAPES } from '../../dsp/lfo';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const AUTO_FILTER_SYNC = { tempo: 0, hz: 1 } as const;

/** How many octaves the cutoff moves, above and below, with the LFO at 100%. */
export const LFO_OCTAVES = 4;
/** How many octaves the cutoff opens (or closes) with the envelope at ±100% and a 0 dB sound. */
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
      label: 'Filter',
      params: [
        choice('type', 'Type', FILTER_TYPES),
        choice('slope', 'Slope', FILTER_SLOPES),
        num('freq', 'Frequency', 20, 20000, 2000, 'Hz', { scale: 'log', step: 1 }),
        num('resonance', 'Resonance', 0, 100, 20, '%', { step: 1 }),
        num('drive', 'Drive', 0, 24, 0, 'dB', { step: 0.1 }),
      ],
    },
    {
      label: 'LFO',
      params: [
        num('lfoAmount', 'Amount', 0, 100, 0, '%', { step: 1 }),
        choice('lfoShape', 'Wave', LFO_SHAPES),
        choice('lfoSync', 'Sync', ['Tempo', 'Hz']),
        choice('lfoDivision', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'lfoSync', is: AUTO_FILTER_SYNC.tempo } }),
        num('lfoRate', 'Rate', 0.01, 20, 1, 'Hz', { scale: 'log', step: 0.01, when: { param: 'lfoSync', is: AUTO_FILTER_SYNC.hz } }),
        num('lfoPhase', 'Phase', 0, 360, 0, '°', { step: 1 }),
        num('lfoStereo', 'Stereo', 0, 180, 0, '°', { step: 1 }),
      ],
    },
    {
      label: 'Envelope',
      params: [
        num('envAmount', 'Amount', -100, 100, 0, '%', { step: 1 }),
        num('envAttack', 'Attack', 0.1, 100, 6, 'ms', { scale: 'log', step: 0.1 }),
        num('envRelease', 'Release', 10, 2000, 200, 'ms', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Output',
      params: [
        num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 }),
        num('output', 'Output', -24, 12, 0, 'dB', { step: 0.1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Wobble 1/8', params: { freq: 400, resonance: 55, slope: 1, drive: 6, lfoAmount: 60, lfoShape: LFO_SHAPE.sine, lfoDivision: TEMPO_RATE['1/8'] } },
    { name: '4-bar opening', params: { freq: 300, resonance: 35, slope: 1, lfoAmount: 70, lfoShape: LFO_SHAPE.sawUp, lfoDivision: TEMPO_RATE['4 bars'] } },
    { name: 'Breath', params: { type: FILTER_TYPE.highPass, freq: 150, resonance: 25, lfoAmount: 35, lfoShape: LFO_SHAPE.triangle, lfoDivision: TEMPO_RATE['2 bars'], lfoStereo: 90 } },
    { name: 'Auto-wah', params: { type: FILTER_TYPE.bandPass, freq: 350, resonance: 60, envAmount: 70, envAttack: 4, envRelease: 120 } },
    { name: 'Random steps', params: { freq: 900, resonance: 45, lfoAmount: 45, lfoShape: LFO_SHAPE.sampleHold, lfoDivision: TEMPO_RATE['1/16'] } },
    { name: 'Telephone', params: { type: FILTER_TYPE.bandPass, slope: 1, freq: 1600, resonance: 10, drive: 9 } },
  ],
};
