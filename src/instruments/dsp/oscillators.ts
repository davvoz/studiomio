/* Forme d'onda con fase in [0, 1). Dente di sega e quadra usano PolyBLEP: lo scalino viene
 * arrotondato sul campione in cui cade, così le armoniche sopra Nyquist quasi spariscono
 * (niente fischi metallici sulle note acute). */

export type Wave = (phase: number, dt: number) => number;

/** Correzione PolyBLEP attorno a una discontinuità in fase 0; `dt` = incremento di fase. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

const saw: Wave = (t, dt) => 2 * t - 1 - polyBlep(t, dt);
const square: Wave = (t, dt) => (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
const triangle: Wave = t => 1 - 4 * Math.abs(t - 0.5);
const sine: Wave = t => Math.sin(2 * Math.PI * t);

/** Nell'ordine delle opzioni dei parametri "onda" (Saw, Square, Triangle, Sine). */
export const WAVE_TABLE: readonly Wave[] = [saw, square, triangle, sine];

/** Onde dell'LFO (Sine, Triangle, Square), senza correzioni: va lento. */
export const LFO_TABLE: readonly Wave[] = [sine, triangle, t => (t < 0.5 ? 1 : -1)];
