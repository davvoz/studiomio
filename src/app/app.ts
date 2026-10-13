import type { PlacementId, TrackId } from '../core/id';
import { randomIds } from '../core/id';
import type { Beats } from '../core/music-time';
import { buildDemoProject } from '../demo/demo-project';
import { encodeWav } from '../dsp/codec/wav';
import { Project } from '../model/project';
import { addMidiClip, addTrack, setLoopRegion, type TrackKind } from '../store/edits';
import { Clipboard, copyClips, pasteClips } from '../store/clipboard';
import { showContextMenu } from '../ui/context-menu';
import { gridStep } from '../ui/timeline/geometry';
import { timelineMenu, type TimelineActions } from './menus';
import { ProjectStore } from '../store/project-store';
import { addedPlacements, deleteMany, duplicateMany, splitMany } from '../store/selection-edits';
import { BottomPanel, type BottomView } from '../ui/bottom-panel';
import { ClipEditor } from '../ui/clip-editor/clip-editor';
import { DeviceView } from '../ui/device/device-view';
import { PianoRoll } from '../ui/piano-roll/piano-roll';
import { bindKeys, KEYMAP, type Commands } from '../ui/keymap';
import { ArrangementView } from '../ui/timeline/arrangement-view';
import { resolveSelection } from '../ui/timeline/planning';
import { TrackHeaders } from '../ui/track-headers';
import { TransportBar, type FileCommands } from '../ui/transport-bar';
import { UiState } from '../ui/ui-state';
import { PeakStore } from '../ui/waveform';
import { AudioSystem } from './audio-system';
import { ProjectSession } from './project-session';

/** L'applicazione: crea le parti, le collega e implementa i comandi. */
export class App implements Commands, FileCommands, TimelineActions {
  readonly store = new ProjectStore(Project.empty('Nuovo progetto', randomIds), randomIds);
  readonly audio = new AudioSystem(this.store);
  readonly session = new ProjectSession(this.store, this.audio);
  readonly ui = new UiState();
  readonly peaks = new PeakStore(id => this.audio.library.get(id));
  readonly arrangement: ArrangementView;
  readonly editor: ClipEditor;
  readonly pianoRoll: PianoRoll;
  readonly device: DeviceView;
  private readonly bottom = new BottomPanel();
  /** Appunti condivisi da timeline e piano roll. */
  readonly clipboard = new Clipboard();
  /** L'editor di ogni tipo di clip: un tipo nuovo porta il suo editor. */
  private readonly clipEditors: Readonly<Record<string, BottomView & { open(id: PlacementId): boolean }>>;
  private readonly transport: TransportBar;
  private readonly status = Object.assign(document.createElement('footer'), { className: 'status' });

  constructor(root: HTMLElement) {
    this.arrangement = new ArrangementView({
      store: this.store, ui: this.ui, engine: this.audio.engine, peaks: this.peaks,
      openClip: (track, id) => this.openClip(track, id),
      dropFiles: (files, track, beat) => this.run(() => this.session.importFiles(files, track, beat)),
      contextMenu: (hit, x, y) => showContextMenu(x, y, timelineMenu(this, hit)),
    });
    this.editor = new ClipEditor({
      store: this.store, engine: this.audio.engine, peaks: this.peaks,
      trackBeats: (sample, bpm) => this.audio.dsp.trackBeats(sample.id, bpm),
      say: t => this.say(t),
    });
    const audition = (track: TrackId, pitch: number, velocity = 100) => this.run(() => this.audio.audition(track, pitch, velocity));
    this.pianoRoll = new PianoRoll({
      store: this.store, engine: this.audio.engine, audition, clipboard: this.clipboard,
      openInstrument: track => this.openDevices(track, true),
      say: t => this.say(t),
    });
    this.device = new DeviceView({ store: this.store, audition: (track, pitch) => audition(track, pitch) });
    this.bottom.add(this.editor, this.pianoRoll, this.device);
    this.clipEditors = { audio: this.editor, midi: this.pianoRoll };
    const headers = new TrackHeaders(this.store, this.ui, { openDevices: track => this.openDevices(track) });
    const transport = this.transport = new TransportBar(this.store, this.ui, this.audio.engine, this, this, () =>
      `${this.session.name}${this.session.saved ? '' : ' •'}`);
    const main = Object.assign(document.createElement('div'), { className: 'arrangement' });
    main.append(headers.element, this.arrangement.element);
    root.append(transport.element, main, this.bottom.element, this.status);

    this.session.on('message', t => this.say(t));
    this.session.on('change', () => transport.render());
    // le clip eliminate escono dalla selezione
    this.store.onChange(p => {
      const alive = new Set(p.tracks.flatMap(t => t.arrangement.map(x => x.id)));
      if ([...this.ui.selection].some(id => !alive.has(id))) this.ui.select([...this.ui.selection].filter(id => alive.has(id)));
    });
    bindKeys(document, this, KEYMAP);
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

  copySelection(): void {
    const copied = copyClips(this.store.project, this.selection());
    if (!copied) return this.say('Seleziona delle clip da copiare.');
    this.clipboard.content = copied;
    const n = copied.items.length;
    this.say(`${n === 1 ? 'Copiata 1 clip: Ctrl+V la incolla' : `Copiate ${n} clip: Ctrl+V le incolla`} al cursore.`);
  }

  cutSelection(): void {
    const refs = this.selection();
    const copied = copyClips(this.store.project, refs);
    if (!copied) return this.say('Seleziona delle clip da tagliare.');
    this.clipboard.content = copied;
    this.store.apply(deleteMany(refs));
  }

  /** Incolla al cursore, sulle tracce da cui si è copiato. */
  paste(): void {
    const copied = this.clipboard.clips;
    if (!copied) return this.say(this.clipboard.notes ? 'Negli appunti ci sono delle note: incollale nel piano roll.' : 'Gli appunti sono vuoti.');
    const index = this.store.project.tracks.findIndex(t => t.id === copied.sourceTrack);
    this.pasteAt(Math.max(0, index), this.audio.engine.position);
  }

  get canPaste(): boolean {
    return this.clipboard.clips !== null;
  }

  pasteAt(trackIndex: number, at: Beats): void {
    const copied = this.clipboard.clips;
    if (!copied) return;
    const before = this.store.project;
    this.store.apply(pasteClips(copied, trackIndex, at));
    const added = addedPlacements(before, this.store.project);
    if (!added.length) return this.say('Nessuna traccia adatta qui: le clip audio vanno su tracce audio, quelle MIDI su tracce MIDI.');
    this.ui.select(added.map(r => r.id));
    // il cursore va alla fine di ciò che si è incollato: Ctrl+V di nuovo continua in fila
    if (!this.audio.engine.playing) this.audio.engine.seek(at + copied.span);
    if (added.length < copied.items.length) this.say(`Incollate ${added.length} clip su ${copied.items.length}: le altre non hanno una traccia adatta.`);
  }

  /** Divide nel punto del cursore le clip selezionate (o, senza selezione, tutte). */
  splitAtCursor(): void {
    this.splitSelectionAt(this.audio.engine.position);
  }

  splitSelectionAt(beat: Beats): void {
    const p = this.store.project;
    const refs = this.selection().length ? this.selection() : p.tracks.flatMap(t => t.arrangement.map(x => ({ track: t.id, id: x.id })));
    this.store.apply(splitMany(refs, beat));
  }

  snap(beat: Beats): Beats {
    const step = gridStep(this.ui.geometry.pxPerBeat, this.store.project.signature);
    return this.ui.snap ? Math.max(0, Math.round(beat / step) * step) : beat;
  }

  newMidiClip(track: TrackId, beat: Beats): void {
    const bar = this.store.project.signature.beatsPerBar;
    this.store.apply(addMidiClip(track, Math.floor(beat / bar) * bar, bar));
  }

  addTrack(kind: TrackKind): void {
    this.store.apply(addTrack(kind));
  }

  isMidiTrack(track: TrackId): boolean {
    return this.store.project.track(track)?.kind === 'midi';
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

  openClip(track: TrackId, id: PlacementId): void {
    const clip = this.store.project.track(track)?.placement(id)?.clip;
    const editor = clip && this.clipEditors[clip.kind];
    if (!editor) return this.say(clip ? `Nessun editor per le clip "${clip.kind}".` : '');
    this.bottom.show(editor, () => editor.open(id));
  }

  /** Apre strumento ed effetti della traccia; da piano roll, con il pulsante per tornare alle note. */
  openDevices(track: TrackId, fromRoll = false): void {
    const placement = fromRoll ? this.pianoRoll.openPlacement : null;
    const back = placement ? () => this.openClip(track, placement) : null;
    this.bottom.show(this.device, () => this.device.open(track, back));
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
