/* "Riverbero": una stanza, una sala o una coda lunga per lanciare voci e rullanti. Dimensione
 * e decadimento separati (come nei riverberi algoritmici da studio), pre-delay per staccare la
 * coda dal colpo, smorzamento degli alti (le pareti assorbono le frequenze alte prima), taglio
 * dei bassi sulla coda (che non impasti), larghezza stereo e mix. Il suono è in reverb-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const MAX_PREDELAY_MS = 250;

export const REVERB: DeviceType = {
  type: 'reverb',
  label: 'Riverbero',
  sections: [
    {
      label: 'Spazio',
      params: [
        num('size', 'Dimensione', 10, 100, 60, '%', { step: 1 }),
        num('decay', 'Decadimento', 0.2, 20, 2.2, 's', { scale: 'log', step: 0.01 }),
        num('predelay', 'Pre-delay', 0, MAX_PREDELAY_MS, 20, 'ms', { step: 1 }),
        num('diffusion', 'Diffusione', 0, 100, 70, '%', { step: 1 }),
      ],
    },
    {
      label: 'Colore',
      params: [
        num('damping', 'Smorzamento', 1000, 20000, 7000, 'Hz', { scale: 'log', step: 1 }),
        num('lowCut', 'Low cut', 20, 1000, 150, 'Hz', { scale: 'log', step: 1 }),
        num('width', 'Larghezza', 0, 100, 100, '%', { step: 1 }),
      ],
    },
    { label: 'Uscita', params: [num('mix', 'Dry/Wet', 0, 100, 25, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Stanza', params: { size: 30, decay: 0.7, predelay: 5, damping: 9000, mix: 18 } },
    { name: 'Sala', params: { size: 75, decay: 2.8, predelay: 25, damping: 6000, mix: 25 } },
    { name: 'Piatto', params: { size: 55, decay: 1.6, predelay: 10, diffusion: 90, damping: 12000, lowCut: 250, mix: 22 } },
    { name: 'Lancio voce', params: { size: 85, decay: 4.5, predelay: 60, damping: 5000, lowCut: 300, mix: 35 } },
    { name: 'Coda infinita', params: { size: 100, decay: 18, predelay: 0, damping: 4000, lowCut: 200, mix: 50 } },
  ],
};
