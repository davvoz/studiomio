/* Devices in the clipboard: effects, instrument or a whole rack, to paste in the same chain
 * or in another one of the project. A snapshot is copied; pasting creates new ids. A rack goes through the
 * saved rack format (which keeps mappings and modulator targets); what that one
 * leaves out, because it belongs to the project, is put back here: the instrument's samples and the sidechain. */
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
  /** The chain they come from: there the modulators' targets still apply. */
  readonly owner: ChainOwner;
  readonly instrument: InstrumentSettings | null;
  readonly effects: readonly EffectSettings[];
  /** Copied with a click on the rack's name: the whole rack (`effects` are its effects). */
  readonly rack: RackPreset | null;
}

const instrumentOf = (p: Project, owner: ChainOwner): InstrumentSettings | null => {
  const t = owner === MASTER ? undefined : p.track(owner);
  return t instanceof MidiTrack ? t.instrument : null;
};

const isMidi = (p: Project, owner: ChainOwner) => instrumentOf(p, owner) !== null;

/** The devices `keys` of `owner`'s chain, in the order of the sound; null if there's nothing. */
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

/** Where what's pasted after `after` goes: after the outermost rack containing it, so as not to
 *  end up in its middle; without `after`, at the end. */
function indexAfter(p: Project, owner: ChainOwner, after: DeviceKey | null): number {
  const effects = p.effectsOf(owner), order = p.chainKeys(owner);
  if (!after) return effects.length;
  const keys = [after, ...racksWith(p.racksOf(owner), after).flatMap(r => r.devices)];
  const last = order[Math.max(...keys.map(k => order.indexOf(k)))];
  return effects.findIndex(e => e.id === last) + 1;
}

/** The effects with new ids. A modulator's target follows its target if it was
 *  copied together with it; otherwise it applies only staying in the same chain (or pointing to the
 *  instrument, if that came along too). A track can't listen to itself. */
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

/** Pastes into `owner`'s chain, after device `after` (without, at the end). The instrument
 *  takes the place of the track's; a rack goes at the end, as when it comes from the browser. */
export const pasteDevices = (content: CopiedDevices, owner: ChainOwner, after: DeviceKey | null = null): Edit =>
  edit(content.rack ? `Paste ${content.rack.name}` : 'Paste devices', (p, ctx) => {
    if (content.rack) return pasteRack(p, content, owner, ctx);
    if (content.instrument && !content.effects.length && !isMidi(p, owner)) throw new Error('The instrument goes on a MIDI track.');
    const next = content.instrument && isMidi(p, owner) ? setInstrument(owner as TrackId, content.instrument).apply(p, ctx) : p;
    const fresh = freshEffects(content, owner, ctx), at = indexAfter(next, owner, after);
    return next.updatingEffects(owner, list => [...list.slice(0, at), ...fresh, ...list.slice(at)]);
  });

/** Removes the effects `keys` (the instrument stays: a MIDI track always has one). */
export const removeDevices = (owner: ChainOwner, keys: readonly DeviceKey[]): Edit =>
  edit('Cut devices', (p, ctx) => keys.reduce((q, k) => (k === INSTRUMENT_DEVICE ? q : removeEffect(owner, k).apply(q, ctx)), p));
