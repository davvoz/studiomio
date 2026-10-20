/* Un LFO che, a tempo e con il trasporto che va, si aggancia alla battuta: la sua posizione si
 * calcola dal battito della timeline, non da quando il dispositivo è partito. Così un giro di
 * 1/4 comincia sempre sul quarto, anche dopo un salto, a ogni giro di loop e nell'export, e lo
 * stesso punto del brano dà sempre lo stesso valore (anche nelle onde casuali). Da fermo, o in
 * Hz, gira libero. Puro: niente Web Audio, si prova in Node. */
import type { TransportPosition } from './core';

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↓', 'Saw ↑', 'Square', 'S&H', 'S&H morbido'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawDown: 2, sawUp: 3, square: 4, sampleHold: 5, smoothRandom: 6 } as const;

/** Un valore casuale in −1..1 per il giro `cycle` (sempre lo stesso per lo stesso giro e seme). */
export function cycleRandom(cycle: number, seed = 0): number {
  let h = (Math.floor(cycle) ^ Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h / 0x80000000;
}

/** Le onde, da −1 a 1, alla fase `p` (0..1) del giro `k`: il seno e il triangolo partono da 0
 *  e salgono, i denti di sega e l'onda quadra dagli estremi. */
const WAVES: readonly ((p: number, k: number, seed: number) => number)[] = [
  p => Math.sin(2 * Math.PI * p),
  p => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4),
  p => 1 - 2 * p,
  p => 2 * p - 1,
  p => (p < 0.5 ? 1 : -1),
  (_p, k, s) => cycleRandom(k, s),
  (p, k, s) => {
    const a = cycleRandom(k - 1, s), b = cycleRandom(k, s);
    return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * p));
  },
];

/** Il valore dell'onda `shape` dopo `cycles` giri (la parte intera dice quale giro, la
 *  frazione dove dentro il giro). */
export function lfoAt(shape: number, cycles: number, seed = 0): number {
  const k = Math.floor(cycles);
  return (WAVES[shape] ?? WAVES[0])(cycles - k, k, seed);
}

/** Come gira un LFO in questo blocco: `beats` quarti per giro (a tempo) o `hz` giri al secondo. */
export interface LfoRate {
  readonly beats: number | null;
  readonly hz: number;
}

/** Dove si trova un LFO, in giri. A ogni blocco `start` lo riallinea alla battuta (se è a
 *  tempo e il trasporto va) o lo lascia correre; `next` avanza di un campione. */
export class LfoClock {
  /** I giri fatti: la frazione è la fase. */
  cycles = 0;
  private step = 0;

  constructor(private readonly sampleRate: number) {}

  start(rate: LfoRate, transport: TransportPosition | null, bpm: number): void {
    if (rate.beats !== null && transport) {
      this.cycles = transport.beat / rate.beats;
      this.step = transport.bpm / 60 / rate.beats / this.sampleRate;
      return;
    }
    const hz = rate.beats !== null ? bpm / 60 / rate.beats : rate.hz;
    this.step = hz / this.sampleRate;
  }

  next(): void {
    this.cycles += this.step;
  }
}
