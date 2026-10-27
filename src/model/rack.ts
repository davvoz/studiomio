/* I rack, come in Live: un gruppo di dispositivi consecutivi della catena (con lo strumento è un
 * Instrument Rack, con soli effetti un Audio Effect Rack) con 8 macro. Ogni macro muove i
 * parametri mappati, ciascuno tra il suo minimo e il suo massimo. Il suono non cambia: il rack
 * è un gruppo sopra la catena, che resta una fila sola (niente catene parallele). Qui ci sono i
 * dati e le operazioni pure, sull'ordine dei dispositivi della catena. */
import type { DeviceId } from '../core/id';
import { INSTRUMENT_DEVICE } from './envelope';

/** Un dispositivo della catena: lo strumento o un effetto (per id). */
export type DeviceKey = DeviceId | typeof INSTRUMENT_DEVICE;

export const MACRO_COUNT = 8;
/** Le macro vanno da 0 a 127, come in Live e sulle manopole MIDI. */
export const MACRO_MAX = 127;

export interface MacroMapping {
  readonly device: DeviceKey;
  readonly param: string;
  /** Il valore del parametro con la macro a 0 e a 127 (min > max: la macro lo muove al contrario). */
  readonly min: number;
  readonly max: number;
}

/** Come si suona una macro: manopola (come in Live), interruttore (un clic accende, un altro
 *  spegne), pulsante (acceso solo mentre lo si tiene premuto) o molla (una manopola che, lasciata,
 *  torna da sola al suo riposo). Interruttore e pulsante valgono solo 0 o MACRO_MAX: portano ogni
 *  parametro mappato da un capo all'altro della sua corsa. */
export type MacroMode = 'knob' | 'toggle' | 'button' | 'spring';

export const MACRO_MODES: readonly (readonly [mode: MacroMode, label: string])[] = [
  ['knob', 'Manopola'], ['toggle', 'Interruttore'], ['button', 'Pulsante'], ['spring', 'Molla'],
];

/** Dove torna una macro molla lasciata e in quanto: `time` in battiti se `sync`, se no in
 *  millisecondi (da dovunque sia, sempre nello stesso tempo). */
export interface MacroSpring {
  /** 0 … MACRO_MAX. */
  readonly rest: number;
  readonly time: number;
  readonly sync: boolean;
}

/** I tempi di ritorno tra cui scegliere: a tempo (in battiti) e liberi (in millisecondi). */
export const SPRING_TIMES: readonly (readonly [time: number, sync: boolean, label: string])[] = [
  [0.25, true, '1/16'], [0.5, true, '1/8'], [1, true, '1/4'], [2, true, '1/2'],
  [4, true, '1 battuta'], [8, true, '2 battute'], [16, true, '4 battute'],
  [50, false, '50 ms'], [100, false, '100 ms'], [250, false, '250 ms'], [500, false, '500 ms'],
  [1000, false, '1 s'], [2000, false, '2 s'], [5000, false, '5 s'],
];
export const SPRING_MS_MAX = 60_000;
export const SPRING_BEATS_MAX = 64;

/** Il tempo di ritorno a parole: "1/4", "2 battute", "300 ms". */
export function springTimeLabel({ time, sync }: MacroSpring): string {
  const named = SPRING_TIMES.find(([t, s]) => t === time && s === sync);
  if (named) return named[2];
  if (!sync) return time >= 1000 ? `${+(time / 1000).toFixed(2)} s` : `${Math.round(time)} ms`;
  return time % 4 === 0 ? `${time / 4} battut${time === 4 ? 'a' : 'e'}` : `${+time.toFixed(2)} battiti`;
}

/** Un tempo di ritorno scritto a mano: "300 ms", "1.5 s", "3/16" (di nota), "2 battute",
 *  "3 battiti"; un numero da solo è in millisecondi. null: non si capisce. */
export function parseSpringTime(text: string): { time: number; sync: boolean } | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (fraction) return Number(fraction[2]) > 0 ? { time: (4 * Number(fraction[1])) / Number(fraction[2]), sync: true } : null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secondi?|battut[ae]|bar|battit[oi]|beats?)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]), unit = m[2] ?? 'ms';
  if (!(n > 0)) return null;
  if (unit === 'ms') return { time: n, sync: false };
  if (unit.startsWith('s')) return { time: n * 1000, sync: false };
  if (unit.startsWith('battut') || unit === 'bar') return { time: n * 4, sync: true };
  return { time: n, sync: true };
}

/** Una molla valida (riposo nella corsa, tempo positivo e non enorme). */
export function springFor(rest: number, time: number, sync: boolean): MacroSpring {
  const max = sync ? SPRING_BEATS_MAX : SPRING_MS_MAX;
  const fine = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  return {
    rest: Math.max(0, Math.min(MACRO_MAX, fine(rest, 0))),
    time: Math.max(sync ? 1 / 16 : 1, Math.min(max, fine(time, sync ? 1 : 250))),
    sync,
  };
}

export interface Macro {
  /** null: il nome viene dal primo parametro mappato, o è "Macro N". */
  readonly name: string | null;
  /** 0 … MACRO_MAX. */
  readonly value: number;
  readonly mappings: readonly MacroMapping[];
  /** Assente: manopola. */
  readonly mode?: MacroMode;
  /** Solo delle molle. */
  readonly spring?: MacroSpring;
}

export const macroMode = (m: Macro): MacroMode => m.mode ?? 'knob';

/** La molla di una macro molla (null per gli altri tipi). */
export const springOf = (m: Macro): MacroSpring | null =>
  (macroMode(m) === 'spring' ? m.spring ?? springFor(0, 1, true) : null);

/** Interruttore o pulsante: acceso o spento, niente in mezzo. */
export const isSwitchMacro = (m: Macro): boolean => macroMode(m) === 'toggle' || macroMode(m) === 'button';

/** Il valore che una macro può avere: per interruttore e pulsante, acceso (da metà in su) o spento. */
export function macroValueFor(mode: MacroMode, value: number): number {
  const v = Math.max(0, Math.min(MACRO_MAX, Number.isFinite(value) ? value : 0));
  return mode === 'knob' || mode === 'spring' ? v : v >= MACRO_MAX / 2 ? MACRO_MAX : 0;
}

export interface Rack {
  readonly id: DeviceId;
  /** null: "Instrument Rack" o "Audio Effect Rack". */
  readonly name: string | null;
  /** I dispositivi del rack nell'ordine della catena, sempre di seguito. */
  readonly devices: readonly DeviceKey[];
  readonly macros: readonly Macro[];
}

export type RackList = readonly Rack[];

/** Nessun rack (sempre la stessa lista: le modifiche si riconoscono dal riferimento). */
export const NO_RACKS: RackList = Object.freeze([]);

/** Il nome di una macro come parametro del rack (nei bersagli delle modulazioni delle clip). */
export const macroParam = (index: number): string => `macro${index + 1}`;

/** L'indice della macro di un parametro del rack, o −1. */
export function macroIndex(param: string): number {
  const m = /^macro([1-8])$/.exec(param);
  return m ? Number(m[1]) - 1 : -1;
}

export const EMPTY_MACRO: Macro = { name: null, value: 0, mappings: [] };

export const newRack = (id: DeviceId, devices: readonly DeviceKey[]): Rack =>
  ({ id, name: null, devices: [...devices], macros: Array<Macro>(MACRO_COUNT).fill(EMPTY_MACRO) });

export const rackOf = (racks: RackList, key: DeviceKey): Rack | undefined => racks.find(r => r.devices.includes(key));

export const findRack = (racks: RackList, id: DeviceId): Rack | undefined => racks.find(r => r.id === id);

/** La macro che muove un parametro, se c'è (un parametro va a una macro sola). */
export function macroOf(racks: RackList, device: DeviceKey, param: string): { rack: Rack; index: number } | null {
  const rack = rackOf(racks, device);
  const index = rack?.macros.findIndex(m => m.mappings.some(x => x.device === device && x.param === param)) ?? -1;
  return rack && index >= 0 ? { rack, index } : null;
}

/** Il nome di un rack come si mostra. */
export const rackName = (r: Rack): string =>
  r.name ?? (r.devices.includes(INSTRUMENT_DEVICE) ? 'Instrument Rack' : 'Audio Effect Rack');

/** Il nome di una macro come si mostra: il suo, o quello del primo parametro mappato (come in
 *  Live), o "Macro N". `paramLabel` dà il nome di un parametro. */
export const macroName = (m: Macro, index: number, paramLabel: (x: MacroMapping) => string | undefined): string =>
  m.name ?? (m.mappings.length ? paramLabel(m.mappings[0]) : undefined) ?? `Macro ${index + 1}`;

/** Le regole: i dispositivi di un rack esistono, sono di seguito nella catena, sono di un rack
 *  solo; ogni rack ha MACRO_COUNT macro, che mappano solo dispositivi del rack. */
export function checkRacks(order: readonly DeviceKey[], racks: RackList): void {
  const claimed = new Set<DeviceKey>();
  for (const r of racks) {
    if (!r.devices.length) throw new Error(`il rack ${r.id} è vuoto`);
    if (r.macros.length !== MACRO_COUNT) throw new Error(`il rack ${r.id} ha ${r.macros.length} macro`);
    const first = order.indexOf(r.devices[0]);
    r.devices.forEach((k, i) => {
      if (claimed.has(k)) throw new Error(`il dispositivo ${k} è in due rack`);
      claimed.add(k);
      if (first < 0 || order[first + i] !== k) throw new Error(`i dispositivi del rack ${r.id} non sono di seguito nella catena`);
    });
    for (const m of r.macros) {
      for (const x of m.mappings) if (!r.devices.includes(x.device)) throw new Error(`una macro del rack ${r.id} muove un dispositivo fuori dal rack`);
    }
  }
}

/** Dopo che dei dispositivi sono stati tolti: escono dai rack (e dalle mappature); un rack
 *  rimasto vuoto sparisce. */
export function pruneRacks(order: readonly DeviceKey[], racks: RackList): RackList {
  const present = new Set(order);
  if (racks.every(r => r.devices.every(k => present.has(k)))) return racks;
  return racks
    .map(r => (r.devices.every(k => present.has(k)) ? r : {
      ...r,
      devices: r.devices.filter(k => present.has(k)),
      macros: r.macros.map(m => ({ ...m, mappings: m.mappings.filter(x => present.has(x.device)) })),
    }))
    .filter(r => r.devices.length);
}

/** Toglie le mappature di un dispositivo (es. lo strumento cambiato: i parametri sono altri). */
export const withoutMappingsOf = (racks: RackList, device: DeviceKey): RackList =>
  racks.some(r => r.macros.some(m => m.mappings.some(x => x.device === device)))
    ? racks.map(r => ({ ...r, macros: r.macros.map(m => ({ ...m, mappings: m.mappings.filter(x => x.device !== device) })) }))
    : racks;

export function updateRack(racks: RackList, id: DeviceId, fn: (r: Rack) => Rack): RackList {
  if (!findRack(racks, id)) throw new RangeError(`rack ${id} non trovato`);
  return racks.map(r => (r.id === id ? { ...fn(r), id } : r));
}

export function updateMacro(r: Rack, index: number, fn: (m: Macro) => Macro): Rack {
  if (!Number.isInteger(index) || index < 0 || index >= MACRO_COUNT) throw new RangeError(`macro ${index + 1} inesistente`);
  return { ...r, macros: r.macros.map((m, i) => (i === index ? fn(m) : m)) };
}

/** Raggruppa in un rack nuovo dei dispositivi di seguito, che non sono già in un rack. */
export function group(order: readonly DeviceKey[], racks: RackList, keys: readonly DeviceKey[], id: DeviceId): RackList {
  const sorted = [...new Set(keys)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!sorted.length) throw new RangeError('nessun dispositivo da raggruppare');
  if (sorted.some(k => !order.includes(k))) throw new RangeError('dispositivo non trovato');
  if (sorted.some(k => rackOf(racks, k))) throw new Error('un dispositivo è già in un rack (i rack dentro i rack non ci sono ancora)');
  const first = order.indexOf(sorted[0]);
  if (sorted.some((k, i) => order[first + i] !== k)) throw new Error('si raggruppano solo dispositivi uno di seguito all\'altro');
  return [...racks, newRack(id, sorted)];
}

export const ungroup = (racks: RackList, id: DeviceId): RackList => {
  if (!findRack(racks, id)) throw new RangeError(`rack ${id} non trovato`);
  return racks.filter(r => r.id !== id);
};

/** Un elemento della catena come la si vede: un dispositivo da solo o un rack con i suoi. */
export type ChainItem =
  | { readonly kind: 'device'; readonly key: DeviceKey }
  | { readonly kind: 'rack'; readonly rack: Rack };

export function chainItems(order: readonly DeviceKey[], racks: RackList): ChainItem[] {
  const items: ChainItem[] = [];
  for (let i = 0; i < order.length;) {
    const rack = rackOf(racks, order[i]);
    if (rack) {
      items.push({ kind: 'rack', rack });
      i += rack.devices.length;
    } else items.push({ kind: 'device', key: order[i++] });
  }
  return items;
}

const keysOf = (item: ChainItem): readonly DeviceKey[] => (item.kind === 'rack' ? item.rack.devices : [item.key]);

/** Il risultato di uno spostamento: il nuovo ordine e i rack. */
export interface Layout {
  readonly order: readonly DeviceKey[];
  readonly racks: RackList;
}

/** Sposta un dispositivo di un posto (◂ ▸). Dentro un rack si sposta tra i suoi; dal bordo del
 *  rack ne esce, e accanto a un rack ci entra, senza cambiare l'ordine del suono (come
 *  trascinarlo dentro e fuori in Live). Il solo dispositivo di un rack si porta dietro il rack.
 *  Lo strumento resta il primo. */
export function moveDevice(order: readonly DeviceKey[], racks: RackList, key: DeviceKey, dir: -1 | 1): Layout {
  const i = order.indexOf(key);
  if (i < 0) throw new RangeError(`dispositivo ${key} non trovato`);
  if (key === INSTRUMENT_DEVICE) return { order, racks };
  const rack = rackOf(racks, key);
  if (rack) {
    if (rack.devices.length === 1) return moveRack(order, racks, rack.id, dir);
    const at = rack.devices.indexOf(key);
    const edge = dir < 0 ? at === 0 : at === rack.devices.length - 1;
    // il primo del rack resta lo strumento
    if (edge || (dir < 0 && rack.devices[at - 1] === INSTRUMENT_DEVICE)) {
      if (!edge) return { order, racks };
      return { order, racks: updateRack(racks, rack.id, r => removeMember(r, key)) };
    }
    return { order: swap(order, i, i + dir), racks: updateRack(racks, rack.id, r => ({ ...r, devices: swap(r.devices, at, at + dir) })) };
  }
  const j = i + dir;
  if (j < 0 || j >= order.length) return { order, racks };
  // accanto a un rack ci entra, anche a un Instrument Rack con il solo strumento
  const next = rackOf(racks, order[j]);
  if (next) {
    const devices = dir > 0 ? [key, ...next.devices] : [...next.devices, key];
    return { order, racks: updateRack(racks, next.id, r => ({ ...r, devices })) };
  }
  if (order[j] === INSTRUMENT_DEVICE) return { order, racks };
  return { order: swap(order, i, j), racks };
}

/** Sposta un rack intero oltre l'elemento accanto (un dispositivo o un altro rack). */
export function moveRack(order: readonly DeviceKey[], racks: RackList, id: DeviceId, dir: -1 | 1): Layout {
  const items = chainItems(order, racks);
  const i = items.findIndex(x => x.kind === 'rack' && x.rack.id === id);
  if (i < 0) throw new RangeError(`rack ${id} non trovato`);
  const j = i + dir;
  const blocked = (x: ChainItem | undefined) => !x || keysOf(x).includes(INSTRUMENT_DEVICE);
  if (blocked(items[i]) || blocked(items[j])) return { order, racks };
  return { order: swap(items, i, j).flatMap(keysOf), racks };
}

function removeMember(r: Rack, key: DeviceKey): Rack {
  return {
    ...r,
    devices: r.devices.filter(k => k !== key),
    macros: r.macros.map(m => ({ ...m, mappings: m.mappings.filter(x => x.device !== key) })),
  };
}

function swap<T>(list: readonly T[], i: number, j: number): T[] {
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
