/* What the session's cells show, decided without the DOM: the button and the title of a slot, and
 * from the engine's state which slots play, which wait for the boundary, how far the clips are. */
import type { TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { groupSlotState, sceneState, type SceneState, type TrackSessionState } from '../../engine/session';
import type { Clip } from '../../model/clip';
import type { Project } from '../../model/project';
import { GroupTrack, type Track } from '../../model/track';

/** The button in a slot: ▶ launches, ● records (lit while recording), ■ stops the track. */
export type SlotButton = 'launch' | 'record' | 'recording' | 'stop';

export interface SlotFace {
  readonly button: SlotButton;
  /** The cell's tooltip ('' none). */
  readonly title: string;
  /** The slot is the one the track is recording into. */
  readonly recording: boolean;
}

export const RECORD_TITLE = { on: 'Stop recording: the clip ends at the next boundary and starts looping', off: 'Record a clip here (from the next boundary)' };

/** A track's slot (not a group's): with a clip ▶ (● while recording into it); empty, ● if the
 *  track is armed or recording there, ■ otherwise. */
export function slotFace(track: Track, clip: Clip | null, recording: boolean, armed: boolean): SlotFace {
  if (clip) {
    return { button: recording ? 'recording' : 'launch', recording, title: `${clip.name}: ▶ launches, a click opens the editor, drag to move (Ctrl copies)` };
  }
  if (recording || armed) {
    return { button: recording ? 'recording' : 'record', recording, title: 'Click ● to record a clip here (double click: an empty MIDI clip)' };
  }
  const title = track.kind === 'audio' ? 'Double click: import an audio file into this slot (or drag it here)' : '';
  return { button: 'stop', recording, title };
}

/** A MIDI track armed for playing (⌨): its empty slots record. */
export const isArmed = (track: Track, keyboardTracks: ReadonlySet<TrackId>): boolean => track.kind === 'midi' && keyboardTracks.has(track.id);

/** How much of the clip has passed (0..1), for the progress bar. */
export function clipProgress(clip: Clip, elapsed: Beats): number {
  const content = clip.contentBeatAt(elapsed);
  if (content === null) return 0;
  const start = clip.loop.enabled ? Math.min(clip.region.start, clip.loop.start) : clip.region.start;
  const end = clip.loop.enabled ? clip.loop.end : clip.region.end;
  return Math.max(0, Math.min(1, (content - start) / (end - start)));
}

export interface SlotPlayback {
  readonly playing: boolean;
  readonly queued: boolean;
  /** How far the playing clip is (0..1); 0 when it doesn't play. */
  readonly progress: number;
}

export interface TrackPlayback {
  readonly slots: readonly SlotPlayback[];
  /** The track will stop at the next boundary. */
  readonly stopQueued: boolean;
  /** The session took the track: it doesn't follow its timeline. */
  readonly taken: boolean;
}

export interface SessionPlayback {
  readonly tracks: ReadonlyMap<TrackId, TrackPlayback>;
  readonly scenes: readonly SceneState[];
}

type StateOf = (track: Track) => TrackSessionState;

/** A visible column: a group's slots from its tracks together, row by row. */
function trackPlayback(p: Project, t: Track, stateOf: StateOf): TrackPlayback {
  const st = stateOf(t);
  const queued = st.queued && typeof st.queued === 'object' ? st.queued.slot : -1;
  const members = t instanceof GroupTrack ? p.soundingTracks(t.id).map(m => [m, stateOf(m)] as const) : null;
  const slots = t.slots.map((clip, s): SlotPlayback => {
    const group = members && groupSlotState(members, s);
    const playing = group ? group.playing : st.playing?.slot === s;
    const progress = playing && clip && st.playing ? clipProgress(clip, st.playing.elapsed) : 0;
    return { playing, queued: group ? group.queued : queued === s, progress };
  });
  return { slots, stopQueued: st.queued === 'stop', taken: !st.followsArrangement };
}

/** The playback state of every visible column and of every scene (a scene plays if one of its clips plays). */
export function sessionPlayback(p: Project, stateOf: StateOf): SessionPlayback {
  const tracks = new Map(p.visibleTracks.map(t => [t.id, trackPlayback(p, t, stateOf)] as const));
  const sounding = p.tracks.filter(t => !(t instanceof GroupTrack)).map(t => [t, stateOf(t)] as const);
  return { tracks, scenes: p.scenes.map((_, s) => sceneState(sounding, s)) };
}
