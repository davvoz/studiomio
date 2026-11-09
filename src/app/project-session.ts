import { Emitter, type Unsubscribe } from '../core/emitter';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { zipParts } from '../dsp/codec/zip';
import type { AudioData } from '../dsp/types';
import { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { MemoryDirectory, type Directory } from '../persistence/directory';
import { FsAccessDirectory } from '../persistence/fs-access-directory';
import { ProjectFolder, safeFileName, unpackProject } from '../persistence/project-folder';
import type { ProjectStore } from '../store/project-store';
import { starterProject } from '../store/edits';
import { importSample } from '../store/selection-edits';
import { importSampleToSlot } from '../store/session-edits';
import { springsAtRest } from '../store/rack-edits';
import type { SampleId } from '../core/id';
import type { AudioAnalysis } from '../dsp/analysis/analyze';

/** What the session uses of the audio (AudioSystem satisfies it; tests use a fake). */
export interface SessionAudio {
  readonly context: { decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> };
  readonly engine: { stop(): void };
  readonly dsp: { analyze(sourceId: string, sensitivity: number): Promise<AudioAnalysis> };
  addSample(id: SampleId, audio: AudioData): Promise<void>;
}

type SessionEvents = {
  /** Folder or save state changed. */
  change: [];
  message: [text: string];
  /** The project now lives in this disk folder (opened or saved as). */
  stored: [dir: Directory];
};

/** The open project and its folder. A new project lives in an in-memory folder
 *  until it's saved to disk with "Save as". */
export class ProjectSession {
  private folder: ProjectFolder;
  private onDisk = false;
  private savedVersion: Project;
  /** The version last written to the recovery copy. */
  private autosaved: Project | null = null;
  private readonly events = new Emitter<SessionEvents>();

  constructor(private readonly store: ProjectStore, private readonly audio: SessionAudio, private readonly pickDirectory: () => Promise<Directory> = FsAccessDirectory.pick) {
    this.folder = new ProjectFolder(new MemoryDirectory('New project'));
    this.savedVersion = store.project;
    store.onChange(() => this.events.emit('change'));
  }

  on<K extends keyof SessionEvents>(event: K, fn: (...a: SessionEvents[K]) => void): Unsubscribe {
    return this.events.on(event, fn);
  }

  /** Folder name (or "New project" if it's not on disk yet). */
  get name(): string {
    return this.folder.name;
  }

  get saved(): boolean {
    return this.onDisk && !this.changed;
  }

  /** There are changes since the last save (or since opening): closing the project loses them. */
  get changed(): boolean {
    return this.store.project !== this.savedVersion;
  }

  /** The project as it is now counts as unmodified (e.g. the demo just loaded). */
  forgetChanges(): void {
    this.savedVersion = this.store.project;
    this.events.emit('change');
  }

  /** Imports audio files: copy into the project folder, analysis and clips on the timeline.
   *  Several files go on new tracks, one below the other. */
  async importFiles(files: readonly File[], target: TrackId | null, start: Beats): Promise<void> {
    for (const [i, file] of files.entries()) {
      try {
        const sample = await this.loadFile(file);
        this.store.apply(importSample(sample, i === 0 ? target : null, start));
        this.say(`Imported "${file.name}": ${sample.analysis?.tempo.toFixed(2)} BPM.`);
      } catch (e) {
        this.say(`Couldn't import "${file.name}": ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Imports audio files into session slots, from `slot` down in the same column (on
   *  a new audio track if `target` isn't one). Files past the last scene are skipped. */
  async importFilesToSlots(files: readonly File[], target: TrackId | null, slot: number): Promise<void> {
    let track = target;
    for (const [i, file] of files.entries()) {
      if (slot + i >= this.store.project.scenes.length) break;
      try {
        const sample = await this.loadFile(file);
        const before = this.store.project;
        this.store.apply(importSampleToSlot(sample, track, slot + i));
        // the first clip may have created a new track (at the bottom, or at the bottom of the group): the others go below it
        track = this.store.project.tracks.find(t => !before.track(t.id))?.id ?? track;
        this.say(`Imported "${file.name}" into the session.`);
      } catch (e) {
        this.say(`Couldn't import "${file.name}": ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Copies an audio file into the project folder and loads it in the engine, without putting it
   *  anywhere: the reference is used by whoever asks for it (e.g. a Drum Machine pad). */
  importSampleFile(file: File): Promise<SampleRef> {
    return this.loadFile(file);
  }

  /** Puts audio already in memory into the project folder (e.g. the demo loop). */
  async addAudio(name: string, data: AudioData, wav: Uint8Array): Promise<SampleRef> {
    const file = await this.folder.importAudio(name, wav);
    return this.register(name.replace(/\.[^.]+$/, ''), file, data);
  }

  /** A new project, with the starting tracks (see `starterProject`); `blank`: without tracks. */
  async newProject(blank = false): Promise<void> {
    this.audio.engine.stop();
    this.folder = new ProjectFolder(new MemoryDirectory('New project'));
    this.onDisk = false;
    this.store.load(blank ? Project.empty('New project', this.store.ids) : starterProject('New project', this.store.ids));
    this.savedVersion = this.store.project;
    this.events.emit('change');
  }

  /** Opens the project in folder `dir` (without: lets the user choose it). */
  async open(dir?: Directory): Promise<void> {
    dir ??= await this.pickDirectory();
    const folder = new ProjectFolder(dir);
    if (!(await folder.hasProject())) throw new Error(`"${dir.name}" doesn't contain a studiomio project`);
    await this.openFolder(folder, true, `Opened "${dir.name}".`);
    this.events.emit('stored', dir);
  }

  /** Opens a project received in a ZIP file (see `collectAndSave`). It stays in memory until
   *  it's saved: "Save" asks for the folder to put it in. */
  async openArchive(file: File): Promise<void> {
    const dir = await unpackProject(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.zip$/i, ''));
    await this.openFolder(new ProjectFolder(dir), false, `Opened "${dir.name}" from ${file.name}: save it to choose its folder.`);
  }

  private async openFolder(folder: ProjectFolder, onDisk: boolean, opened: string): Promise<void> {
    const { project, missing } = await folder.load();
    this.audio.engine.stop();
    await this.loadSamples(folder, project, missing);
    this.folder = folder;
    this.onDisk = onDisk;
    this.store.load(project);
    this.savedVersion = project;
    this.events.emit('change');
    this.say(missing.length ? `${opened} ${missing.length} audio files are missing: ${missing.map(s => s.file).join(', ')}` : opened);
  }

  /** True if the folder has a recovery copy (changes never saved: the app
   *  hung or was closed without saving). */
  async hasRecovery(): Promise<boolean> {
    return this.onDisk && (await this.folder.loadRecovery()) !== null;
  }

  /** Reopens the recovery copy in place of the saved project; it still needs saving. */
  async restoreRecovery(): Promise<void> {
    const recovered = await this.folder.loadRecovery();
    if (!recovered) return;
    const { project, missing } = recovered;
    this.audio.engine.stop();
    const loaded = new Set(this.store.project.samples.map(s => s.id));
    await this.loadSamples(this.folder, project, [...missing, ...project.samples.filter(s => loaded.has(s.id))]);
    this.store.load(project);
    this.autosaved = project;
    this.events.emit('change');
    this.say(`Restored the unsaved changes of "${this.name}": save to keep them.`);
  }

  /** The unsaved changes are thrown away: the recovery copy is no longer needed. */
  async discardRecovery(): Promise<void> {
    if (this.onDisk) await this.folder.dropRecovery();
  }

  /** Writes the recovery copy if the project changed since last time (only for a
   *  project on disk: a new one doesn't have a folder yet). */
  async autosave(): Promise<void> {
    const project = this.store.project;
    if (!this.onDisk || !this.changed || project === this.autosaved) return;
    const folder = this.folder, saved = this.savedVersion;
    await folder.saveRecovery(springsAtRest(project));
    // meanwhile something else was saved or opened: the copy is old and mustn't be left there
    if (this.folder !== folder || this.savedVersion !== saved) await folder.dropRecovery();
    else this.autosaved = project;
  }

  async save(): Promise<void> {
    if (!this.onDisk) return this.saveAs();
    await this.folder.save(springsAtRest(this.store.project));
    this.markSaved();
  }

  /** Saves to another folder, copying the project's audio files into it. */
  async saveAs(): Promise<void> {
    const dir = await this.pickDirectory();
    await copyFiles(this.folder.dir, dir, this.store.project.samples.map(s => s.file));
    this.folder = new ProjectFolder(dir);
    this.onDisk = true;
    await this.folder.save(springsAtRest(this.store.project));
    this.markSaved();
    this.events.emit('stored', dir);
  }

  /** Collect and save: saves (if the project is already on disk) and puts the project in a ZIP file
   *  to hand to others, with all and only the audio files it uses. Whoever receives it opens it with
   *  `openArchive`, or extracts it and opens the folder. */
  async collectAndSave(): Promise<File> {
    if (this.onDisk) await this.save();
    const entries = await this.folder.archive(springsAtRest(this.store.project), this.name);
    const file = new File(zipParts(entries) as Uint8Array<ArrayBuffer>[], `${safeFileName(this.name)}.zip`, { type: 'application/zip' });
    const audio = entries.length - 1;
    this.say(`Collected "${this.name}" into ${file.name}: ${audio} audio files, ${(file.size / 1e6).toFixed(1)} MB.`);
    return file;
  }

  private markSaved(): void {
    this.savedVersion = this.store.project;
    this.events.emit('change');
    this.say(`Saved in "${this.folder.name}".`);
  }

  /** Loads the project's audio files in the engine, except those in `skip`. */
  private async loadSamples(folder: ProjectFolder, project: Project, skip: readonly SampleRef[]): Promise<void> {
    for (const s of project.samples) {
      if (skip.includes(s)) continue;
      await this.audio.addSample(s.id, await this.decode(await folder.readAudio(s)));
    }
  }

  private async loadFile(file: File): Promise<SampleRef> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = await this.decode(bytes);
    const path = await this.folder.importAudio(file.name, bytes);
    return this.register(file.name.replace(/\.[^.]+$/, ''), path, data);
  }

  /** Loads the audio in the engine, analyses it and returns the reference for the project. */
  private async register(name: string, file: string, data: AudioData): Promise<SampleRef> {
    const id = this.store.ids.next('sample');
    await this.audio.addSample(id, data);
    const sensitivity = 0.5;
    const analysis = await this.audio.dsp.analyze(id, sensitivity);
    return {
      id, name, file, sampleRate: data.sampleRate, channels: data.channels.length, frames: data.channels[0].length,
      analysis: { tempo: analysis.tempo, sensitivity, transients: analysis.transients.map(t => t / data.sampleRate) },
    };
  }

  /** Decodes with the audio context (which brings the file to its sample rate); at most stereo. */
  private async decode(bytes: Uint8Array): Promise<AudioData> {
    const buf = await this.audio.context.decodeAudioData(bytes.slice().buffer);
    const channels = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice());
    return { channels, sampleRate: buf.sampleRate };
  }

  private say(text: string): void {
    this.events.emit('message', text);
  }
}

async function copyFiles(from: Directory, to: Directory, paths: readonly string[]): Promise<void> {
  for (const p of new Set(paths)) {
    if (!(await to.exists(p))) await to.writeBytes(p, await from.readBytes(p));
  }
}
