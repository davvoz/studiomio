import { randomIds, type TrackId } from '../core/id';
import { ClipRendering, SCENE_MAX_BARS } from './clip-rendering';
import { diskFolders, projectPicker, ProjectFiles, recentEntry } from './project-files';
import { TimelineCommands } from './timeline-commands';
import { keepUiInProject } from './ui-upkeep';
import { automationClip, browserTarget, importTarget, type WorkPlace } from './work-targets';
import type { ModTarget } from '../model/envelope';
import type { Beats, Seconds } from '../core/music-time';
import type { Color } from '../model/clip';
import type { Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import { launchQuantumBeats } from '../model/launch';
import { midiTargetsOf } from '../model/midi-map';
import type { SampleRef } from '../model/sample';
import { BrowserCatalog, standardSources } from '../browser/catalog';
import { FsFolder, indexedDbPlaces } from '../browser/fs-folder';
import type { BrowserItem, BrowserSource, LoadTarget } from '../browser/item';
import { ControlSurfaces } from '../control/control-surfaces';
import { buildDemoProject } from '../demo/demo-project';
import { encodeWav } from '../dsp/codec/wav';
import { EFFECT_TYPES, effectType, INSTRUMENT_TYPES, instrumentType } from '../devices/registry';
import { userPresets } from '../devices/user-presets';
import { FACTORY_RACKS } from '../devices/factory-racks';
import { userRacks } from '../devices/user-racks';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import type { TimeRange } from '../model/note-edits';
import { sceneArrangement } from '../model/scene-export';
import { foldTail } from '../engine/offline-mix';
import { addBus, addTrack, followClipSound, setLoopRegion, setRecordQuantize, starterProject, type TrackKind } from '../store/edits';
import { Clipboard } from '../store/clipboard';
import { soloAudioProject } from '../store/consolidate';
import { findClip, placementRef, type ClipRef } from '../store/clip-ref';
import { showContextMenu, type MenuItem } from '../ui/context-menu';
import { showRecordingSettings } from '../ui/recording-dialog';
import { choose } from '../ui/dialog';
import { chooseImport } from '../ui/import-dialog';
import { rulerMenu, timelineMenu, type TimelineActions } from './menus';
import { ProjectStore } from '../store/project-store';
import { BottomPanel, type BottomView } from '../ui/bottom-panel';
import { acceptBrowserDrops } from '../ui/browser/browser-drag';
import { BrowserView } from '../ui/browser/browser-view';
import { ClipEditor } from '../ui/clip-editor/clip-editor';
import { DeviceView } from '../ui/device/device-view';
import { PianoRoll } from '../ui/piano-roll/piano-roll';
import { bindKeys, KEYMAP, releaseSelectsAfterClick, type Commands } from '../ui/keymap';
import { ArrangementView } from '../ui/timeline/arrangement-view';
import { MasterAutomation } from '../ui/master-automation';
import { DrawMode } from '../ui/draw-mode';
import { gridLabel, nudgeGrid, type GridSetting } from '../ui/timeline/geometry';
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
import { keyboardBase, NoteKeyboard, NoteKeys } from './note-keyboard';
import { MidiMapper } from './midi-mapper';
import { MidiNoteInput } from './midi-note-input';
import { RecordingPrefs } from './recording-prefs';
import { SessionRecorder } from './session-recorder';
import { mainMenu } from './main-menu';
import { RecentProjects, type RecentProject } from './recent-projects';
import { ProjectSession } from './project-session';
import { MacroSprings } from '../store/macro-springs';
import { SamplePreview } from './sample-preview';

/** The application: creates the parts, connects them and implements the commands. */
export class App implements Commands, TimelineActions {
  readonly store = new ProjectStore(starterProject('New project', randomIds), randomIds);
  readonly audio = new AudioSystem(this.store);
  /** How this computer records: the latency compensation, the movements. */
  private readonly recording = new RecordingPrefs(this.audio.context);
  readonly session = new ProjectSession(this.store, this.audio, projectPicker());
  /** The project folders opened or saved recently, for the File menu. */
  readonly recent = new RecentProjects();
  readonly ui = new UiState();
  /** Spring macros return to rest by themselves, whoever moves them. */
  readonly springs = new MacroSprings(this.store);
  readonly peaks = new PeakStore(id => this.audio.library.get(id));
  readonly arrangement: ArrangementView;
  readonly editor: ClipEditor;
  readonly pianoRoll: PianoRoll;
  readonly device: DeviceView;
  readonly sessionView: SessionView;
  /** The browser on the left: its sources, who loads what is chosen, the view. */
  readonly catalog = new BrowserCatalog<FsFolder>(standardSources({
    instruments: INSTRUMENT_TYPES, effects: EFFECT_TYPES, user: userPresets, racks: userRacks, factoryRacks: FACTORY_RACKS, project: this.store,
  }), indexedDbPlaces);
  private readonly loader: BrowserLoader;
  readonly browser: BrowserView;
  private readonly arrangementArea = Object.assign(document.createElement('div'), { className: 'arrangement' });
  private readonly viewButtons: { arrangement: HTMLButtonElement; session: HTMLButtonElement; back: HTMLButtonElement };
  private readonly browserButton: HTMLButtonElement;
  private readonly bottom = new BottomPanel();
  /** Clipboard shared by timeline and piano roll. */
  readonly clipboard = new Clipboard();
  /** Draw mode (B), shared by the piano roll and the modulation lanes. */
  readonly drawMode = new DrawMode();
  /** The keyboard and MIDI inputs: they listen from construction on, kept here for their whole life. */
  readonly noteKeys: NoteKeys;
  /** Recording what's played into the session's slots. */
  readonly recorder: SessionRecorder;
  readonly keyMapper: KeyMapper;
  readonly midiMapper: MidiMapper;
  readonly midiTargets: MidiTargets;
  private readonly automation: MasterAutomation;
  /** The last opened clip of each track: that's where "Show automation" goes. */
  private readonly lastClips = new Map<TrackId, ClipRef>();
  /** The editor of each clip kind: a new kind brings its own editor. */
  private readonly clipEditors: Readonly<Record<string, BottomView & { open(ref: ClipRef): boolean }>>;
  private readonly transport: TransportBar;
  private readonly menuBar: MenuBar;
  /** The MIDI controllers on the session (APC40 mkII, Launchpad). */
  readonly surfaces: ControlSurfaces;
  private readonly status = Object.assign(document.createElement('span'), { className: 'status-text' });
  private readonly statusBar = Object.assign(document.createElement('footer'), { className: 'status' });
  /** The timeline's editing commands, moving music between timeline and session, the project's files. */
  private readonly timeline: TimelineCommands;
  private readonly rendering: ClipRendering;
  private readonly files: ProjectFiles;

  constructor(root: HTMLElement) {
    const say = (t: string) => this.say(t), run = (action: () => unknown) => this.run(action);
    this.timeline = new TimelineCommands({
      store: this.store, ui: this.ui, clipboard: this.clipboard, engine: this.audio.engine,
      reveal: beat => this.arrangement.reveal(beat), pasteDevices: () => this.pasteDevices(), say,
    });
    this.rendering = new ClipRendering({
      store: this.store, ui: this.ui, engine: this.audio.engine, render: (source, pls, span) => this.renderClips(source, pls, span), run, say,
    });
    this.files = new ProjectFiles({
      session: this.session, recent: this.recent, choose, chooseImport, ...diskFolders, download, run, say,
      buildDemo: async () => {
        await buildDemoProject(this.store, this.session);
        this.store.load(this.store.project); // the demo project can't be undone
      },
    });
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
      say: t => this.say(t), clipboard: this.clipboard, drawMode: this.drawMode, ui: this.ui,
    });
    const audition = (track: TrackId, pitch: number, velocity = 100) => this.run(() => this.audio.audition(track, pitch, velocity));
    this.pianoRoll = new PianoRoll({
      store: this.store, engine: this.audio.engine, audition, clipboard: this.clipboard, drawMode: this.drawMode, ui: this.ui,
      openInstrument: track => this.openDevices(track, true),
      pasteDevices: () => this.pasteDevices(),
      say: t => this.say(t),
    });
    this.device = new DeviceView({
      store: this.store, audition: (track, pitch) => audition(track, pitch),
      clipboard: this.clipboard, showAutomation: (owner, target) => this.showAutomation(owner, target),
      sampleRate: this.audio.context.sampleRate, spectrum: (owner, id) => this.audio.spectrum(owner, id), dynamics: (owner, id) => this.audio.dynamics(owner, id),
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
    const showAutomation = (owner: ChainOwner, target: ModTarget) => this.showAutomation(owner, target);
    const pasteDeviceItems = (owner: ChainOwner) => this.pasteDeviceItems(owner);
    const headerActions = { openDevices: (owner: ChainOwner) => this.openDevices(owner), dropItem, showAutomation, pasteDeviceItems };
    const meters = new MeterBoard(owner => this.audio.engine.levels(owner));
    this.recorder = new SessionRecorder(this.audio.engine, this.store, () => {
      const p = this.store.project;
      return launchQuantumBeats(p.launchQuantization, p.signature);
    }, t => this.say(t), {
      delay: () => this.recording.beats(this.store.project.tempo.bpm),
      armed: () => this.ui.keyboardTracks,
    });
    this.recorder.recordMoves = this.recording.moves;
    this.sessionView = new SessionView({
      recorder: this.recorder,
      store: this.store, ui: this.ui, engine: this.audio.engine, meters, clipboard: this.clipboard, showAutomation,
      openClip: ref => this.openClip(ref),
      openDevices: owner => this.openDevices(owner),
      pasteDevices: () => this.pasteDevices(),
      pasteDeviceItems,
      importToSlot: (files, track, slot) => this.dropFiles(files, () => this.session.importFilesToSlots(files, track, slot)),
      addTrack: kind => this.addTrack(kind),
      exportScene: index => this.exportScene(index),
      sceneToArrangement: index => this.sceneToArrangement(index),
      say: t => this.say(t),
      dropItem,
    });
    const headers = new TrackHeaders(this.store, this.ui, headerActions, meters);
    this.arrangement.bindWheel(headers.element);
    const automation = this.automation = new MasterAutomation(this.store, this.ui, this.audio.engine, this.clipboard, this.drawMode);
    const master = new MasterStrip(this.store, headerActions, meters, automation);
    const transport = this.transport = new TransportBar(this.store, this.ui, this.audio.engine, this, this.recorder);
    const menuBar = this.menuBar = new MenuBar(mainMenu(this), () => `${this.session.name}${this.session.changed ? ' •' : ''}`);
    const main = this.arrangementArea;
    main.append(headers.element, this.arrangement.element, master.header, master.lane, automation.header, automation.lane);
    // the timeline master receives effects from the browser
    // only effects on the master: no instruments or Instrument Racks
    const masterAccepts = (p: BrowserItem['payload']) => p?.kind === 'effect' || (p?.kind === 'rack' && !p.rack.instrument);
    acceptBrowserDrops(master.header, item => dropItem(item, { kind: 'chain', owner: MASTER }), { accept: item => masterAccepts(item.payload) });
    const views = Object.assign(document.createElement('div'), { className: 'views' });
    views.append(main, this.sessionView.element);
    // the browser on the left, next to the views and the bottom area, as in Live
    const work = Object.assign(document.createElement('div'), { className: 'work' });
    work.append(views, this.bottom.element);
    const workspace = Object.assign(document.createElement('div'), { className: 'workspace' });
    workspace.append(this.browser.element, work);
    this.statusBar.append(this.status, Object.assign(document.createElement('span'), { className: 'version', textContent: `v${__APP_VERSION__}` }));
    root.append(menuBar.element, transport.element, workspace, this.statusBar);
    const viewButton = (text: string, title: string, run: () => void) => Object.assign(document.createElement('button'), { textContent: text, title, onclick: run });
    this.viewButtons = {
      arrangement: viewButton('☰ Arr.', 'Arrangement: la timeline (Tab)', () => this.showView('arrangement')),
      session: viewButton('▦ Session', 'Session: the clips to launch, scene by scene, and the mixer (Tab)', () => this.showView('session')),
      back: viewButton('↩', 'Back to arrangement: the tracks taken by the session go back to playing their timeline', () => this.audio.engine.backToArrangement()),
    };
    this.viewButtons.back.className = 'back-to-arrangement';
    this.browserButton = viewButton('◧ Browser', 'Show or hide the browser (Ctrl+Alt+B)', () => this.toggleBrowser());
    transport.addGroup(this.browserButton, this.viewButtons.arrangement, this.viewButtons.session, this.viewButtons.back);
    this.surfaces = this.controlSurfaces();
    this.audio.engine.onSessionChange(() => this.renderViews());
    this.audio.engine.onClipSound((track, sound) => this.store.apply(followClipSound(track, sound), { transient: true }));
    // the processor has already zeroed the faulty block and restarted the engine: here we say which
    this.audio.onDeviceFault((type, error) => {
      const label = instrumentType(type)?.label ?? effectType(type)?.label ?? type;
      const why = error ? ` (${error})` : '';
      this.say(`${label} produced an invalid sound and was restarted${why}.`);
    });
    this.renderViews();

    this.session.on('message', t => this.say(t));
    this.session.on('change', () => menuBar.render());
    this.session.on('stored', dir => {
      const entry = recentEntry(dir);
      if (entry) void this.recent.add(entry);
    });
    // the selection, the armed tracks and the chosen track stay valid
    this.store.onChange(p => keepUiInProject(p, this.ui));
    // what's played by hand (computer keyboard, MIDI keyboard) sounds and is recorded
    const playing = {
      press: (track: TrackId, pitch: number, velocity: number) => {
        this.audio.pressNote(track, pitch, velocity);
        this.recorder.press(track, pitch, velocity);
      },
      release: (track: TrackId, pitch: number) => {
        this.audio.releaseNote(track, pitch);
        this.recorder.release(track, pitch);
      },
    };
    // before mapped keys: with ⌨ on the note keys play, even if they're mapped
    this.noteKeys = new NoteKeys(this.ui, new NoteKeyboard({
      base: id => keyboardBase(this.store.project, id),
      ...playing,
      say: t => this.say(t),
    }));
    // before the shortcuts: the keys mapped to macros and parameters
    this.keyMapper = new KeyMapper(this.store, this.ui, t => this.say(t), this.springs);
    this.midiMapper = new MidiMapper(this.store, this.ui, this.surfaces, t => this.say(t), this.springs);
    const midiNotes = new MidiNoteInput(() => this.ui.keyboardTracks,
      (channel, number) => this.ui.midiMapping || midiTargetsOf(this.store.project.midiMap, { type: 'note', channel, number }).length > 0,
      playing);
    this.surfaces.onMidi(data => midiNotes.receive(data));
    this.ui.onChange(() => midiNotes.keepTracks(this.ui.keyboardTracks));
    this.midiTargets = new MidiTargets(this.store, this.ui, t => this.say(t));
    bindKeys(document, this, KEYMAP);
    releaseSelectsAfterClick(document);
    // closing the window with unsaved changes asks for confirmation (in Electron the main process asks)
    addEventListener('beforeunload', e => { if (this.session.changed) e.preventDefault(); });
    // every so often unsaved changes go into the recovery copy: if the app hangs
    // they're not lost (when the project is reopened it asks whether to recover them)
    setInterval(() => this.session.autosave().catch(e => console.warn('recovery copy:', e)), AUTOSAVE_MS);
    this.say('Drag audio files onto the timeline or open File › Load the demo project. Drag up/down on the bar numbers to zoom, sideways to scroll; Alt drags without the grid.');
  }

  /** What loads in the background once the app is built (main.ts calls it right after the
   *  constructor): the devices' AudioWorklet, the browser's folders and the recent projects. */
  start(): void {
    this.audio.loadDevices();
    void this.catalog.restore();
    this.recent.load().catch(e => console.warn('recent projects: couldn\'t read them', e));
  }

  // ---------------------------------------------------------------- commands

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

  deleteSelection(): void { this.timeline.deleteSelection(); }
  colorSelection(color: Color | undefined): void { this.timeline.colorSelection(color); }
  duplicateSelection(): void { this.timeline.duplicateSelection(); }
  copySelection(): void { this.timeline.copySelection(); }
  cutSelection(): void { this.timeline.cutSelection(); }
  paste(): void { this.timeline.paste(); }
  pasteAt(trackIndex: number, at: Beats): void { this.timeline.pasteAt(trackIndex, at); }
  splitAtCursor(): void { this.timeline.splitAtCursor(); }
  splitSelectionAt(beat: Beats): void { this.timeline.splitSelectionAt(beat); }
  selectAll(): void { this.timeline.selectAll(); }
  duplicateLoop(): void { this.timeline.duplicateLoop(); }
  newMidiClip(track: TrackId, beat: Beats): void { this.timeline.newMidiClip(track, beat); }
  snap(beat: Beats): Beats { return this.timeline.snap(beat); }
  consolidateSelection(): void { this.rendering.consolidate(); }
  selectionToSession(): void { this.rendering.toSession(); }
  sceneToArrangement(index: number): void { this.rendering.sceneToArrangement(index); }

  get canPaste(): boolean {
    return this.clipboard.clips !== null || this.clipboard.devices !== null;
  }

  /** Pastes the clipboard's devices into `owner`'s chain and shows it: wherever
   *  Ctrl+V comes from, without `owner` it goes to the chosen track (or the open chain). */
  pasteDevices(owner: ChainOwner | null = this.ui.track ?? this.device.openOwner): void {
    if (!owner) return this.say('Choose the track to paste onto.');
    this.openDevices(owner);
    if (this.device.openOwner === owner) this.device.pasteSelection();
  }

  private pasteDeviceItems(owner: ChainOwner): MenuItem[] {
    return this.clipboard.devices ? [{ label: 'Paste devices', run: () => this.pasteDevices(owner) }] : [];
  }

  /** The audio of the clips in the range, without the track's effects, in a new file in the
   *  project folder. */
  private async renderClips(source: Project, pls: readonly Placement<AudioClip>[], span: TimeRange): Promise<SampleRef> {
    const sr = this.audio.context.sampleRate, frames = Math.round(source.tempo.secondsAt(span.end - span.start) * sr);
    const mix = await this.audio.exportMix(span.start, span.end, soloAudioProject(source, pls, this.store.ids), 0);
    const channels = mix.map(c => c.slice(0, frames));
    return this.session.addAudio(`${pls[0].clip.name} consolidated.wav`, { channels, sampleRate: sr }, new Uint8Array(encodeWav(channels, sr, 24)));
  }

  /** A new bus; buses show in the session, next to the master. */
  addBus(): void {
    this.store.apply(addBus());
    if (!this.sessionView.isVisible) this.say('Bus added: you\'ll find it in the session (Tab), with the send knobs in the mixer.');
  }

  addTrack(kind: TrackKind): void {
    this.store.apply(addTrack(kind));
  }

  isMidiTrack(track: TrackId): boolean {
    return this.store.project.track(track)?.kind === 'midi';
  }

  get loopEnabled(): boolean {
    return this.store.project.loop.enabled;
  }

  toggleLoop(): void {
    this.store.apply(setLoopRegion({ enabled: !this.store.project.loop.enabled }));
  }

  toggleMetronome(): void {
    this.audio.engine.metronomeOn = !this.audio.engine.metronomeOn;
    this.transport.render();
  }

  toggleOverdub(): void {
    this.recorder.toggleOverdub();
  }

  recordingSettings(): void {
    const { store, recording, recorder } = this;
    void showRecordingSettings({
      get quantize() { return store.project.recordQuantize; },
      setQuantize: q => store.apply(setRecordQuantize(q)),
      audioMs: recording.audioMs,
      get offsetMs() { return recording.offsetMs; },
      set offsetMs(ms: number) { recording.offsetMs = ms; },
      get moves() { return recording.moves; },
      set moves(on: boolean) {
        recording.moves = on;
        recorder.recordMoves = on;
      },
    });
  }

  toggleView(): void {
    this.showView(this.sessionView.isVisible ? 'arrangement' : 'session');
  }

  groupTracks(): void {
    if (!groupSelectedTracks(this.store, this.ui)) this.say('Choose the tracks to group (Shift or Ctrl+click on the headers to choose more than one).');
  }

  ungroupTracks(): void {
    if (!ungroupSelectedTrack(this.store, this.ui)) this.say('Choose a group (or one of its tracks) to ungroup.');
  }

  /** Shows the timeline or the session (one in place of the other, as in Live). */
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
    if (on) this.say('KEY: click a macro or a device parameter, then press the key that will move it (Del removes it, Esc to finish).');
  }

  /** Turning MIDI on, if MIDI isn't active yet it is activated (the first time the browser asks for permission). */
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
        ? `MIDI: click a macro, a parameter or a mixer control, then move the knob, fader or pad that will move it (Del removes it, Esc to finish). Inputs: ${inputs.join(', ')}.`
        : "MIDI: no MIDI controller connected (besides the APC40 and the Launchpads, which have their own map). Connect it whenever you like, it's picked up by itself.");
    });
  }

  /** Loads a browser item where it's dropped or, without that, where you're working. */
  loadItem(item: BrowserItem, target: LoadTarget = this.browserTarget(item)): void {
    const payload = item.payload;
    if (payload) this.run(() => this.loader.load(payload, target));
  }

  /** Where an item loaded with a double click goes (see browserTarget). */
  private browserTarget(item: BrowserItem): LoadTarget {
    return browserTarget(item, this.workPlace());
  }

  /** Where the user is working now. */
  private workPlace(): WorkPlace {
    return {
      chain: this.bottom.open === this.device ? this.device.openOwner : null,
      session: this.sessionView.isVisible ? { slot: this.sessionView.selection } : null,
      track: this.ui.track,
      cursor: this.audio.engine.position,
    };
  }

  /** Adds a folder chosen by the user to the browser's places (one already added isn't repeated). */
  private async addBrowserFolder(): Promise<BrowserSource> {
    const folder = await FsFolder.pick();
    const source = await this.catalog.addFolder(folder, (a, b) => a.same(b));
    this.say(`Folder "${folder.name}" in the browser's places.`);
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

  toggleDraw(): void {
    this.drawMode.toggle();
  }

  narrowGrid(): void {
    this.changeGrid(nudgeGrid(this.ui.grid, -1));
  }

  widenGrid(): void {
    this.changeGrid(nudgeGrid(this.ui.grid, 1));
  }

  toggleTriplet(): void {
    this.changeGrid({ ...this.ui.grid, triplet: !this.ui.grid.triplet });
  }

  private changeGrid(grid: GridSetting): void {
    this.ui.setGrid(grid);
    this.say(`Grid: ${gridLabel(grid)}`);
  }

  toggleFollow(): void {
    this.ui.setFollow(this.ui.followPaused || !this.ui.follow);
  }

  zoom(factor: number): void {
    const g = this.ui.geometry;
    this.ui.setGeometry(g.zoomed(g.pxPerBeat * factor, Math.max(0, g.beatToX(this.audio.engine.position))));
  }

  zoomToSelection(): void {
    if (!this.arrangement.zoomToSelection()) this.say('Z zooms to the selection: first select some clips or draw a time range in them.');
  }

  zoomBack(): void {
    this.arrangement.zoomBack();
  }

  zoomToFit(): void {
    this.arrangement.zoomToFit();
  }

  // ---------------------------------------------------------------- file

  newProject(): void { this.files.newProject(); }
  open(): void { this.files.open(); }
  save(): void { this.files.save(); }
  saveAs(): void { this.files.saveAs(); }
  openRecent(entry: RecentProject): void { this.files.openRecent(entry); }
  openPath(path: string): void { this.files.openPath(path); }
  importFromProject(): void { this.files.importFromProject(); }
  collectAndSave(): void { this.files.collectAndSave(); }
  openArchive(file: File): void { this.files.openArchive(file); }
  loadDemo(): void { this.files.loadDemo(); }

  /** Asks for a project in a ZIP file and opens it. */
  chooseArchive(): void {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip,application/zip' });
    picker.onchange = () => { if (picker.files?.[0]) this.openArchive(picker.files[0]); };
    picker.click();
  }

  /** Asks for audio files and imports them (as if they were dragged). */
  chooseAudioFiles(): void {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*', multiple: true });
    picker.onchange = () => this.importFiles([...(picker.files ?? [])]);
    picker.click();
  }

  /** In the session the files go into the chosen slot (or a new track from the first scene),
   *  in the timeline at the cursor. */
  importFiles(files: File[]): void {
    const target = importTarget(this.workPlace());
    if (target.kind === 'slots') this.run(() => this.session.importFilesToSlots(files, target.track, target.slot));
    else this.run(() => this.session.importFiles(files, null, target.beat));
  }

  /** A ZIP dropped on the window is a project to open, other files are audio to import. */
  private dropFiles(files: File[], importAudio: () => Promise<void>): void {
    this.files.dropFiles(files, importAudio);
  }

  /** Exports the loop region if it's active, otherwise the whole timeline. */
  exportMix(): void {
    this.run(async () => {
      const p = this.store.project;
      const [from, to] = p.loop.enabled ? [p.loop.start, p.loop.end] : [0, p.arrangementEnd];
      if (to <= from) return this.say('Nothing to export: the timeline is empty.');
      this.say('Exporting the mix…');
      const mix = await this.audio.exportMix(from, to);
      download(new Blob([encodeWav(mix, this.audio.context.sampleRate, 24)], { type: 'audio/wav' }), `${this.session.name}.wav`);
      this.say(`Mix exported: ${(mix[0].length / this.audio.context.sampleRate).toFixed(1)} s.`);
    });
  }

  /** The audio of scene `index`, as long as needed for its loops to come round. */
  exportScene(index: number): void {
    this.run(async () => {
      const p = this.store.project, scene = p.scenes[index];
      const plan = scene && sceneArrangement(p, index, this.store.ids, SCENE_MAX_BARS * p.signature.beatsPerBar);
      if (!plan) return this.say('Nothing to export: the scene is empty.');
      this.say(`Exporting scene "${scene.name}"…`);
      const sr = this.audio.context.sampleRate;
      // for a loop a long tail, which then wraps to the start of the file
      const mix = await this.audio.exportMix(0, plan.length, plan.project, plan.loops ? SCENE_LOOP_TAIL : undefined);
      const out = plan.loops ? foldTail(mix, Math.round(p.tempo.secondsAt(plan.length) * sr)) : mix;
      download(new Blob([encodeWav(out, sr, 24)], { type: 'audio/wav' }), `${this.session.name} - ${scene.name}.wav`);
      const bars = plan.length / p.signature.beatsPerBar;
      const length = Number.isInteger(bars) ? `${bars} bars` : `${plan.length} beats`;
      this.say(`Scene "${scene.name}" exported: ${length}${plan.loops ? ', in loop' : ''}.`);
    });
  }

  /** The range [from, to] of a sample as a new file in the project folder (the crop). */
  private cropSample(sample: SampleRef, from: Seconds, to: Seconds): Promise<SampleRef> {
    const data = this.audio.library.get(sample.id);
    if (!data) throw new Error(`the audio of "${sample.name}" isn't loaded`);
    const sr = data.sampleRate, a = Math.round(from * sr), b = Math.round(to * sr);
    const channels = data.channels.map(c => c.slice(a, b));
    return this.session.addAudio(`${sample.name} crop.wav`, { channels, sampleRate: sr }, new Uint8Array(encodeWav(channels, sr, 24)));
  }

  // ---------------------------------------------------------------- helpers

  /** The MIDI controllers: they connect by themselves if permission is already there; Options › Enable MIDI controllers asks for it. */
  private controlSurfaces(): ControlSurfaces {
    const openDetail = () => this.bottom.open, devices = () => this.device;
    const surfaces = new ControlSurfaces({
      store: this.store, ui: this.ui, engine: this.audio.engine, recorder: this.recorder,
      togglePlay: () => this.togglePlay(),
      stopAndRewind: () => this.stopAndRewind(),
      toggleMetronome: () => this.toggleMetronome(),
      openDevices: owner => this.openDevices(owner),
      openClip: ref => this.openClip(ref),
      get detail() {
        const open = openDetail();
        if (open === devices()) return 'devices';
        return open ? 'clip' : null;
      },
      closeDetail: () => this.bottom.closeAll(),
      say: t => this.say(t),
    });
    const led = Object.assign(document.createElement('span'), { className: 'surface' });
    const render = () => {
      const name = surfaces.connected;
      led.hidden = name === null;
      led.textContent = `🎛 ${name}`;
      led.title = `${name}: connected to the session`;
    };
    surfaces.onChange(render);
    render();
    this.menuBar.addAside(led);
    this.ui.onChange(() => this.device.markControlled(this.ui.controlledDevice));
    void surfaces.autoStart();
    return surfaces;
  }

  /** Opens the clip (on the timeline or in a slot) in its editor. */
  openClip(ref: ClipRef): void {
    const clip = findClip(this.store.project, ref)?.clip;
    const editor = clip && this.clipEditors[clip.kind];
    if (!editor) return this.say(clip ? `No editor for "${clip.kind}" clips.` : '');
    this.ui.selectTrack(ref.track);
    this.lastClips.set(ref.track, ref);
    this.bottom.show(editor, () => editor.open(ref));
  }

  /** Shows a parameter's curve. On the master it's on the timeline; on a track it's in a clip:
   *  the last one opened, or the one playing, or the first it has. */
  showAutomation(owner: ChainOwner, target: ModTarget): void {
    if (owner === MASTER) {
      this.showView('arrangement');
      if (!this.automation.show(target)) this.say('This parameter can\'t be automated.');
      return;
    }
    const ref = automationClip(this.store.project, owner, this.lastClips.get(owner), this.audio.engine.playingClips().get(owner));
    if (!ref) return this.say('The track has no clips: automation is drawn in a clip. Create one and try again.');
    this.openClip(ref);
    const clip = findClip(this.store.project, ref)?.clip;
    if (clip && !(clip.kind === 'audio' ? this.editor : this.pianoRoll).modulation.show(target)) this.say('This parameter can\'t be automated.');
  }

  /** Opens a track's instrument and effects, or the master's effects; from the piano roll, with the
   *  button to go back to the notes. */
  openDevices(owner: ChainOwner, fromRoll = false): void {
    const clip = fromRoll ? this.pianoRoll.openClip : null;
    const back = clip && owner !== MASTER ? () => this.openClip(clip) : null;
    if (owner !== MASTER) this.ui.selectTrack(owner);
    this.bottom.show(this.device, () => this.device.open(owner, back));
  }

  /** Runs an action showing errors in the status bar (cancelling a file picker isn't an error). */
  run(action: () => unknown): void {
    Promise.resolve().then(action).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error(e);
      this.say(`Error: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  say(text: string): void {
    this.status.textContent = text;
  }

  /** Cursor position (for automated tests). */
  get cursor(): Beats {
    return this.audio.engine.position;
  }
}

/** How often the recovery copy is written (if there are changes). */
const AUTOSAVE_MS = 30_000;

/** Seconds of tail computed past the end of a looping scene, then wrapped to the start. */
const SCENE_LOOP_TAIL = 8;

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
