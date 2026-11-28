/* A track's audio by itself, with its effects: which project the offline mixdown has to play.
 * Two ways, as in Live:
 * - a stem ("Export the tracks"): the track as it's heard in the mix, through its effects, volume,
 *   pan and groups, with what its sends make the buses play (their reverbs); not the master's effects;
 * - a bounce (Freeze and Flatten into a new audio track): only the track's own chain (instrument,
 *   effects, the clips' curves); the volume, pan, sends and group are left to the new track's mixer.
 * The other tracks stay only where the track listens to them (sidechain), silent; the rest is removed,
 * so that the mixdown doesn't compute them. Pure data. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { laneEnd } from './arrangement';
import { MASTER, type Project } from './project';
import { NO_RACKS } from './rack';
import { sidechainLinks } from './sidechain';
import { GroupTrack, SEND_OFF_DB, type Track } from './track';

export type TrackRenderMode = 'stem' | 'bounce';

/** The tracks with clips on the timeline that have a sound of their own (not the groups). */
export const renderableTracks = (project: Project): Track[] =>
  project.tracks.filter(t => !(t instanceof GroupTrack) && t.arrangement.length > 0);

/** The tracks to export as stems: those with clips that are in the mix, not muted (nor their groups).
 *  A track rendered into a new audio track stays muted: it isn't exported twice. */
export const stemTracks = (project: Project): Track[] =>
  renderableTracks(project).filter(t => !t.mixer.mute && !project.groupsOf(t.id).some(g => g.mixer.mute));

/** Where a track's clips start and end on the timeline, null if it has none. */
export function trackSpan(track: Track): { start: Beats; end: Beats } | null {
  const lane = track.arrangement;
  return lane.length ? { start: lane[0].start, end: laneEnd(lane) } : null;
}

/** The buses `t` sends something to. */
const sentTo = (t: Track): TrackId[] =>
  (Object.entries(t.sends) as [TrackId, number][]).filter(([, db]) => db > SEND_OFF_DB).map(([bus]) => bus);

/** The channels the render needs: those the sound goes through (`path`), the tracks their effects
 *  listen to (sidechain: their whole sound, so a group with its tracks, and what they listen to in
 *  turn), and the groups all these go out through (only to stay in place: their other tracks aren't
 *  needed). */
export function neededChannels(project: Project, path: readonly TrackId[]): Set<TrackId> {
  const links = sidechainLinks(project);
  const listened = (id: TrackId) => links.filter(l => l.owner === id).map(l => l.source);
  const sounding = new Set<TrackId>();
  const todo = path.flatMap(listened);
  for (let id = todo.pop(); id; id = todo.pop()) {
    if (sounding.has(id)) continue;
    sounding.add(id);
    const inside = project.track(id) instanceof GroupTrack ? project.trackBlock(id).slice(1).map(t => t.id) : [];
    todo.push(...inside, ...listened(id));
  }
  return new Set([...path, ...sounding].flatMap(id => [id, ...project.groupsOf(id).map(g => g.id)]));
}

/** Only the channels in `keep` (a kept track keeps its groups, so removing a group takes away
 *  only tracks not kept). */
function onlyChannels(project: Project, keep: ReadonlySet<TrackId>): Project {
  let p = project;
  for (const t of project.channels) if (!keep.has(t.id) && p.track(t.id)) p = p.removingTrack(t.id);
  return p;
}

/** The master lets the sound through as it is: no effects, no curves, at 0 dB. */
const plainMaster = (p: Project): Project =>
  p.updatingChain(MASTER, () => ({ effects: [], racks: NO_RACKS })).withMaster({ volumeDb: 0, mute: false }).withMasterAutomationOn(false);

/** Only `id` is heard: it's soloed (with its groups open), the others aren't. */
function soloed(p: Project, id: TrackId, open: ReadonlySet<TrackId>): Project {
  return p.channels.reduce((q, t) => {
    const solo = t.id === id;
    const mute = open.has(t.id) ? false : t.mixer.mute;
    return t.mixer.solo === solo && t.mixer.mute === mute ? q : q.updatingTrack(t.id, x => x.withMixer({ solo, mute }));
  }, p);
}

/** The project whose mixdown is track `id`'s audio (see the file's comment). */
export function trackRenderProject(project: Project, id: TrackId, mode: TrackRenderMode): Project {
  const track = project.track(id);
  if (!track) throw new Error(`track ${id} not found`);
  if (mode === 'stem') {
    // through its groups and into the buses it (or a group of it) sends to
    const groups = project.groupsOf(id).map(g => g.id);
    const heard = [id, ...groups, ...[track, ...project.groupsOf(id)].flatMap(sentTo)];
    return soloed(plainMaster(onlyChannels(project, neededChannels(project, heard))), id, new Set([id, ...groups]));
  }
  // outside its groups, without sends, at 0 dB in the middle
  let p = track.group ? project.movingTrack(id, project.tracks.length - 1, null) : project;
  p = p.updatingTrack(id, t => sentTo(t).reduce((x, bus) => x.withSend(bus, -Infinity), t.withMixer({ volumeDb: 0, pan: 0 })));
  return soloed(plainMaster(onlyChannels(p, neededChannels(p, [id]))), id, new Set([id]));
}
