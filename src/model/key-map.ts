/* The computer keyboard on the devices, like Live's Key Map: a key moves a rack's
 * macro or a parameter of an instrument or an effect. A key can move more than one;
 * each has at most one key. The mappings belong to the project (they're saved and undone); those
 * of a rack or a device that's gone stay written but don't apply (an "Undo"
 * bringing them back brings back the key too) and aren't saved. */
import type { DeviceId } from '../core/id';
import type { ChainOwner } from './project';
import { MACRO_COUNT, type DeviceKey } from './rack';

export type KeyTarget =
  | { readonly kind: 'macro'; readonly owner: ChainOwner; readonly rack: DeviceId; readonly index: number }
  | { readonly kind: 'param'; readonly owner: ChainOwner; readonly device: DeviceKey; readonly param: string };

export interface KeyMapping {
  /** KeyboardEvent.code: the physical key, the same on every layout (e.g. "KeyQ", "Digit1"). */
  readonly key: string;
  readonly target: KeyTarget;
}

export type KeyMap = readonly KeyMapping[];

/** No mappings (always the same list: changes are recognized by reference). */
export const NO_KEYS: KeyMap = Object.freeze([]);

export const sameTarget = (a: KeyTarget, b: KeyTarget): boolean =>
  a.owner === b.owner && (a.kind === 'macro'
    ? b.kind === 'macro' && a.rack === b.rack && a.index === b.index
    : b.kind === 'param' && a.device === b.device && a.param === b.param);

/** A target's key, or null. */
export const keyOf = (map: KeyMap, target: KeyTarget): string | null =>
  map.find(m => sameTarget(m.target, target))?.key ?? null;

/** A key's targets. */
export const targetsOf = (map: KeyMap, key: string): KeyTarget[] =>
  map.filter(m => m.key === key).map(m => m.target);

/** Gives a target a key (null: removes it); the previous key no longer moves it. */
export function withKey(map: KeyMap, target: KeyTarget, key: string | null): KeyMap {
  const kept = map.filter(m => !sameTarget(m.target, target));
  if (key === null) return kept.length === map.length ? map : kept;
  if (keyOf(map, target) === key) return map;
  return [...kept, { key, target }];
}

/** Removes the keys of a device's parameters (e.g. the instrument changed: the parameters are different). */
export const withoutParamKeysOf = (map: KeyMap, owner: ChainOwner, device: DeviceKey): KeyMap => {
  const kept = map.filter(m => m.target.kind !== 'param' || m.target.owner !== owner || m.target.device !== device);
  return kept.length === map.length ? map : kept;
};

/** The rules: a key, a target with a macro that exists, no target twice. */
export function checkKeyMap(map: KeyMap): void {
  map.forEach((m, i) => {
    if (!m.key) throw new Error('a keyboard mapping without a key');
    if (m.target.kind === 'macro' && !(Number.isInteger(m.target.index) && m.target.index >= 0 && m.target.index < MACRO_COUNT)) {
      throw new RangeError(`key ${m.key} moves macro ${m.target.index + 1}, which doesn't exist`);
    }
    if (map.findIndex(x => sameTarget(x.target, m.target)) !== i) throw new Error(`key ${m.key} is on a target that already has a key`);
  });
}

/** A key's name as it's shown: "Q", "1", "Num 1", "F5"… */
export function keyLabel(code: string): string {
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1];
  const num = /^Numpad(.+)$/.exec(code);
  if (num) return `Num ${NUMPAD[num[1]] ?? num[1]}`;
  return SPECIAL[code] ?? code;
}

const NUMPAD: Record<string, string> = { Add: '+', Subtract: '−', Multiply: '×', Divide: '÷', Decimal: ',' };
const SPECIAL: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\', IntlBackslash: '<',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};
