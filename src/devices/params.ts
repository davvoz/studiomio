/* Description of a device's parameters (instrument or effect). From this description come the
 * interface's controls, the default values and the validation: a new device declares its
 * parameters and writes no interface code. Pure data, also used in the AudioWorklet. */

/** The parameter counts only when another one (a choice) has a certain value, or one of several values. */
export interface ParamCondition {
  readonly param: string;
  readonly is: number | readonly number[];
}

interface ParamBase {
  readonly id: string;
  readonly label: string;
  readonly when?: ParamCondition;
  /** A parameter the device changes only from its graphic panel (e.g. the points of a
   *  drawn LFO): it doesn't go in the macro and modulation menus nor on the controllers. */
  readonly hidden?: boolean;
}

export interface NumberParam extends ParamBase {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit?: string;
  /** 'log' for frequencies and times: the knob moves evenly over the octaves. */
  readonly scale?: 'linear' | 'log';
  /** Step of the values (e.g. 1 for semitones). */
  readonly step?: number;
  /** At the minimum the parameter is off and reads −∞ (e.g. a closed send). */
  readonly offAtMin?: boolean;
}

export interface ChoiceParam extends ParamBase {
  readonly kind: 'choice';
  readonly options: readonly string[];
  /** Index of the default option. */
  readonly default: number;
}

export type ParamSpec = NumberParam | ChoiceParam;

export interface ParamSection {
  readonly label: string;
  readonly params: readonly ParamSpec[];
  /** The section exists only with this value of another parameter (e.g. the instrument of a Drum
   *  Machine pad): otherwise its parameters don't reach the engine and can't be chosen. */
  readonly when?: ParamCondition;
}

/** Operations depending on the parameter type: one entry per type. */
interface ParamKind<P extends ParamSpec> {
  clamp(p: P, v: number): number;
  /** Value → control position in 0..1. */
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
    format: (p, v) => (p.offAtMin && v <= p.min ? withUnit('−∞', p.unit) : formatNumber(v, p.unit ?? '')),
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

/** Units that change scale to stay readable: 1200 Hz → 1.2 kHz, 0.05 s → 50 ms. */
const UNIT_SCALES: Readonly<Record<string, (v: number) => readonly [number, string]>> = {
  Hz: v => (Math.abs(v) >= 1000 ? [v / 1000, 'kHz'] : [v, 'Hz']),
  s: v => (Math.abs(v) < 1 ? [v * 1000, 'ms'] : [v, 's']),
  pan: v => [Math.abs(v), panSide(v)],
};

function formatNumber(v: number, unit: string): string {
  const [value, u] = UNIT_SCALES[unit]?.(v) ?? [v, unit];
  return withUnit(value.toFixed(decimals(value)), u);
}

/** Decimals worth showing: none for whole or large numbers, one from 10, two below. */
function decimals(value: number): number {
  const a = Math.abs(value);
  if (a >= 100 || Number.isInteger(value)) return 0;
  return a >= 10 ? 1 : 2;
}

const withUnit = (text: string, unit: string | undefined) => (unit ? `${text} ${unit}` : text);

function panSide(v: number): string {
  if (v < 0) return 'L';
  return v > 0 ? 'R' : 'C';
}
