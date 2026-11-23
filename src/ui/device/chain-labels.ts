/* What the device view shows of a chain, without the DOM: whose it is, the devices' names
 * ("Delay", "Delay 2"…), the modulators' targets, and the chain's shape (when the panels must be
 * rebuilt instead of updated). */
import { deviceTypeAt, mappingSpec } from '../../devices/rack-params';
import type { EffectList } from '../../model/effect-list';
import type { ModTarget } from '../../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../../model/project';
import { macroParam, rackName, type DeviceKey, type RackList } from '../../model/rack';
import { MidiTrack, type Track } from '../../model/track';

/** The master's colour in the title. */
export const MASTER_COLOR = 'var(--text)';

/** What the view shows of whoever owns the chain: a track or the master. */
export interface ChainSource {
  readonly name: string;
  readonly color: string;
  /** The track, if the chain belongs to a track (for the MIDI tracks' instrument). */
  readonly track: Track | null;
  readonly effects: EffectList;
  readonly racks: RackList;
}

/** The chain of `owner`; null if the track is gone. */
export function chainSource(project: Project, owner: ChainOwner): ChainSource | null {
  if (owner === MASTER) return { name: 'Master', color: MASTER_COLOR, track: null, effects: project.masterEffects, racks: project.masterRacks };
  const track = project.track(owner);
  return track ? { name: track.name, color: track.color, track, effects: track.effects, racks: track.racks } : null;
}

/** The chain's shape: it changes if owner, instrument, effects, their order or type, the racks
 *  (devices, names, macro kinds, mappings) or how they're shown (`view`) change. */
export const shapeOf = (owner: ChainOwner, { track, effects, racks }: ChainSource, view: string): string =>
  [owner, track instanceof MidiTrack ? track.instrument.type : '-', ...effects.map(e => `${e.id}:${e.type}`), view,
    JSON.stringify(racks.map(r => [r.id, r.name, r.devices, r.macros.map(m => [m.name, m.mode ?? 'knob', m.mappings.map(x => `${x.device}:${x.param}`)])]))].join('|');

/** The names of a chain's devices: "Delay", "Delay 2"…, and of the racks. */
export function deviceLabels(p: Project, owner: ChainOwner): Map<DeviceKey, string> {
  const out = new Map<DeviceKey, string>(p.racksOf(owner).map(r => [r.id, rackName(r)]));
  const seen = new Map<string, number>();
  for (const key of p.chainKeys(owner)) {
    const label = deviceTypeAt(p, owner, key)?.label ?? key;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    out.set(key, n > 1 ? `${label} ${n}` : label);
  }
  return out;
}

export const sameModTarget = (a: ModTarget, b: ModTarget): boolean =>
  a.kind === b.kind && a.param === b.param && (a.kind !== 'device' || (b.kind === 'device' && a.device === b.device));

/** A modulator target's name: "Prisma · Cutoff", "Rack · Macro 2", "Volume". */
export function modTargetLabel(p: Project, owner: ChainOwner, t: ModTarget): string {
  if (t.kind === 'mixer') return t.param === 'volume' ? 'Track volume' : 'Track pan';
  if (t.kind === 'clip') return 'Transpose';
  const device = deviceLabels(p, owner).get(t.device);
  if (!device) return `(removed) · ${t.param}`;
  return `${device} · ${mappingSpec(p, owner, { device: t.device, param: t.param })?.label ?? t.param}`;
}

/** The modulators' targets from a menu: the track's volume and pan, the racks' macros. */
export function modTargetChoices(p: Project, owner: ChainOwner): { target: ModTarget; label: string }[] {
  const mixer: ModTarget[] = owner === MASTER ? [] : [{ kind: 'mixer', param: 'volume' }, { kind: 'mixer', param: 'pan' }];
  const macros = p.racksOf(owner).flatMap(r => r.macros.map((_, i): ModTarget => ({ kind: 'device', device: r.id, param: macroParam(i) })));
  return [...mixer, ...macros].map(target => ({ target, label: modTargetLabel(p, owner, target) }));
}

/** The controls the chain's modulators move, as "device|param". */
export function modulatedParams(p: Project, owner: ChainOwner): Set<string> {
  const moved = new Set<string>();
  for (const e of p.effectsOf(owner)) for (const t of e.targets ?? []) if (t?.kind === 'device') moved.add(`${t.device}|${t.param}`);
  return moved;
}
