/* Descrizione dei parametri di un dispositivo (strumento o effetto). Da questa descrizione nascono i controlli
 * dell'interfaccia, i valori predefiniti e la validazione: un dispositivo nuovo dichiara i suoi
 * parametri e non scrive codice d'interfaccia. Dati puri, usati anche nell'AudioWorklet. */

/** Il parametro conta solo quando un altro (una scelta) ha un certo valore, o uno di più valori. */
export interface ParamCondition {
  readonly param: string;
  readonly is: number | readonly number[];
}

interface ParamBase {
  readonly id: string;
  readonly label: string;
  readonly when?: ParamCondition;
  /** Un parametro che il dispositivo modifica solo dal suo pannello grafico (es. i punti di un
   *  LFO disegnato): non va nei menu delle macro e delle modulazioni né sui controller. */
  readonly hidden?: boolean;
}

export interface NumberParam extends ParamBase {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit?: string;
  /** 'log' per frequenze e tempi: la manopola si muove in modo uniforme sulle ottave. */
  readonly scale?: 'linear' | 'log';
  /** Passo dei valori (es. 1 per i semitoni). */
  readonly step?: number;
}

export interface ChoiceParam extends ParamBase {
  readonly kind: 'choice';
  readonly options: readonly string[];
  /** Indice dell'opzione predefinita. */
  readonly default: number;
}

export type ParamSpec = NumberParam | ChoiceParam;

export interface ParamSection {
  readonly label: string;
  readonly params: readonly ParamSpec[];
}

/** Operazioni che dipendono dal tipo di parametro: una voce per tipo. */
interface ParamKind<P extends ParamSpec> {
  clamp(p: P, v: number): number;
  /** Valore → posizione del controllo in 0..1. */
  toUnit(p: P, v: number): number;
  fromUnit(p: P, u: number): number;
  format(p: P, v: number): string;
}

const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

const KINDS: { readonly [K in ParamSpec['kind']]: ParamKind<Extract<ParamSpec, { kind: K }>> } = {
  number: {
    clamp: (p, v) => {
      const c = Math.max(p.min, Math.min(p.max, Number.isFinite(v) ? v : p.default));
      return p.step ? Math.round(c / p.step) * p.step : c;
    },
    toUnit: (p, v) => clamp01(p.scale === 'log'
      ? Math.log(Math.max(p.min, v) / p.min) / Math.log(p.max / p.min)
      : (v - p.min) / (p.max - p.min)),
    fromUnit: (p, u) => KINDS.number.clamp(p, p.scale === 'log'
      ? p.min * Math.pow(p.max / p.min, clamp01(u))
      : p.min + clamp01(u) * (p.max - p.min)),
    format: (p, v) => formatNumber(v, p.unit ?? ''),
  },
  choice: {
    clamp: (p, v) => Math.max(0, Math.min(p.options.length - 1, Math.round(Number.isFinite(v) ? v : p.default))),
    toUnit: (p, v) => (p.options.length > 1 ? v / (p.options.length - 1) : 0),
    fromUnit: (p, u) => Math.round(clamp01(u) * (p.options.length - 1)),
    format: (p, v) => p.options[KINDS.choice.clamp(p, v)],
  },
};

const kindOf = <P extends ParamSpec>(p: P) => KINDS[p.kind] as unknown as ParamKind<P>;

export const clampParam = (p: ParamSpec, v: number): number => kindOf(p).clamp(p, v);
export const paramToUnit = (p: ParamSpec, v: number): number => kindOf(p).toUnit(p, v);
export const paramFromUnit = (p: ParamSpec, u: number): number => kindOf(p).fromUnit(p, u);
export const formatParam = (p: ParamSpec, v: number): string => kindOf(p).format(p, v);

/** Unità che cambiano scala per restare leggibili: 1200 Hz → 1.2 kHz, 0.05 s → 50 ms. */
const UNIT_SCALES: Readonly<Record<string, (v: number) => readonly [number, string]>> = {
  Hz: v => (Math.abs(v) >= 1000 ? [v / 1000, 'kHz'] : [v, 'Hz']),
  s: v => (Math.abs(v) < 1 ? [v * 1000, 'ms'] : [v, 's']),
  pan: v => [Math.abs(v), v < 0 ? 'L' : v > 0 ? 'R' : 'C'],
};

function formatNumber(v: number, unit: string): string {
  const [value, u] = UNIT_SCALES[unit]?.(v) ?? [v, unit];
  const a = Math.abs(value);
  const digits = a >= 100 || Number.isInteger(value) ? 0 : a >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${u ? ` ${u}` : ''}`;
}
