import type { IdFactory, PlacementId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Clip } from './clip';

/** Una clip posata sulla timeline di una traccia. */
export interface Placement<C extends Clip = Clip> {
  readonly id: PlacementId;
  readonly clip: C;
  /** Inizio sulla timeline. */
  readonly start: Beats;
  /** Durata sulla timeline (può superare la clip se è in loop). */
  readonly length: Beats;
  /** Battiti della clip saltati all'inizio (bordo sinistro tagliato). */
  readonly offset: Beats;
  /** Dissolvenze in entrata e in uscita, in battiti (le clip audio, come in Live). */
  readonly fadeIn?: Beats;
  readonly fadeOut?: Beats;
}

export type Lane<C extends Clip = Clip> = readonly Placement<C>[];

export const placementEnd = (p: Placement): Beats => p.start + p.length;

const EPS = 1e-9;

/** Una clip senza loop non può durare più del suo contenuto: la durata viene limitata. */
function fitToClip<C extends Clip>(p: Placement<C>): Placement<C> {
  if (p.offset < 0) throw new RangeError(`offset negativo: ${p.offset}`);
  const length = Math.min(p.length, p.clip.playLength - p.offset);
  if (!(length > EPS)) throw new RangeError(`durata non valida: ${p.length}`);
  return fitFades(length === p.length ? p : { ...p, length });
}

/** Le dissolvenze dentro la durata della clip (quella in entrata ha la precedenza); quelle
 *  nulle spariscono. */
function fitFades<C extends Clip>(p: Placement<C>): Placement<C> {
  if (p.fadeIn === undefined && p.fadeOut === undefined) return p;
  const { fadeIn = 0, fadeOut = 0, ...rest } = p;
  const fi = Math.min(Math.max(0, fadeIn), p.length), fo = Math.min(Math.max(0, fadeOut), p.length - fi);
  return { ...rest, ...(fi > EPS ? { fadeIn: fi } : {}), ...(fo > EPS ? { fadeOut: fo } : {}) };
}

/** Parte di `p` che resta tenendo solo [from, to) della timeline, o null se non resta nulla. */
export function keepBetween<C extends Clip>(p: Placement<C>, from: Beats, to: Beats, id: PlacementId): Placement<C> | null {
  const s = Math.max(p.start, from), e = Math.min(placementEnd(p), to);
  if (e - s <= EPS) return null;
  // un bordo tagliato perde la sua dissolvenza
  const { fadeIn, fadeOut, ...rest } = p;
  return fitFades({
    ...rest, id, start: s, length: e - s, offset: p.offset + (s - p.start),
    ...(fadeIn && s <= p.start + EPS ? { fadeIn } : {}),
    ...(fadeOut && e >= placementEnd(p) - EPS ? { fadeOut } : {}),
  });
}

/** Posa `placement` sulla corsia. Come in Live, la clip nuova vince: le clip sotto vengono
 *  accorciate, divise in due o tolte. Il risultato è ordinato per inizio. */
export function place<C extends Clip>(lane: Lane<C>, placement: Placement<C>, ids: IdFactory): Placement<C>[] {
  placement = fitToClip(placement);
  const id = placement.id;
  return [...clear(lane.filter(p => p.id !== id), placement.start, placementEnd(placement), ids), placement]
    .sort((a, b) => a.start - b.start);
}

/** Svuota [from, to) della corsia: le clip a cavallo vengono accorciate o divise in due. */
export function clear<C extends Clip>(lane: Lane<C>, from: Beats, to: Beats, ids: IdFactory): Placement<C>[] {
  const out: Placement<C>[] = [];
  for (const p of lane) {
    if (placementEnd(p) <= from + EPS || p.start >= to - EPS) {
      out.push(p);
      continue;
    }
    const left = keepBetween(p, -Infinity, from, p.id);
    // se la clip sporge da entrambi i lati, la parte destra diventa una clip nuova
    const right = keepBetween(p, to, Infinity, left ? ids.next('placement') : p.id);
    if (left) out.push(left);
    if (right) out.push(right);
  }
  return out;
}

export function remove<C extends Clip>(lane: Lane<C>, id: PlacementId): Placement<C>[] {
  return lane.filter(p => p.id !== id);
}

/** Cambia una clip posata e la riposa (spostarla o allungarla può coprire le vicine). */
export function update<C extends Clip>(
  lane: Lane<C>, id: PlacementId, fn: (p: Placement<C>) => Placement<C>, ids: IdFactory,
): Placement<C>[] {
  const p = lane.find(x => x.id === id);
  if (!p) throw new Error(`clip ${id} non trovata sulla traccia`);
  return place(lane, fn(p), ids);
}

/** Taglia una clip posata in due nel punto `at` della timeline. */
export function split<C extends Clip>(lane: Lane<C>, id: PlacementId, at: Beats, ids: IdFactory): Placement<C>[] {
  const p = lane.find(x => x.id === id);
  if (!p) throw new Error(`clip ${id} non trovata sulla traccia`);
  const left = keepBetween(p, -Infinity, at, p.id);
  const right = keepBetween(p, at, Infinity, ids.next('placement'));
  if (!left || !right) return [...lane];
  return [...remove(lane, id), left, right].sort((a, b) => a.start - b.start);
}

/** Clip posate che si sovrappongono a [from, to). */
export function between<C extends Clip>(lane: Lane<C>, from: Beats, to: Beats): Placement<C>[] {
  return lane.filter(p => p.start < to && placementEnd(p) > from);
}

/** Fine dell'ultima clip della corsia (0 se vuota). */
export const laneEnd = (lane: Lane): Beats => lane.reduce((m, p) => Math.max(m, placementEnd(p)), 0);
