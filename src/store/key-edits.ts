/* The computer keyboard on macros and parameters: giving a key to a target and pressing it.
 * A toggle macro changes at every press; a button is on while the key is down
 * (a change that undoes itself: `holdKey`); a knob jumps from one end to the other. A
 * parameter does the same: a switch or a menu goes to the next choice, a knob goes from the
 * minimum to the maximum and back (as in Live). */
import { clampParam, paramToUnit } from '../devices/params';
import { deviceAt, mappingSpec } from '../devices/rack-params';
import { keyOf, targetsOf, withKey, type KeyTarget } from '../model/key-map';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type Project } from '../model/project';
import { findRack, MACRO_MAX, macroMode, macroOf, springOf, type Macro } from '../model/rack';
import { setEffectParam, setInstrumentParam } from './edits';
import { edit, type Edit, type EditContext } from './project-store';
import { setMacro } from './rack-edits';

/** Gives a key to a target (null: removes it). */
export const setKey = (target: KeyTarget, key: string | null): Edit =>
  edit(key ? 'Map to key' : 'Remove the key', p => {
    if (!p.hasKeyTarget(target)) throw new RangeError('the key\'s target doesn\'t exist');
    return keyOf(p.keyMap, target) === key ? p : p.updatingKeyMap(map => withKey(map, target, key));
  });

/** The pressed key: toggles, knobs and parameters change (one undo step). The
 *  button macros belong to `holdKey`. */
export const pressKey = (key: string): Edit =>
  edit('Key', (p, ctx) => {
    for (const t of targetsOf(p.keyMap, key)) p = press(p, ctx, t);
    return p;
  });

/** The key down or up for the button macros (on only while held) and spring macros (down
 *  pulls it to the end far from rest; released, the spring brings it back). */
export const holdKey = (key: string, down: boolean): Edit =>
  edit('Key', (p, ctx) => {
    for (const t of targetsOf(p.keyMap, key)) p = hold(p, ctx, t, down);
    return p;
  });

/** A button or spring macro held or released (by a key or by a MIDI note). */
export function hold(p: Project, ctx: EditContext, t: KeyTarget, down: boolean): Project {
  const m = macroAt(p, t);
  if (t.kind !== 'macro' || !m) return p;
  if (macroMode(m) === 'button') return setMacro(t.owner, t.rack, t.index, down ? MACRO_MAX : 0).apply(p, ctx);
  const s = springOf(m);
  if (s && down) return setMacro(t.owner, t.rack, t.index, s.rest < MACRO_MAX / 2 ? MACRO_MAX : 0).apply(p, ctx);
  return p;
}

/** The targets' spring macros: whoever holds them (a key, a note) tells the spring. */
export type MacroTarget = Extract<KeyTarget, { kind: 'macro' }>;

export const springTargets = (p: Project, targets: readonly { readonly kind: string }[]): MacroTarget[] =>
  (targets.filter(t => t.kind === 'macro') as MacroTarget[]).filter(t => {
    const m = macroAt(p, t);
    return !!m && !!springOf(m);
  });

export const macroAt = (p: Project, t: KeyTarget): Macro | undefined =>
  (t.kind === 'macro' ? findRack(p.racksOf(t.owner), t.rack)?.macros[t.index] : undefined);

/** A key (or a MIDI note) pressed on a target. */
export function press(p: Project, ctx: EditContext, t: KeyTarget): Project {
  if (t.kind === 'macro') {
    const m = macroAt(p, t);
    if (!m || macroMode(m) === 'button' || macroMode(m) === 'spring') return p;
    return setMacro(t.owner, t.rack, t.index, m.value >= MACRO_MAX / 2 ? 0 : MACRO_MAX).apply(p, ctx);
  }
  // a parameter mapped to a macro is moved by the macro
  if (macroOf(p.racksOf(t.owner), t.device, t.param)) return p;
  const spec = mappingSpec(p, t.owner, t);
  if (!spec) return p;
  const current = clampParam(spec, deviceAt(p, t.owner, t.device)?.params[t.param] ?? spec.default);
  const value = spec.kind === 'choice'
    ? (current + 1) % spec.options.length
    : paramToUnit(spec, current) >= 0.5 ? spec.min : spec.max;
  if (t.device !== INSTRUMENT_DEVICE) return setEffectParam(t.owner, t.device, t.param, value).apply(p, ctx);
  if (t.owner === MASTER) return p;
  return setInstrumentParam(t.owner, t.param, value).apply(p, ctx);
}
