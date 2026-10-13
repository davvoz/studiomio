/* Lo strumento di una traccia MIDI, come dato del progetto: il tipo (un nome registrato,
 * es. "analog") e i valori dei parametri. Il modello non conosce i tipi di strumento: i
 * parametri non salvati prendono il valore predefinito del tipo quando lo strumento suona,
 * così un parametro aggiunto in futuro non cambia il suono dei progetti esistenti. */

export type ParamValues = Readonly<Record<string, number>>;

export interface InstrumentSettings {
  readonly type: string;
  /** Nome del preset da cui si è partiti (solo da mostrare), o null. */
  readonly preset: string | null;
  readonly params: ParamValues;
}

export const DEFAULT_INSTRUMENT: InstrumentSettings = { type: 'analog', preset: 'Init', params: {} };

export const withParam = (s: InstrumentSettings, id: string, value: number): InstrumentSettings =>
  ({ ...s, params: { ...s.params, [id]: value } });
