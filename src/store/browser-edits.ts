/* What the browser loads into the project: an instrument or an effect (with its preset) on a
 * track, a saved rack, or a sample in a Sampler, as in Live. Each is a single undo
 * step. */
import type { TrackId } from '../core/id';
import type { Preset } from '../devices/device-type';
import { effectType } from '../devices/registry';
import { SAMPLE_SLOT, SAMPLER } from '../devices/instruments/sampler/sampler';
import { DEFAULT_INSTRUMENT, newEffect, withPreset, type EffectSettings, type InstrumentSettings } from '../model/device';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { racksWith, ungroup, type DeviceKey } from '../model/rack';
import { presetRacks, presetTarget, type RackPreset } from '../model/rack-preset';
import type { SampleRef } from '../model/sample';
import { MidiTrack } from '../model/track';
import { addEffect, addTrack, loadEffectPreset, setInstrument, setInstrumentSamples, type TrackKind } from './edits';
import { edit, type Edit, type EditContext } from './project-store';
import { reapplyMacros } from './rack-edits';

/** A new track of kind `kind` right after `near` (and in its group), or at the end; it also returns
 *  its id. */
function newTrack(p: Project, ctx: EditContext, kind: TrackKind, near: TrackId | null): [Project, TrackId] {
  const place = near && p.tracks.some(t => t.id === near) ? { after: near } : undefined;
  const before = new Set(p.tracks.map(t => t.id));
  const next = addTrack(kind, place).apply(p, ctx);
  return [next, next.tracks.find(t => !before.has(t.id))!.id];
}

/** The settings of an instrument of type `type`, with the preset's values (or the defaults). */
export const instrumentSettings = (type: string, preset: Preset | null): InstrumentSettings => {
  const base: InstrumentSettings = { ...DEFAULT_INSTRUMENT, type, preset: null, params: {} };
  return preset ? withPreset(base, preset.name, preset.params) : base;
};

/** The instrument (with the preset) on track `target` if it's MIDI; otherwise on a new MIDI
 *  track, right after (or at the end, without a track). */
export const loadInstrument = (target: TrackId | null, type: string, label: string, preset: Preset | null): Edit =>
  edit(`Load ${preset?.name ?? label}`, (p, ctx) => {
    let next = p, track = target;
    if (!track || !(p.track(track) instanceof MidiTrack)) [next, track] = newTrack(p, ctx, 'midi', target);
    next = setInstrument(track, instrumentSettings(type, preset)).apply(next, ctx);
    return preset ? reapplyMacros(next, track) : next;
  });

/** A sample dropped on a MIDI track's chain, as in Live: a Sampler plays it. If the
 *  instrument is already a Sampler only the sample changes (the settings stay); otherwise a
 *  new Sampler takes the instrument's place. A single step. */
export const loadSampler = (track: TrackId, sample: SampleRef): Edit =>
  edit(`Sampler: ${sample.name}`, (p, ctx) => {
    const t = p.track(track);
    if (!(t instanceof MidiTrack)) throw new TypeError(`the track ${t?.name ?? track} has no instrument`);
    const next = t.instrument.type === SAMPLER.type ? p : setInstrument(track, instrumentSettings(SAMPLER.type, null)).apply(p, ctx);
    return setInstrumentSamples(track, { [SAMPLE_SLOT]: sample }).apply(next, ctx);
  });

/** An effect (with the preset) at the end of `owner`'s chain (a track, a bus or the master);
 *  without, on a new audio track, as when in Live it's dropped below the tracks. */
export const loadEffect = (owner: ChainOwner | null, type: string, label: string, preset: Preset | null): Edit =>
  edit(`Load ${preset ? `${label}: ${preset.name}` : label}`, (p, ctx) => {
    let next = p, target = owner;
    // whoever works on notes wants an instrument: outside a MIDI track one is created
    const notes = !!effectType(type)?.notes;
    if (notes && !(target && p.track(target as TrackId) instanceof MidiTrack)) [next, target] = newTrack(p, ctx, 'midi', null);
    else if (!target || (target !== MASTER && !p.track(target))) [next, target] = newTrack(p, ctx, 'audio', null);
    const before = new Set(next.effectsOf(target).map(e => e.id));
    next = addEffect(target, type, label).apply(next, ctx);
    const added = next.effectsOf(target).find(e => !before.has(e.id));
    return preset && added ? loadEffectPreset(target, added.id, preset.name, preset.params).apply(next, ctx) : next;
  });

/** A saved rack in `owner`'s chain, as in Live. An Instrument Rack takes the place
 *  of the instrument (the racks it was in are ungrouped) and its effects go before the others; on
 *  a track without instrument it goes on a new MIDI track, right after. An Audio Effect Rack
 *  goes at the end of the chain; without a track, on a new audio track. */
export const loadRack = (owner: ChainOwner | null, preset: RackPreset): Edit =>
  edit(`Load ${preset.name}`, (p, ctx) => {
    let next = p, target = owner;
    const { instrument } = preset;
    if (instrument) {
      if (target === MASTER) throw new Error(`«${preset.name}» has an instrument: it goes on a MIDI track`);
      if (!target || !(p.track(target) instanceof MidiTrack)) [next, target] = newTrack(p, ctx, 'midi', target);
      for (const old of racksWith(next.racksOf(target), INSTRUMENT_DEVICE)) next = next.updatingRacks(target, racks => ungroup(racks, old.id));
      next = setInstrument(target, { ...DEFAULT_INSTRUMENT, ...instrument, params: { ...instrument.params } }).apply(next, ctx);
    } else if (!target || (target !== MASTER && !p.track(target))) [next, target] = newTrack(p, ctx, 'audio', null);
    const fresh = preset.effects.map((e): EffectSettings =>
      ({ ...newEffect(ctx.ids.next('device'), e.type), enabled: e.enabled, preset: e.preset, params: { ...e.params } }));
    const devices: DeviceKey[] = [...(instrument ? [INSTRUMENT_DEVICE] as const : []), ...fresh.map(e => e.id)];
    const racks = presetRacks(preset, devices, () => ctx.ids.next('device'));
    // the modulators' targets, inside the rack just placed
    const effects = fresh.map((e, i) => {
      const saved = preset.effects[i].targets;
      return saved ? { ...e, targets: saved.map(t => presetTarget(t, devices, racks)) } : e;
    });
    next = next.updatingChain(target, c => ({
      effects: instrument ? [...effects, ...c.effects] : [...c.effects, ...effects],
      racks: [...c.racks, ...racks],
    }));
    // the mapped parameters where the macros take them
    return reapplyMacros(next, target);
  });
