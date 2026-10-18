/* Le curve di Prisma, comuni al motore e al disegno del pannello: la curva di un tratto (degli
 * inviluppi e degli LFO disegnati) e le forme degli LFO. Una forma va da 0 a 1 (unipolare):
 * la matrice la rende bipolare (−1…1) se serve. Un LFO disegnato è una fila di punti, dal
 * primo (sempre all'inizio del giro) all'ultimo (sempre alla fine), uniti da tratti che si
 * possono curvare. Dati puri: girano nell'AudioWorklet e nell'interfaccia. */

/** Punti al massimo in un LFO disegnato. */
export const LFO_POINTS = 16;
/** Campioni della tabella in cui il motore mette la forma di un LFO (un giro). */
export const LFO_TABLE_SIZE = 1024;

export const LFO_SHAPES = ['Seno', 'Triangolo', 'Dente ↑', 'Dente ↓', 'Quadra', 'Disegnata', 'S&H', 'Casuale morbido'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawUp: 2, sawDown: 3, square: 4, drawn: 5, sampleHold: 6, smoothRandom: 7 } as const;

/** Le forme casuali non hanno una tabella: cambiano a ogni giro. */
export const isRandomShape = (shape: number): boolean => shape === LFO_SHAPE.sampleHold || shape === LFO_SHAPE.smoothRandom;

/** Un punto di un LFO disegnato: posizione nel giro e valore in 0…1; `curve` (−100…100) piega
 *  il tratto che parte da qui verso il punto dopo. */
export interface LfoPoint {
  readonly x: number;
  readonly y: number;
  readonly curve: number;
}

/** Quanto è andato avanti un tratto (0…1) dopo `t` (0…1) del suo tempo: con `curve` positiva
 *  corre all'inizio e rallenta alla fine (come una carica o una scarica esponenziale), con la
 *  negativa il contrario; a 0 è una retta. */
export function bend(t: number, curve: number): number {
  if (Math.abs(curve) < 0.5) return t;
  const k = -curve * 0.08;
  return Math.expm1(k * t) / Math.expm1(k);
}

/** I parametri dei punti di un LFO (`l1Pts`, `l1X3`, `l1Y3`, `l1C3`…). */
export const pointParam = (lfo: number, axis: 'X' | 'Y' | 'C', k: number): string => `l${lfo}${axis}${k}`;
export const pointCountParam = (lfo: number): string => `l${lfo}Pts`;

/** I punti di un LFO dai suoi parametri: il primo a x = 0, l'ultimo a x = 1, gli altri in
 *  ordine (a parità di x restano nell'ordine dato: è uno scalino). */
export function pointsOf(values: Readonly<Record<string, number>>, lfo: number): LfoPoint[] {
  const n = Math.max(2, Math.min(LFO_POINTS, Math.round(values[pointCountParam(lfo)] ?? 3)));
  const points: LfoPoint[] = [];
  for (let k = 1; k <= n; k++) {
    const x = k === 1 ? 0 : k === n ? 1 : clamp01(values[pointParam(lfo, 'X', k)] ?? 0.5);
    points.push({ x, y: clamp01(values[pointParam(lfo, 'Y', k)] ?? 0), curve: values[pointParam(lfo, 'C', k)] ?? 0 });
  }
  const inner = points.slice(1, -1).map((p, i) => ({ p, i })).sort((a, b) => a.p.x - b.p.x || a.i - b.i).map(e => e.p);
  return [points[0], ...inner, points[n - 1]];
}

/** I parametri che descrivono `points` per l'LFO `lfo`. */
export function pointValues(lfo: number, points: readonly LfoPoint[]): Record<string, number> {
  const out: Record<string, number> = { [pointCountParam(lfo)]: points.length };
  points.forEach((p, i) => {
    out[pointParam(lfo, 'X', i + 1)] = round3(p.x);
    out[pointParam(lfo, 'Y', i + 1)] = round3(p.y);
    out[pointParam(lfo, 'C', i + 1)] = Math.round(p.curve);
  });
  return out;
}

/** Il valore di un LFO disegnato a `phase` (0…1). */
export function drawnValue(points: readonly LfoPoint[], phase: number): number {
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x <= phase) i++;
  const a = points[i], b = points[i + 1], w = b.x - a.x;
  if (w <= 1e-9) return b.y;
  return a.y + (b.y - a.y) * bend(clamp01((phase - a.x) / w), a.curve);
}

/** Il valore di una forma fissa a `phase` (0…1): partono tutte dal basso, come un inviluppo. */
export function shapeValue(shape: number, phase: number): number {
  switch (shape) {
    case LFO_SHAPE.triangle: return phase < 0.5 ? 2 * phase : 2 - 2 * phase;
    case LFO_SHAPE.sawUp: return phase;
    case LFO_SHAPE.sawDown: return 1 - phase;
    case LFO_SHAPE.square: return phase < 0.5 ? 1 : 0;
    default: return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  }
}

/** Una forma fissa come punti, per cominciare a disegnare da lì. Il seno è fatto di quattro
 *  tratti curvi: gli somiglia molto. */
export function pointsForShape(shape: number): LfoPoint[] {
  const p = (x: number, y: number, curve = 0): LfoPoint => ({ x, y, curve });
  switch (shape) {
    case LFO_SHAPE.triangle: return [p(0, 0), p(0.5, 1), p(1, 0)];
    case LFO_SHAPE.sawUp: return [p(0, 0), p(1, 1)];
    case LFO_SHAPE.sawDown: return [p(0, 1), p(1, 0)];
    case LFO_SHAPE.square: return [p(0, 1), p(0.5, 1), p(0.5, 0), p(1, 0)];
    case LFO_SHAPE.sine: return [p(0, 0, -45), p(0.25, 0.5, 45), p(0.5, 1, -45), p(0.75, 0.5, 45), p(1, 0)];
    default: return [p(0, 0), p(0.5, 1), p(1, 0)];
  }
}

/** Riempie `out` con un giro della forma (fissa o disegnata). */
export function fillShape(out: Float32Array, shape: number, points: readonly LfoPoint[]): void {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const phase = i / n;
    out[i] = shape === LFO_SHAPE.drawn ? drawnValue(points, phase) : shapeValue(shape, phase);
  }
}

/** Un numero a caso in 0…1 fisso per ogni intero (S&H: lo stesso giro dà lo stesso valore). */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

/** Il valore di una forma casuale nel giro `cycle` a `phase`: S&H tiene il valore del giro,
 *  quello morbido scivola (coseno) verso il valore del giro dopo. */
export function randomValue(shape: number, cycle: number, phase: number): number {
  const a = hash01(cycle);
  if (shape !== LFO_SHAPE.smoothRandom) return a;
  const t = 0.5 - 0.5 * Math.cos(Math.PI * phase);
  return a + (hash01(cycle + 1) - a) * t;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round3 = (x: number) => Math.round(x * 1000) / 1000;
