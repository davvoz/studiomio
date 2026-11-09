/* A scene's audio: its clips put on the timeline of a copy of the project, so the
 * timeline mixdown (offline-mix) plays it as it's heard when launching it. */
import type { IdFactory } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Clip } from './clip';
import type { Project } from './project';
import { GroupTrack } from './track';

/** Step the loop lengths are compared with: a sixteenth. */
const TICKS_PER_BEAT = 4;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export interface SceneLength {
  readonly length: Beats;
  /** At least one clip loops: at the end the file restarts from the top seamlessly. */
  readonly loops: boolean;
}

/** Automatic length of a scene's audio: the first point where all the loops come back
 *  together to the start (4 and 3 bars → 12), at least as long as the longest clip without loop. If the
 *  loops come back together only after `maxBeats`, the longest is enough. Null if there are no clips. */
export function sceneLength(clips: readonly Clip[], maxBeats: Beats): SceneLength | null {
  if (!clips.length) return null;
  const loops = clips.filter(c => c.loop.enabled).map(c => c.loop.end - c.loop.start);
  const once = Math.max(0, ...clips.filter(c => !c.loop.enabled).map(c => c.region.end - c.region.start));
  if (!loops.length) return { length: once, loops: false };
  const ticks = loops.map(l => Math.max(1, Math.round(l * TICKS_PER_BEAT)));
  const lcm = ticks.reduce((a, b) => (a / gcd(a, b)) * b, 1);
  let length = lcm / TICKS_PER_BEAT > maxBeats ? Math.max(...loops) : lcm / TICKS_PER_BEAT;
  // a multiple of the loops' length, so that the final round also closes
  if (length < once) length *= Math.ceil(once / length - 1e-9);
  return { length, loops: true };
}

/** The clips of scene `index`, one per track (groups have no clips). */
export const sceneClips = (project: Project, index: number): Clip[] =>
  project.tracks.flatMap(t => (t instanceof GroupTrack ? [] : t.slots[index] ?? []));

export interface SceneArrangement extends SceneLength {
  /** The project with, on each track, only the scene's clip from beat 0. */
  readonly project: Project;
}

/** Scene `index` as a timeline, to export with the mixdown: each track plays the clip of
 *  its slot from the start (for the whole length if it loops, once otherwise); the tracks
 *  with an empty slot are silent, as when launching the scene. Null if the scene is empty. */
export function sceneArrangement(project: Project, index: number, ids: IdFactory, maxBeats: Beats): SceneArrangement | null {
  const tracks = project.tracks.filter(t => !(t instanceof GroupTrack));
  const len = sceneLength(sceneClips(project, index), maxBeats);
  if (!len || !(len.length > 0)) return null;
  let out = project;
  for (const t of tracks) {
    out = out.updatingTrack(t.id, track => {
      let next = track.arrangement.reduce((x, p) => x.removingPlacement(p.id), track);
      const clip = track.slots[index];
      if (clip) next = next.placing({ id: ids.next('placement'), clip, start: 0, length: len.length, offset: 0 }, ids);
      return next;
    });
  }
  return { ...len, project: out };
}
