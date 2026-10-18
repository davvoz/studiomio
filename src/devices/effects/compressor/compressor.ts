/* "Compressore": abbassa il volume quando il suono supera la soglia, di quanto dice il
 * rapporto, con ginocchio morbido. Per tenere insieme un bus (colla), dare punch a una
 * batteria (attacco lento: il colpo passa, il corpo si schiaccia) o, con il mix, comprimere in
 * parallelo. Il passa-alto sul rilevatore evita che i bassi lo facciano pompare. Con il
 * sidechain il rilevatore ascolta un'altra traccia: la cassa che abbassa il basso. Qui c'è la
 * descrizione; il suono è in compressor-core.ts, la curva (comune a suono e disegno) in
 * compressor-math.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const DETECTORS = ['Picco', 'RMS'] as const;
export const DETECTOR = { peak: 0, rms: 1 } as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const COMPRESSOR: DeviceType = {
  type: 'compressor',
  label: 'Compressore',
  sidechain: true,
  sections: [
    {
      label: 'Curva',
      params: [
        num('threshold', 'Soglia', -60, 0, -18, 'dB', { step: 0.1 }),
        num('ratio', 'Rapporto', 1, 20, 4, ':1', { scale: 'log', step: 0.1 }),
        num('knee', 'Ginocchio', 0, 24, 6, 'dB', { step: 0.1 }),
      ],
    },
    {
      label: 'Tempi',
      params: [
        num('attack', 'Attacco', 0.1, 100, 10, 'ms', { scale: 'log', step: 0.1 }),
        num('release', 'Rilascio', 5, 1000, 120, 'ms', { scale: 'log', step: 1 }),
        choice('detector', 'Rilevatore', DETECTORS),
        num('scHp', 'Passa-alto ril.', 20, 500, 20, 'Hz', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Uscita',
      params: [
        choice('auto', 'Auto gain', ['Off', 'On'], 1),
        num('makeup', 'Guadagno', -12, 24, 0, 'dB', { step: 0.1 }),
        num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Colla', params: { threshold: -14, ratio: 2, knee: 10, attack: 30, release: 150, scHp: 90 } },
    { name: 'Punch batteria', params: { threshold: -20, ratio: 4, knee: 6, attack: 25, release: 80, scHp: 60 } },
    { name: 'Parallela', params: { threshold: -32, ratio: 10, knee: 4, attack: 2, release: 60, mix: 35, makeup: 6 } },
    { name: 'Basso', params: { threshold: -18, ratio: 5, knee: 6, attack: 8, release: 90, detector: DETECTOR.rms } },
    { name: 'Voce', params: { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms } },
    { name: 'Schiaccia', params: { threshold: -36, ratio: 20, knee: 2, attack: 0.3, release: 40, makeup: 4 } },
  ],
};
