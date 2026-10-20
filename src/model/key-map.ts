/* La tastiera del computer sui dispositivi, come il Key Map di Live: un tasto muove una macro di
 * un rack o un parametro di uno strumento o di un effetto. Un tasto può muoverne più di uno;
 * ognuno ha al più un tasto. Le mappature sono del progetto (si salvano e si annullano); quelle
 * di un rack o di un dispositivo che non c'è più restano scritte ma non valgono (un "Annulla"
 * che li riporta riporta anche il tasto) e non si salvano. */
import type { DeviceId } from '../core/id';
import type { ChainOwner } from './project';
import { MACRO_COUNT, type DeviceKey } from './rack';

export type KeyTarget =
  | { readonly kind: 'macro'; readonly owner: ChainOwner; readonly rack: DeviceId; readonly index: number }
  | { readonly kind: 'param'; readonly owner: ChainOwner; readonly device: DeviceKey; readonly param: string };

export interface KeyMapping {
  /** KeyboardEvent.code: il tasto fisico, uguale su ogni disposizione (es. "KeyQ", "Digit1"). */
  readonly key: string;
  readonly target: KeyTarget;
}

export type KeyMap = readonly KeyMapping[];

/** Nessuna mappatura (sempre la stessa lista: le modifiche si riconoscono dal riferimento). */
export const NO_KEYS: KeyMap = Object.freeze([]);

export const sameTarget = (a: KeyTarget, b: KeyTarget): boolean =>
  a.owner === b.owner && (a.kind === 'macro'
    ? b.kind === 'macro' && a.rack === b.rack && a.index === b.index
    : b.kind === 'param' && a.device === b.device && a.param === b.param);

/** Il tasto di un bersaglio, o null. */
export const keyOf = (map: KeyMap, target: KeyTarget): string | null =>
  map.find(m => sameTarget(m.target, target))?.key ?? null;

/** I bersagli di un tasto. */
export const targetsOf = (map: KeyMap, key: string): KeyTarget[] =>
  map.filter(m => m.key === key).map(m => m.target);

/** Dà a un bersaglio un tasto (null: lo toglie); il tasto di prima non lo muove più. */
export function withKey(map: KeyMap, target: KeyTarget, key: string | null): KeyMap {
  const kept = map.filter(m => !sameTarget(m.target, target));
  if (key === null) return kept.length === map.length ? map : kept;
  if (keyOf(map, target) === key) return map;
  return [...kept, { key, target }];
}

/** Toglie i tasti dei parametri di un dispositivo (es. lo strumento cambiato: i parametri sono altri). */
export const withoutParamKeysOf = (map: KeyMap, owner: ChainOwner, device: DeviceKey): KeyMap => {
  const kept = map.filter(m => m.target.kind !== 'param' || m.target.owner !== owner || m.target.device !== device);
  return kept.length === map.length ? map : kept;
};

/** Le regole: un tasto, un bersaglio con una macro che esiste, nessun bersaglio due volte. */
export function checkKeyMap(map: KeyMap): void {
  map.forEach((m, i) => {
    if (!m.key) throw new Error('una mappatura della tastiera senza tasto');
    if (m.target.kind === 'macro' && !(Number.isInteger(m.target.index) && m.target.index >= 0 && m.target.index < MACRO_COUNT)) {
      throw new RangeError(`il tasto ${m.key} muove la macro ${m.target.index + 1}, che non c'è`);
    }
    if (map.findIndex(x => sameTarget(x.target, m.target)) !== i) throw new Error(`il tasto ${m.key} è su un bersaglio che ha già un tasto`);
  });
}

/** Il nome di un tasto come si mostra: "Q", "1", "Num 1", "F5"… */
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
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Insert: 'Ins', Home: 'Home', End: 'Fine', PageUp: 'Pag↑', PageDown: 'Pag↓',
};
