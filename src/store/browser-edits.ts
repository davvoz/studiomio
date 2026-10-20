/* Ciò che il browser carica nel progetto: uno strumento o un effetto (con il suo preset) su una
 * traccia, un rack salvato, o un sample in un Sampler, come in Live. Ognuna è un solo passo di
 * annullamento. */
import type { TrackId } from '../core/id';
import type { Preset } from '../devices/device-type';
import { SAMPLE_SLOT, SAMPLER } from '../devices/instruments/sampler/sampler';
import { DEFAULT_INSTRUMENT, newEffect, withPreset, type EffectSettings, type InstrumentSettings } from '../model/device';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { rackOf, ungroup, type DeviceKey, type Macro, type Rack } from '../model/rack';
import type { RackPreset } from '../model/rack-preset';
import type { SampleRef } from '../model/sample';
import { MidiTrack } from '../model/track';
import { addEffect, addTrack, loadEffectPreset, setInstrument, setInstrumentSamples, type TrackKind } from './edits';
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

/** Un sample lasciato sulla catena di una traccia MIDI, come in Live: lo suona un Sampler. Se lo
 *  strumento è già un Sampler cambia solo il sample (le impostazioni restano); altrimenti un
 *  Sampler nuovo prende il posto dello strumento. Un passo solo. */
export const loadSampler = (track: TrackId, sample: SampleRef): Edit =>
  edit(`Sampler: ${sample.name}`, (p, ctx) => {
    const t = p.track(track);
    if (!(t instanceof MidiTrack)) throw new TypeError(`la traccia ${t?.name ?? track} non ha uno strumento`);
    const next = t.instrument.type === SAMPLER.type ? p : setInstrument(track, instrumentSettings(SAMPLER.type, null)).apply(p, ctx);
    return setInstrumentSamples(track, { [SAMPLE_SLOT]: sample }).apply(next, ctx);
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

/** Un rack salvato nella catena di `owner`, come in Live. Un Instrument Rack prende il posto
 *  dello strumento (il rack in cui era si separa) e i suoi effetti vanno prima degli altri; su
 *  una traccia senza strumento va su una traccia MIDI nuova, subito dopo. Un Audio Effect Rack
 *  va in fondo alla catena; senza traccia, su una traccia audio nuova. */
export const loadRack = (owner: ChainOwner | null, preset: RackPreset): Edit =>
  edit(`Carica ${preset.name}`, (p, ctx) => {
    let next = p, target = owner;
    const { instrument } = preset;
    if (instrument) {
      if (target === MASTER) throw new Error(`«${preset.name}» ha uno strumento: va su una traccia MIDI`);
      if (!target || !(p.track(target) instanceof MidiTrack)) [next, target] = newTrack(p, ctx, 'midi', target);
      const old = rackOf(next.racksOf(target), INSTRUMENT_DEVICE);
      if (old) next = next.updatingRacks(target, racks => ungroup(racks, old.id));
      next = setInstrument(target, { ...DEFAULT_INSTRUMENT, ...instrument, params: { ...instrument.params } }).apply(next, ctx);
    } else if (!target || (target !== MASTER && !p.track(target))) [next, target] = newTrack(p, ctx, 'audio', null);
    const effects = preset.effects.map((e): EffectSettings =>
      ({ ...newEffect(ctx.ids.next('device'), e.type), enabled: e.enabled, preset: e.preset, params: { ...e.params } }));
    const devices: DeviceKey[] = [...(instrument ? [INSTRUMENT_DEVICE] as const : []), ...effects.map(e => e.id)];
    const rack: Rack = {
      id: ctx.ids.next('device'),
      name: preset.name,
      devices,
      macros: preset.macros.map(({ mappings, ...m }): Macro => ({ ...m, mappings: mappings.map(x => ({ ...x, device: devices[x.device] })) })),
    };
    next = next.updatingChain(target, c => ({
      effects: instrument ? [...effects, ...c.effects] : [...c.effects, ...effects],
      racks: [...c.racks, rack],
    }));
    // i parametri mappati dove le macro li portano
    return reapplyMacros(next, target);
  });
