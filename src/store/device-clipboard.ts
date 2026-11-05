/* Dispositivi negli appunti: effetti, strumento o un rack intero, da incollare nella stessa catena
 * o in un'altra del progetto. Si copia una fotografia; incollare crea id nuovi. Un rack passa dal
 * formato dei rack salvati (che tiene mappature e destinazioni dei modulatori); ciò che quello
 * lascia fuori, perché è del progetto, si rimette qui: i sample dello strumento e il sidechain. */
import type { DeviceId, TrackId } from '../core/id';
import type { EffectSettings, InstrumentSettings } from '../model/device';
import { INSTRUMENT_DEVICE, type ModTarget } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { findRack, rackName, racksWith, type DeviceKey } from '../model/rack';
import { captureRack, type RackPreset } from '../model/rack-preset';
import { MidiTrack } from '../model/track';
import { loadRack } from './browser-edits';
import { removeEffect, setInstrument } from './edits';
import { edit, type Edit, type EditContext } from './project-store';

export interface CopiedDevices {
  readonly kind: 'devices';
  /** La catena da cui vengono: lì le destinazioni dei modulatori valgono ancora. */
  readonly owner: ChainOwner;
  readonly instrument: InstrumentSettings | null;
  readonly effects: readonly EffectSettings[];
  /** Copiato con un clic sul nome del rack: il rack intero (`effects` sono i suoi effetti). */
  readonly rack: RackPreset | null;
}

const instrumentOf = (p: Project, owner: ChainOwner): InstrumentSettings | null => {
  const t = owner === MASTER ? undefined : p.track(owner);
  return t instanceof MidiTrack ? t.instrument : null;
};

const isMidi = (p: Project, owner: ChainOwner) => instrumentOf(p, owner) !== null;

/** I dispositivi `keys` della catena di `owner`, nell'ordine del suono; null se non c'è niente. */
export function copyDevices(p: Project, owner: ChainOwner, keys: readonly DeviceKey[]): CopiedDevices | null {
  const instrument = keys.includes(INSTRUMENT_DEVICE) ? instrumentOf(p, owner) : null;
  const effects = p.effectsOf(owner).filter(e => keys.includes(e.id));
  return instrument || effects.length ? { kind: 'devices', owner, instrument, effects, rack: null } : null;
}

export function copyRack(p: Project, owner: ChainOwner, id: DeviceId): CopiedDevices | null {
  const rack = findRack(p.racksOf(owner), id);
  if (!rack) return null;
  return {
    kind: 'devices', owner, rack: captureRack(p, owner, id, rackName(rack)),
    instrument: rack.devices.includes(INSTRUMENT_DEVICE) ? instrumentOf(p, owner) : null,
    effects: p.effectsOf(owner).filter(e => rack.devices.includes(e.id)),
  };
}

/** Dove va ciò che si incolla dopo `after`: dopo il rack più esterno che lo contiene, per non
 *  finirgli in mezzo; senza `after`, in fondo. */
function indexAfter(p: Project, owner: ChainOwner, after: DeviceKey | null): number {
  const effects = p.effectsOf(owner), order = p.chainKeys(owner);
  if (!after) return effects.length;
  const keys = [after, ...racksWith(p.racksOf(owner), after).flatMap(r => r.devices)];
  const last = order[Math.max(...keys.map(k => order.indexOf(k)))];
  return effects.findIndex(e => e.id === last) + 1;
}

/** Gli effetti con id nuovi. Una destinazione di un modulatore segue il suo bersaglio se è stato
 *  copiato insieme a lui; altrimenti vale solo restando nella stessa catena (o puntando allo
 *  strumento, se è arrivato anche lui). Una traccia non può ascoltare sé stessa. */
function freshEffects(content: CopiedDevices, owner: ChainOwner, ctx: EditContext): EffectSettings[] {
  const ids = new Map(content.effects.map(e => [e.id as DeviceKey, ctx.ids.next('device')]));
  const retarget = (t: ModTarget | null): ModTarget | null => {
    if (t?.kind !== 'device') return t;
    const device = ids.get(t.device);
    if (device) return { ...t, device };
    return owner === content.owner || (t.device === INSTRUMENT_DEVICE && content.instrument) ? t : null;
  };
  return content.effects.map(e => {
    const { sidechain, targets, ...rest } = e;
    return {
      ...rest, id: ids.get(e.id)!,
      ...(sidechain && sidechain !== owner ? { sidechain } : {}),
      ...(targets ? { targets: targets.map(retarget) } : {}),
    };
  });
}

function pasteRack(p: Project, content: CopiedDevices, owner: ChainOwner, ctx: EditContext): Project {
  const before = new Set(p.effectsOf(owner).map(e => e.id));
  let next = loadRack(owner, content.rack!).apply(p, ctx);
  const added = next.effectsOf(owner).filter(e => !before.has(e.id));
  next = added.reduce((q, e, i) => {
    const source = content.effects[i]?.sidechain;
    return source && source !== owner ? q.updatingEffects(owner, list => list.map(x => (x.id === e.id ? { ...x, sidechain: source } : x))) : q;
  }, next);
  return content.instrument?.samples && isMidi(next, owner) ? setInstrument(owner as TrackId, content.instrument).apply(next, ctx) : next;
}

/** Incolla nella catena di `owner`, dopo il dispositivo `after` (senza, in fondo). Lo strumento
 *  prende il posto di quello della traccia; un rack va in fondo, come quando arriva dal browser. */
export const pasteDevices = (content: CopiedDevices, owner: ChainOwner, after: DeviceKey | null = null): Edit =>
  edit(content.rack ? `Incolla ${content.rack.name}` : 'Incolla dispositivi', (p, ctx) => {
    if (content.rack) return pasteRack(p, content, owner, ctx);
    if (content.instrument && !content.effects.length && !isMidi(p, owner)) throw new Error('Lo strumento va su una traccia MIDI.');
    const next = content.instrument && isMidi(p, owner) ? setInstrument(owner as TrackId, content.instrument).apply(p, ctx) : p;
    const fresh = freshEffects(content, owner, ctx), at = indexAfter(next, owner, after);
    return next.updatingEffects(owner, list => [...list.slice(0, at), ...fresh, ...list.slice(at)]);
  });

/** Toglie gli effetti `keys` (lo strumento resta: una traccia MIDI ne ha sempre uno). */
export const removeDevices = (owner: ChainOwner, keys: readonly DeviceKey[]): Edit =>
  edit('Taglia dispositivi', (p, ctx) => keys.reduce((q, k) => (k === INSTRUMENT_DEVICE ? q : removeEffect(owner, k).apply(q, ctx)), p));
