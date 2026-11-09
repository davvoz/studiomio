/* Where what comes from the browser goes, as in Live: an instrument on the MIDI track (on another
 * track, in a new MIDI track), an effect at the end of the chain, a saved rack (an
 * Instrument Rack like an instrument, an Audio Effect Rack like an effect), a sample on the timeline,
 * in a slot or (on a MIDI track's chain) in a Sampler. With a double click it goes where you're working: the chain open at the bottom, the slot
 * chosen in the session, the chosen track at the cursor in the timeline. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { BrowserPayload, LoadTarget } from '../browser/item';
import type { Preset } from '../devices/device-type';
import { effectType, instrumentType } from '../devices/registry';
import { MASTER, type ChainOwner } from '../model/project';
import type { RackPreset } from '../model/rack-preset';
import type { SampleRef } from '../model/sample';
import { MidiTrack } from '../model/track';
import { loadEffect, loadInstrument, loadRack, loadSampler } from '../store/browser-edits';
import type { ProjectStore } from '../store/project-store';
import { addedPlacements, importSample } from '../store/selection-edits';
import { importSampleToSlot } from '../store/session-edits';
import type { UiState } from '../ui/ui-state';

export interface BrowserLoaderDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  /** Importing audio files, as when they're dragged in from outside. */
  readonly importFiles: (files: File[], track: TrackId | null, beat: Beats) => Promise<void>;
  readonly importFilesToSlots: (files: File[], track: TrackId | null, slot: number) => Promise<void>;
  /** Copies an audio file into the project (for the Sampler). */
  readonly importSample: (file: File) => Promise<SampleRef>;
  /** The timeline cursor: a sample loaded on a chain goes there. */
  readonly cursor: () => Beats;
  readonly openDevices: (owner: ChainOwner) => void;
  readonly say: (text: string) => void;
}

export class BrowserLoader {
  constructor(private readonly deps: BrowserLoaderDeps) {}

  async load(payload: BrowserPayload, target: LoadTarget): Promise<void> {
    switch (payload.kind) {
      case 'instrument': return this.instrument(payload.type, payload.preset, target);
      case 'effect': return this.effect(payload.type, payload.preset, target);
      case 'rack': return this.rack(payload.rack, target);
      case 'sample':
      case 'file': return this.audio(payload, target);
    }
  }

  private instrument(type: string, preset: Preset | null, target: LoadTarget): void {
    const { store, ui } = this.deps;
    const label = instrumentType(type)?.label ?? type;
    const owner = ownerOf(target);
    const before = new Set(store.project.tracks.map(t => t.id));
    store.apply(loadInstrument(owner === MASTER ? null : owner, type, label, preset));
    const track = store.project.tracks.find(t => !before.has(t.id)) ?? (owner && owner !== MASTER ? store.project.track(owner) : undefined);
    if (!track) return;
    ui.selectTrack(track.id);
    this.deps.openDevices(track.id);
    this.deps.say(`${preset ? `${label}: ${preset.name}` : label} su "${track.name}".`);
  }

  private effect(type: string, preset: Preset | null, target: LoadTarget): void {
    const { store } = this.deps;
    const label = effectType(type)?.label ?? type;
    const owner = ownerOf(target);
    const before = new Set(store.project.tracks.map(t => t.id));
    store.apply(loadEffect(owner, type, label, preset));
    const where = store.project.tracks.find(t => !before.has(t.id))?.id ?? owner;
    if (!where) return;
    this.deps.openDevices(where);
    const name = where === MASTER ? 'Master' : store.project.track(where)?.name;
    this.deps.say(`${preset ? `${label}: ${preset.name}` : label} at the end of "${name}"'s effects.`);
  }

  private rack(rack: RackPreset, target: LoadTarget): void {
    const { store, ui, say } = this.deps;
    const owner = ownerOf(target);
    if (rack.instrument && owner === MASTER) return say(`«${rack.name}» has an instrument: it goes on a MIDI track, not on the master.`);
    // a rack saved with a newer version of the app may have devices this one doesn't have
    const unknown = [
      ...(rack.instrument && !instrumentType(rack.instrument.type) ? [rack.instrument.type] : []),
      ...rack.effects.filter(e => !effectType(e.type)).map(e => e.type),
    ];
    if (unknown.length) return say(`«${rack.name}» uses devices this version doesn't have (${unknown.join(', ')}): update the app.`);
    const before = new Set(store.project.tracks.map(t => t.id));
    store.apply(loadRack(owner, rack));
    const where = store.project.tracks.find(t => !before.has(t.id))?.id ?? owner;
    if (!where) return;
    if (rack.instrument && where !== MASTER) ui.selectTrack(where);
    this.deps.openDevices(where);
    const name = where === MASTER ? 'Master' : store.project.track(where)?.name;
    say(rack.instrument ? `Rack «${rack.name}» on "${name}".` : `Rack «${rack.name}» at the end of "${name}"'s effects.`);
  }

  private async audio(payload: Extract<BrowserPayload, { kind: 'sample' | 'file' }>, target: LoadTarget): Promise<void> {
    const { store, ui } = this.deps;
    // on a MIDI track's chain: a Sampler plays it
    const midi = target.kind === 'chain' && target.owner !== MASTER ? store.project.track(target.owner) : undefined;
    if (midi instanceof MidiTrack) {
      const sample = payload.kind === 'sample' ? payload.sample : await this.deps.importSample(await payload.file());
      store.apply(loadSampler(midi.id, sample));
      this.deps.openDevices(midi.id);
      return this.deps.say(`"${sample.name}" in "${midi.name}"'s Sampler.`);
    }
    // on a chain: on its track's timeline, at the cursor
    const at: LoadTarget = target.kind === 'chain'
      ? { kind: 'lane', track: target.owner === MASTER ? null : target.owner, beat: this.deps.cursor() } : target;
    if (payload.kind === 'file') {
      const file = await payload.file();
      return at.kind === 'slot' ? this.deps.importFilesToSlots([file], at.track, at.slot) : this.deps.importFiles([file], at.track, at.kind === 'lane' ? at.beat : 0);
    }
    const before = store.project;
    if (at.kind === 'slot') {
      if (at.slot >= before.scenes.length) return this.deps.say('No scene there: add one to put the sample in it.');
      store.apply(importSampleToSlot(payload.sample, at.track, at.slot));
    } else if (at.kind === 'lane') {
      store.apply(importSample(payload.sample, at.track, at.beat));
      ui.select(addedPlacements(before, store.project).map(r => r.id));
    }
  }
}

/** The track (or the master) a device goes on. */
const ownerOf = (target: LoadTarget): ChainOwner | null => (target.kind === 'chain' ? target.owner : target.track);
