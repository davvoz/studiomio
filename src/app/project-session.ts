import { Emitter, type Unsubscribe } from '../core/emitter';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { AudioData } from '../dsp/types';
import { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { MemoryDirectory, type Directory } from '../persistence/directory';
import { FsAccessDirectory } from '../persistence/fs-access-directory';
import { ProjectFolder } from '../persistence/project-folder';
import type { ProjectStore } from '../store/project-store';
import { importSample } from '../store/selection-edits';
import { importSampleToSlot } from '../store/session-edits';
import type { SampleId } from '../core/id';
import type { AudioAnalysis } from '../dsp/analysis/analyze';

/** Ciò che la sessione usa dell'audio (AudioSystem lo soddisfa; i test usano un finto). */
export interface SessionAudio {
  readonly context: { decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> };
  readonly engine: { stop(): void };
  readonly dsp: { analyze(sourceId: string, sensitivity: number): Promise<AudioAnalysis> };
  addSample(id: SampleId, audio: AudioData): Promise<void>;
}

type SessionEvents = {
  /** Cambiati cartella o stato di salvataggio. */
  change: [];
  message: [text: string];
};

/** Il progetto aperto e la sua cartella. Un progetto nuovo vive in una cartella in memoria
 *  finché non lo si salva su disco con "Salva con nome". */
export class ProjectSession {
  private folder: ProjectFolder;
  private onDisk = false;
  private savedVersion: Project;
  private readonly events = new Emitter<SessionEvents>();

  constructor(private readonly store: ProjectStore, private readonly audio: SessionAudio, private readonly pickDirectory: () => Promise<Directory> = FsAccessDirectory.pick) {
    this.folder = new ProjectFolder(new MemoryDirectory('Nuovo progetto'));
    this.savedVersion = store.project;
    store.onChange(() => this.events.emit('change'));
  }

  on<K extends keyof SessionEvents>(event: K, fn: (...a: SessionEvents[K]) => void): Unsubscribe {
    return this.events.on(event, fn);
  }

  /** Nome della cartella (o "Nuovo progetto" se non è ancora su disco). */
  get name(): string {
    return this.folder.name;
  }

  get saved(): boolean {
    return this.onDisk && this.store.project === this.savedVersion;
  }

  /** Importa file audio: copia nella cartella del progetto, analisi e clip sulla timeline.
   *  Più file vanno su tracce nuove, uno sotto l'altro. */
  async importFiles(files: readonly File[], target: TrackId | null, start: Beats): Promise<void> {
    for (const [i, file] of files.entries()) {
      try {
        const sample = await this.loadFile(file);
        this.store.apply(importSample(sample, i === 0 ? target : null, start));
        this.say(`Importato "${file.name}": ${sample.analysis?.tempo.toFixed(2)} BPM.`);
      } catch (e) {
        this.say(`Impossibile importare "${file.name}": ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Importa file audio negli slot della session, da `slot` in giù nella stessa colonna (su
   *  una traccia audio nuova se `target` non lo è). I file oltre l'ultima scena si saltano. */
  async importFilesToSlots(files: readonly File[], target: TrackId | null, slot: number): Promise<void> {
    let track = target;
    for (const [i, file] of files.entries()) {
      if (slot + i >= this.store.project.scenes.length) break;
      try {
        const sample = await this.loadFile(file);
        const before = this.store.project.tracks.length;
        this.store.apply(importSampleToSlot(sample, track, slot + i));
        // la prima clip può aver creato una traccia nuova: le altre vanno lì sotto
        if (this.store.project.tracks.length > before) track = this.store.project.tracks.at(-1)!.id;
        this.say(`Importato "${file.name}" nella session.`);
      } catch (e) {
        this.say(`Impossibile importare "${file.name}": ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Copia un file audio nella cartella del progetto e lo carica nel motore, senza metterlo da
   *  nessuna parte: il riferimento lo usa chi lo chiede (es. un pad della Drum Machine). */
  importSampleFile(file: File): Promise<SampleRef> {
    return this.loadFile(file);
  }

  /** Mette nella cartella del progetto un audio già in memoria (es. il loop demo). */
  async addAudio(name: string, data: AudioData, wav: Uint8Array): Promise<SampleRef> {
    const file = await this.folder.importAudio(name, wav);
    return this.register(name.replace(/\.[^.]+$/, ''), file, data);
  }

  async newProject(): Promise<void> {
    this.audio.engine.stop();
    this.folder = new ProjectFolder(new MemoryDirectory('Nuovo progetto'));
    this.onDisk = false;
    this.store.load(Project.empty('Nuovo progetto', this.store.ids));
    this.savedVersion = this.store.project;
    this.events.emit('change');
  }

  async open(): Promise<void> {
    const dir = await this.pickDirectory();
    const folder = new ProjectFolder(dir);
    if (!(await folder.hasProject())) throw new Error(`"${dir.name}" non contiene un progetto studiomio`);
    const { project, missing } = await folder.load();
    this.audio.engine.stop();
    for (const s of project.samples) {
      if (missing.includes(s)) continue;
      await this.audio.addSample(s.id, await this.decode(await folder.readAudio(s)));
    }
    this.folder = folder;
    this.onDisk = true;
    this.store.load(project);
    this.savedVersion = project;
    this.events.emit('change');
    this.say(missing.length
      ? `Aperto "${dir.name}". Mancano ${missing.length} file audio: ${missing.map(s => s.file).join(', ')}`
      : `Aperto "${dir.name}".`);
  }

  async save(): Promise<void> {
    if (!this.onDisk) return this.saveAs();
    await this.folder.save(this.store.project);
    this.markSaved();
  }

  /** Salva in un'altra cartella, copiandoci i file audio del progetto. */
  async saveAs(): Promise<void> {
    const dir = await this.pickDirectory();
    await copyFiles(this.folder.dir, dir, this.store.project.samples.map(s => s.file));
    this.folder = new ProjectFolder(dir);
    this.onDisk = true;
    await this.folder.save(this.store.project);
    this.markSaved();
  }

  private markSaved(): void {
    this.savedVersion = this.store.project;
    this.events.emit('change');
    this.say(`Salvato in "${this.folder.name}".`);
  }

  private async loadFile(file: File): Promise<SampleRef> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = await this.decode(bytes);
    const path = await this.folder.importAudio(file.name, bytes);
    return this.register(file.name.replace(/\.[^.]+$/, ''), path, data);
  }

  /** Carica l'audio nel motore, lo analizza e restituisce il riferimento per il progetto. */
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

  /** Decodifica con il contesto audio (che porta il file al suo sample rate); al massimo stereo. */
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
