import type { TrackId } from '../core/id';
import { randomIds } from '../core/id';
import type { Beats, Seconds } from '../core/music-time';
import type { Color } from '../model/clip';
import type { SampleRef } from '../model/sample';
import { BrowserCatalog, standardSources } from '../browser/catalog';
import { FsFolder, indexedDbPlaces } from '../browser/fs-folder';
import type { BrowserItem, BrowserSource, LoadTarget } from '../browser/item';
import { ControlSurfaces } from '../control/control-surfaces';
import { buildDemoProject } from '../demo/demo-project';
import { encodeWav } from '../dsp/codec/wav';
import { EFFECT_TYPES, INSTRUMENT_TYPES } from '../devices/registry';
import { userPresets } from '../devices/user-presets';
import { FACTORY_RACKS } from '../devices/factory-racks';
import { userRacks } from '../devices/user-racks';
import { MASTER, type ChainOwner } from '../model/project';
import { BusTrack } from '../model/track';
import { sceneArrangement, sceneClips, sceneLength } from '../model/scene-export';
import { foldTail } from '../engine/offline-mix';
import { addBus, addMidiClip, addTrack, setLoopRegion, starterProject, type TrackKind } from '../store/edits';
import { Clipboard, copyClips, pasteClips } from '../store/clipboard';
import { sceneToArrangement } from '../store/session-edits';
import { findClip, placementRef, setClipColor, type ClipRef } from '../store/clip-ref';
import { showContextMenu } from '../ui/context-menu';
import { choose } from '../ui/dialog';
import { gridStep } from '../ui/timeline/geometry';
import { rulerMenu, timelineMenu, type TimelineActions } from './menus';
import { edit, ProjectStore } from '../store/project-store';
import { addedPlacements, cutOutRange, deleteMany, duplicateLoopRegion, duplicateMany, splitMany } from '../store/selection-edits';
import { BottomPanel, type BottomView } from '../ui/bottom-panel';
import { acceptBrowserDrops } from '../ui/browser/browser-drag';
import { BrowserView } from '../ui/browser/browser-view';
import { ClipEditor } from '../ui/clip-editor/clip-editor';
import { DeviceView } from '../ui/device/device-view';
import { PianoRoll } from '../ui/piano-roll/piano-roll';
import { bindKeys, KEYMAP, type Commands } from '../ui/keymap';
import { ArrangementView } from '../ui/timeline/arrangement-view';
import { resolveSelection } from '../ui/timeline/planning';
import { MasterAutomation } from '../ui/master-automation';
import { MasterStrip } from '../ui/master-strip';
import { SessionView } from '../ui/session/session-view';
import { MeterBoard } from '../ui/meters/meter-board';
import { groupSelectedTracks, ungroupSelectedTrack } from '../ui/track-groups';
import { TrackHeaders } from '../ui/track-headers';
import { MenuBar } from '../ui/menu-bar';
import { TransportBar } from '../ui/transport-bar';
import { MidiTargets } from '../ui/midi-targets';
import { UiState } from '../ui/ui-state';
import { PeakStore } from '../ui/waveform';
import { AudioSystem } from './audio-system';
import { BrowserLoader } from './browser-loader';
import { KeyMapper } from './key-mapper';
import { MidiMapper } from './midi-mapper';
import { mainMenu } from './main-menu';
import { ProjectSession } from './project-session';
import { MacroSprings } from '../store/macro-springs';
import { SamplePreview } from './sample-preview';

/** L'applicazione: crea le parti, le collega e implementa i comandi. */
export class App implements Commands, TimelineActions {
  readonly store = new ProjectStore(starterProject('Nuovo progetto', randomIds), randomIds);
  readonly audio = new AudioSystem(this.store);
  readonly session = new ProjectSession(this.store, this.audio);
  readonly ui = new UiState();
  /** Le macro molla tornano al riposo da sole, chiunque le muova. */
  readonly springs = new MacroSprings(this.store);
  readonly peaks = new PeakStore(id => this.audio.library.get(id));
  readonly arrangement: ArrangementView;
  readonly editor: ClipEditor;
  readonly pianoRoll: PianoRoll;
  readonly device: DeviceView;
  readonly sessionView: SessionView;
  /** Il browser a sinistra: le sue fonti, chi carica ciò che si sceglie, la vista. */
  readonly catalog = new BrowserCatalog<FsFolder>(standardSources({
    instruments: INSTRUMENT_TYPES, effects: EFFECT_TYPES, user: userPresets, racks: userRacks, factoryRacks: FACTORY_RACKS, project: this.store,
  }), indexedDbPlaces);
  private readonly loader: BrowserLoader;
  readonly browser: BrowserView;
  private readonly arrangementArea = Object.assign(document.createElement('div'), { className: 'arrangement' });
  private readonly viewButtons: { arrangement: HTMLButtonElement; session: HTMLButtonElement; back: HTMLButtonElement };
  private readonly browserButton: HTMLButtonElement;
  private readonly bottom = new BottomPanel();
  /** Appunti condivisi da timeline e piano roll. */
  readonly clipboard = new Clipboard();
  /** L'editor di ogni tipo di clip: un tipo nuovo porta il suo editor. */
  private readonly clipEditors: Readonly<Record<string, BottomView & { open(ref: ClipRef): boolean }>>;
  private readonly transport: TransportBar;
  private readonly menuBar: MenuBar;
  /** I controller MIDI sulla session (APC40 mkII, Launchpad). */
  readonly surfaces: ControlSurfaces;
  private readonly status = Object.assign(document.createElement('span'), { className: 'status-text' });
  private readonly statusBar = Object.assign(document.createElement('footer'), { className: 'status' });

  constructor(root: HTMLElement) {
    this.loader = new BrowserLoader({
      store: this.store, ui: this.ui,
      importFiles: (files, track, beat) => this.session.importFiles(files, track, beat),
      importFilesToSlots: (files, track, slot) => this.session.importFilesToSlots(files, track, slot),
      importSample: file => this.session.importSampleFile(file),
      cursor: () => this.audio.engine.position,
      openDevices: owner => this.openDevices(owner),
      say: t => this.say(t),
    });
    const dropItem = (item: BrowserItem, target: LoadTarget) => this.loadItem(item, target);
    this.browser = new BrowserView({
      catalog: this.catalog,
      load: item => this.loadItem(item),
      addFolder: () => this.addBrowserFolder(),
      preview: new SamplePreview(this.audio.context, id => this.audio.library.get(id)),
      say: t => this.say(t),
    });
    void this.catalog.restore();
    this.arrangement = new ArrangementView({
      store: this.store, ui: this.ui, engine: this.audio.engine, peaks: this.peaks,
      openClip: (track, id) => this.openClip(placementRef(track, id)),
      dropFiles: (files, track, beat) => this.dropFiles(files, () => this.session.importFiles(files, track, beat)),
      dropItem,
      contextMenu: (hit, x, y) => showContextMenu(x, y, timelineMenu(this, hit)),
      rulerMenu: (x, y) => showContextMenu(x, y, rulerMenu(this)),
    });
    this.editor = new ClipEditor({
      store: this.store, engine: this.audio.engine, peaks: this.peaks,
      trackBeats: (sample, bpm) => this.audio.dsp.trackBeats(sample.id, bpm),
      cropSample: (sample, from, to) => this.cropSample(sample, from, to),
      say: t => this.say(t),
    });
    const audition = (track: TrackId, pitch: number, velocity = 100) => this.run(() => this.audio.audition(track, pitch, velocity));
    this.pianoRoll = new PianoRoll({
      store: this.store, engine: this.audio.engine, audition, clipboard: this.clipboard,
      openInstrument: track => this.openDevices(track, true),
      say: t => this.say(t),
    });
    this.device = new DeviceView({
      store: this.store, audition: (track, pitch) => audition(track, pitch),
      sampleRate: this.audio.context.sampleRate, spectrum: (owner, id) => this.audio.spectrum(owner, id),
      playedNotes: track => {
        const engine = this.audio.engine;
        let last = engine.audioTime;
        return () => {
          const now = engine.audioTime, notes = engine.notesStarted(track, last, now);
          last = now;
          return notes;
        };
      },
      importSample: file => this.session.importSampleFile(file),
      springs: this.springs,
      sampleAudio: id => this.audio.library.get(id),
      playheads: track => this.audio.engine.playheads(track),
      modulation: (owner, target) => this.audio.engine.modulationAt(owner, target),
      say: t => this.say(t),
      dropItem,
      ui: this.ui,
    });
    this.bottom.add(this.editor, this.pianoRoll, this.device);
    this.clipEditors = { audio: this.editor, midi: this.pianoRoll };
    const headerActions = { openDevices: (owner: ChainOwner) => this.openDevices(owner), dropItem };
    const meters = new MeterBoard(owner => this.audio.engine.levels(owner));
    this.sessionView = new SessionView({
      store: this.store, ui: this.ui, engine: this.audio.engine, meters, clipboard: this.clipboard,
      openClip: ref => this.openClip(ref),
      openDevices: owner => this.openDevices(owner),
      importToSlot: (files, track, slot) => this.dropFiles(files, () => this.session.importFilesToSlots(files, track, slot)),
      addTrack: kind => this.addTrack(kind),
      exportScene: index => this.exportScene(index),
      sceneToArrangement: index => this.sceneToArrangement(index),
      say: t => this.say(t),
      dropItem,
    });
    const headers = new TrackHeaders(this.store, this.ui, headerActions, meters);
    const automation = new MasterAutomation(this.store, this.ui, this.audio.engine);
    const master = new MasterStrip(this.store, headerActions, meters, automation);
    const transport = this.transport = new TransportBar(this.store, this.ui, this.audio.engine, this);
    const menuBar = this.menuBar = new MenuBar(mainMenu(this), () => `${this.session.name}${this.session.changed ? ' •' : ''}`);
    const main = this.arrangementArea;
    main.append(headers.element, this.arrangement.element, master.header, master.lane, automation.header, automation.lane);
    // il master della timeline riceve gli effetti dal browser
    // sul master solo effetti: niente strumenti né Instrument Rack
    const masterAccepts = (p: BrowserItem['payload']) => p?.kind === 'effect' || (p?.kind === 'rack' && !p.rack.instrument);
    acceptBrowserDrops(master.header, item => dropItem(item, { kind: 'chain', owner: MASTER }), { accept: item => masterAccepts(item.payload) });
    const views = Object.assign(document.createElement('div'), { className: 'views' });
    views.append(main, this.sessionView.element);
    // il browser a sinistra, accanto a viste e area in basso, come in Live
    const work = Object.assign(document.createElement('div'), { className: 'work' });
    work.append(views, this.bottom.element);
    const workspace = Object.assign(document.createElement('div'), { className: 'workspace' });
    workspace.append(this.browser.element, work);
    this.statusBar.append(this.status, Object.assign(document.createElement('span'), { className: 'version', textContent: `v${__APP_VERSION__}` }));
    root.append(menuBar.element, transport.element, workspace, this.statusBar);
    const viewButton = (text: string, title: string, run: () => void) => Object.assign(document.createElement('button'), { textContent: text, title, onclick: run });
    this.viewButtons = {
      arrangement: viewButton('☰ Arr.', 'Arrangement: la timeline (Tab)', () => this.showView('arrangement')),
      session: viewButton('▦ Session', 'Session: le clip da lanciare, scena per scena, e il mixer (Tab)', () => this.showView('session')),
      back: viewButton('↩', 'Torna all\'arrangement: le tracce prese dalla session tornano a suonare la loro timeline', () => this.audio.engine.backToArrangement()),
    };
    this.viewButtons.back.className = 'back-to-arrangement';
    this.browserButton = viewButton('◧ Browser', 'Mostra o nasconde il browser (Ctrl+Alt+B)', () => this.toggleBrowser());
    transport.addGroup(this.browserButton, this.viewButtons.arrangement, this.viewButtons.session, this.viewButtons.back);
    this.surfaces = this.controlSurfaces();
    this.audio.engine.onSessionChange(() => this.renderViews());
    this.renderViews();

    this.session.on('message', t => this.say(t));
    this.session.on('change', () => menuBar.render());
    // le clip eliminate escono dalla selezione, la traccia eliminata non è più quella scelta;
    // una traccia nascosta in un gruppo chiuso passa la scelta al gruppo che si vede
    this.store.onChange(p => {
      const alive = new Set(p.tracks.flatMap(t => t.arrangement.map(x => x.id)));
      if ([...this.ui.selection].some(id => !alive.has(id))) this.ui.select([...this.ui.selection].filter(id => alive.has(id)));
      if (this.ui.track && !p.track(this.ui.track)) this.ui.selectTrack(null);
      else if (this.ui.track && !(p.track(this.ui.track) instanceof BusTrack) && !p.visibleTracks.some(t => t.id === this.ui.track)) {
        this.ui.selectTrack(p.groupsOf(this.ui.track).filter(g => g.folded).at(-1)?.id ?? null);
      }
    });
    // prima delle scorciatoie: i tasti mappati sulle macro e sui parametri
    new KeyMapper(this.store, this.ui, t => this.say(t), this.springs);
    new MidiMapper(this.store, this.ui, this.surfaces, t => this.say(t), this.springs);
    new MidiTargets(this.store, this.ui, t => this.say(t));
    bindKeys(document, this, KEYMAP);
    // chiudere la finestra con modifiche non salvate chiede conferma (in Electron la chiede il processo principale)
    addEventListener('beforeunload', e => { if (this.session.changed) e.preventDefault(); });
    this.say('Trascina dei file audio sulla timeline o apri File › Carica il progetto demo. Ctrl+rotella per lo zoom, Alt per trascinare senza griglia.');
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

  /** Con un tratto di tempo selezionato si elimina solo quello, come in Live. */
  deleteSelection(): void {
    const refs = this.selection(), range = this.ui.range;
    if (!refs.length) return;
    if (!range) return void this.store.apply(deleteMany(refs));
    const cut = cutOutRange(this.store.project, this.store.ids, refs, range);
    this.store.apply(edit('Elimina clip', (_p, ctx) => deleteMany(cut.pieces).apply(cut.project, ctx)));
  }

  colorSelection(color: Color | undefined): void {
    const refs = this.selection().map(r => placementRef(r.track, r.id));
    if (refs.length) this.store.apply(setClipColor(refs, color));
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
    const index = this.store.project.visibleTracks.findIndex(t => t.id === copied.sourceTrack);
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

  /** Divide nel punto del cursore le clip selezionate (o, senza selezione, tutte); con un tratto
   *  di tempo selezionato lo divide ai suoi bordi, come in Live, e resta selezionato il pezzo dentro. */
  splitAtCursor(): void {
    const range = this.ui.range;
    if (!range) return this.splitSelectionAt(this.audio.engine.position);
    const cut = cutOutRange(this.store.project, this.store.ids, this.selection(), range);
    this.store.apply(edit('Dividi', () => cut.project));
    this.ui.select(cut.pieces.map(r => r.id));
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

  /** Un bus nuovo; i bus si vedono nella session, accanto al master. */
  addBus(): void {
    this.store.apply(addBus());
    if (!this.sessionView.isVisible) this.say('Bus aggiunto: lo trovi nella session (Tab), con le manopole delle mandate nel mixer.');
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

  get loopEnabled(): boolean {
    return this.store.project.loop.enabled;
  }

  toggleLoop(): void {
    this.store.apply(setLoopRegion({ enabled: !this.store.project.loop.enabled }));
  }

  /** Copia il tratto del loop subito dopo, ci sposta il loop e seleziona le clip copiate. */
  duplicateLoop(): void {
    const before = this.store.project;
    this.store.apply(duplicateLoopRegion());
    this.ui.select(addedPlacements(before, this.store.project).map(r => r.id));
    const { start, end } = this.store.project.loop, sig = this.store.project.signature;
    this.arrangement.reveal(start);
    this.say(`Loop duplicato: ora è da ${sig.format(start)} a ${sig.format(end)}. Ctrl+Maiusc+D di nuovo per un altro giro.`);
  }

  toggleMetronome(): void {
    this.audio.engine.metronomeOn = !this.audio.engine.metronomeOn;
    this.transport.render();
  }

  toggleView(): void {
    this.showView(this.sessionView.isVisible ? 'arrangement' : 'session');
  }

  groupTracks(): void {
    if (!groupSelectedTracks(this.store, this.ui)) this.say('Scegli le tracce da raggruppare (Maiusc o Ctrl+clic sulle intestazioni per sceglierne più di una).');
  }

  ungroupTracks(): void {
    if (!ungroupSelectedTrack(this.store, this.ui)) this.say('Scegli un gruppo (o una sua traccia) da separare.');
  }

  /** Mostra la timeline o la session (al posto l'una dell'altra, come in Live). */
  showView(view: 'arrangement' | 'session'): void {
    this.arrangementArea.hidden = view !== 'arrangement';
    this.sessionView.show(view === 'session');
    this.renderViews();
  }

  toggleBrowser(): void {
    this.browser.toggle();
    this.renderViews();
  }

  searchBrowser(): void {
    this.browser.focusSearch();
    this.renderViews();
  }

  toggleKeyMap(): void {
    const on = !this.ui.keyMapping;
    this.ui.setKeyMapping(on);
    if (on) this.say('KEY: clicca una macro o un parametro di un dispositivo, poi premi il tasto che lo muoverà (Canc lo toglie, Esc per finire).');
  }

  /** Accendendo MIDI, se il MIDI non è ancora attivo lo si attiva (la prima volta il browser chiede il permesso). */
  toggleMidiMap(): void {
    const on = !this.ui.midiMapping;
    this.ui.setMidiMapping(on);
    if (!on) return;
    this.run(async () => {
      try {
        if (!this.surfaces.enabled) await this.surfaces.enable();
      } catch (e) {
        this.ui.setMidiMapping(false);
        throw e;
      }
      const inputs = this.surfaces.mappingInputs;
      this.say(inputs.length
        ? `MIDI: clicca una macro, un parametro o un controllo del mixer, poi muovi la manopola, il fader o il pad che lo muoverà (Canc lo toglie, Esc per finire). Ingressi: ${inputs.join(', ')}.`
        : "MIDI: nessun controller MIDI collegato (oltre all'APC40 e ai Launchpad, che hanno la loro mappa). Collegalo quando vuoi, si ascolta da solo.");
    });
  }

  /** Carica una voce del browser dove la si lascia o, senza, dove si sta lavorando. */
  loadItem(item: BrowserItem, target: LoadTarget = this.browserTarget(item)): void {
    const payload = item.payload;
    if (payload) this.run(() => this.loader.load(payload, target));
  }

  /** Dove va una voce caricata con il doppio clic: un dispositivo nella catena aperta in basso
   *  (o sulla traccia scelta), un sample nello slot scelto della session o al cursore della
   *  traccia scelta nella timeline. */
  private browserTarget(item: BrowserItem): LoadTarget {
    const audio = item.payload?.kind === 'sample' || item.payload?.kind === 'file';
    const owner = this.device.openOwner;
    if (!audio && owner && this.bottom.open === this.device) return { kind: 'chain', owner };
    if (this.sessionView.isVisible && audio) {
      const s = this.sessionView.selection;
      return { kind: 'slot', track: s?.track ?? this.ui.track, slot: s?.slot ?? 0 };
    }
    return { kind: 'lane', track: this.ui.track, beat: this.audio.engine.position };
  }

  /** Aggiunge ai luoghi del browser una cartella scelta dall'utente (una già aggiunta non si ripete). */
  private async addBrowserFolder(): Promise<BrowserSource> {
    const folder = await FsFolder.pick();
    const source = await this.catalog.addFolder(folder, (a, b) => a.same(b));
    this.say(`Cartella "${folder.name}" nei luoghi del browser.`);
    return source;
  }

  private renderViews(): void {
    this.browserButton.classList.toggle('on', this.browser.isOpen);
    const session = this.sessionView.isVisible;
    this.viewButtons.arrangement.classList.toggle('on', !session);
    this.viewButtons.session.classList.toggle('on', session);
    const taken = this.audio.engine.arrangementOverridden;
    this.viewButtons.back.disabled = !taken;
    this.viewButtons.back.classList.toggle('lit', taken);
  }

  toggleSnap(): void {
    this.ui.setSnap(!this.ui.snap);
  }

  toggleFollow(): void {
    this.ui.setFollow(this.ui.followPaused || !this.ui.follow);
  }

  zoom(factor: number): void {
    const g = this.ui.geometry;
    this.ui.setGeometry(g.zoomed(g.pxPerBeat * factor, Math.max(0, g.beatToX(this.audio.engine.position))));
  }

  // ---------------------------------------------------------------- file

  newProject(): void { this.run(async () => { if (await this.closeProject()) await this.session.newProject(); }); }
  open(): void { this.run(async () => { if (await this.closeProject()) await this.session.open(); }); }
  save(): void { this.run(() => this.session.save()); }
  saveAs(): void { this.run(() => this.session.saveAs()); }

  /** Raccogli e salva: il progetto in un file ZIP da passare a un altro utente. */
  collectAndSave(): void {
    this.run(async () => {
      const file = await this.session.collectAndSave();
      download(file, file.name);
    });
  }

  /** Chiede un progetto in un file ZIP e lo apre. */
  chooseArchive(): void {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip,application/zip' });
    picker.onchange = () => { if (picker.files?.[0]) this.openArchive(picker.files[0]); };
    picker.click();
  }

  openArchive(file: File): void {
    this.run(async () => { if (await this.closeProject()) await this.session.openArchive(file); });
  }

  /** Uno ZIP lasciato nella finestra è un progetto da aprire, gli altri file audio da importare. */
  private dropFiles(files: File[], importAudio: () => Promise<void>): void {
    const archive = files.find(f => /\.zip$/i.test(f.name));
    if (archive) this.openArchive(archive);
    else this.run(importAudio);
  }

  /** Chiede dei file audio e li importa (come se li si trascinasse). */
  chooseAudioFiles(): void {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*', multiple: true });
    picker.onchange = () => this.importFiles([...(picker.files ?? [])]);
    picker.click();
  }

  /** Nella session i file vanno nello slot scelto (o in una traccia nuova dalla prima scena),
   *  nella timeline al cursore. */
  importFiles(files: File[]): void {
    if (this.sessionView.isVisible) {
      const s = this.sessionView.selection;
      return this.run(() => this.session.importFilesToSlots(files, s?.track ?? null, s?.slot ?? 0));
    }
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

  /** L'audio della scena `index`, lungo quanto serve perché i suoi loop si richiudano. */
  exportScene(index: number): void {
    this.run(async () => {
      const p = this.store.project, scene = p.scenes[index];
      const plan = scene && sceneArrangement(p, index, this.store.ids, SCENE_MAX_BARS * p.signature.beatsPerBar);
      if (!plan) return this.say('Niente da esportare: la scena è vuota.');
      this.say(`Esportazione della scena "${scene.name}"…`);
      const sr = this.audio.context.sampleRate;
      // per un loop una coda lunga, che poi torna all'inizio del file
      const mix = await this.audio.exportMix(0, plan.length, plan.project, plan.loops ? SCENE_LOOP_TAIL : undefined);
      const out = plan.loops ? foldTail(mix, Math.round(p.tempo.secondsAt(plan.length) * sr)) : mix;
      download(new Blob([encodeWav(out, sr, 24)], { type: 'audio/wav' }), `${this.session.name} - ${scene.name}.wav`);
      const bars = plan.length / p.signature.beatsPerBar;
      this.say(`Scena "${scene.name}" esportata: ${Number.isInteger(bars) ? `${bars} battute` : `${plan.length} battiti`}${plan.loops ? ', in loop' : ''}.`);
    });
  }

  /** La scena `index` nell'arrangement al cursore, lunga quanto serve perché i suoi loop si
   *  richiudano. Il cursore va alla sua fine: la scena dopo si mette in fila. */
  sceneToArrangement(index: number): void {
    const p = this.store.project, scene = p.scenes[index];
    const len = scene && sceneLength(sceneClips(p, index), SCENE_MAX_BARS * p.signature.beatsPerBar);
    if (!len || !(len.length > 0)) return this.say('La scena è vuota: non c\'è niente da copiare.');
    const at = Math.max(0, this.audio.engine.position);
    this.store.apply(sceneToArrangement(index, at, len.length));
    this.ui.select(addedPlacements(p, this.store.project).map(r => r.id));
    if (!this.audio.engine.playing) this.audio.engine.seek(at + len.length);
    const bar = (b: Beats) => +(b / p.signature.beatsPerBar + 1).toFixed(2);
    this.say(`Scena "${scene.name}" nell'arrangement dalla battuta ${bar(at)} alla ${bar(at + len.length)}.`);
  }

  /** Il tratto [from, to] di un sample come file nuovo nella cartella del progetto (il crop). */
  private cropSample(sample: SampleRef, from: Seconds, to: Seconds): Promise<SampleRef> {
    const data = this.audio.library.get(sample.id);
    if (!data) throw new Error(`l'audio di "${sample.name}" non è caricato`);
    const sr = data.sampleRate, a = Math.round(from * sr), b = Math.round(to * sr);
    const channels = data.channels.map(c => c.slice(a, b));
    return this.session.addAudio(`${sample.name} crop.wav`, { channels, sampleRate: sr }, new Uint8Array(encodeWav(channels, sr, 24)));
  }

  /** Prima di lasciare il progetto (nuovo, apri, demo): se ci sono modifiche chiede se salvarle.
   *  false: si rinuncia (anche se il salvataggio non va a buon fine). */
  private async closeProject(): Promise<boolean> {
    if (!this.session.changed) return true;
    const answer = await choose('Salvare le modifiche?', `Se non le salvi, le modifiche a "${this.session.name}" andranno perse.`, [
      { label: 'Non salvare', value: 'discard' },
      { label: 'Annulla', value: 'cancel' },
      { label: 'Salva', value: 'save', primary: true },
    ]);
    if (answer === 'save') await this.session.save(); // se si annulla la scelta della cartella, si ferma qui
    return answer === 'save' || answer === 'discard';
  }

  loadDemo(): void {
    this.run(async () => {
      if (!(await this.closeProject())) return;
      await this.session.newProject(true);
      await buildDemoProject(this.store, this.session);
      this.store.load(this.store.project); // il progetto demo non si annulla
      this.session.forgetChanges();
      this.say('Progetto demo caricato: premi Spazio per ascoltarlo.');
    });
  }

  // ---------------------------------------------------------------- aiuti

  /** I controller MIDI: si collegano da soli se il permesso c'è già; Opzioni › Attiva i controller MIDI lo chiede. */
  private controlSurfaces(): ControlSurfaces {
    const app = this;
    const surfaces = new ControlSurfaces({
      store: this.store, ui: this.ui, engine: this.audio.engine,
      togglePlay: () => this.togglePlay(),
      stopAndRewind: () => this.stopAndRewind(),
      toggleMetronome: () => this.toggleMetronome(),
      openDevices: owner => this.openDevices(owner),
      openClip: ref => this.openClip(ref),
      get detail() {
        const open = app.bottom.open;
        return open === app.device ? 'devices' : open ? 'clip' : null;
      },
      closeDetail: () => this.bottom.closeAll(),
      say: t => this.say(t),
    });
    const led = Object.assign(document.createElement('span'), { className: 'surface' });
    const render = () => {
      const name = surfaces.connected;
      led.hidden = name === null;
      led.textContent = `🎛 ${name}`;
      led.title = `${name}: collegato alla session`;
    };
    surfaces.onChange(render);
    render();
    this.menuBar.addAside(led);
    this.ui.onChange(() => this.device.markControlled(this.ui.controlledDevice));
    void surfaces.autoStart();
    return surfaces;
  }

  /** Apre la clip (sulla timeline o in uno slot) nel suo editor. */
  openClip(ref: ClipRef): void {
    const clip = findClip(this.store.project, ref)?.clip;
    const editor = clip && this.clipEditors[clip.kind];
    if (!editor) return this.say(clip ? `Nessun editor per le clip "${clip.kind}".` : '');
    this.ui.selectTrack(ref.track);
    this.bottom.show(editor, () => editor.open(ref));
  }

  /** Apre strumento ed effetti di una traccia, o gli effetti del master; dal piano roll, con il
   *  pulsante per tornare alle note. */
  openDevices(owner: ChainOwner, fromRoll = false): void {
    const clip = fromRoll ? this.pianoRoll.openClip : null;
    const back = clip && owner !== MASTER ? () => this.openClip(clip) : null;
    if (owner !== MASTER) this.ui.selectTrack(owner);
    this.bottom.show(this.device, () => this.device.open(owner, back));
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

/** Una scena si esporta al massimo per tante battute (se i loop si richiudono solo dopo, basta il più lungo). */
const SCENE_MAX_BARS = 64;
/** Secondi di coda calcolati oltre la fine di una scena in loop, poi riportati all'inizio. */
const SCENE_LOOP_TAIL = 8;

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
