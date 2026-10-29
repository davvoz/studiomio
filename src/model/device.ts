/* I dispositivi di una traccia come dati del progetto: lo strumento (tracce MIDI) e la catena
 * degli effetti (tutte le tracce). Ognuno ha un tipo (un nome registrato, es. "analog",
 * "delay") e i valori dei parametri. Il modello non conosce i tipi: i parametri non salvati
 * prendono il valore predefinito del tipo quando il dispositivo suona, così un parametro
 * aggiunto in futuro non cambia il suono dei progetti esistenti. */
import type { DeviceId, SampleId, TrackId } from '../core/id';
import type { ModTarget } from './envelope';

export type ParamValues = Readonly<Record<string, number>>;

/** I sample che un dispositivo suona, per posto (es. "p1" il primo pad della Drum Machine). */
export type DeviceSamples = Readonly<Record<string, SampleId>>;

/** Ciò che hanno in comune strumenti ed effetti. */
export interface DeviceSettings {
  readonly type: string;
  /** Nome del preset da cui si è partiti (solo da mostrare), o null. */
  readonly preset: string | null;
  readonly params: ParamValues;
  /** I sample caricati nel dispositivo, se ne usa (file del progetto, come per le clip audio). */
  readonly samples?: DeviceSamples;
}

export type InstrumentSettings = DeviceSettings;

/** Un effetto nella catena di una traccia. */
export interface EffectSettings extends DeviceSettings {
  readonly id: DeviceId;
  /** Spento = il suono passa senza effetto (bypass). */
  readonly enabled: boolean;
  /** La traccia che il rilevatore ascolta al posto del suono che passa (sidechain), per gli
   *  effetti che lo accettano. Assente: ascolta il proprio ingresso. */
  readonly sidechain?: TrackId;
  /** Per i modulatori (LFO, Inviluppo): cosa muove ogni destinazione (null: libera). La quantità
   *  di ognuna è un parametro (vedi devices/modulators). Assente: nessuna. */
  readonly targets?: readonly (ModTarget | null)[];
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

/** Il rilevatore ascolta la traccia `source` (null: di nuovo il proprio ingresso). */
export function withSidechain(e: EffectSettings, source: TrackId | null): EffectSettings {
  const { sidechain: _old, ...rest } = e;
  return source ? { ...rest, sidechain: source } : rest;
}

/** Il bersaglio della destinazione `slot` (da 0) di un modulatore, o null (anche null: la toglie);
 *  le libere in fondo spariscono. */
export function withTarget(e: EffectSettings, slot: number, target: ModTarget | null): EffectSettings {
  const targets = [...(e.targets ?? [])];
  while (targets.length <= slot) targets.push(null);
  targets[slot] = target;
  while (targets.length && targets[targets.length - 1] === null) targets.pop();
  const { targets: _old, ...rest } = e;
  return targets.length ? { ...rest, targets } : rest;
}

/** La catena con le destinazioni dei modulatori che muovevano il dispositivo `device` libere (il
 *  dispositivo è cambiato di tipo). Se nessuna lo muoveva, la stessa lista. */
export function withoutTargetsOf(effects: readonly EffectSettings[], device: string): readonly EffectSettings[] {
  const hits = (t: ModTarget | null) => t?.kind === 'device' && t.device === device;
  if (!effects.some(e => e.targets?.some(hits))) return effects;
  return effects.map(e => (e.targets?.some(hits) ? e.targets.reduce((x, t, i) => (hits(t) ? withTarget(x, i, null) : x), e) : e));
}

/** Il sample al posto `slot`, o null se vuoto. */
export const sampleAt = (s: DeviceSettings, slot: string): SampleId | null => s.samples?.[slot] ?? null;

/** Mette (o con null toglie) il sample al posto `slot`. */
export function withSample<S extends DeviceSettings>(s: S, slot: string, id: SampleId | null): S {
  const { [slot]: _old, ...rest } = s.samples ?? {};
  const samples = id ? { ...rest, [slot]: id } : rest;
  return { ...s, samples: Object.keys(samples).length ? samples : undefined };
}

/** I sample usati da un dispositivo. */
export const deviceSampleIds = (s: DeviceSettings): SampleId[] => Object.values(s.samples ?? {});
