/* La session nel motore: per ogni traccia, cosa suona e da quando, sull'orologio continuo
 * del trasporto (battiti che scorrono senza mai saltare, anche quando la timeline torna
 * all'inizio del loop). Una traccia segue l'arrangement finché non le si lancia una clip;
 * da lì suona la clip (o niente, se la si ferma) finché non si torna all'arrangement.
 * È stato della riproduzione, non del progetto: non si salva e non si annulla. */
import type { ClipId, TrackId } from '../core/id';
import type { Clip } from '../model/clip';
import type { Track } from '../model/track';

/** Cosa suona una traccia in un tratto dell'orologio: la sua timeline, o una clip della
 *  session lanciata all'istante `origin`. */
export type ProgramSource =
  | { readonly kind: 'arrangement' }
  | { readonly kind: 'clip'; readonly clip: ClipId; readonly origin: number };

/** Un tratto della scaletta di una traccia: `source` suona in [from, until). */
export interface Program {
  readonly source: ProgramSource;
  readonly from: number;
  readonly until: number;
}

const ARRANGEMENT: ProgramSource = { kind: 'arrangement' };
const ALWAYS_ARRANGEMENT: readonly Program[] = [{ source: ARRANGEMENT, from: -Infinity, until: Infinity }];

/** Lo stato di una traccia da mostrare nella session. */
export interface TrackSessionState {
  /** La clip che suona: slot, e da quanti battiti (dal suo inizio). */
  readonly playing: { readonly slot: number; readonly elapsed: number } | null;
  /** Cosa succederà al prossimo confine: un'altra clip, lo stop o il ritorno all'arrangement. */
  readonly queued: { readonly slot: number } | 'stop' | 'arrangement' | null;
  /** La traccia suona la sua timeline (non è stata presa dalla session). */
  readonly followsArrangement: boolean;
}

/** La scaletta di una traccia: tratti in ordine, che non si sovrappongono. */
export class TrackSchedule {
  private list: readonly Program[] = ALWAYS_ARRANGEMENT;

  get programs(): readonly Program[] {
    return this.list;
  }

  /** Da `at` in poi suona `source` (niente se null): ciò che suonava si chiude in `at`, ciò che
   *  era in coda dopo `at` si cancella. */
  switchAt(at: number, source: ProgramSource | null): void {
    const kept = this.list.filter(p => p.from < at).map(p => (p.until > at ? { ...p, until: at } : p));
    this.list = source ? [...kept, { source, from: at, until: Infinity }] : kept;
  }

  at(clock: number): Program | undefined {
    return this.list.find(p => p.from <= clock && clock < p.until);
  }

  /** Il primo tratto che inizia dopo `clock` (in coda). */
  after(clock: number): Program | undefined {
    return this.list.find(p => p.from > clock);
  }

  /** Dimentica i tratti finiti prima di `clock`. */
  prune(clock: number): void {
    if (this.list.some(p => p.until <= clock)) this.list = this.list.filter(p => p.until > clock);
  }

  /** Trasporto fermo: le clip si fermano e ciò che era in coda si cancella. Una traccia che
   *  seguiva l'arrangement continua a seguirlo; una presa dalla session resta muta (come in
   *  Live, finché non si torna all'arrangement). L'orologio ripartirà da capo. */
  reset(clock: number): void {
    this.list = this.at(clock)?.source.kind === 'arrangement' ? ALWAYS_ARRANGEMENT : [];
  }
}

export class Session {
  private readonly tracks = new Map<TrackId, TrackSchedule>();

  /** La scaletta della traccia (all'inizio: segue l'arrangement). */
  schedule(track: TrackId): TrackSchedule {
    let s = this.tracks.get(track);
    if (!s) this.tracks.set(track, (s = new TrackSchedule()));
    return s;
  }

  programs(track: TrackId): readonly Program[] {
    return this.tracks.get(track)?.programs ?? ALWAYS_ARRANGEMENT;
  }

  launch(track: TrackId, clip: ClipId, at: number): void {
    this.schedule(track).switchAt(at, { kind: 'clip', clip, origin: at });
  }

  stop(track: TrackId, at: number): void {
    this.schedule(track).switchAt(at, null);
  }

  /** Le tracce prese dalla session tornano alla loro timeline da `at`; restituisce quali. */
  backToArrangement(at: number): TrackId[] {
    const moved: TrackId[] = [];
    for (const [id, s] of this.tracks) {
      const now = s.at(at), next = s.after(at);
      if (now?.source.kind === 'arrangement' && !next) continue;
      s.switchAt(at, ARRANGEMENT);
      moved.push(id);
    }
    return moved;
  }

  /** Le tracce che, finiti i cambi in coda, non seguiranno la loro timeline. */
  get taken(): ReadonlySet<TrackId> {
    return new Set([...this.tracks].filter(([, s]) => s.programs.at(-1)?.source.kind !== 'arrangement').map(([id]) => id));
  }

  state(track: Track, clock: number): TrackSessionState {
    const s = this.tracks.get(track.id);
    if (!s) return { playing: null, queued: null, followsArrangement: true };
    const now = s.at(clock), next = s.after(clock);
    return {
      playing: now?.source.kind === 'clip' ? playingClip(track, now.source.clip, clock - now.source.origin) : null,
      queued: next ? (next.source.kind === 'clip' ? slotOf(track, next.source.clip) : 'arrangement')
        : now && now.until !== Infinity ? 'stop' : null,
      followsArrangement: now?.source.kind === 'arrangement',
    };
  }

  /** Trasporto fermo: vedi TrackSchedule.reset. */
  reset(clock: number): void {
    for (const s of this.tracks.values()) s.reset(clock);
  }

  prune(clock: number): void {
    for (const s of this.tracks.values()) s.prune(clock);
  }

  remove(track: TrackId): void {
    this.tracks.delete(track);
  }
}

/** La clip `id` negli slot della traccia (null se non c'è più). */
export function slotClip(track: Track, id: ClipId): Clip | null {
  return track.slots.find(c => c?.id === id) ?? null;
}

function slotOf(track: Track, id: ClipId): { slot: number } | null {
  const slot = track.slots.findIndex(c => c?.id === id);
  return slot < 0 ? null : { slot };
}

/** Una clip senza loop finisce da sola: dopo la sua durata non suona più. */
function playingClip(track: Track, id: ClipId, elapsed: number): TrackSessionState['playing'] {
  const slot = track.slots.findIndex(c => c?.id === id);
  if (slot < 0 || elapsed >= track.slots[slot]!.playLength) return null;
  return { slot, elapsed };
}
