/* Le forme pronte di una modulazione: un'onda scritta come punti nel tratto [from, to]. Una curva
 * fa solo rette e scalini, quindi quelle tonde sono spezzate fitte. Un ciclo si ripete fino a
 * riempire il tratto; l'ultimo, se non ci sta tutto, si taglia. */
import type { Beats } from '../../core/music-time';
import { MOD_SCALES, type EnvelopePoint, type ModScale } from '../../model/envelope';

export type ShapeId = 'sine' | 'triangle' | 'rampUp' | 'rampDown' | 'square' | 'pump' | 'steps' | 'drift';

/** Cosa mettere nel tratto. */
export interface ShapeChoice {
  readonly shape: ShapeId;
  /** Durata di un ciclo; 0: un solo ciclo su tutto il tratto. */
  readonly cycle: Beats;
  /** Quanta parte della scala usa, da 0 a 1. */
  readonly depth: number;
  readonly invert: boolean;
  /** Le forme casuali: lo stesso seme ridà gli stessi valori. */
  readonly seed: number;
}

/** Un punto del ciclo: dove (da 0 a 1) e quanto (da −1 a 1). */
type Knot = readonly [phase: number, level: number];

interface Shape {
  readonly id: ShapeId;
  readonly label: string;
  /** Quanti cicli si vedono nell'icona. */
  readonly icon: number;
  /** Un generatore di cicli: `random` dà valori tra −1 e 1, `detail` dice quanto fitte le tonde. */
  cycles(random: () => number, detail: number): () => readonly Knot[];
}

const fixed = (knots: readonly Knot[]) => () => () => knots;
const curve = (level: (phase: number) => number) => (_: unknown, detail: number) => {
  const knots = Array.from({ length: detail + 1 }, (_, i): Knot => [i / detail, level(i / detail)]);
  return () => knots;
};

export const SHAPES: readonly Shape[] = [
  { id: 'sine', label: 'Sinusoide', icon: 1, cycles: curve(p => Math.sin(2 * Math.PI * p)) },
  { id: 'triangle', label: 'Triangolo', icon: 1, cycles: fixed([[0, 0], [0.25, 1], [0.75, -1], [1, 0]]) },
  { id: 'rampUp', label: 'Rampa su', icon: 1, cycles: fixed([[0, -1], [1, 1]]) },
  { id: 'rampDown', label: 'Rampa giù', icon: 1, cycles: fixed([[0, 1], [1, -1]]) },
  { id: 'square', label: 'Quadra', icon: 1, cycles: fixed([[0, 1], [0.5, 1], [0.5, -1], [1, -1]]) },
  // giù di colpo, poi risale in fretta: come una cassa in sidechain
  { id: 'pump', label: 'Pompa', icon: 2, cycles: curve(p => 1 - 2 * (1 - p) ** 4) },
  {
    id: 'steps', label: 'Scalini casuali', icon: 5,
    cycles: random => () => { const v = random(); return [[0, v], [1, v]]; },
  },
  {
    id: 'drift', label: 'Casuale morbida', icon: 5,
    cycles: random => {
      let a = random();
      return () => { const from = a; a = random(); return [[0, from], [1, a]]; };
    },
  },
];

/** Una forma rotonda ha al massimo tanti punti per ciclo, e al minimo tanti (se i cicli sono molti). */
const DETAIL = { max: 32, min: 6, total: 2048 } as const;
/** La trasposizione ha una scala di 4 ottave: al massimo una forma ne usa una per parte. */
const TRANSPOSE_REACH = 12;
const EPS = 1e-9;

/** Numeri che dipendono solo dal seme (mulberry32), tra −1 e 1. */
function randomFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Dove arriva la forma sulla scala. Il volume ha il neutro in cima: lì usa solo la parte sotto,
 *  tutta intera. */
function reachOf(scale: ModScale, depth: number): { low: number; high: number } {
  const reach = scale === MOD_SCALES.transpose ? TRANSPOSE_REACH : Infinity;
  return {
    low: scale.neutral - Math.min(reach, scale.neutral - scale.min) * depth,
    high: scale.neutral + Math.min(reach, scale.max - scale.neutral) * depth,
  };
}

/** I punti della forma in [from, to], in battiti assoluti. */
export function shapePoints(choice: ShapeChoice, from: Beats, to: Beats, scale: ModScale): EnvelopePoint[] {
  const shape = SHAPES.find(s => s.id === choice.shape)!;
  const length = to - from, cycle = choice.cycle > 0 ? choice.cycle : length;
  const count = Math.ceil(length / cycle - EPS);
  const detail = Math.max(DETAIL.min, Math.min(DETAIL.max, Math.floor(DETAIL.total / count)));
  const { low, high } = reachOf(scale, choice.depth);
  const valueOf = (level: number) => low + (((choice.invert ? -level : level) + 1) / 2) * (high - low);
  const next = shape.cycles(randomFrom(choice.seed), detail);
  const out: EnvelopePoint[] = [];
  for (let i = 0; i < count; i++) {
    for (const [phase, level] of next()) {
      const beat = from + (i + phase) * cycle, value = valueOf(level);
      if (beat <= to + EPS) {
        out.push({ beat: Math.min(beat, to), value });
        continue;
      }
      // il ciclo non ci sta: si taglia alla fine del tratto, sulla retta che stava facendo
      const last = out[out.length - 1];
      out.push({ beat: to, value: last.value + ((value - last.value) * (to - last.beat)) / (beat - last.beat) });
      return out;
    }
  }
  return out;
}
