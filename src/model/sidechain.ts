/* The sidechain as data: an effect (the compressor) listening to another track. The sound
 * of the source track is taken after its effects and before its volume (like "Post FX" in
 * Live): a lowered or muted kick keeps making the bass pump.
 *
 * In the audio graph a connection looping back on itself would silence everything, so here
 * those closing a loop are discarded: a track listening to itself, two tracks listening
 * to each other, a track listening to the group containing it or to a bus it sends to
 * (the sound also goes through the sends). The master can listen to
 * any track (the tracks never depend on it). */
import type { DeviceId, TrackId } from '../core/id';
import type { EffectList } from './effect-list';
import { MASTER, type ChainOwner, type Project } from './project';

/** A playing connection: the detector of effect `device` of `owner` listens to `source`. */
export interface SidechainLink {
  readonly owner: ChainOwner;
  readonly device: DeviceId;
  readonly source: TrackId;
}

/** Who receives whose sound: A → B if A's sound reaches B's channel. */
class Flow {
  private readonly next = new Map<TrackId, TrackId[]>();

  add(from: TrackId, to: TrackId): void {
    const list = this.next.get(from);
    if (list) list.push(to);
    else this.next.set(from, [to]);
  }

  /** True if the sound of `from` reaches (also through others) `to`. */
  reaches(from: TrackId, to: TrackId): boolean {
    const seen = new Set<TrackId>([from]), todo = [from];
    for (let t = todo.pop(); t; t = todo.pop()) {
      for (const n of this.next.get(t) ?? []) {
        if (n === to) return true;
        if (!seen.has(n)) {
          seen.add(n);
          todo.push(n);
        }
      }
    }
    return false;
  }
}

/** True if `owner` can listen to `source` without closing a loop. */
const allowed = (flow: Flow, owner: ChainOwner, source: TrackId): boolean =>
  owner === MASTER || (owner !== source && !flow.reaches(owner, source));

/** The project's chains in the order the connections are resolved: tracks, buses, then master. */
const chains = (p: Project): [ChainOwner, EffectList][] => [...p.channels.map((t): [ChainOwner, EffectList] => [t.id, t.effects]), [MASTER, p.masterEffects]];

/** The connections, skipping `skip` (the effect whose source is being looked for). */
function resolve(p: Project, skip?: { owner: ChainOwner; device: DeviceId }): { links: SidechainLink[]; flow: Flow } {
  const flow = new Flow();
  for (const t of p.tracks) {
    if (t.group) flow.add(t.id, t.group);
    for (const bus of Object.keys(t.sends) as TrackId[]) flow.add(t.id, bus);
  }
  const links: SidechainLink[] = [];
  for (const [owner, effects] of chains(p)) {
    for (const e of effects) {
      const source = e.sidechain;
      if (!source || !p.track(source) || (skip && skip.owner === owner && skip.device === e.id)) continue;
      // in track order: in a loop the connection of the lowest track is discarded
      if (!allowed(flow, owner, source)) continue;
      links.push({ owner, device: e.id, source });
      if (owner !== MASTER) flow.add(source, owner);
    }
  }
  return { links, flow };
}

/** The playing connections (those towards tracks that are gone, or that would close a
 *  loop, no: that detector hears nothing). */
export const sidechainLinks = (p: Project): SidechainLink[] => resolve(p).links;

/** The tracks effect `device` of `owner` can listen to. */
export function sidechainSources(p: Project, owner: ChainOwner, device: DeviceId): TrackId[] {
  const { flow } = resolve(p, { owner, device });
  return p.channels.filter(t => allowed(flow, owner, t.id)).map(t => t.id);
}
