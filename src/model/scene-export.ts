/* L'audio di una scena: le sue clip messe sulla timeline di una copia del progetto, così il
 * mixdown della timeline (offline-mix) la suona come la si sente lanciandola. */
import type { IdFactory } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Clip } from './clip';
import type { Project } from './project';
import { GroupTrack } from './track';

/** Passo con cui si confrontano le lunghezze dei loop: un sedicesimo. */
const TICKS_PER_BEAT = 4;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export interface SceneLength {
  readonly length: Beats;
  /** Almeno una clip va in loop: alla fine il file riparte da capo senza stacchi. */
  readonly loops: boolean;
}

/** Lunghezza automatica dell'audio di una scena: il primo punto in cui tutti i loop tornano
 *  insieme all'inizio (4 e 3 battute → 12), almeno quanto la clip senza loop più lunga. Se i
 *  loop tornano insieme solo dopo `maxBeats`, basta il più lungo. Null se non ci sono clip. */
export function sceneLength(clips: readonly Clip[], maxBeats: Beats): SceneLength | null {
  if (!clips.length) return null;
  const loops = clips.filter(c => c.loop.enabled).map(c => c.loop.end - c.loop.start);
  const once = Math.max(0, ...clips.filter(c => !c.loop.enabled).map(c => c.region.end - c.region.start));
  if (!loops.length) return { length: once, loops: false };
  const ticks = loops.map(l => Math.max(1, Math.round(l * TICKS_PER_BEAT)));
  const lcm = ticks.reduce((a, b) => (a / gcd(a, b)) * b);
  let length = lcm / TICKS_PER_BEAT > maxBeats ? Math.max(...loops) : lcm / TICKS_PER_BEAT;
  // un multiplo della lunghezza dei loop, perché anche il giro finale si chiuda
  if (length < once) length *= Math.ceil(once / length - 1e-9);
  return { length, loops: true };
}

export interface SceneArrangement extends SceneLength {
  /** Il progetto con, su ogni traccia, solo la clip della scena dal battito 0. */
  readonly project: Project;
}

/** La scena `index` come timeline, da esportare con il mixdown: ogni traccia suona la clip del
 *  suo slot dall'inizio (per tutta la lunghezza se va in loop, una volta sola se no); le tracce
 *  con lo slot vuoto tacciono, come quando si lancia la scena. Null se la scena è vuota. */
export function sceneArrangement(project: Project, index: number, ids: IdFactory, maxBeats: Beats): SceneArrangement | null {
  const tracks = project.tracks.filter(t => !(t instanceof GroupTrack));
  const clips = tracks.map(t => t.slots[index]).filter((c): c is Clip => !!c);
  const len = sceneLength(clips, maxBeats);
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
