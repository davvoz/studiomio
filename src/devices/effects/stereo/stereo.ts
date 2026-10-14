/* "Stereo": l'Utility di Live per l'immagine. Larghezza (0 % mono, 100 % com'è, fino a 200 %),
 * "Bassi mono" che sotto la frequenza scelta toglie il lato (la differenza tra i canali): il sub
 * e la cassa restano al centro, come vogliono gli impianti dei club e il vinile, mentre sopra il
 * suono resta largo. E un guadagno. Il suono è in stereo-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const bassMono: ChoiceParam = { kind: 'choice', id: 'bassMono', label: 'Bassi mono', options: ['Off', 'On'], default: 1 };

export const STEREO: DeviceType = {
  type: 'stereo',
  label: 'Stereo',
  sections: [
    {
      label: 'Immagine',
      params: [
        num('width', 'Larghezza', 0, 200, 100, '%', { step: 1 }),
        bassMono,
        num('monoFreq', 'Sotto', 40, 400, 120, 'Hz', { scale: 'log', when: { param: 'bassMono', is: 1 } }),
      ],
    },
    { label: 'Uscita', params: [num('gain', 'Guadagno', -24, 12, 0, 'dB', { step: 0.1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Master', params: { monoFreq: 110 } },
    { name: 'Basso mono', params: { monoFreq: 200 } },
    { name: 'Largo', params: { width: 140, monoFreq: 150 } },
    { name: 'Mono', params: { width: 0 } },
  ],
};
