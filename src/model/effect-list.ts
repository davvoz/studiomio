/* An effect chain as data: the ordered list the sound goes through. Pure
 * functions, used by tracks and master: each returns a new list. */
import type { DeviceId } from '../core/id';
import type { EffectSettings } from './device';

export type EffectList = readonly EffectSettings[];

const clampIndex = (list: EffectList, index: number) => Math.max(0, Math.min(index, list.length));

function indexOf(list: EffectList, id: DeviceId): number {
  const i = list.findIndex(e => e.id === id);
  if (i < 0) throw new RangeError(`effect ${id} not found`);
  return i;
}

/** Adds an effect at position `index` (at the end if missing). */
export function add(list: EffectList, effect: EffectSettings, index = list.length): EffectList {
  const e = [...list];
  e.splice(clampIndex(list, index), 0, effect);
  return e;
}

export function remove(list: EffectList, id: DeviceId): EffectList {
  indexOf(list, id);
  return list.filter(e => e.id !== id);
}

export function update(list: EffectList, id: DeviceId, fn: (e: EffectSettings) => EffectSettings): EffectList {
  indexOf(list, id);
  return list.map(e => (e.id === id ? { ...fn(e), id } : e));
}

/** Moves an effect to position `index` of the chain. */
export function move(list: EffectList, id: DeviceId, index: number): EffectList {
  const e = [...list];
  const [moved] = e.splice(indexOf(list, id), 1);
  e.splice(clampIndex(e, index), 0, moved);
  return e;
}
