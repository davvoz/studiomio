/* "Gate": il trance gate. Un pattern di step (fino a 32) a tempo, agganciato alla battuta: ogni
 * step apre il suono al suo livello (0 = chiuso) per la parte dello step data da "Gate", con
 * attacco e rilascio per non fare click; lo swing ritarda gli step dispari. "Profondità" dice
 * quanto chiude: a 100% il silenzio, meno lascia passare un po' di suono (un tremolo a step).
 * Gli step si disegnano nel pannello (ui/device/gate); qui c'è solo la descrizione, il suono
 * è in gate-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const MAX_STEPS = 32;

/** Quanto è lungo uno step, in quarti. */
export const STEP_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['1/4', 1], ['1/8', 1 / 2], ['1/8T', 1 / 3], ['1/16', 1 / 4], ['1/16T', 1 / 6], ['1/32', 1 / 8],
];

/** Il parametro del livello dello step `i` (da 0). */
export const stepParam = (i: number) => `step${i + 1}`;

/** Un pattern scritto con "x" (aperto), "o" (a metà) e "." (chiuso): i livelli dei suoi step. */
export function pattern(text: string): Record<string, number> {
  const steps = text.replace(/\s/g, '');
  return Object.fromEntries(Array.from({ length: MAX_STEPS }, (_, i) => {
    const c = steps[i % steps.length];
    return [stepParam(i), c === 'x' ? 100 : c === 'o' ? 50 : 0];
  }));
}

/** Il pattern di partenza: il classico trance gate in sedicesimi. */
const INIT = pattern('x.xx .xx. x.xx .x.x');

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

const rate = (label: string) => STEP_RATES.findIndex(([l]) => l === label);

export const GATE: DeviceType = {
  type: 'gate',
  label: 'Gate',
  sections: [
    {
      label: 'Pattern',
      params: [
        choice('rate', 'Velocità', STEP_RATES.map(([l]) => l), rate('1/16')),
        num('length', 'Passi', 1, MAX_STEPS, 16, '', { step: 1 }),
        num('swing', 'Swing', 0, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Step',
      params: [
        num('gate', 'Gate', 5, 100, 75, '%', { step: 1 }),
        num('attack', 'Attacco', 0.5, 50, 1, 'ms', { scale: 'log', step: 0.1 }),
        num('release', 'Rilascio', 0.5, 500, 20, 'ms', { scale: 'log', step: 0.1 }),
        num('depth', 'Profondità', 0, 100, 100, '%', { step: 1 }),
      ],
    },
    {
      label: 'Passi',
      params: Array.from({ length: MAX_STEPS }, (_, i) =>
        num(stepParam(i), `Passo ${i + 1}`, 0, 100, INIT[stepParam(i)], '%', { step: 1, hidden: true })),
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Ottavi', params: { ...pattern('x'), rate: rate('1/8'), gate: 50 } },
    { name: 'Sedicesimi staccati', params: { ...pattern('x'), gate: 35, release: 8 } },
    { name: 'Galoppo', params: { ...pattern('x.xx'), gate: 60 } },
    { name: 'Swing', params: { ...pattern('x.xx x.x. xx.x x.xo'), swing: 55, gate: 65 } },
    { name: 'Terzine', params: { ...pattern('x.x x.. x.x .xx'), length: 12, rate: rate('1/16T'), gate: 70 } },
    { name: 'Tremolo a step', params: { ...pattern('xo'), depth: 60, attack: 8, release: 60, gate: 100 } },
    { name: 'Respiro di 1/4', params: { ...pattern('x...'), rate: rate('1/32'), length: 8, gate: 100, attack: 2, release: 120 } },
  ],
};
