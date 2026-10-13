/* Una catena di effetti come dati: la lista ordinata in cui il suono li attraversa. Funzioni
 * pure, usate da tracce e master: ognuna restituisce una lista nuova. */
import type { DeviceId } from '../core/id';
import type { EffectSettings } from './device';

export type EffectList = readonly EffectSettings[];

const clampIndex = (list: EffectList, index: number) => Math.max(0, Math.min(index, list.length));

function indexOf(list: EffectList, id: DeviceId): number {
  const i = list.findIndex(e => e.id === id);
  if (i < 0) throw new RangeError(`effetto ${id} non trovato`);
  return i;
}

/** Aggiunge un effetto in posizione `index` (in fondo se manca). */
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

/** Sposta un effetto nella posizione `index` della catena. */
export function move(list: EffectList, id: DeviceId, index: number): EffectList {
  const e = [...list];
  const [moved] = e.splice(indexOf(list, id), 1);
  e.splice(clampIndex(e, index), 0, moved);
  return e;
}
