/* Le modulazioni di una clip (gli inviluppi di clip di Live): curve disegnate nel tempo della
 * clip che muovono un parametro della traccia mentre la clip suona, relative al valore che il
 * parametro ha (la manopola resta dov'è: la curva la sposta). Girano con il loop della clip e
 * valgono sia sulla timeline sia nella session. Qui ci sono i dati e le operazioni pure. */
import type { DeviceId } from '../core/id';
import type { Beats } from '../core/music-time';

/** Cosa muove una curva: volume o pan della traccia, o un parametro di un dispositivo della
 *  traccia (lo strumento, o un effetto per id). */
export type ModTarget =
  | { readonly kind: 'mixer'; readonly param: 'volume' | 'pan' }
  | { readonly kind: 'device'; readonly device: DeviceId | typeof INSTRUMENT_DEVICE; readonly param: string };

/** Il dispositivo "strumento" nei bersagli (gli effetti hanno il loro id). */
export const INSTRUMENT_DEVICE = 'instrument';

export interface EnvelopePoint {
  /** Battito della clip (come le note e il warp). */
  readonly beat: Beats;
  /** Nella scala del tipo di bersaglio (vedi MOD_SCALES). */
  readonly value: number;
}

export interface ClipEnvelope {
  readonly target: ModTarget;
  /** Ordinati per battito; due punti nello stesso battito fanno uno scalino. */
  readonly points: readonly EnvelopePoint[];
}

/** La scala dei valori di un tipo di bersaglio: limiti e valore neutro (nessuna modulazione). */
export interface ModScale {
  readonly min: number;
  readonly max: number;
  readonly neutral: number;
}

/** Volume: quanto del volume della traccia resta (1 = tutto, 0 = silenzio). Pan: spostamento
 *  (−1 tutto a sinistra … +1 tutto a destra). Parametro: spostamento della manopola, in
 *  frazioni della sua corsa (−1 … +1). */
export const MOD_SCALES = {
  volume: { min: 0, max: 1, neutral: 1 },
  pan: { min: -1, max: 1, neutral: 0 },
  param: { min: -1, max: 1, neutral: 0 },
} as const satisfies Readonly<Record<string, ModScale>>;

export type ModScaleKind = keyof typeof MOD_SCALES;

export const scaleKindOf = (t: ModTarget): ModScaleKind => (t.kind === 'mixer' ? t.param : 'param');

export const scaleOf = (t: ModTarget): ModScale => MOD_SCALES[scaleKindOf(t)];

/** Una chiave che identifica il bersaglio: "mixer:volume", "instrument:cutoff", "<id effetto>:time". */
export const targetKey = (t: ModTarget): string => (t.kind === 'mixer' ? `mixer:${t.param}` : `${t.device}:${t.param}`);

/** Il bersaglio di una chiave (al contrario di targetKey), o null se non è valida. */
export function parseTargetKey(key: string): ModTarget | null {
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) return null;
  const owner = key.slice(0, i), param = key.slice(i + 1);
  if (owner === 'mixer') return param === 'volume' || param === 'pan' ? { kind: 'mixer', param } : null;
  return { kind: 'device', device: owner as DeviceId, param };
}

export const sameTarget = (a: ModTarget, b: ModTarget): boolean => targetKey(a) === targetKey(b);

const clamp = (v: number, s: ModScale) => Math.max(s.min, Math.min(s.max, v));

/** Il valore della curva al battito `beat`: prima del primo punto vale il primo, dopo l'ultimo
 *  l'ultimo, in mezzo la retta tra i due vicini. Su uno scalino vale già il punto dopo. */
export function envelopeValueAt(points: readonly EnvelopePoint[], beat: Beats): number {
  const n = points.length;
  if (n === 0) return NaN;
  if (beat < points[0].beat) return points[0].value;
  // l'ultimo punto con battito <= beat (ricerca binaria)
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].beat <= beat) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo], b = points[lo + 1];
  if (!b || b.beat === a.beat) return a.value;
  return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
}

/** Punti validi: dentro la scala, battiti non negativi, in ordine (l'ordine di chi ha lo stesso
 *  battito resta quello dato: decide da che parte sta lo scalino). */
export function normalizePoints(points: readonly EnvelopePoint[], scale: ModScale): EnvelopePoint[] {
  return points
    .map((p, i) => ({ p: { beat: Math.max(0, p.beat), value: clamp(p.value, scale) }, i }))
    .sort((a, b) => a.p.beat - b.p.beat || a.i - b.i)
    .map(x => x.p);
}

/** Le curve con quella del bersaglio sostituita (o aggiunta); senza punti la curva sparisce. */
export function withEnvelope(envelopes: readonly ClipEnvelope[], target: ModTarget, points: readonly EnvelopePoint[]): ClipEnvelope[] {
  if (!points.length) return envelopes.filter(e => !sameTarget(e.target, target));
  const env = { target, points: normalizePoints(points, scaleOf(target)) };
  const i = envelopes.findIndex(e => sameTarget(e.target, target));
  return i < 0 ? [...envelopes, env] : envelopes.map((e, k) => (k === i ? env : e));
}
