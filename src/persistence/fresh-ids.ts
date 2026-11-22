/* New ids for a project's tracks, devices, racks, clips and samples, so that its parts can go into
 * another project (also a copy of the same one) without colliding. It goes through the file
 * format: every reference (racks, macros, modulators, sidechains, sends, groups, curves) follows its
 * track or device, also those that future versions of the format will add. */
import type { IdFactory } from '../core/id';
import type { Project } from '../model/project';
import type { Json } from './json-reader';
import { ProjectCodec } from './project-codec';

/** The project with new ids, made by `ids`; the rest (names, parameters, files) doesn't change. */
export function withFreshIds(project: Project, ids: IdFactory, codec = new ProjectCodec()): Project {
  return codec.decode(remapped(codec.encode(project), freshIds(project, ids)));
}

/** Old id → new id, for everything that has an id in the project. */
function freshIds(p: Project, ids: IdFactory): Map<string, string> {
  const owned: [id: string, kind: string][] = [
    ...p.channels.flatMap((t): [string, string][] => [
      [t.id, 'track'],
      ...[...t.effects, ...t.racks].map((d): [string, string] => [d.id, 'device']),
      ...t.arrangement.map((pl): [string, string] => [pl.id, 'placement']),
      ...t.clips.map((c): [string, string] => [c.id, 'clip']),
    ]),
    ...[...p.masterEffects, ...p.masterRacks].map((d): [string, string] => [d.id, 'device']),
    ...p.samples.map((s): [string, string] => [s.id, 'sample']),
  ];
  const fresh = new Map<string, string>();
  // the same id in several places (a clip copied to the session) gets the same new id
  for (const [id, kind] of owned) if (!fresh.has(id)) fresh.set(id, ids.next(kind));
  return fresh;
}

/** An id, or a target key starting with one ("<device id>:cutoff"), with the new id. */
function renamed(text: string, fresh: ReadonlyMap<string, string>): string {
  const whole = fresh.get(text);
  if (whole) return whole;
  const colon = text.indexOf(':');
  const head = colon > 0 ? fresh.get(text.slice(0, colon)) : undefined;
  return head ? head + text.slice(colon) : text;
}

/** The JSON with the ids renamed, in the values and in the keys (sends, curves). */
function remapped(json: Json, fresh: ReadonlyMap<string, string>): Json {
  if (typeof json === 'string') return renamed(json, fresh);
  if (Array.isArray(json)) return json.map(v => remapped(v, fresh));
  if (json && typeof json === 'object') {
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [renamed(k, fresh), remapped(v, fresh)]));
  }
  return json;
}
