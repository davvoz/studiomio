/* Importing from another project, as Live's browser does with the tracks of another set: some
 * tracks (a group with all its tracks), buses and the master's devices, with or without their
 * clips. Here are the pure parts: what is taken from the other project and how it goes into this
 * one. The ids are made new elsewhere (persistence/fresh-ids), the audio files are copied by the
 * session. */
import type { TrackId } from '../core/id';
import { MASTER, type Project } from './project';
import { BusTrack, GroupTrack, type Track } from './track';

export interface ImportChoice {
  /** Tracks and buses to bring; a group brings all its tracks. */
  readonly tracks: readonly TrackId[];
  /** The master's effects and racks, added after those of this project's master. */
  readonly master: boolean;
  /** With the timeline and session clips; without, only devices, racks, mixer and sends. */
  readonly clips: boolean;
}

/** The tracks the choice brings: the chosen ones and, for the groups, all their tracks. */
function broughtIds(source: Project, choice: ImportChoice): Set<TrackId> {
  return new Set(choice.tracks.flatMap(id => {
    const t = source.track(id);
    if (!t) return [];
    return t instanceof BusTrack ? [id] : source.trackBlock(id).map(x => x.id);
  }));
}

/** The track without clips, on the timeline and in the session. */
function withoutClips<T extends Track>(track: T): T {
  const empty = track.arrangement.reduce((t, p) => t.removingPlacement(p.id), track);
  return empty.slots.reduce((t, c, i) => (c ? t.withSlot(i, null) : t), empty);
}

/** `source` with only what the choice brings, still with its ids. A chosen track whose group stays
 *  out comes out of it; the sends and the sidechains towards what stays out are closed, as when
 *  deleting a track. Only the samples still used remain. Null if the choice brings nothing. */
export function importPart(source: Project, choice: ImportChoice): Project | null {
  const brought = broughtIds(source, choice);
  if (!brought.size && !(choice.master && source.masterEffects.length)) return null;
  let part = source;
  // a group left out lets its tracks go up to the group containing it
  for (const g of source.tracks) if (g instanceof GroupTrack && !brought.has(g.id)) part = part.ungroupingTrack(g.id);
  for (const t of part.channels) if (!brought.has(t.id)) part = part.removingTrack(t.id);
  if (!choice.clips) part = part.tracks.reduce((p, t) => p.updatingTrack(t.id, withoutClips), part);
  if (!choice.master) part = part.updatingChain(MASTER, () => ({ effects: [], racks: [] }));
  return part.withoutUnusedSamples();
}

/** `target` with the part (whose ids must be new for it) added: its samples, its buses after
 *  the buses, its tracks after the tracks (in their groups) and the master's devices after those of
 *  the master. The scenes stay `target`'s: the slots past its last scene are lost. */
export function mergingImport(target: Project, part: Project): Project {
  let next = part.samples.reduce((p, s) => p.addingSample(s), target);
  // the buses before the tracks: the tracks' sends must find them
  next = part.buses.reduce((p, b) => p.addingBus(b), next);
  next = part.tracks.reduce((p, t) => p.addingTrack(t), next);
  if (!part.masterEffects.length) return next;
  return next.updatingChain(MASTER, c => ({
    effects: [...c.effects, ...part.masterEffects],
    racks: [...c.racks, ...part.masterRacks],
  }));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the part brings, in words: "3 tracks, 1 bus and 2 master devices". */
export function importSummary(part: Project): string {
  const items = [
    part.tracks.length ? count(part.tracks.length, 'track', 'tracks') : '',
    part.buses.length ? count(part.buses.length, 'bus', 'buses') : '',
    part.masterEffects.length ? count(part.masterEffects.length, 'master device', 'master devices') : '',
  ].filter(Boolean);
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] ?? 'nothing';
}
