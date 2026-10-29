/** Le saturazioni dell'uscita degli strumenti a strati, nell'ordine delle loro scelte. */
export const DRIVE_TYPES = ['Morbida', 'Dura', 'Ripiegata'] as const;

/** La saturazione `type` (in DRIVE_TYPES), con `amount` 0..1: a 0 il suono è pulito; poi tanh,
 *  taglio netto a ±1, o ripiegamento (oltre il bordo l'onda torna indietro). */
export function driveSample(x: number, amount: number, type: number): number {
  if (amount < 0.005) return x;
  const d = 1 + amount * 9, wet = Math.min(1, amount * 5);
  let y: number;
  if (type === 1) y = Math.max(-1, Math.min(1, x * d));
  else if (type === 2) y = Math.sin((Math.PI / 2) * x * d);
  else y = Math.tanh(x * d) / Math.tanh(d);
  return x + (y - x) * wet;
}

/** Saturazione morbida che tiene il picco a 1 (`amount` 0..1, a 0 pulita). */
export const softClip = (x: number, amount: number): number =>
  (amount < 0.005 ? x : Math.tanh(x * (1 + amount * 6)) / Math.tanh(1 + amount * 6));
