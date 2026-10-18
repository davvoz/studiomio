/* Il sidechain come dati: un effetto (il compressore) che ascolta un'altra traccia. Il suono
 * della traccia sorgente si prende dopo i suoi effetti e prima del suo volume (come "Post FX" in
 * Live): una cassa abbassata o in mute continua a far pompare il basso.
 *
 * Nel grafo audio un collegamento che torna su sé stesso zittirebbe tutto, quindi qui si
 * scartano quelli che chiudono un anello: una traccia che ascolta sé stessa, due tracce che si
 * ascoltano a vicenda, una traccia che ascolta il gruppo che la contiene. Il master può ascoltare
 * qualunque traccia (le tracce non dipendono mai da lui). */
import type { DeviceId, TrackId } from '../core/id';
import type { EffectList } from './effect-list';
import { MASTER, type ChainOwner, type Project } from './project';

/** Un collegamento che suona: il rilevatore dell'effetto `device` di `owner` ascolta `source`. */
export interface SidechainLink {
  readonly owner: ChainOwner;
  readonly device: DeviceId;
  readonly source: TrackId;
}

/** Chi riceve il suono di chi: A → B se il suono di A arriva nel canale di B. */
class Flow {
  private readonly next = new Map<TrackId, TrackId[]>();

  add(from: TrackId, to: TrackId): void {
    const list = this.next.get(from);
    if (list) list.push(to);
    else this.next.set(from, [to]);
  }

  /** Vero se il suono di `from` arriva (anche passando per altri) in `to`. */
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

/** Vero se `owner` può ascoltare `source` senza chiudere un anello. */
const allowed = (flow: Flow, owner: ChainOwner, source: TrackId): boolean =>
  owner === MASTER || (owner !== source && !flow.reaches(owner, source));

/** Le catene del progetto nell'ordine in cui si risolvono i collegamenti: tracce, poi master. */
const chains = (p: Project): [ChainOwner, EffectList][] => [...p.tracks.map((t): [ChainOwner, EffectList] => [t.id, t.effects]), [MASTER, p.masterEffects]];

/** I collegamenti, saltando `skip` (l'effetto di cui si cerca la sorgente). */
function resolve(p: Project, skip?: { owner: ChainOwner; device: DeviceId }): { links: SidechainLink[]; flow: Flow } {
  const flow = new Flow();
  for (const t of p.tracks) if (t.group) flow.add(t.id, t.group);
  const links: SidechainLink[] = [];
  for (const [owner, effects] of chains(p)) {
    for (const e of effects) {
      const source = e.sidechain;
      if (!source || !p.track(source) || (skip && skip.owner === owner && skip.device === e.id)) continue;
      // nell'ordine delle tracce: in un anello si scarta il collegamento della traccia più in basso
      if (!allowed(flow, owner, source)) continue;
      links.push({ owner, device: e.id, source });
      if (owner !== MASTER) flow.add(source, owner);
    }
  }
  return { links, flow };
}

/** I collegamenti che suonano (quelli verso tracce che non ci sono più, o che chiuderebbero un
 *  anello, no: quel rilevatore non sente niente). */
export const sidechainLinks = (p: Project): SidechainLink[] => resolve(p).links;

/** Le tracce che l'effetto `device` di `owner` può ascoltare. */
export function sidechainSources(p: Project, owner: ChainOwner, device: DeviceId): TrackId[] {
  const { flow } = resolve(p, { owner, device });
  return p.tracks.filter(t => allowed(flow, owner, t.id)).map(t => t.id);
}
