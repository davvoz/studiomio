import type { ParamValues } from '../model/device';
import { clampParam, type ParamSection, type ParamSpec } from './params';

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
  /** Per gli strumenti che danno un nome alle note (la drum machine: un pad per nota): con
   *  questi valori dei parametri (e questi nomi dei sample caricati, per posto), il nome di
   *  ogni nota che suona qualcosa. */
  readonly noteNames?: (values: Readonly<Record<string, number>>, samples?: ReadonlyMap<string, string>) => ReadonlyMap<number, string>;
}

export const paramsOf = (t: DeviceType): ParamSpec[] => t.sections.flatMap(s => s.params);

export const paramSpec = (t: DeviceType, id: string): ParamSpec | undefined => paramsOf(t).find(p => p.id === id);

/** Tutti i parametri del tipo: quelli dati (validati) e, per gli altri, i predefiniti. */
export function resolveParams(t: DeviceType, values: ParamValues): Record<string, number> {
  return Object.fromEntries(paramsOf(t).map(p => [p.id, p.id in values ? clampParam(p, values[p.id]) : p.default]));
}

/** Vero se il parametro conta con questi valori (es. il tempo in ms solo senza sincronia). */
export function paramActive(p: ParamSpec, values: Readonly<Record<string, number>>): boolean {
  if (!p.when) return true;
  const { param, is } = p.when;
  return typeof is === 'number' ? values[param] === is : is.includes(values[param]);
}
