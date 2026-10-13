import type { ParamValues } from '../model/instrument';
import { clampParam, type ParamSection, type ParamSpec } from './params';

export interface Preset {
  readonly name: string;
  /** Solo i valori diversi da quelli predefiniti. */
  readonly params: ParamValues;
}

/** Un tipo di strumento, lato interfaccia: nome, parametri raggruppati e preset. Il suono lo
 *  fa il suo motore DSP nell'AudioWorklet, registrato con lo stesso `type`. */
export interface InstrumentType {
  readonly type: string;
  readonly label: string;
  readonly sections: readonly ParamSection[];
  readonly presets: readonly Preset[];
}

export const paramsOf = (t: InstrumentType): ParamSpec[] => t.sections.flatMap(s => s.params);

export const paramSpec = (t: InstrumentType, id: string): ParamSpec | undefined => paramsOf(t).find(p => p.id === id);

/** Tutti i parametri del tipo: quelli dati (validati) e, per gli altri, i predefiniti. */
export function resolveParams(t: InstrumentType, values: ParamValues): Record<string, number> {
  return Object.fromEntries(paramsOf(t).map(p => [p.id, p.id in values ? clampParam(p, values[p.id]) : p.default]));
}
