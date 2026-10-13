/* I dispositivi di una traccia come dati del progetto: lo strumento (tracce MIDI) e la catena
 * degli effetti (tutte le tracce). Ognuno ha un tipo (un nome registrato, es. "analog",
 * "delay") e i valori dei parametri. Il modello non conosce i tipi: i parametri non salvati
 * prendono il valore predefinito del tipo quando il dispositivo suona, così un parametro
 * aggiunto in futuro non cambia il suono dei progetti esistenti. */
import type { DeviceId } from '../core/id';

export type ParamValues = Readonly<Record<string, number>>;

/** Ciò che hanno in comune strumenti ed effetti. */
export interface DeviceSettings {
  readonly type: string;
  /** Nome del preset da cui si è partiti (solo da mostrare), o null. */
  readonly preset: string | null;
  readonly params: ParamValues;
}

export type InstrumentSettings = DeviceSettings;

/** Un effetto nella catena di una traccia. */
export interface EffectSettings extends DeviceSettings {
  readonly id: DeviceId;
  /** Spento = il suono passa senza effetto (bypass). */
  readonly enabled: boolean;
}

export const DEFAULT_INSTRUMENT: InstrumentSettings = { type: 'analog', preset: 'Init', params: {} };

export const newEffect = (id: DeviceId, type: string): EffectSettings => ({ id, type, enabled: true, preset: null, params: {} });

export const withParam = <S extends DeviceSettings>(s: S, id: string, value: number): S =>
  ({ ...s, params: { ...s.params, [id]: value } });

/** Più parametri insieme (es. frequenza e guadagno di un punto dell'EQ trascinato). */
export const withParams = <S extends DeviceSettings>(s: S, values: ParamValues): S =>
  ({ ...s, params: { ...s.params, ...values } });

export const withPreset = <S extends DeviceSettings>(s: S, name: string, params: ParamValues): S =>
  ({ ...s, preset: name, params: { ...params } });
