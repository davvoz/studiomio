/* The rack panel's texts and small calculations: what a macro's tooltip says, a spring's rest and
 * return under its knob, the rest dragged up and down. */
import { MACRO_MAX, springTimeLabel, type MacroSpring } from '../../model/rack';

/** The macro's tooltip: what it moves (`moves`: "Device · Parameter"), or how to map it; a spring says how it returns. */
export function macroTitle(label: string, moves: readonly string[], spring: boolean): string {
  const title = moves.length
    ? `${label}: moves ${moves.join(', ')}`
    : `${label}: no mapped parameter (turn on Map, choose the macro and click a parameter)`;
  return spring
    ? `${title}\nSpring: released it returns to rest (↺: drag it up and down) within the return time (click to choose it).`
    : title;
}

/** Under a spring's knob: its rest and its return time. */
export const springTexts = (s: MacroSpring): { readonly rest: string; readonly time: string } =>
  ({ rest: `↺ ${Math.round(s.rest)}`, time: springTimeLabel(s) });

/** The rest dragged by `dy` pixels up (180 px: the whole range; `fine`: 10 times slower), within the macro's range. */
export const draggedRest = (value: number, dy: number, fine: boolean): number =>
  Math.max(0, Math.min(MACRO_MAX, value + (dy * MACRO_MAX / 180) * (fine ? 0.1 : 1)));
