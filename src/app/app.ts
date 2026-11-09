import type { TrackId } from '../core/id';
import type { ModTarget } from '../model/envelope';
import { randomIds } from '../core/id';
import type { Beats, Seconds } from '../core/music-time';
import type { Color } from '../model/clip';
import type { Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import { MidiClip } from '../model/midi-clip';
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
import { BusTrack } from '../model/track';
import type { Directory } from '../persistence/directory';
import { FsAccessDirectory } from '../persistence/fs-access-directory';
import { ProjectFolder } from '../persistence/project-folder';
import { sceneArrangement, sceneClips, sceneLength } from '../model/scene-export';
import { foldTail } from '../engine/offline-mix';
import { addBus, addMidiClip, addTrack, followClipSound, setLoopRegion, starterProject, type TrackKind } from '../store/edits';
import { Clipboard, copyClips, pasteClips } from '../store/clipboard';
import {
  consolidatedAudioClip, consolidatedMidiClip, consolidateSpans, placementsIn, sessionClip, soloAudioProject, withConsolidated, type Consolidated,
} from '../store/consolidate';
import { arrangementToScene, sceneToArrangement, type SceneClip } from '../store/session-edits';
import { findClip, placementRef, setClipColor, slotRef, type ClipRef } from '../store/clip-ref';
import { showContextMenu, type MenuItem } from '../ui/context-menu';
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
import { keyboardBase, NoteKeyboard, NoteKeys } from './note-keyboard';
import { MidiMapper } from './midi-mapper';
import { mainMenu } from './main-menu';
import { RecentProjects } from './recent-projects';
import { ProjectSession } from './project-session';
import { MacroSprings } from '../store/macro-springs';
import { SamplePreview } from './sample-preview';

/** The application: creates the parts, connects them and implements the commands. */
export class App implements Commands, TimelineActions {
  readonly store = new ProjectStore(starterProject('New project', randomIds), randomIds);
  readonly audio = new AudioSystem(this.store);
  readonly session = new ProjectSession(this.store, this.audio);
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
  /** The keyboard and MIDI inputs: they listen from construction on, kept here for their whole life. */
  readonly noteKeys: NoteKeys;
  readonly keyMapper: KeyMapper;
  readonly midiMapper: MidiMapper;
  readonly midiTargets: MidiTargets;
  private readonly automation: MasterAutomation;
  /** The last opened clip of each track: that's where "Show automation" goes. */
  private readonly lastClips = new Map<TrackId, ClipRef>();
  /** A consolidation is rendering audio: another one doesn't start. */
  private consolidating = false;
  /** The editor of each clip kind: a new kind brings its own editor. */
  private readonly clipEditors: Readonly<Record<string, BottomView & { open(ref: ClipRef): boolean }>>;
  private readonly transport: TransportBar;
  private readonly menuBar: MenuBar;
  /** The MIDI controllers on the session (APC40 mkII, Launchpad). */
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
      say: t => this.say(t), clipboard: this.clipboard,
    });
    const audition = (track: TrackId, pitch: number, velocity = 100) => this.run(() => this.audio.audition(track, pitch, velocity));
    this.pianoRoll = new PianoRoll({
      store: this.store, engine: this.audio.engine, audition, clipboard: this.clipboard,
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
    this.sessionView = new SessionView({
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
    const automation = this.automation = new MasterAutomation(this.store, this.ui, this.audio.engine, this.clipboard);
    const master = new MasterStrip(this.store, headerActions, meters, automation);
    const transport = this.transport = new TransportBar(this.store, this.ui, this.audio.engine, this);
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
      this.say(`${label} produced an invalid sound and was restarted${error ? ` (${error})` : ''}.`);
    });
    this.renderViews();

    this.session.on('message', t => this.say(t));
    this.session.on('change', () => menuBar.render());
    this.session.on('stored', dir => { if (dir instanceof FsAccessDirectory) void this.recent.add(dir.root); });
    // deleted clips leave the selection, the deleted track is no longer the chosen one;
    // a track hidden in a closed group passes the choice to the visible group
    this.store.onChange(p => {
      const alive = new Set(p.tracks.flatMap(t => t.arrangement.map(x => x.id)));
      if ([...this.ui.selection].some(id => !alive.has(id))) this.ui.select([...this.ui.selection].filter(id => alive.has(id)));
      this.ui.keepKeyboardTracks(id => !!p.track(id));
      if (this.ui.track && !p.track(this.ui.track)) this.ui.selectTrack(null);
      else if (this.ui.track && !(p.track(this.ui.track) instanceof BusTrack) && !p.visibleTracks.some(t => t.id === this.ui.track)) {
        this.ui.selectTrack(p.groupsOf(this.ui.track).filter(g => g.folded).at(-1)?.id ?? null);
      }
    });
    // before mapped keys: with ⌨ on the note keys play, even if they're mapped
    this.noteKeys = new NoteKeys(this.ui, new NoteKeyboard({
      base: id => keyboardBase(this.store.project, id),
      press: (track, pitch, velocity) => this.audio.pressNote(track, pitch, velocity),
      release: (track, pitch) => this.audio.releaseNote(track, pitch),
      say: t => this.say(t),
    }));
    // before the shortcuts: the keys mapped to macros and parameters
    this.keyMapper = new KeyMapper(this.store, this.ui, t => this.say(t), this.springs);
    this.midiMapper = new MidiMapper(this.store, this.ui, this.surfaces, t => this.say(t), this.springs);
    this.midiTargets = new MidiTargets(this.store, this.ui, t => this.say(t));
    bindKeys(document, this, KEYMAP);
    // closing the window with unsaved changes asks for confirmation (in Electron the main process asks)
    addEventListener('beforeunload', e => { if (this.session.changed) e.preventDefault(); });
    // every so often unsaved changes go into the recovery copy: if the app hangs
    // they're not lost (when the project is reopened it asks whether to recover them)
    setInterval(() => this.session.autosave().catch(e => console.warn('recovery copy:', e)), AUTOSAVE_MS);
    this.say('Drag audio files onto the timeline or open File › Load the demo project. Ctrl+wheel to zoom, Alt to drag without the grid.');
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

  /** With a time range selected only that is deleted, as in Live. */
  deleteSelection(): void {
    const refs = this.selection(), range = this.ui.range;
    if (!refs.length) return;
    if (!range) return void this.store.apply(deleteMany(refs));
    const cut = cutOutRange(this.store.project, this.store.ids, refs, range);
    this.store.apply(edit('Delete clip', (_p, ctx) => deleteMany(cut.pieces).apply(cut.project, ctx)));
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
    if (!copied) return this.say('Select some clips to copy.');
    this.clipboard.content = copied;
    const n = copied.items.length;
    this.say(`${n === 1 ? 'Copied 1 clip: Ctrl+V pastes it' : `Copied ${n} clips: Ctrl+V pastes them`} at the cursor.`);
  }

  cutSelection(): void {
    const refs = this.selection();
    const copied = copyClips(this.store.project, refs);
    if (!copied) return this.say('Select some clips to cut.');
    this.clipboard.content = copied;
    this.store.apply(deleteMany(refs));
  }

  /** Pastes at the cursor, on the tracks it was copied from; devices, on the chosen track. */
  paste(): void {
    if (this.clipboard.devices) return this.pasteDevices();
    const copied = this.clipboard.clips;
    if (!copied) return this.say(this.clipboard.notes ? 'The clipboard holds notes: paste them in the piano roll.' : 'The clipboard is empty.');
    const index = this.store.project.visibleTracks.findIndex(t => t.id === copied.sourceTrack);
    this.pasteAt(Math.max(0, index), this.audio.engine.position);
  }

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

  pasteAt(trackIndex: number, at: Beats): void {
    const copied = this.clipboard.clips;
    if (!copied) return;
    const before = this.store.project;
    this.store.apply(pasteClips(copied, trackIndex, at));
    const added = addedPlacements(before, this.store.project);
    if (!added.length) return this.say('No suitable track here: audio clips go on audio tracks, MIDI ones on MIDI tracks.');
    this.ui.select(added.map(r => r.id));
    // the cursor goes to the end of what was pasted: Ctrl+V again continues in a row
    if (!this.audio.engine.playing) this.audio.engine.seek(at + copied.span);
    if (added.length < copied.items.length) this.say(`Pasted ${added.length} of ${copied.items.length} clips: the others have no suitable track.`);
  }

  /** Splits the selected clips (or, without a selection, all of them) at the cursor; with a time
   *  range selected it splits at its edges, as in Live, and the piece inside stays selected. */
  splitAtCursor(): void {
    const range = this.ui.range;
    if (!range) return this.splitSelectionAt(this.audio.engine.position);
    const cut = cutOutRange(this.store.project, this.store.ids, this.selection(), range);
    this.store.apply(edit('Split', () => cut.project));
    this.ui.select(cut.pieces.map(r => r.id));
  }

  splitSelectionAt(beat: Beats): void {
    const p = this.store.project;
    const refs = this.selection().length ? this.selection() : p.tracks.flatMap(t => t.arrangement.map(x => ({ track: t.id, id: x.id })));
    this.store.apply(splitMany(refs, beat));
  }

  /** Consolidate (Ctrl+J), as in Live: on each track the selected clips, from the first
   *  to the last (or the selected time range), become a single clip that sounds as
   *  before. Audio is rendered without the track's effects into a new file in the
   *  project folder. */
  consolidateSelection(): void {
    const refs = this.selection(), range = this.ui.range;
    if (!refs.length) return this.say('Select some clips to consolidate.');
    if (this.consolidating) return;
    this.consolidating = true;
    this.run(async () => {
      try {
        const base = this.store.project, ids = this.store.ids;
        const spans = consolidateSpans(base, refs, range);
        // with a time range only that is consolidated: first the clips are split at its edges
        const source = range ? cutOutRange(base, ids, spans.flatMap(s => placementsIn(base, s).map(pl => ({ track: s.track, id: pl.id }))), range).project : base;
        const audio = spans.some(s => placementsIn(source, s).some(pl => pl.clip instanceof AudioClip));
        if (audio) this.say('Consolidating the audio…');
        const items: Consolidated[] = [];
        for (const span of spans) {
          const pls = placementsIn(source, span);
          if (!pls.length) continue;
          const clipId = ids.next('clip'), placement = ids.next('placement');
          if (pls[0].clip instanceof MidiClip) {
            items.push({ span, placement, clip: consolidatedMidiClip(clipId, pls as Placement<MidiClip>[], span.start, span.end) });
            continue;
          }
          const audioPls = pls as Placement<AudioClip>[];
          const sample = await this.renderClips(source, audioPls, span);
          items.push({ span, placement, sample, clip: consolidatedAudioClip(clipId, audioPls, sample, source.tempo.bpm, span.start, span.end) });
        }
        if (this.store.project !== base) return this.say('The project changed during consolidation: try again.');
        this.store.apply(edit('Consolidate', (_p, ctx) => withConsolidated(source, items, ctx.ids)));
        this.ui.select(items.map(i => i.placement));
        this.say(items.length === 1 ? 'Clip consolidated.' : `${items.length} clips consolidated, one per track.`);
      } finally {
        this.consolidating = false;
      }
    });
  }

  /** Copy to session, the opposite of "Copy to arrangement": the selected clips (or the
   *  selected time range) in a new scene at the bottom. Each track has a clip covering
   *  the whole range, so they stay in time with each other; a single clip repeating its piece stays
   *  as it is, the rest is consolidated (audio is rendered into a new file). */
  selectionToSession(): void {
    const refs = this.selection();
    if (!refs.length) return this.say('Select some clips to copy to the session.');
    if (this.consolidating) return;
    this.consolidating = true;
    this.run(async () => {
      try {
        const base = this.store.project, ids = this.store.ids, bar = base.signature.beatsPerBar;
        const own = consolidateSpans(base, refs, this.ui.range);
        const range = { start: Math.min(...own.map(s => s.start)), end: Math.max(...own.map(s => s.end)) };
        const spans = own.map(s => ({ ...s, ...range }));
        // clips are split at the range's edges: only what plays there stays inside
        const source = cutOutRange(base, ids, spans.flatMap(s => placementsIn(base, s).map(pl => ({ track: s.track, id: pl.id }))), range).project;
        const clips: SceneClip[] = [];
        for (const span of spans) {
          const pls = placementsIn(source, span);
          if (!pls.length) continue;
          const clipId = ids.next('clip'), clip = sessionClip(clipId, pls, range.start, range.end);
          if (clip) {
            clips.push({ track: span.track, clip });
            continue;
          }
          this.say('Rendering the audio…');
          const audioPls = pls as Placement<AudioClip>[];
          const sample = await this.renderClips(source, audioPls, span);
          clips.push({ track: span.track, sample, clip: consolidatedAudioClip(clipId, audioPls, sample, source.tempo.bpm, range.start, range.end) });
        }
        if (this.store.project !== base) return this.say('The project changed during rendering: try again.');
        const from = Math.floor(range.start / bar) + 1, to = Math.max(from, Math.ceil(range.end / bar));
        const name = from === to ? `Bar ${from}` : `Bars ${from}-${to}`;
        this.store.apply(arrangementToScene(name, clips));
        this.say(`Scene "${name}" at the bottom of the session, with ${clips.length === 1 ? 'one clip' : `${clips.length} clips`}.`);
      } finally {
        this.consolidating = false;
      }
    });
  }

  /** The audio of the clips in the range, without the track's effects, in a new file in the
   *  project folder. */
  private async renderClips(source: Project, pls: readonly Placement<AudioClip>[], span: TimeRange): Promise<SampleRef> {
    const sr = this.audio.context.sampleRate, frames = Math.round(source.tempo.secondsAt(span.end - span.start) * sr);
    const mix = await this.audio.exportMix(span.start, span.end, soloAudioProject(source, pls, this.store.ids), 0);
    const channels = mix.map(c => c.slice(0, frames));
    return this.session.addAudio(`${pls[0].clip.name} consolidated.wav`, { channels, sampleRate: sr }, new Uint8Array(encodeWav(channels, sr, 24)));
  }

  snap(beat: Beats): Beats {
    const step = gridStep(this.ui.geometry.pxPerBeat, this.store.project.signature);
    return this.ui.snap ? Math.max(0, Math.round(beat / step) * step) : beat;
  }

  newMidiClip(track: TrackId, beat: Beats): void {
    const bar = this.store.project.signature.beatsPerBar;
    this.store.apply(addMidiClip(track, Math.floor(beat / bar) * bar, bar));
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

  selectAll(): void {
    this.ui.select(this.store.project.tracks.flatMap(t => t.arrangement.map(x => x.id)));
  }

  get loopEnabled(): boolean {
    return this.store.project.loop.enabled;
  }

  toggleLoop(): void {
    this.store.apply(setLoopRegion({ enabled: !this.store.project.loop.enabled }));
  }

  /** Copies the loop range right after, moves the loop there and selects the copied clips. */
  duplicateLoop(): void {
    const before = this.store.project;
    this.store.apply(duplicateLoopRegion());
    this.ui.select(addedPlacements(before, this.store.project).map(r => r.id));
    const { start, end } = this.store.project.loop, sig = this.store.project.signature;
    this.arrangement.reveal(start);
    this.say(`Loop duplicated: it's now from ${sig.format(start)} to ${sig.format(end)}. Ctrl+Shift+D again for another round.`);
  }

  toggleMetronome(): void {
    this.audio.engine.metronomeOn = !this.audio.engine.metronomeOn;
    this.transport.render();
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

  /** Where an item loaded with a double click goes: a device in the chain open at the bottom
   *  (or on the chosen track), a sample in the chosen session slot or at the cursor of the
   *  chosen track in the timeline. */
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

  toggleFollow(): void {
    this.ui.setFollow(this.ui.followPaused || !this.ui.follow);
  }

  zoom(factor: number): void {
    const g = this.ui.geometry;
    this.ui.setGeometry(g.zoomed(g.pxPerBeat * factor, Math.max(0, g.beatToX(this.audio.engine.position))));
  }

  // ---------------------------------------------------------------- file

  newProject(): void { this.run(async () => { if (await this.closeProject()) await this.session.newProject(); }); }
  open(): void { this.run(async () => { if (await this.closeProject()) await this.openFolder(); }); }
  save(): void { this.run(() => this.session.save()); }

  /** Opens a recent project. Permission on the folder is asked right away, while the click
   *  on the item still counts; if the folder is gone (moved, deleted) it leaves the list. */
  openRecent(handle: FileSystemDirectoryHandle): void {
    this.run(async () => {
      const gone = async () => {
        await this.recent.remove(handle);
        this.say(`"${handle.name}" is gone (moved or deleted?): removed from recent projects.`);
      };
      let dir: FsAccessDirectory;
      try {
        dir = await FsAccessDirectory.reopen(handle);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return gone();
        throw e;
      }
      if (!(await new ProjectFolder(dir).hasProject())) return gone();
      if (await this.closeProject()) await this.openFolder(dir);
    });
  }

  /** Opens a project folder; if there are changes never saved (the app hung or
   *  was closed without saving) asks whether to recover them. */
  private async openFolder(dir?: Directory): Promise<void> {
    await this.session.open(dir);
    if (!(await this.session.hasRecovery())) return;
    const answer = await choose('Recover unsaved changes?',
      `"${this.session.name}" has changes that weren't saved: the app hung or was closed without saving. Do you want to recover them?`, [
        { label: 'Discard them', value: 'discard' },
        { label: 'Restore them', value: 'restore', primary: true },
      ]);
    if (answer === 'restore') await this.session.restoreRecovery();
    else if (answer === 'discard') await this.session.discardRecovery();
  }
  saveAs(): void { this.run(() => this.session.saveAs()); }

  /** Collect and save: the project in a ZIP file to hand to another user. */
  collectAndSave(): void {
    this.run(async () => {
      const file = await this.session.collectAndSave();
      download(file, file.name);
    });
  }

  /** Asks for a project in a ZIP file and opens it. */
  chooseArchive(): void {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip,application/zip' });
    picker.onchange = () => { if (picker.files?.[0]) this.openArchive(picker.files[0]); };
    picker.click();
  }

  openArchive(file: File): void {
    this.run(async () => { if (await this.closeProject()) await this.session.openArchive(file); });
  }

  /** A ZIP dropped on the window is a project to open, other files are audio to import. */
  private dropFiles(files: File[], importAudio: () => Promise<void>): void {
    const archive = files.find(f => /\.zip$/i.test(f.name));
    if (archive) this.openArchive(archive);
    else this.run(importAudio);
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
    if (this.sessionView.isVisible) {
      const s = this.sessionView.selection;
      return this.run(() => this.session.importFilesToSlots(files, s?.track ?? null, s?.slot ?? 0));
    }
    this.run(() => this.session.importFiles(files, null, this.audio.engine.position));
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
      this.say(`Scene "${scene.name}" exported: ${Number.isInteger(bars) ? `${bars} bars` : `${plan.length} beats`}${plan.loops ? ', in loop' : ''}.`);
    });
  }

  /** Scene `index` into the arrangement at the cursor, as long as needed for its loops to
   *  come round. The cursor goes to its end: the next scene lines up after it. */
  sceneToArrangement(index: number): void {
    const p = this.store.project, scene = p.scenes[index];
    const len = scene && sceneLength(sceneClips(p, index), SCENE_MAX_BARS * p.signature.beatsPerBar);
    if (!len || !(len.length > 0)) return this.say('The scene is empty: there\'s nothing to copy.');
    const at = Math.max(0, this.audio.engine.position);
    this.store.apply(sceneToArrangement(index, at, len.length));
    this.ui.select(addedPlacements(p, this.store.project).map(r => r.id));
    if (!this.audio.engine.playing) this.audio.engine.seek(at + len.length);
    const bar = (b: Beats) => +(b / p.signature.beatsPerBar + 1).toFixed(2);
    this.say(`Scene "${scene.name}" in the arrangement from bar ${bar(at)} to ${bar(at + len.length)}.`);
  }

  /** The range [from, to] of a sample as a new file in the project folder (the crop). */
  private cropSample(sample: SampleRef, from: Seconds, to: Seconds): Promise<SampleRef> {
    const data = this.audio.library.get(sample.id);
    if (!data) throw new Error(`the audio of "${sample.name}" isn't loaded`);
    const sr = data.sampleRate, a = Math.round(from * sr), b = Math.round(to * sr);
    const channels = data.channels.map(c => c.slice(a, b));
    return this.session.addAudio(`${sample.name} crop.wav`, { channels, sampleRate: sr }, new Uint8Array(encodeWav(channels, sr, 24)));
  }

  /** Before leaving the project (new, open, demo): if there are changes asks whether to save them.
   *  false: give up (also if saving doesn't succeed). */
  private async closeProject(): Promise<boolean> {
    if (!this.session.changed) return true;
    const answer = await choose('Save changes?', `If you don't save them, the changes to "${this.session.name}" will be lost.`, [
      { label: 'Don\'t save', value: 'discard' },
      { label: 'Undo', value: 'cancel' },
      { label: 'Save', value: 'save', primary: true },
    ]);
    if (answer === 'save') await this.session.save(); // if choosing the folder is cancelled, it stops here
    if (answer === 'discard') await this.session.discardRecovery();
    return answer === 'save' || answer === 'discard';
  }

  loadDemo(): void {
    this.run(async () => {
      if (!(await this.closeProject())) return;
      await this.session.newProject(true);
      await buildDemoProject(this.store, this.session);
      this.store.load(this.store.project); // the demo project can't be undone
      this.session.forgetChanges();
      this.say('Demo project loaded: press Space to listen to it.');
    });
  }

  // ---------------------------------------------------------------- helpers

  /** The MIDI controllers: they connect by themselves if permission is already there; Options › Enable MIDI controllers asks for it. */
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
        if (open === app.device) return 'devices';
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
    const ref = this.clipOf(owner);
    if (!ref) return this.say('The track has no clips: automation is drawn in a clip. Create one and try again.');
    this.openClip(ref);
    const clip = findClip(this.store.project, ref)?.clip;
    if (clip && !(clip.kind === 'audio' ? this.editor : this.pianoRoll).modulation.show(target)) this.say('This parameter can\'t be automated.');
  }

  /** The track's clip to work on. */
  private clipOf(id: TrackId): ClipRef | null {
    const p = this.store.project, track = p.track(id), last = this.lastClips.get(id);
    if (!track) return null;
    if (last && findClip(p, last)) return last;
    const playing = this.audio.engine.playingClips().get(id);
    if (playing) return slotRef(id, playing);
    const slot = track.slots.find(c => c);
    if (slot) return slotRef(id, slot.id);
    const placed = track.arrangement[0];
    return placed ? placementRef(id, placed.id) : null;
  }

  /** Opens a track's instrument and effects, or the master's effects; from the piano roll, with the
   *  button to go back to the notes. */
  openDevices(owner: ChainOwner, fromRoll = false): void {
    const clip = fromRoll ? this.pianoRoll.openClip : null;
    const back = clip && owner !== MASTER ? () => this.openClip(clip) : null;
    if (owner !== MASTER) this.ui.selectTrack(owner);
    this.bottom.show(this.device, () => this.device.open(owner, back));
  }

  private selection() {
    return resolveSelection(this.store.project, this.ui.selection);
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

/** A scene is exported for at most this many bars (if the loops only come round later, the longest is enough). */
const SCENE_MAX_BARS = 64;
/** Seconds of tail computed past the end of a looping scene, then wrapped to the start. */
const SCENE_LOOP_TAIL = 8;

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
