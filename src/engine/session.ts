/* La session nel motore: per ogni traccia, cosa suona e da quando, sull'orologio continuo
 * del trasporto (battiti che scorrono senza mai saltare, anche quando la timeline torna
 * all'inizio del loop). Una traccia segue l'arrangement finché non le si lancia una clip;
 * da lì suona la clip (o niente, se la si ferma) finché non si torna all'arrangement.
 * Fermando il trasporto le clip che suonano si ricordano, e ripartono con il play.
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
  /** La clip che suonava quando il trasporto si è fermato: ripartirà con il play. */
  private paused: ClipId | null = null;

  get programs(): readonly Program[] {
    return this.list;
  }

  /** Da `at` in poi suona `source` (niente se null): ciò che suonava si chiude in `at`, ciò che
   *  era in coda dopo `at` si cancella. */
  switchAt(at: number, source: ProgramSource | null): void {
    this.paused = null;
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
   *  seguiva l'arrangement continua a seguirlo; una presa dalla session tace, e se suonava
   *  la clip `resume` la riprende dall'inizio al prossimo play (come in Live). L'orologio
   *  ripartirà da capo. */
  reset(clock: number, resume: ClipId | null): void {
    this.list = this.at(clock)?.source.kind === 'arrangement' ? ALWAYS_ARRANGEMENT : [];
    this.paused = resume;
  }

  /** Il trasporto riparte all'istante `clock`: la clip ricordata allo stop suona da lì. */
  start(clock: number): void {
    if (this.paused) this.list = [{ source: { kind: 'clip', clip: this.paused, origin: clock }, from: clock, until: Infinity }];
    this.paused = null;
  }

  /** A trasporto fermo: la clip ricordata non ripartirà. */
  forget(): void {
    this.paused = null;
  }

  get hasPaused(): boolean {
    return this.paused !== null;
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

  /** Trasporto fermo: vedi TrackSchedule.reset. Le clip che suonano ancora (non quelle
   *  senza loop già finite) ripartiranno con il play. */
  reset(tracks: readonly Track[], clock: number): void {
    for (const [id, s] of this.tracks) {
      const track = tracks.find(t => t.id === id);
      const slot = track && this.state(track, clock).playing?.slot;
      s.reset(clock, slot === undefined ? null : track!.slots[slot]!.id);
    }
  }

  /** Il trasporto riparte: vedi TrackSchedule.start. */
  start(clock: number): void {
    for (const s of this.tracks.values()) s.start(clock);
  }

  /** A trasporto fermo: le clip ricordate di `tracks` (tutte se omesso) non ripartiranno;
   *  restituisce se ce n'erano. */
  forget(tracks?: readonly TrackId[]): boolean {
    let any = false;
    for (const [id, s] of this.tracks) {
      if (tracks && !tracks.includes(id)) continue;
      any ||= s.hasPaused;
      s.forget();
    }
    return any;
  }

  prune(clock: number): void {
    for (const s of this.tracks.values()) s.prune(clock);
  }

  remove(track: TrackId): void {
    this.tracks.delete(track);
  }
}

/** Lo stato di un gruppo dalle sue tracce: suona la clip della prima che suona, è in coda ciò
 *  che una aspetta (una clip prima dello stop), segue l'arrangement se lo seguono tutte. */
export function mergedState(states: readonly TrackSessionState[]): TrackSessionState {
  const clip = states.find(s => typeof s.queued === 'object' && s.queued)?.queued;
  return {
    playing: states.find(s => s.playing)?.playing ?? null,
    queued: clip ?? (states.some(s => s.queued === 'stop') ? 'stop' : states.some(s => s.queued === 'arrangement') ? 'arrangement' : null),
    followsArrangement: states.every(s => s.followsArrangement),
  };
}

/** Uno slot di un gruppo, dalle tracce del gruppo nella stessa riga. */
export interface GroupSlotState {
  /** Almeno una traccia ha una clip nella riga (lo slot ha ▶). */
  readonly clips: boolean;
  /** Almeno una suona la sua clip della riga. */
  readonly playing: boolean;
  /** Almeno una aspetta il prossimo confine per lanciare la sua clip della riga. */
  readonly queued: boolean;
}

export function groupSlotState(members: readonly (readonly [Track, TrackSessionState])[], slot: number): GroupSlotState {
  return {
    clips: members.some(([t]) => t.slots[slot]),
    playing: members.some(([, s]) => s.playing?.slot === slot),
    queued: members.some(([, s]) => typeof s.queued === 'object' && s.queued?.slot === slot),
  };
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
