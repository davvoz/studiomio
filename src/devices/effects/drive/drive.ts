/* "Drive": saturazione e distorsione, da un calore leggero a un fuzz rotto. Pensato per
 * suonare pieno: sei curve (anche asimmetriche, per le armoniche pari), "Colore" per decidere
 * quali frequenze saturano di più, i bassi che possono restare puliti sotto un crossover, il
 * tono, la compensazione del volume e il mix parallelo. Tutto gira sovracampionato (niente
 * aliasing). Qui c'è la descrizione; la curva è in drive-math.ts, il suono in drive-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { SHAPES } from './drive-math';

/** I fattori di sovracampionamento, nell'ordine dei valori del parametro "Qualità". */
export const OVERSAMPLING = [2, 4, 8] as const;

/** Valori della forma per nome. */
export const SHAPE = Object.fromEntries(SHAPES.map((s, i) => [s.id, i])) as Readonly<Record<string, number>>;

const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });

export const DRIVE: DeviceType = {
  type: 'drive',
  label: 'Drive',
  sections: [
    {
      label: 'Saturazione',
      params: [
        choice('shape', 'Forma', SHAPES.map(s => s.label), SHAPE.tube),
        num('drive', 'Drive', 0, 36, 12, 'dB', { step: 0.5 }),
        percent('bias', 'Bias', 0, -100),
        percent('color', 'Colore', 0, -100),
      ],
    },
    {
      label: 'Bassi',
      params: [
        percent('low', 'Bassi puliti', 50),
        num('split', 'Crossover', 40, 400, 120, 'Hz', { scale: 'log' }),
      ],
    },
    {
      label: 'Uscita',
      params: [
        num('tone', 'Tono', 1000, 20000, 16000, 'Hz', { scale: 'log' }),
        choice('auto', 'Auto gain', ['Off', 'On'], 1),
        num('output', 'Uscita', -24, 12, 0, 'dB', { step: 0.5 }),
        percent('mix', 'Dry/Wet', 100),
      ],
    },
    { label: 'Qualità', params: [choice('oversampling', 'Oversampling', OVERSAMPLING.map(f => `${f}×`), 1)] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Calda', params: { shape: SHAPE.tube, drive: 9, bias: 20, color: -20, low: 60, tone: 12000 } },
    { name: 'Nastro', params: { shape: SHAPE.tape, drive: 14, color: -30, low: 40, tone: 11000 } },
    { name: 'Basso 808', params: { shape: SHAPE.tube, drive: 20, bias: 25, low: 75, split: 90, tone: 9000 } },
    { name: 'Batteria parallela', params: { shape: SHAPE.hard, drive: 24, color: 30, low: 30, tone: 14000, mix: 40 } },
    { name: 'Presenza', params: { shape: SHAPE.soft, drive: 8, color: 50, low: 80, mix: 50 } },
    { name: 'Fuzz', params: { shape: SHAPE.fuzz, drive: 28, low: 50, tone: 7000 } },
    { name: 'Rotto', params: { shape: SHAPE.fold, drive: 22, color: 40, low: 60, tone: 10000, mix: 70 } },
  ],
};
