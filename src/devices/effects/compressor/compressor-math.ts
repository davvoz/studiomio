/* La curva del compressore: quanto esce (in dB) per quanto entra, con il ginocchio morbido
 * (un raccordo quadratico largo `knee` dB attorno alla soglia). La usano il suono e il disegno. */

export interface Curve {
  readonly threshold: number;
  readonly ratio: number;
  readonly knee: number;
}

/** Il livello in uscita, in dB, per un livello in ingresso `x` dB (senza guadagno d'uscita). */
export function curveDb(c: Curve, x: number): number {
  const over = x - c.threshold, slope = 1 / c.ratio - 1;
  if (2 * over <= -c.knee) return x;
  if (2 * Math.abs(over) < c.knee) {
    const t = over + c.knee / 2;
    return x + (slope * t * t) / (2 * c.knee);
  }
  return x + slope * over;
}

/** Il guadagno di compensazione automatico: rende metà della riduzione che la curva dà a 0 dB
 *  (un compromesso dell'orecchio: a soglie basse alzarla tutta sarebbe troppo). */
export const autoMakeup = (c: Curve): number => -curveDb(c, 0) / 2;
