/* La tastiera del computer sulle macro e sui parametri: dare un tasto a un bersaglio e premerlo.
 * Una macro interruttore cambia a ogni pressione; una pulsante è accesa finché il tasto è giù
 * (un cambio che si disfa da solo: `holdKey`); una manopola salta da un capo all'altro. Un
 * parametro fa lo stesso: un interruttore o un menu passa alla scelta dopo, una manopola va dal
 * minimo al massimo e ritorno (come in Live). */
import { clampParam, paramToUnit } from '../devices/params';
import { deviceAt, mappingSpec } from '../devices/rack-params';
import { keyOf, targetsOf, withKey, type KeyTarget } from '../model/key-map';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type Project } from '../model/project';
import { findRack, MACRO_MAX, macroMode, macroOf, springOf, type Macro } from '../model/rack';
import { setEffectParam, setInstrumentParam } from './edits';
import { edit, type Edit, type EditContext } from './project-store';
import { setMacro } from './rack-edits';

/** Dà un tasto a un bersaglio (null: lo toglie). */
export const setKey = (target: KeyTarget, key: string | null): Edit =>
  edit(key ? 'Mappa sul tasto' : 'Togli il tasto', p => {
    if (!p.hasKeyTarget(target)) throw new RangeError('il bersaglio del tasto non c\'è');
    return keyOf(p.keyMap, target) === key ? p : p.updatingKeyMap(map => withKey(map, target, key));
  });

/** Il tasto premuto: interruttori, manopole e parametri cambiano (un passo di annullamento). Le
 *  macro pulsante sono di `holdKey`. */
export const pressKey = (key: string): Edit =>
  edit('Tasto', (p, ctx) => {
    for (const t of targetsOf(p.keyMap, key)) p = press(p, ctx, t);
    return p;
  });

/** Il tasto giù o su per le macro pulsante (accese solo mentre lo si tiene) e molla (giù la
 *  tira fino al capo lontano dal riposo; lasciata, la riporta la molla). */
export const holdKey = (key: string, down: boolean): Edit =>
  edit('Tasto', (p, ctx) => {
    for (const t of targetsOf(p.keyMap, key)) p = hold(p, ctx, t, down);
    return p;
  });

/** Una macro pulsante o molla tenuta o lasciata (da un tasto o da una nota MIDI). */
export function hold(p: Project, ctx: EditContext, t: KeyTarget, down: boolean): Project {
  const m = macroAt(p, t);
  if (t.kind !== 'macro' || !m) return p;
  if (macroMode(m) === 'button') return setMacro(t.owner, t.rack, t.index, down ? MACRO_MAX : 0).apply(p, ctx);
  const s = springOf(m);
  if (s && down) return setMacro(t.owner, t.rack, t.index, s.rest < MACRO_MAX / 2 ? MACRO_MAX : 0).apply(p, ctx);
  return p;
}

/** Le macro molla dei bersagli: chi le tiene (un tasto, una nota) lo dice alla molla. */
export type MacroTarget = Extract<KeyTarget, { kind: 'macro' }>;

export const springTargets = (p: Project, targets: readonly { readonly kind: string }[]): MacroTarget[] =>
  (targets.filter(t => t.kind === 'macro') as MacroTarget[]).filter(t => {
    const m = macroAt(p, t);
    return !!m && !!springOf(m);
  });

export const macroAt = (p: Project, t: KeyTarget): Macro | undefined =>
  (t.kind === 'macro' ? findRack(p.racksOf(t.owner), t.rack)?.macros[t.index] : undefined);

/** Un tasto (o una nota MIDI) premuto su un bersaglio. */
export function press(p: Project, ctx: EditContext, t: KeyTarget): Project {
  if (t.kind === 'macro') {
    const m = macroAt(p, t);
    if (!m || macroMode(m) === 'button' || macroMode(m) === 'spring') return p;
    return setMacro(t.owner, t.rack, t.index, m.value >= MACRO_MAX / 2 ? 0 : MACRO_MAX).apply(p, ctx);
  }
  // un parametro mappato su una macro lo muove la macro
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
