import type { PlacementId, TrackId } from '../core/id';
import { randomIds } from '../core/id';
import type { Beats } from '../core/music-time';
import { buildDemoProject } from '../demo/demo-project';
import { encodeWav } from '../dsp/codec/wav';
import { Project } from '../model/project';
import { setLoopRegion } from '../store/edits';
import { ProjectStore } from '../store/project-store';
import { addedPlacements, deleteMany, duplicateMany, splitMany } from '../store/selection-edits';
import { ClipEditor } from '../ui/clip-editor/clip-editor';
import { bindKeys, type Commands } from '../ui/keymap';
import { ArrangementView } from '../ui/timeline/arrangement-view';
import { resolveSelection } from '../ui/timeline/planning';
import { TrackHeaders } from '../ui/track-headers';
import { TransportBar, type FileCommands } from '../ui/transport-bar';
import { UiState } from '../ui/ui-state';
import { PeakStore } from '../ui/waveform';
import { AudioSystem } from './audio-system';
import { ProjectSession } from './project-session';

/** L'applicazione: crea le parti, le collega e implementa i comandi. */
export class App implements Commands, FileCommands {
  readonly store = new ProjectStore(Project.empty('Nuovo progetto', randomIds), randomIds);
  readonly audio = new AudioSystem(this.store);
  readonly session = new ProjectSession(this.store, this.audio);
  readonly ui = new UiState();
  readonly peaks = new PeakStore(id => this.audio.library.get(id));
  readonly arrangement: ArrangementView;
  readonly editor: ClipEditor;
  private readonly transport: TransportBar;
  private readonly status = Object.assign(document.createElement('footer'), { className: 'status' });

  constructor(root: HTMLElement) {
    this.arrangement = new ArrangementView({
      store: this.store, ui: this.ui, engine: this.audio.engine, peaks: this.peaks,
      openClip: (track, id) => this.openClip(track, id),
      dropFiles: (files, track, beat) => this.run(() => this.session.importFiles(files, track, beat)),
    });
    this.editor = new ClipEditor({
      store: this.store, engine: this.audio.engine, peaks: this.peaks,
      trackBeats: (sample, bpm) => this.audio.dsp.trackBeats(sample.id, bpm),
      say: t => this.say(t),
    });
    const headers = new TrackHeaders(this.store, this.ui);
    const transport = this.transport = new TransportBar(this.store, this.ui, this.audio.engine, this, this, () =>
      `${this.session.name}${this.session.saved ? '' : ' •'}`);
    const main = Object.assign(document.createElement('div'), { className: 'arrangement' });
    main.append(headers.element, this.arrangement.element);
    root.append(transport.element, main, this.editor.element, this.status);

    this.session.on('message', t => this.say(t));
    this.session.on('change', () => transport.render());
    // le clip eliminate escono dalla selezione
    this.store.onChange(p => {
      const alive = new Set(p.tracks.flatMap(t => t.arrangement.map(x => x.id)));
      if ([...this.ui.selection].some(id => !alive.has(id))) this.ui.select([...this.ui.selection].filter(id => alive.has(id)));
    });
    bindKeys(document, this);
    this.say('Trascina dei file audio sulla timeline o premi "Demo". Ctrl+rotella per lo zoom, Alt per trascinare senza griglia.');
  }

  // ---------------------------------------------------------------- comandi

  togglePlay(): void {
    if (this.audio.engine.playing) this.audio.engine.stop();
    else this.run(() => this.audio.play());
  }

  stopAndRewind(): void {
    this.audio.engine.stop();
    this.audio.engine.seek(0);
    this.arrangement.reveal(0);
  }

  undo(): void { this.store.undo(); }
  redo(): void { this.store.redo(); }

  deleteSelection(): void {
    const refs = this.selection();
    if (refs.length) this.store.apply(deleteMany(refs));
  }

  duplicateSelection(): void {
    const refs = this.selection();
    if (!refs.length) return;
    const before = this.store.project;
    this.store.apply(duplicateMany(refs));
    this.ui.select(addedPlacements(before, this.store.project).map(r => r.id));
  }

  /** Divide nel punto del cursore le clip selezionate (o, senza selezione, tutte). */
  splitAtCursor(): void {
    const p = this.store.project;
    const refs = this.selection().length ? this.selection() : p.tracks.flatMap(t => t.arrangement.map(x => ({ track: t.id, id: x.id })));
    this.store.apply(splitMany(refs, this.audio.engine.position));
  }

  selectAll(): void {
    this.ui.select(this.store.project.tracks.flatMap(t => t.arrangement.map(x => x.id)));
  }

  toggleLoop(): void {
    this.store.apply(setLoopRegion({ enabled: !this.store.project.loop.enabled }));
  }

  toggleMetronome(): void {
    this.audio.engine.metronomeOn = !this.audio.engine.metronomeOn;
    this.transport.render();
  }

  toggleSnap(): void {
    this.ui.setSnap(!this.ui.snap);
  }

  zoom(factor: number): void {
    const g = this.ui.geometry;
    this.ui.setGeometry(g.zoomed(g.pxPerBeat * factor, Math.max(0, g.beatToX(this.audio.engine.position))));
  }

  // ---------------------------------------------------------------- file

  newProject(): void { this.run(() => this.session.newProject()); }
  open(): void { this.run(() => this.session.open()); }
  save(): void { this.run(() => this.session.save()); }
  saveAs(): void { this.run(() => this.session.saveAs()); }

  importFiles(files: File[]): void {
    this.run(() => this.session.importFiles(files, null, this.audio.engine.position));
  }

  /** Esporta la regione di loop se è attiva, altrimenti tutta la timeline. */
  exportMix(): void {
    this.run(async () => {
      const p = this.store.project;
      const [from, to] = p.loop.enabled ? [p.loop.start, p.loop.end] : [0, p.arrangementEnd];
      if (to <= from) return this.say('Niente da esportare: la timeline è vuota.');
      this.say('Esportazione del mix…');
      const mix = await this.audio.exportMix(from, to);
      download(new Blob([encodeWav(mix, this.audio.context.sampleRate, 24)], { type: 'audio/wav' }), `${this.session.name}.wav`);
      this.say(`Mix esportato: ${(mix[0].length / this.audio.context.sampleRate).toFixed(1)} s.`);
    });
  }

  loadDemo(): void {
    this.run(async () => {
      await this.session.newProject();
      await buildDemoProject(this.store, this.session);
      this.store.load(this.store.project); // il progetto demo non si annulla
      this.say('Progetto demo caricato: premi Spazio per ascoltarlo.');
    });
  }

  // ---------------------------------------------------------------- aiuti

  private openClip(track: TrackId, id: PlacementId): void {
    const clip = this.store.project.track(track)?.placement(id)?.clip;
    if (!clip) return;
    if (!this.editor.open(id)) this.say(`"${clip.name}": il piano roll per le clip MIDI arriverà con gli strumenti.`);
  }

  private selection() {
    return resolveSelection(this.store.project, this.ui.selection);
  }

  /** Esegue un'azione mostrando gli errori nella barra di stato (annullare un selettore di file non è un errore). */
  run(action: () => unknown): void {
    Promise.resolve().then(action).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error(e);
      this.say(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  say(text: string): void {
    this.status.textContent = text;
  }

  /** Posizione del cursore (per i test automatici). */
  get cursor(): Beats {
    return this.audio.engine.position;
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
