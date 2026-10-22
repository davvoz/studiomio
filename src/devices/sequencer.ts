/* Il sequencer a passi degli strumenti a una voce (Analog, Neuro), come quello di una 303 che si
 * scrive da solo. Acceso, lo strumento non suona le note che riceve: finché una nota è tenuta
 * suona un giro di passi a tempo con la battuta, trasposto su quella nota (la clip tiene le note
 * lunghe: la tonica, gli accordi del giro). Il giro nasce da un numero (Pattern) e le manopole
 * dicono quanto è pieno, quanto si allarga in altezza, quanti accenti e slide: girandole il
 * giro cambia restando lo stesso (a Densità più alta si aggiungono note, non se ne spostano).
 * Qui c'è la descrizione dei parametri; il suono è in dsp/step-sequencer.ts. */
import type { ChoiceParam, NumberParam, ParamSection } from './params';

/** Le velocità dei passi: battiti per passo. */
export const SEQ_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['1/8', 0.5], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125],
];

/** Le scale: intervalli dalla nota tenuta in ordine di importanza. Con Altezza a 0 suona solo
 *  il primo (la tonica); salendo entrano gli altri, nell'ordine. */
export const SEQ_SCALES: readonly (readonly [label: string, intervals: readonly number[]])[] = [
  // la tonica, l'ottava e la seconda bemolle, poi la quinta e il resto del frigio
  ['Frigio', [0, 12, 1, 7, 3, 10, 13, 8, 5, 15, 19, 24]],
  // il motivo di brehho23: tonica, seconda bemolle e tritono
  ['Frigio e tritono', [0, 12, 1, 6, 3, 13, 7, 10, 18, 15, -12, 24]],
  ['Minore', [0, 12, 7, 3, 10, 5, 8, 15, 2, 19, 14, 24]],
  // la tonica che martella su e giù d'ottava
  ['Ottave', [0, 12, 0, 24, -12, 12]],
  ['Quinte', [0, 7, 12, 19, -5, 24, 0, 7]],
];

/** Il primo, il secondo… valore di SEQ_SCALES per nome. */
export const SEQ_SCALE = Object.fromEntries(SEQ_SCALES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;
export const SEQ_RATE = Object.fromEntries(SEQ_RATES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;

/** Quanti pattern diversi (il parametro Pattern va da 0 a SEQ_PATTERNS − 1). */
export const SEQ_PATTERNS = 128;
/** Quanti passi al massimo in un giro. */
export const SEQ_MAX_STEPS = 32;

const ON = { param: 'seqOn', is: 1 } as const;
const num = (id: string, label: string, min: number, max: number, def: number, unit = '', step?: number): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...(step ? { step } : {}), when: ON });
const choice = (id: string, label: string, options: readonly string[], def: number): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, when: ON });

export const SEQUENCER_SECTION: ParamSection = {
  label: 'Sequencer',
  params: [
    { kind: 'choice', id: 'seqOn', label: 'Sequencer', options: ['Off', 'On'], default: 0 },
    num('seqPattern', 'Pattern', 0, SEQ_PATTERNS - 1, 0, '', 1),
    num('seqLength', 'Passi', 1, SEQ_MAX_STEPS, 16, '', 1),
    choice('seqRate', 'Velocità', SEQ_RATES.map(([l]) => l), SEQ_RATE['1/16']),
    num('seqDensity', 'Densità', 0, 100, 60, '%', 1),
    choice('seqScale', 'Scala', SEQ_SCALES.map(([l]) => l), SEQ_SCALE.Frigio),
    num('seqRange', 'Altezza', 0, 100, 30, '%', 1),
    num('seqOctave', 'Ottava', -2, 2, 0, '', 1),
    num('seqAccent', 'Accenti', 0, 100, 30, '%', 1),
    num('seqSlide', 'Slide', 0, 100, 20, '%', 1),
    num('seqGate', 'Gate', 10, 100, 55, '%', 1),
    choice('seqKick', 'Battere', ['Suona', 'Lascia alla cassa'], 0),
  ],
};
