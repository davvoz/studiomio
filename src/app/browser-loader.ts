/* Dove va ciò che arriva dal browser, come in Live: uno strumento sulla traccia MIDI (su un'altra
 * traccia, in una traccia MIDI nuova), un effetto in fondo alla catena, un sample sulla timeline,
 * in uno slot o (sulla catena di una traccia MIDI) in un Sampler. Con il doppio clic va dove si sta lavorando: la catena aperta in basso, lo slot
 * scelto nella session, la traccia scelta al cursore nella timeline. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { BrowserPayload, LoadTarget } from '../browser/item';
import type { Preset } from '../devices/device-type';
import { effectType, instrumentType } from '../devices/registry';
import { MASTER, type ChainOwner } from '../model/project';
import type { SampleRef } from '../model/sample';
import { MidiTrack } from '../model/track';
import { loadEffect, loadInstrument, loadSampler } from '../store/browser-edits';
import type { ProjectStore } from '../store/project-store';
import { addedPlacements, importSample } from '../store/selection-edits';
import { importSampleToSlot } from '../store/session-edits';
import type { UiState } from '../ui/ui-state';

export interface BrowserLoaderDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  /** L'import dei file audio, come quando li si trascina da fuori. */
  readonly importFiles: (files: File[], track: TrackId | null, beat: Beats) => Promise<void>;
  readonly importFilesToSlots: (files: File[], track: TrackId | null, slot: number) => Promise<void>;
  /** Copia un file audio nel progetto (per il Sampler). */
  readonly importSample: (file: File) => Promise<SampleRef>;
  /** Il cursore della timeline: un sample caricato su una catena va lì. */
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
    this.deps.say(`${preset ? `${label}: ${preset.name}` : label} in fondo agli effetti di "${name}".`);
  }

  private async audio(payload: Extract<BrowserPayload, { kind: 'sample' | 'file' }>, target: LoadTarget): Promise<void> {
    const { store, ui } = this.deps;
    // sulla catena di una traccia MIDI: lo suona un Sampler
    const midi = target.kind === 'chain' && target.owner !== MASTER ? store.project.track(target.owner) : undefined;
    if (midi instanceof MidiTrack) {
      const sample = payload.kind === 'sample' ? payload.sample : await this.deps.importSample(await payload.file());
      store.apply(loadSampler(midi.id, sample));
      this.deps.openDevices(midi.id);
      return this.deps.say(`"${sample.name}" nel Sampler di "${midi.name}".`);
    }
    // su una catena: sulla timeline della sua traccia, al cursore
    const at: LoadTarget = target.kind === 'chain'
      ? { kind: 'lane', track: target.owner === MASTER ? null : target.owner, beat: this.deps.cursor() } : target;
    if (payload.kind === 'file') {
      const file = await payload.file();
      return at.kind === 'slot' ? this.deps.importFilesToSlots([file], at.track, at.slot) : this.deps.importFiles([file], at.track, at.kind === 'lane' ? at.beat : 0);
    }
    const before = store.project;
    if (at.kind === 'slot') {
      if (at.slot >= before.scenes.length) return this.deps.say('Nessuna scena lì: aggiungine una per metterci il sample.');
      store.apply(importSampleToSlot(payload.sample, at.track, at.slot));
    } else if (at.kind === 'lane') {
      store.apply(importSample(payload.sample, at.track, at.beat));
      ui.select(addedPlacements(before, store.project).map(r => r.id));
    }
  }
}

/** La traccia (o il master) su cui va un dispositivo. */
const ownerOf = (target: LoadTarget): ChainOwner | null => (target.kind === 'chain' ? target.owner : target.track);
