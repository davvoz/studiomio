/* "Multibanda": compressione su tre bande verso il basso (i picchi scendono) e verso l'alto
 * (i dettagli piani salgono), come l'OTT: il suono denso, vicino e aggressivo della musica
 * elettronica di oggi. Profondità dosa tutto, Tempo allunga attacco e rilascio insieme, e ogni
 * banda ha il suo guadagno. Il suono è in multiband-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number) => num(id, label, 0, 100, def, '%', { step: 1 });

export const MULTIBAND: DeviceType = {
  type: 'multiband',
  label: 'Multibanda',
  sections: [
    {
      label: 'Compressione',
      params: [
        percent('depth', 'Profondità', 50),
        percent('time', 'Tempo', 50),
        percent('upward', 'Verso l\'alto', 100),
        percent('downward', 'Verso il basso', 100),
        num('input', 'Ingresso', -12, 24, 0, 'dB', { step: 0.1 }),
      ],
    },
    {
      label: 'Bande',
      params: [
        num('xLow', 'Taglio basso', 40, 500, 120, 'Hz', { scale: 'log', step: 1 }),
        num('xHigh', 'Taglio alto', 1000, 10000, 2500, 'Hz', { scale: 'log', step: 1 }),
        num('low', 'Basse', -12, 12, 0, 'dB', { step: 0.1 }),
        num('mid', 'Medie', -12, 12, 0, 'dB', { step: 0.1 }),
        num('high', 'Alte', -12, 12, 0, 'dB', { step: 0.1 }),
      ],
    },
    { label: 'Uscita', params: [num('output', 'Uscita', -24, 12, 0, 'dB', { step: 0.1 }), percent('mix', 'Dry/Wet', 100)] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'OTT', params: { depth: 100, time: 50, input: 0, output: 4 } },
    { name: 'Denso', params: { depth: 60, time: 40, output: 2 } },
    { name: 'Lead aggressivo', params: { depth: 80, time: 25, input: 4, high: 2, low: -3, output: 0 } },
    { name: 'Batteria', params: { depth: 45, time: 35, upward: 60, mid: 1, output: 1, mix: 70 } },
    { name: 'Master leggero', params: { depth: 20, time: 60, upward: 50, output: 0 } },
  ],
};
