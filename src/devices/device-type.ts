import type { ParamValues } from '../model/device';
import { clampParam, type ParamCondition, type ParamSection, type ParamSpec } from './params';

export interface Preset {
  readonly name: string;
  /** Solo i valori diversi da quelli predefiniti. */
  readonly params: ParamValues;
}

/** Un tipo di dispositivo (strumento o effetto), lato interfaccia: nome, parametri raggruppati
 *  e preset. Il suono lo fa il suo motore DSP nell'AudioWorklet, registrato con lo stesso
 *  `type` in worklet/cores.ts. */
export interface DeviceType {
  readonly type: string;
  readonly label: string;
  readonly sections: readonly ParamSection[];
  readonly presets: readonly Preset[];
  /** Per gli effetti che possono ascoltare un'altra traccia (sidechain): il motore riceve quel
   *  suono come secondo ingresso, per il rilevatore. */
  readonly sidechain?: boolean;
  /** Per gli strumenti i cui preset sono kit di batteria (la Drum Machine): finiscono anche in
   *  Batterie, nel browser. */
  readonly kit?: boolean;
  /** Per gli strumenti che danno un nome alle note (la drum machine: un pad per nota): con
   *  questi valori dei parametri (e questi nomi dei sample caricati, per posto), il nome di
   *  ogni nota che suona qualcosa. */
  readonly noteNames?: (values: Readonly<Record<string, number>>, samples?: ReadonlyMap<string, string>) => ReadonlyMap<number, string>;
  /** I parametri che restano come sono quando si sceglie un preset (es. la mappa delle zone del
   *  Sampler, che dipende dai sample caricati e non dal suono). */
  readonly keepsOnPreset?: (param: string) => boolean;
}

/** I valori dei parametri che un preset di `t` non cambia, tra `params`. */
export const keptOnPreset = (t: DeviceType, params: ParamValues): ParamValues =>
  t.keepsOnPreset ? Object.fromEntries(Object.entries(params).filter(([id]) => t.keepsOnPreset!(id))) : {};

export const paramsOf = (t: DeviceType): ParamSpec[] => t.sections.flatMap(s => s.params);

/** Vero se la condizione vale con questi valori. */
const holds = ({ param, is }: ParamCondition, values: Readonly<Record<string, number>>): boolean =>
  typeof is === 'number' ? values[param] === is : is.includes(values[param]);

/** Le sezioni che ci sono con questi valori (quelle con una condizione solo se vale). */
export const activeSections = (t: DeviceType, values: ParamValues): ParamSection[] => {
  const all = t.sections.some(s => s.when) ? resolveParams(t, values) : values;
  return t.sections.filter(s => !s.when || holds(s.when, all));
};

/** I parametri che si mostrano fuori dal pannello del dispositivo (menu, controller); con i
 *  valori, solo quelli delle sezioni che ci sono. */
export const visibleParamsOf = (t: DeviceType, values?: ParamValues): ParamSpec[] =>
  (values ? activeSections(t, values) : t.sections).flatMap(s => s.params).filter(p => !p.hidden);

/** I parametri per id, per tipo (la Drum Machine ne ha migliaia: gli strumenti dei pad). */
const specsByType = new WeakMap<DeviceType, ReadonlyMap<string, ParamSpec>>();

export const paramSpec = (t: DeviceType, id: string): ParamSpec | undefined => {
  let specs = specsByType.get(t);
  if (!specs) specsByType.set(t, (specs = new Map(paramsOf(t).map(p => [p.id, p]))));
  return specs.get(id);
};

/** Tutti i parametri del tipo: quelli dati (validati) e, per gli altri, i predefiniti. */
export function resolveParams(t: DeviceType, values: ParamValues): Record<string, number> {
  return Object.fromEntries(paramsOf(t).map(p => [p.id, p.id in values ? clampParam(p, values[p.id]) : p.default]));
}

/** Come resolveParams, senza i parametri delle sezioni che con questi valori non ci sono: è ciò
 *  che arriva al motore. */
export function resolveActiveParams(t: DeviceType, values: ParamValues): Record<string, number> {
  const all = resolveParams(t, values);
  if (!t.sections.some(s => s.when)) return all;
  const out: Record<string, number> = {};
  for (const s of t.sections) if (!s.when || holds(s.when, all)) for (const p of s.params) out[p.id] = all[p.id];
  return out;
}

/** Vero se il parametro conta con questi valori (es. il tempo in ms solo senza sincronia). */
export function paramActive(p: ParamSpec, values: Readonly<Record<string, number>>): boolean {
  return !p.when || holds(p.when, values);
}
