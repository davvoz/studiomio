/* Ciò che il browser carica nel progetto: uno strumento o un effetto (con il suo preset) su una
 * traccia, come in Live. Ognuna è un solo passo di annullamento. */
import type { TrackId } from '../core/id';
import type { Preset } from '../devices/device-type';
import { DEFAULT_INSTRUMENT, withPreset, type InstrumentSettings } from '../model/device';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { MidiTrack } from '../model/track';
import { addEffect, addTrack, loadEffectPreset, setInstrument, type TrackKind } from './edits';
import { edit, type Edit, type EditContext } from './project-store';
import { reapplyMacros } from './rack-edits';

/** Una traccia nuova di tipo `kind` subito dopo `near` (e nel suo gruppo), o in fondo; restituisce
 *  anche il suo id. */
function newTrack(p: Project, ctx: EditContext, kind: TrackKind, near: TrackId | null): [Project, TrackId] {
  const place = near && p.tracks.some(t => t.id === near) ? { after: near } : undefined;
  const before = new Set(p.tracks.map(t => t.id));
  const next = addTrack(kind, place).apply(p, ctx);
  return [next, next.tracks.find(t => !before.has(t.id))!.id];
}

/** Le impostazioni di uno strumento di tipo `type`, con i valori del preset (o i predefiniti). */
export const instrumentSettings = (type: string, preset: Preset | null): InstrumentSettings => {
  const base: InstrumentSettings = { ...DEFAULT_INSTRUMENT, type, preset: null, params: {} };
  return preset ? withPreset(base, preset.name, preset.params) : base;
};

/** Lo strumento (con il preset) sulla traccia `target` se è MIDI; altrimenti su una traccia MIDI
 *  nuova, subito dopo (o in fondo, senza traccia). */
export const loadInstrument = (target: TrackId | null, type: string, label: string, preset: Preset | null): Edit =>
  edit(`Carica ${preset?.name ?? label}`, (p, ctx) => {
    let next = p, track = target;
    if (!track || !(p.track(track) instanceof MidiTrack)) [next, track] = newTrack(p, ctx, 'midi', target);
    next = setInstrument(track, instrumentSettings(type, preset)).apply(next, ctx);
    return preset ? reapplyMacros(next, track) : next;
  });

/** Un effetto (con il preset) in fondo alla catena di `owner` (una traccia, un bus o il master);
 *  senza, su una traccia audio nuova, come quando in Live lo si lascia sotto le tracce. */
export const loadEffect = (owner: ChainOwner | null, type: string, label: string, preset: Preset | null): Edit =>
  edit(`Carica ${preset ? `${label}: ${preset.name}` : label}`, (p, ctx) => {
    let next = p, target = owner;
    if (!target || (target !== MASTER && !p.track(target))) [next, target] = newTrack(p, ctx, 'audio', null);
    const before = new Set(next.effectsOf(target).map(e => e.id));
    next = addEffect(target, type, label).apply(next, ctx);
    const added = next.effectsOf(target).find(e => !before.has(e.id));
    return preset && added ? loadEffectPreset(target, added.id, preset.name, preset.params).apply(next, ctx) : next;
  });
