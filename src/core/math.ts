/* Small numeric helpers shared by the engine, the worklets and the UI. Pure: no DOM, no Web Audio. */

/** `x` held inside 0..1. */
export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** `x` held inside −1..1. */
export const clamp11 = (x: number): number => Math.min(1, Math.max(-1, x));

/** The sign to print before a magnitude: '+', '−' (the typographic minus) or nothing for zero. */
export function signGlyph(v: number): string {
  if (v > 0) return '+';
  if (v < 0) return '−';
  return '';
}

/** The value of the first `[threshold, value]` pair whose threshold `x` exceeds, otherwise `fallback`
 *  (thresholds from the largest down, e.g. a grid step that shrinks with the zoom). */
export function pickAbove(x: number, steps: readonly (readonly [number, number])[], fallback: number): number {
  return steps.find(([threshold]) => x > threshold)?.[1] ?? fallback;
}

/** "1 curve", "3 curves": `n` and the noun, plural with an s. */
export const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
