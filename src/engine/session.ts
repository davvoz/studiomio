/* The session in the engine: for each track, what it plays and since when, on the transport's
 * continuous clock (beats flowing without ever jumping, even when the timeline goes back
 * to the start of the loop). A track follows the arrangement until a clip is launched on it;
 * from there it plays the clip (or nothing, if it's stopped) until it goes back to the arrangement.
 * Stopping the transport the playing clips are remembered, and restart with play.
 * It's playback state, not project state: it isn't saved and can't be undone. */
import type { ClipId, TrackId } from '../core/id';
import type { Clip } from '../model/clip';
import type { Track } from '../model/track';

/** What a track plays in a stretch of the clock: its timeline, or a session clip
 *  launched at instant `origin`. */
export type ProgramSource =
  | { readonly kind: 'arrangement' }
  | { readonly kind: 'clip'; readonly clip: ClipId; readonly origin: number };

/** A stretch of a track's schedule: `source` plays in [from, until). */
export interface Program {
  readonly source: ProgramSource;
  readonly from: number;
  readonly until: number;
}

const ARRANGEMENT: ProgramSource = { kind: 'arrangement' };
const ALWAYS_ARRANGEMENT: readonly Program[] = [{ source: ARRANGEMENT, from: -Infinity, until: Infinity }];

/** A track's state to show in the session. */
export interface TrackSessionState {
  /** The playing clip: slot, and for how many beats (since its start). */
  readonly playing: { readonly slot: number; readonly elapsed: number } | null;
  /** What will happen at the next boundary: another clip, the stop or the return to the arrangement. */
  readonly queued: { readonly slot: number } | 'stop' | 'arrangement' | null;
  /** The track plays its timeline (it wasn't taken by the session). */
  readonly followsArrangement: boolean;
}

/** A track's schedule: stretches in order, not overlapping. */
export class TrackSchedule {
  private list: readonly Program[] = ALWAYS_ARRANGEMENT;
  /** The clip that was playing when the transport stopped: it will restart with play. */
  private paused: ClipId | null = null;

  get programs(): readonly Program[] {
    return this.list;
  }

  /** From `at` on `source` plays (nothing if null): what was playing closes at `at`, what
   *  was queued after `at` is cancelled. */
  switchAt(at: number, source: ProgramSource | null): void {
    this.paused = null;
    const kept = this.list.filter(p => p.from < at).map(p => (p.until > at ? { ...p, until: at } : p));
    this.list = source ? [...kept, { source, from: at, until: Infinity }] : kept;
  }

  at(clock: number): Program | undefined {
    return this.list.find(p => p.from <= clock && clock < p.until);
  }

  /** The first stretch starting after `clock` (queued). */
  after(clock: number): Program | undefined {
    return this.list.find(p => p.from > clock);
  }

  /** Forgets the stretches finished before `clock`. */
  prune(clock: number): void {
    if (this.list.some(p => p.until <= clock)) this.list = this.list.filter(p => p.until > clock);
  }

  /** Transport stopped: the clips stop and what was queued is cancelled. A track that
   *  followed the arrangement keeps following it; one taken by the session goes silent, and if it was playing
   *  clip `resume` restarts it from the start at the next play (as in Live). The clock
   *  will restart from the top. */
  reset(clock: number, resume: ClipId | null): void {
    this.list = this.at(clock)?.source.kind === 'arrangement' ? ALWAYS_ARRANGEMENT : [];
    this.paused = resume;
  }

  /** The transport restarts at instant `clock`: the clip remembered at the stop plays from there. */
  start(clock: number): void {
    if (this.paused) this.list = [{ source: { kind: 'clip', clip: this.paused, origin: clock }, from: clock, until: Infinity }];
    this.paused = null;
  }

  /** With the transport stopped: the remembered clip won't restart. */
  forget(): void {
    this.paused = null;
  }

  get hasPaused(): boolean {
    return this.paused !== null;
  }
}

export class Session {
  private readonly tracks = new Map<TrackId, TrackSchedule>();

  /** The track's schedule (at the start: it follows the arrangement). */
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

  /** The tracks taken by the session go back to their timeline from `at`; returns which. */
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

  /** The tracks that, once the queued changes are done, won't follow their timeline. */
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

  /** Transport stopped: see TrackSchedule.reset. The clips still playing (not those
   *  without loop already finished) will restart with play. */
  reset(tracks: readonly Track[], clock: number): void {
    for (const [id, s] of this.tracks) {
      const track = tracks.find(t => t.id === id);
      const slot = track && this.state(track, clock).playing?.slot;
      s.reset(clock, slot === undefined ? null : track!.slots[slot]!.id);
    }
  }

  /** The transport starts again: see TrackSchedule.start. */
  start(clock: number): void {
    for (const s of this.tracks.values()) s.start(clock);
  }

  /** With the transport stopped: the remembered clips of `tracks` (all if omitted) won't restart;
   *  returns whether there were any. */
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

/** A group's state from its tracks: it plays the clip of the first that plays, it queues what
 *  one is waiting for (a clip before the stop), it follows the arrangement if they all follow it. */
export function mergedState(states: readonly TrackSessionState[]): TrackSessionState {
  const clip = states.find(s => typeof s.queued === 'object' && s.queued)?.queued;
  return {
    playing: states.find(s => s.playing)?.playing ?? null,
    queued: clip ?? (states.some(s => s.queued === 'stop') ? 'stop' : states.some(s => s.queued === 'arrangement') ? 'arrangement' : null),
    followsArrangement: states.every(s => s.followsArrangement),
  };
}

/** A group's slot, from the group's tracks in the same row. */
export interface GroupSlotState {
  /** At least one track has a clip in the row (the slot has ▶). */
  readonly clips: boolean;
  /** At least one plays its clip of the row. */
  readonly playing: boolean;
  /** At least one is waiting for the next boundary to launch its clip of the row. */
  readonly queued: boolean;
}

export function groupSlotState(members: readonly (readonly [Track, TrackSessionState])[], slot: number): GroupSlotState {
  return {
    clips: members.some(([t]) => t.slots[slot]),
    playing: members.some(([, s]) => s.playing?.slot === slot),
    queued: members.some(([, s]) => typeof s.queued === 'object' && s.queued?.slot === slot),
  };
}

/** A scene: it plays if at least one of its clips plays (with a clip of another scene launched,
 *  both play), it's queued if a track is waiting for the next boundary to launch its
 *  clip of the row. */
export interface SceneState {
  readonly clips: boolean;
  readonly playing: boolean;
  readonly queued: boolean;
}

/** `tracks`: the playing tracks (not the groups), with their state. */
export function sceneState(tracks: readonly (readonly [Track, TrackSessionState])[], slot: number): SceneState {
  const withClip = tracks.filter(([t]) => t.slots[slot]);
  return {
    clips: withClip.length > 0,
    playing: withClip.some(([, s]) => s.playing?.slot === slot),
    queued: withClip.some(([, s]) => typeof s.queued === 'object' && s.queued?.slot === slot),
  };
}

/** Clip `id` in the track's slots (null if it's gone). */
export function slotClip(track: Track, id: ClipId): Clip | null {
  return track.slots.find(c => c?.id === id) ?? null;
}

function slotOf(track: Track, id: ClipId): { slot: number } | null {
  const slot = track.slots.findIndex(c => c?.id === id);
  return slot < 0 ? null : { slot };
}

/** A clip without loop ends by itself: after its length it no longer plays. */
function playingClip(track: Track, id: ClipId, elapsed: number): TrackSessionState['playing'] {
  const slot = track.slots.findIndex(c => c?.id === id);
  if (slot < 0 || elapsed >= track.slots[slot]!.playLength) return null;
  return { slot, elapsed };
}
