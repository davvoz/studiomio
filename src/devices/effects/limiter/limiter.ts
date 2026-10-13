/* "Limiter": l'ultimo anello del master. Spinge il suono (Guadagno) e lo tiene sotto il Tetto
 * senza lasciar passare un picco, guardando avanti di qualche millisecondo: il guadagno scende
 * prima che il picco arrivi, quindi niente distorsione sull'attacco. Con "Tra i campioni" misura
 * anche i picchi che il convertitore ricostruisce tra un campione e l'altro (true peak). Il
 * suono è in limiter-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

/** Quanto guarda avanti al massimo (millisecondi): fissa anche il ritardo massimo. */
export const MAX_LOOKAHEAD_MS = 10;

export const LIMITER: DeviceType = {
  type: 'limiter',
  label: 'Limiter',
  sections: [
    {
      label: 'Limiter',
      params: [
        num('gain', 'Guadagno', 0, 24, 0, 'dB', { step: 0.1 }),
        num('ceiling', 'Tetto', -12, 0, -0.3, 'dB', { step: 0.1 }),
        num('release', 'Rilascio', 10, 1000, 80, 'ms', { scale: 'log', step: 1 }),
        num('lookahead', 'Anticipo', 0.5, MAX_LOOKAHEAD_MS, 2, 'ms', { scale: 'log', step: 0.1 }),
        { kind: 'choice', id: 'truePeak', label: 'Tra i campioni', options: ['Off', 'On'], default: 1 },
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Master', params: { gain: 4, ceiling: -0.3, release: 60 } },
    { name: 'Forte', params: { gain: 8, ceiling: -0.3, release: 40, lookahead: 1.5 } },
    { name: 'Trasparente', params: { gain: 2, ceiling: -1, release: 200, lookahead: 5 } },
  ],
};
