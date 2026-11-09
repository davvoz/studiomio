/* The session view, as in Live: a column per track with the clips in the slots (one row per
 * scene), below the track's stop and the mixer; after the tracks the buses (without clips, only the
 * mixer); on the right the master with the scene launch. A click on ▶ launches a clip (at the next quantization boundary), ▶ of a
 * scene launches the row. The clips are dragged from one slot to another (Ctrl copies). */
import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { groupSlotState, sceneState } from '../../engine/session';
import { LAUNCH_QUANTA } from '../../model/launch';
import type { Clip } from '../../model/clip';
import { PALETTE } from '../../model/colors';
import type { ModTarget } from '../../model/envelope';
import { MASTER, type ChainOwner, type Scene } from '../../model/project';
import { sceneClips } from '../../model/scene-export';
import { BusTrack, GroupTrack, type Track } from '../../model/track';
import { setClipColor, setTrackColor, slotRef, type ClipRef } from '../../store/clip-ref';
import { copySlotClips, pasteSlots, pasteToSlot, type Clipboard } from '../../store/clipboard';
import {
  addBus, moveBus, moveTrack, removeTrack, renameTrack, setBusFolded, setLaunchQuantization, type TrackDrop, type TrackKind,
} from '../../store/edits';
import type { Edit, ProjectStore } from '../../store/project-store';
import {
  captureScene, clearSlots, deleteScene, duplicateScene, duplicateSlots, insertScene, moveScene, moveSlots, newSlotMidiClip, renameScene,
  setSceneColor, updateSlotClip, type SlotRef,
} from '../../store/session-edits';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { KEY, SEPARATOR, showContextMenu, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { renameInline } from '../inline-rename';
import { bindKeys, type Binding } from '../keymap';
import type { MeterBoard } from '../meters/meter-board';
import { addEffectItems } from '../mixer-controls';
import { canStartTrackDrag, startTrackDrag, type DropSpot } from '../track-drag';
import { groupMenuItems, newTrackHereItems, toggleFold } from '../track-groups';
import { clickTrack, type UiState } from '../ui-state';
import { MasterStripView, TrackStrip } from './mixer-strip';

export interface SessionViewDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: PlaybackEngine;
  readonly meters: MeterBoard;
  readonly clipboard: Clipboard;
  openClip(ref: ClipRef): void;
  openDevices(owner: ChainOwner): void;
  /** Puts the clipboard's devices on the chosen track. */
  pasteDevices(): void;
  /** The menu items to paste devices onto `owner` (none if the clipboard has none). */
  pasteDeviceItems(owner: ChainOwner): MenuItem[];
  /** Shows a parameter's curve in the track's clip. */
  showAutomation?(owner: ChainOwner, target: ModTarget): void;
  /** A browser item dropped on a slot, on a column's (or the master's) head or
   *  outside the columns (`track` null: a new track). */
  dropItem?(item: BrowserItem, target: LoadTarget): void;
  /** Imports some audio files into the slots from `slot` down (on a new track if `track` is null or isn't audio). */
  importToSlot(files: File[], track: TrackId | null, slot: number): void;
  addTrack(kind: TrackKind): void;
  /** Exports to WAV the audio of the scene at index `index`. */
  exportScene(index: number): void;
  /** Copies the scene at index `index` into the arrangement, at the cursor. */
  sceneToArrangement(index: number): void;
  say(text: string): void;
}

/** The session's keyboard commands (on the chosen slot): they take priority over the general ones. */
const SESSION_KEYS: readonly Binding<SessionView>[] = [
  // before the bare arrows, which also apply with Shift
  { key: 'arrowup', shift: true, run: v => v.extendSelection(0, -1) },
  { key: 'arrowdown', shift: true, run: v => v.extendSelection(0, 1) },
  { key: 'arrowleft', shift: true, run: v => v.extendSelection(-1, 0) },
  { key: 'arrowright', shift: true, run: v => v.extendSelection(1, 0) },
  { key: 'a', ctrl: true, run: v => v.selectAll() },
  { key: 'enter', run: v => v.launchSelected() },
  { key: 'delete', run: v => v.clearSelected() },
  { key: 'backspace', run: v => v.clearSelected() },
  { key: 'd', ctrl: true, run: v => v.duplicateSelected() },
  { key: 'i', ctrl: true, shift: true, run: v => v.captureAndInsertScene() },
  { key: 'c', ctrl: true, run: v => v.copySelected() },
  { key: 'x', ctrl: true, run: v => v.cutSelected() },
  { key: 'v', ctrl: true, run: v => v.pasteSelected() },
  { key: 'arrowup', run: v => v.moveSelection(0, -1) },
  { key: 'arrowdown', run: v => v.moveSelection(0, 1) },
  { key: 'arrowleft', run: v => v.moveSelection(-1, 0) },
  { key: 'arrowright', run: v => v.moveSelection(1, 0) },
];

/** Grid rows: headers, one per scene, stop, space, mixer. */
const row = { head: 1, scene: (s: number) => 2 + s, stop: (scenes: number) => 2 + scenes, mixer: (scenes: number) => 4 + scenes };

/** How much of the clip has passed (0..1), for the progress bar. */
function clipProgress(clip: Clip, elapsed: Beats): number {
  const content = clip.contentBeatAt(elapsed);
  if (content === null) return 0;
  const start = clip.loop.enabled ? Math.min(clip.region.start, clip.loop.start) : clip.region.start;
  const end = clip.loop.enabled ? clip.loop.end : clip.region.end;
  return Math.max(0, Math.min(1, (content - start) / (end - start)));
}

const place = <T extends HTMLElement>(e: T, gridRow: number, gridColumn: number): T => {
  e.style.gridRow = String(gridRow);
  e.style.gridColumn = String(gridColumn);
  return e;
};

const slotKey = (track: TrackId, slot: number) => `${track}:${slot}`;

/** The columns: the tracks, the leftover space, the buses, the master. Bus `i`'s column
 *  (with `T` tracks) comes after the space, next to the master. */
const busColumn = (T: number, i: number) => T + 2 + i;

/** A bus column's width: narrow if it's collapsed. */
const busWidth = (b: BusTrack) => (b.folded ? 'var(--session-folded)' : 'var(--session-col)');

/** For each bus the distance from the right edge: the master and the buses coming after it. */
const busRights = (buses: readonly BusTrack[]): string[] =>
  buses.map((_, i) => `calc(var(--session-master) + 2px${buses.slice(i + 1).map(b => ` + ${busWidth(b)} + 2px`).join('')})`);

/** A bus stays still next to the master, as in Live, while the tracks scroll underneath. */
function pinBus(e: HTMLElement, right: string): HTMLElement {
  e.classList.add('bus-pinned');
  e.style.setProperty('--bus-right', right);
  return e;
}

/** Interface preferences of whoever uses this browser (if local storage is missing, never mind). */
const MIXER_PREF = 'studiomio.session.mixer';
const readPref = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePref = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* niente */ }
};

/** A clip grabbed with the mouse: it becomes a drag after a few pixels. */
interface SlotDrag {
  readonly from: SlotRef;
  readonly x: number;
  readonly y: number;
  /** With Ctrl a click without dragging adds the clip to or removes it from the selection. */
  readonly toggle: boolean;
  ghost: HTMLElement | null;
}

/** A drag started from an empty slot: it chooses the rectangle of slots it covers. */
interface SlotBand {
  readonly from: SlotRef;
  readonly x: number;
  readonly y: number;
  active: boolean;
  /** Started with Shift: without dragging, it's a click extending the selection. */
  readonly extend?: boolean;
}

export class SessionView {
  readonly element = el('section', { className: 'session-view', hidden: true, tabIndex: -1 });
  private readonly grid = el('div', { className: 'session-grid' });
  private readonly scroll = el('div', { className: 'session-scroll' }, this.grid);
  /** The connected controller's box (Live's "red box"): the clips its grid plays. */
  private readonly ring = el('div', { className: 'session-ring', hidden: true });
  private ringAt = '';
  private readonly mixerToggle = el<HTMLButtonElement>('button', { textContent: '🎚 Mixer', title: 'Show or hide the mixer at the bottom of the tracks' });
  private readonly quantize = el<HTMLSelectElement>('select', { title: 'Launch quantization: the clips start at the next boundary' },
    ...LAUNCH_QUANTA.map(q => el('option', { value: q.id, textContent: q.label })));
  private readonly strips = new Map<TrackId, TrackStrip>();
  private readonly master: MasterStripView;
  /** The cells rebuilt at every change (the mixer strips instead stay). */
  private cells: HTMLElement[] = [];
  private readonly slots = new Map<string, HTMLElement>();
  private readonly stops = new Map<TrackId, HTMLElement>();
  private readonly heads = new Map<TrackId, HTMLElement>();
  private scenes: HTMLElement[] = [];
  /** The cursor's slot: the one the keyboard moves and that's pasted onto. */
  private selected: SlotRef | null = null;
  /** All the chosen slots (the cursor included), by key. */
  private readonly picked = new Map<string, SlotRef>();
  /** The slot Shift extends the selection from. */
  private anchor: SlotRef | null = null;
  private drag: SlotDrag | null = null;
  private band: SlotBand | null = null;
  /** The picker of the audio files to put in a slot (the slot is `pickFor`). */
  private readonly picker = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
  private pickFor: SlotRef | null = null;

  constructor(private readonly deps: SessionViewDeps) {
    const { store } = deps;
    this.master = new MasterStripView(store, deps, deps.meters);
    this.quantize.onchange = () => store.apply(setLaunchQuantization(this.quantize.value));
    this.mixerToggle.onclick = () => this.showMixer(this.grid.classList.contains('no-mixer'));
    const toolbar = el('div', { className: 'session-toolbar' },
      el('label', {}, 'Launch', this.quantize),
      el('button', { textContent: '+ Scene', title: 'New scene at the bottom', onclick: () => store.apply(insertScene()) }),
      el('button', { textContent: '+ Audio', title: 'New audio track', onclick: () => deps.addTrack('audio') }),
      el('button', { textContent: '+ MIDI', title: 'New MIDI track', onclick: () => deps.addTrack('midi') }),
      el('button', { textContent: '+ Bus', title: 'New bus: the tracks send it sound with the send knobs', onclick: () => store.apply(addBus()) }),
      this.mixerToggle,
      el('span', { className: 'muted', textContent: 'Tab: arrangement · double click on an empty slot: new MIDI clip or audio · drag (Ctrl copies) · several clips: Shift+drag, Shift+click or Ctrl+click' }));
    this.picker.onchange = () => {
      const files = [...(this.picker.files ?? [])], ref = this.pickFor;
      this.picker.value = '';
      this.pickFor = null;
      if (files.length && ref) this.deps.importToSlot(files, ref.track, ref.slot);
    };
    this.grid.append(this.master.element);
    this.element.append(toolbar, this.scroll, this.picker);
    this.showMixer(readPref(MIXER_PREF) !== 'off');
    // the slot brought into view (arrows) mustn't end up under the headers or under the mixer
    new ResizeObserver(() => this.padScroll()).observe(this.master.element);
    this.bindGrid();
    bindKeys(this.element, this, SESSION_KEYS, true);
    store.onChange(() => this.render());
    deps.ui.onChange(() => {
      this.highlightTrack();
      this.placeRing();
    });
    deps.engine.onSessionChange(() => this.refreshState());
    this.render();
    requestAnimationFrame(this.frame);
  }

  /** The mixer at the bottom of the columns: it hides to leave room for the clips. */
  showMixer(visible: boolean): void {
    this.grid.classList.toggle('no-mixer', !visible);
    this.mixerToggle.classList.toggle('on', visible);
    writePref(MIXER_PREF, visible ? 'on' : 'off');
    this.padScroll();
  }

  private padScroll(): void {
    const mixer = this.grid.classList.contains('no-mixer') ? 0 : this.master.element.offsetHeight;
    this.scroll.style.scrollPaddingBottom = `${mixer}px`;
    this.scroll.style.scrollPaddingTop = `${this.grid.querySelector<HTMLElement>('.session-head')?.offsetHeight ?? 0}px`;
  }

  get isVisible(): boolean {
    return !this.element.hidden;
  }

  show(visible: boolean): void {
    this.element.hidden = !visible;
    if (visible) {
      this.element.focus({ preventScroll: true });
      this.refreshState();
    }
  }

  /** The chosen slot (for tests and for the app). */
  get selection(): SlotRef | null {
    return this.selected;
  }

  // ---------------------------------------------------------------- commands on the chosen slot

  launchSelected(): void {
    if (this.picked.size > 1) for (const r of this.pickedClips()) this.deps.engine.launchSlot(r.track, r.slot);
    else if (this.selected) this.deps.engine.launchSlot(this.selected.track, this.selected.slot);
  }

  clearSelected(): void {
    const refs = this.pickedClips();
    if (refs.length) this.apply(clearSlots(refs));
  }

  duplicateSelected(): void {
    const refs = this.pickedClips();
    if (!refs.length) return;
    if (!this.apply(duplicateSlots(refs))) return;
    const height = Math.max(...refs.map(r => r.slot)) - Math.min(...refs.map(r => r.slot)) + 1;
    this.pick(refs.map(r => ({ ...r, slot: r.slot + height })));
  }

  /** Capture and insert scene: below `index` (the chosen slot's scene, otherwise the last) a
   *  scene with the playing clips, which keep playing from there. */
  captureAndInsertScene(index = this.selected?.slot ?? this.deps.store.project.scenes.length - 1): void {
    const playing = this.deps.engine.playingClips();
    if (!this.apply(captureScene(index, playing))) return;
    if (this.selected) this.select({ ...this.selected, slot: index + 1 });
    if (!playing.size) this.deps.say('No clip is playing: an empty scene was inserted.');
  }

  copySelected(): boolean {
    const copied = copySlotClips(this.deps.store.project, this.pickedClips());
    if (!copied) return false;
    this.deps.clipboard.content = copied;
    const n = copied.items.length;
    this.deps.say(`${n > 1 ? `${n} clips copied` : 'Clip copied'}: Ctrl+V pastes ${n > 1 ? 'them' : 'it'} from a slot on, or in the timeline at the cursor.`);
    return true;
  }

  cutSelected(): void {
    if (this.copySelected()) this.clearSelected();
  }

  pasteSelected(): void {
    if (this.deps.clipboard.devices) return this.deps.pasteDevices();
    const s = this.selected, content = this.deps.clipboard.clips;
    if (!s) return;
    if (!content) return this.deps.say('The clipboard has no clips.');
    const refs = pasteSlots(this.deps.store.project, content, s.track, s.slot);
    if (this.apply(pasteToSlot(content, s.track, s.slot)) && refs.length > 1) this.pick(refs, s);
  }

  /** Chooses some audio files to put in slot `ref` (and in those below, if there's more than one). */
  importAudioTo(ref: SlotRef): void {
    this.pickFor = ref;
    this.picker.click();
  }

  moveSelection(dx: number, dy: number): void {
    const p = this.deps.store.project, s = this.selected, tracks = p.visibleTracks;
    if (!tracks.length) return;
    const col = s ? Math.max(0, tracks.findIndex(t => t.id === s.track)) : 0;
    const c = Math.max(0, Math.min(tracks.length - 1, col + dx));
    const slot = Math.max(0, Math.min(p.scenes.length - 1, (s?.slot ?? 0) + (s ? dy : 0)));
    this.select({ track: tracks[c].id, slot });
  }

  /** Shift+arrows: the rectangle from the starting point widens with the cursor. */
  extendSelection(dx: number, dy: number): void {
    const p = this.deps.store.project, s = this.selected, tracks = p.visibleTracks;
    if (!s) return this.moveSelection(dx, dy);
    const c = Math.max(0, Math.min(tracks.length - 1, tracks.findIndex(t => t.id === s.track) + dx));
    this.pickRange(this.anchor ?? s, { track: tracks[c].id, slot: Math.max(0, Math.min(p.scenes.length - 1, s.slot + dy)) });
  }

  /** Ctrl+A: all the clips of the grid. */
  selectAll(): void {
    const refs = this.deps.store.project.visibleTracks.flatMap(t => t.slots.flatMap((c, slot) => (c ? [{ track: t.id, slot }] : [])));
    if (refs.length) this.pick(refs, this.selected ?? refs[0]);
  }

  // ---------------------------------------------------------------- drawing

  /** The columns are the visible tracks (a closed group hides those of its
   *  tracks); the buses sit on the right, next to the master. */
  private render(): void {
    const p = this.deps.store.project, tracks = p.visibleTracks;
    const T = tracks.length, B = p.buses.length, S = p.scenes.length, rights = busRights(p.buses);
    // the leftover space sits between the tracks and the buses: buses and master stay on the right edge
    const cols = (n: number) => (n ? `repeat(${n}, var(--session-col)) ` : '');
    this.grid.style.gridTemplateColumns = `${cols(T)}minmax(0, 1fr) ${p.buses.map(b => `${busWidth(b)} `).join('')}var(--session-master)`;
    this.grid.style.gridTemplateRows = `auto repeat(${S}, var(--session-row)) auto 1fr auto`;
    if (this.quantize.value !== p.launchQuantization) this.quantize.value = p.launchQuantization;
    if (this.selected && !(tracks.some(t => t.id === this.selected!.track) && this.selected.slot < S)) this.selected = null;
    for (const [key, r] of this.picked) if (!(tracks.some(t => t.id === r.track) && r.slot < S)) this.picked.delete(key);
    for (const c of this.cells) c.remove();
    this.slots.clear();
    this.stops.clear();
    this.heads.clear();
    const cells: HTMLElement[] = [];
    tracks.forEach((t, i) => {
      const col = i + 1;
      cells.push(place(this.head(t), row.head, col));
      t.slots.forEach((clip, s) => cells.push(place(this.slot(t, s, clip), row.scene(s), col)));
      cells.push(place(this.stopButton(t), row.stop(S), col));
    });
    p.buses.forEach((b, i) => {
      const col = busColumn(T, i);
      cells.push(pinBus(place(this.busHead(b), row.head, col), rights[i]));
      // no slots: the column stays empty down to the mixer (collapsed, with the vertical name)
      const lane = pinBus(place(el('div', { className: 'bus-lane' }), row.scene(0), col), rights[i]);
      lane.style.gridRowEnd = String(row.stop(S) + 1);
      lane.style.setProperty('--color', b.color);
      if (b.folded) {
        lane.classList.add('folded');
        lane.title = `${b.name}: a click expands the bus`;
        lane.append(el('span', { className: 'bus-lane-name', textContent: b.name }));
        lane.onclick = () => this.apply(setBusFolded(b.id, false));
      }
      cells.push(lane);
    });
    const masterCol = T + B + 2;
    cells.push(place(el('div', {
      className: 'session-head master-head', textContent: 'Master', title: 'Master: a click opens the effects',
      onclick: () => this.deps.openDevices(MASTER),
    }), row.head, masterCol));
    this.scenes = p.scenes.map((scene, s) => place(this.sceneCell(scene, s), row.scene(s), masterCol));
    cells.push(...this.scenes);
    cells.push(place(el('button', {
      className: 'stop-all', textContent: '■ Stop all', title: 'Stop all the clips at the next boundary',
      onclick: () => this.deps.engine.stopAllClips(),
    }), row.stop(S), masterCol));
    this.cells = cells;
    this.grid.append(...cells, this.ring);
    this.renderStrips(S);
    this.highlightTrack();
    this.placeRing();
    this.refreshState();
  }

  /** The chosen tracks: header, slots and mixer strip of their columns. */
  private highlightTrack(): void {
    const chosen = this.deps.ui.selectedTracks;
    for (const [t, head] of this.heads) head.classList.toggle('selected', chosen.has(t));
    for (const cell of this.slots.values()) cell.classList.toggle('track-selected', chosen.has(cell.dataset.track as TrackId));
    for (const [t, strip] of this.strips) {
      strip.element.classList.toggle('selected', chosen.has(t));
      strip.showKeyboard(this.deps.ui.keyboardTracks.has(t));
    }
  }

  /** The box over the slots it covers; when it moves, it's brought into view. */
  private placeRing(): void {
    const r = this.deps.ui.sessionRing, p = this.deps.store.project;
    const T = p.visibleTracks.length, S = p.scenes.length;
    this.ring.hidden = !r || r.track >= T || r.scene >= S;
    if (!r || this.ring.hidden) return;
    place(this.ring, row.scene(r.scene), r.track + 1);
    this.ring.style.gridRowEnd = `span ${Math.min(r.height, S - r.scene)}`;
    this.ring.style.gridColumnEnd = `span ${Math.min(r.width, T - r.track)}`;
    const at = `${r.track}:${r.scene}`;
    if (at !== this.ringAt && this.isVisible) this.ring.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.ringAt = at;
  }

  /** The mixer strips stay in the grid: they're added, removed and moved. */
  private renderStrips(S: number): void {
    const p = this.deps.store.project, T = p.visibleTracks.length, B = p.buses.length, rights = busRights(p.buses);
    const tracks = [...p.visibleTracks, ...p.buses];
    const alive = new Set(tracks.map(t => t.id));
    for (const [id, strip] of this.strips) {
      if (alive.has(id)) continue;
      strip.dispose();
      strip.element.remove();
      this.strips.delete(id);
    }
    tracks.forEach((t, i) => {
      let strip = this.strips.get(t.id);
      if (!strip) {
        strip = new TrackStrip(t.id, this.deps.store, this.deps, this.deps.meters);
        const id = t.id;
        strip.element.addEventListener('pointerdown', e => this.clickTrack(id, e));
        this.strips.set(t.id, strip);
        this.grid.append(strip.element);
      }
      strip.update(t, p.buses);
      strip.element.classList.toggle('folded', t instanceof BusTrack && t.folded);
      if (i < T) place(strip.element, row.mixer(S), i + 1);
      else pinBus(place(strip.element, row.mixer(S), busColumn(T, i - T)), rights[i - T]);
    });
    this.master.update(p);
    place(this.master.element, row.mixer(S), T + B + 2);
  }

  // ---------------------------------------------------------------- moving the columns

  /** A head grabbed with the mouse and dragged moves its track (or its bus, among the buses). */
  private dragColumn(id: TrackId, head: HTMLElement, e: PointerEvent): void {
    if (!canStartTrackDrag(e)) return;
    const bus = this.deps.store.project.buses.findIndex(b => b.id === id);
    if (bus < 0) startTrackDrag(e, { source: head, spotAt: m => this.trackSpot(id, m), drop: drop => this.apply(moveTrack(id, drop)) });
    else startTrackDrag(e, { source: head, spotAt: m => this.busSpot(bus, m), drop: to => this.apply(moveBus(id, to)) });
  }

  /** The line between the columns, as tall as the visible grid. */
  private columnLine(x: number): DropSpot<never>['line'] {
    const box = this.scroll.getBoundingClientRect();
    return { x: x - 1, y: box.top, width: 2, height: box.height };
  }

  /** Where track `id` dropped at `e` would go: in the left half of a column before
   *  it, in the right half after it (at the top of the tracks, if it's an open group); after the last, or over
   *  the buses and the master, at the end. */
  private trackSpot(id: TrackId, e: PointerEvent): DropSpot<TrackDrop> | null {
    const p = this.deps.store.project, tracks = p.visibleTracks;
    const heads = tracks.map(t => this.heads.get(t.id)!.getBoundingClientRect());
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bus-pinned, .master-head, .scene, .master-strip, .stop-all');
    const i = heads.findIndex(r => e.clientX < r.right + 2);
    if (over || i < 0) return { drop: { end: true }, line: this.columnLine(heads.at(-1)!.right + 1) };
    const t = tracks[i], r = heads[i];
    if (t.id === id || p.isInGroup(t.id, id)) return null;
    if (e.clientX < r.left + r.width / 2) return { drop: { before: t.id }, line: this.columnLine(r.left - 1) };
    return { drop: t instanceof GroupTrack && !t.folded ? { first: t.id } : { after: t.id }, line: this.columnLine(r.right + 1) };
  }

  /** Where the bus at index `from` dropped at `e` would go: its index among the other buses. */
  private busSpot(from: number, e: PointerEvent): DropSpot<number> | null {
    const heads = this.deps.store.project.buses.map(b => this.heads.get(b.id)!.getBoundingClientRect());
    let at = heads.findIndex(r => e.clientX < r.left + r.width / 2);
    if (at < 0) at = heads.length;
    if (at === from || at === from + 1) return null;
    const x = at < heads.length ? heads[at].left - 1 : heads.at(-1)!.right + 1;
    return { drop: at > from ? at - 1 : at, line: this.columnLine(x) };
  }

  /** A scene grabbed with the mouse and dragged goes up or down, with its clips. */
  private dragScene(index: number, cell: HTMLElement, e: PointerEvent): void {
    if (!canStartTrackDrag(e)) return;
    const id = this.deps.store.project.scenes[index].id;
    startTrackDrag(e, {
      source: cell, spotAt: m => this.sceneSpot(index, m), drop: to => {
        if (!this.apply(moveScene(id, to))) return;
        // the chosen slot stays on its clip
        const s = this.selected?.slot;
        if (s === undefined) return;
        const slot = s === index ? to : s > index && s <= to ? s - 1 : s < index && s >= to ? s + 1 : s;
        this.select({ ...this.selected!, slot });
      },
    });
  }

  /** Where scene `from` dropped at `e` would go: above the scene in whose upper half it
   *  is, below the last if it's lower; the line crosses the grid. */
  private sceneSpot(from: number, e: PointerEvent): DropSpot<number> | null {
    const rows = this.scenes.map(c => c.getBoundingClientRect());
    let at = rows.findIndex(r => e.clientY < r.top + r.height / 2);
    if (at < 0) at = rows.length;
    if (at === from || at === from + 1) return null;
    const y = at < rows.length ? rows[at].top - 1 : rows.at(-1)!.bottom + 1;
    const box = this.scroll.getBoundingClientRect();
    return { drop: at > from ? at - 1 : at, line: { x: box.left, y: y - 1, width: box.width, height: 2 } };
  }

  private clickTrack(id: TrackId, e: MouseEvent): void {
    const p = this.deps.store.project;
    clickTrack(this.deps.ui, id, e, () => [...p.visibleTracks, ...p.buses].map(t => t.id));
  }

  /** A bus's header: like a track's, but a bus has no clips or groups; ▾
   *  collapses its column. */
  private busHead(b: BusTrack): HTMLElement {
    const name = el('span', { className: 'session-track-name', textContent: b.name });
    const fold = () => this.apply(setBusFolded(b.id, !b.folded));
    const head = el('div', {
      className: `session-head bus${b.folded ? ' folded' : ''}`,
      title: `${b.name}: a click opens the effects, double click renames, drag to move it`,
    }, el('button', {
      className: 'fold', textContent: b.folded ? '▸' : '▾', title: b.folded ? 'Expand the bus' : 'Collapse the bus: its column narrows',
      onclick: (e: MouseEvent) => { e.stopPropagation(); fold(); },
    }), name);
    head.style.setProperty('--color', b.color);
    head.dataset.track = b.id;
    head.onpointerdown = e => {
      this.clickTrack(b.id, e);
      this.dragColumn(b.id, head, e);
    };
    head.onclick = e => {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.deps.openDevices(b.id);
    };
    head.ondblclick = e => {
      e.stopPropagation();
      renameInline(name, n => this.apply(renameTrack(b.id, n)));
    };
    head.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Effects', run: () => this.deps.openDevices(b.id) },
        ...addEffectItems(this.deps.store, b.id, () => this.deps.openDevices(b.id)),
        ...this.deps.pasteDeviceItems(b.id),
        { label: 'Rename', shortcut: 'double click', run: () => renameInline(name, n => this.apply(renameTrack(b.id, n))) },
        { colors: PALETTE, current: b.color, required: true, pick: c => c && this.apply(setTrackColor(b.id, c)) },
        { label: b.folded ? 'Expand the bus' : 'Collapse the bus', run: fold },
        SEPARATOR,
        { label: 'Delete the bus', run: () => this.apply(removeTrack(b.id)) },
        SEPARATOR,
        { label: 'New bus', run: () => this.apply(addBus()) },
      ]);
    };
    this.heads.set(b.id, head);
    return head;
  }

  private head(t: Track): HTMLElement {
    const p = this.deps.store.project;
    const name = el('span', { className: 'session-track-name', textContent: t.name });
    const head = el('div', { className: 'session-head', title: `${t.name}: a click opens instrument and effects, double click renames, drag to move it` }, name);
    head.style.setProperty('--color', t.color);
    head.dataset.track = t.id;
    if (t instanceof GroupTrack) {
      head.classList.add('group');
      head.prepend(el('button', {
        className: 'fold', textContent: t.folded ? '▸' : '▾', title: t.folded ? 'Open the group' : 'Close the group: hides its tracks\' columns',
        onclick: (e: MouseEvent) => { e.stopPropagation(); toggleFold(this.deps.store, t); },
      }));
    }
    const group = t.group ? p.track(t.group) : undefined;
    if (group) {
      head.classList.add('in-group');
      head.style.setProperty('--group-color', group.color);
    }
    head.onpointerdown = e => {
      this.clickTrack(t.id, e);
      this.dragColumn(t.id, head, e);
    };
    head.onclick = e => {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.deps.openDevices(t.id);
    };
    head.ondblclick = e => {
      e.stopPropagation();
      renameInline(name, n => this.apply(renameTrack(t.id, n)));
    };
    head.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: t.kind === 'midi' ? 'Instrument and effects' : 'Effects', run: () => this.deps.openDevices(t.id) },
        ...addEffectItems(this.deps.store, t.id, () => this.deps.openDevices(t.id)),
        ...this.deps.pasteDeviceItems(t.id),
        { label: 'Rename', shortcut: 'double click', run: () => renameInline(name, n => this.apply(renameTrack(t.id, n))) },
        { colors: PALETTE, current: t.color, required: true, pick: c => c && this.apply(setTrackColor(t.id, c)) },
        SEPARATOR,
        ...groupMenuItems(this.deps.store, this.deps.ui, t),
        SEPARATOR,
        { label: t instanceof GroupTrack ? 'Delete the group and its tracks' : 'Delete track', run: () => this.apply(removeTrack(t.id)) },
        SEPARATOR,
        ...newTrackHereItems(this.deps.store, t),
      ]);
    };
    this.heads.set(t.id, head);
    return head;
  }

  private slot(t: Track, s: number, clip: Clip | null): HTMLElement {
    if (t instanceof GroupTrack) return this.groupSlot(t, s);
    const cell = el('div', { className: clip ? 'slot filled' : 'slot' });
    cell.dataset.track = t.id;
    cell.dataset.slot = String(s);
    if (clip) {
      cell.style.setProperty('--clip', clip.color);
      cell.title = `${clip.name}: ▶ launches, a click opens the editor, drag to move (Ctrl copies)`;
      cell.append(
        el('button', { className: 'launch', textContent: '▶', title: 'Launch the clip', onclick: () => this.deps.engine.launchSlot(t.id, s) }),
        el('span', { className: 'clip-name', textContent: clip.name }),
        el('div', { className: 'progress' }));
    } else {
      if (t.kind === 'audio') cell.title = 'Double click: import an audio file into this slot (or drag it here)';
      cell.append(el('button', { className: 'slot-stop', textContent: '■', title: 'Stop the track', onclick: () => this.deps.engine.stopTrack(t.id) }));
    }
    if (this.picked.has(slotKey(t.id, s))) cell.classList.add('selected');
    this.slots.set(slotKey(t.id, s), cell);
    return cell;
  }

  /** A group's slot, as in Live: if at least one of its tracks has a clip in the row, ▶
   *  launches the row of its tracks (those without a clip there stop); otherwise ■ stops them. */
  private groupSlot(t: GroupTrack, s: number): HTMLElement {
    const clips = this.deps.store.project.soundingTracks(t.id).some(m => m.slots[s]);
    const cell = el('div', { className: clips ? 'slot group-slot has-clips' : 'slot group-slot' });
    cell.style.setProperty('--color', t.color);
    cell.dataset.track = t.id;
    cell.dataset.slot = String(s);
    cell.append(clips
      ? el('button', { className: 'launch', textContent: '▶', title: 'Launch the row of the group\'s tracks', onclick: () => this.deps.engine.launchSlot(t.id, s) })
      : el('button', { className: 'slot-stop', textContent: '■', title: 'Stop the group\'s tracks', onclick: () => this.deps.engine.stopTrack(t.id) }));
    if (this.picked.has(slotKey(t.id, s))) cell.classList.add('selected');
    this.slots.set(slotKey(t.id, s), cell);
    return cell;
  }

  private stopButton(t: Track): HTMLElement {
    const b = el('button', { className: 'track-stop', textContent: '■', title: 'Stop the track\'s clip', onclick: () => this.deps.engine.stopTrack(t.id) });
    this.stops.set(t.id, b);
    return b;
  }

  private sceneCell(scene: Scene, index: number): HTMLElement {
    const name = el('span', { className: 'scene-name', textContent: scene.name });
    const cell = el('div', { className: 'scene' },
      el('button', { className: 'launch', textContent: '▶', title: 'Launch the scene', onclick: () => this.deps.engine.launchScene(index) }), name);
    cell.classList.toggle('colored', !!scene.color);
    if (scene.color) cell.style.setProperty('--scene', scene.color);
    cell.ondblclick = () => renameInline(name, n => this.apply(renameScene(scene.id, n)));
    cell.onpointerdown = e => this.dragScene(index, cell, e);
    cell.oncontextmenu = e => {
      e.preventDefault();
      const only = this.deps.store.project.scenes.length < 2;
      const sceneHasClips = sceneClips(this.deps.store.project, index).length > 0;
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Launch the scene', run: () => this.deps.engine.launchScene(index) },
        { label: 'Rename', shortcut: 'double click', run: () => renameInline(name, n => this.apply(renameScene(scene.id, n))) },
        { colors: PALETTE, current: scene.color, pick: c => c !== scene.color && this.apply(setSceneColor(scene.id, c)) },
        { label: 'Duplicate', run: () => this.apply(duplicateScene(scene.id)) },
        { label: 'Capture and insert scene', shortcut: 'Ctrl+Shift+I', run: () => this.captureAndInsertScene(index) },
        { label: 'Copy to the arrangement', disabled: !sceneHasClips, run: () => this.deps.sceneToArrangement(index) },
        { label: 'Export audio…', run: () => this.deps.exportScene(index) },
        { label: 'Insert a scene above', run: () => this.apply(insertScene(index)) },
        { label: 'Insert a scene below', run: () => this.apply(insertScene(index + 1)) },
        SEPARATOR,
        { label: 'Delete the scene', disabled: only, run: () => this.apply(deleteScene(scene.id)) },
      ]);
    };
    return cell;
  }

  // ---------------------------------------------------------------- playback state

  /** Playing clips, queued ones and tracks stopping: at every frame (the progress
   *  flows) and right after a launch. */
  private refreshState(): void {
    if (this.element.hidden) return;
    const { engine, store } = this.deps;
    const p = store.project;
    for (const t of p.visibleTracks) {
      // of a group: its tracks together, and row by row
      const st = engine.sessionState(t);
      const queued = st.queued && typeof st.queued === 'object' ? st.queued.slot : -1;
      const members = t instanceof GroupTrack ? p.soundingTracks(t.id).map(m => [m, engine.sessionState(m)] as const) : null;
      t.slots.forEach((clip, s) => {
        const cell = this.slots.get(slotKey(t.id, s));
        if (!cell) return;
        const group = members && groupSlotState(members, s);
        const playing = group ? group.playing : st.playing?.slot === s;
        cell.classList.toggle('playing', playing);
        cell.classList.toggle('queued', group ? group.queued : queued === s);
        const bar = cell.querySelector<HTMLElement>('.progress');
        if (bar) bar.style.transform = `scaleX(${playing && clip ? clipProgress(clip, st.playing!.elapsed) : 0})`;
      });
      this.stops.get(t.id)?.classList.toggle('queued', st.queued === 'stop');
      this.heads.get(t.id)?.classList.toggle('taken', !st.followsArrangement);
    }
    // the scenes: they play if one of their clips plays
    const sounding = p.tracks.filter(t => !(t instanceof GroupTrack)).map(t => [t, engine.sessionState(t)] as const);
    this.scenes.forEach((cell, s) => {
      const scene = sceneState(sounding, s);
      cell.classList.toggle('playing', scene.playing);
      cell.classList.toggle('queued', scene.queued);
    });
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    if (this.deps.engine.playing) this.refreshState();
  };

  // ---------------------------------------------------------------- mouse

  private slotAt(target: EventTarget | null): SlotRef | null {
    const cell = (target as HTMLElement | null)?.closest?.<HTMLElement>('.slot');
    return cell ? { track: cell.dataset.track as TrackId, slot: Number(cell.dataset.slot) } : null;
  }

  private bindGrid(): void {
    const g = this.grid;
    g.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
      const ref = this.slotAt(e.target);
      if (!ref) return;
      const multi = e.ctrlKey || e.metaKey;
      // with Shift from any slot, even full: a click extends the selection, dragging draws it
      if (e.shiftKey) {
        this.band = { from: ref, x: e.clientX, y: e.clientY, active: false, extend: true };
        return;
      }
      const clip = this.deps.store.project.track(ref.track)?.slots[ref.slot];
      // a clip already among the chosen ones stays with the others: they're dragged together
      if (!(clip && this.picked.has(slotKey(ref.track, ref.slot))) && !(clip && multi)) this.select(ref);
      else this.element.focus({ preventScroll: true });
      if (clip) this.drag = { from: ref, x: e.clientX, y: e.clientY, toggle: multi, ghost: null };
      else this.band = { from: ref, x: e.clientX, y: e.clientY, active: false };
    });
    window.addEventListener('pointermove', e => this.dragMove(e));
    window.addEventListener('pointerup', e => this.dragEnd(e));
    g.addEventListener('dblclick', e => {
      if ((e.target as HTMLElement).closest('button')) return;
      const ref = this.slotAt(e.target);
      const track = ref && this.deps.store.project.track(ref.track);
      if (!ref || !track || track.slots[ref.slot] || track instanceof GroupTrack) return;
      if (track.kind !== 'midi') return this.importAudioTo(ref);
      this.apply(newSlotMidiClip(ref));
      this.openSlot(ref);
    });
    g.addEventListener('contextmenu', e => {
      const ref = this.slotAt(e.target);
      if (!ref) return;
      e.preventDefault();
      if (this.picked.has(slotKey(ref.track, ref.slot))) this.selected = ref;
      else this.select(ref);
      showContextMenu(e.clientX, e.clientY, this.slotMenu(ref, e.target as HTMLElement));
    });
    // audio files dragged from outside: into the slots (a new track if it isn't audio)
    g.addEventListener('dragover', e => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    g.addEventListener('drop', e => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const ref = this.slotAt(e.target);
      this.deps.importToSlot(files, ref?.track ?? null, ref?.slot ?? 0);
    });
    if (this.deps.dropItem) {
      acceptBrowserDrops(g, (item, e) => this.deps.dropItem!(item, this.dropTarget(item, e.target)), {
        // the slot (or the column's head) where it will go, highlighted
        over: e => {
          for (const c of g.querySelectorAll('.drop-target')) c.classList.remove('drop-target');
          const node = (e?.target as HTMLElement | null)?.closest?.('.slot, .session-head');
          node?.classList.add('drop-target');
        },
      });
    }
  }

  /** Where a browser item dropped on `target` goes: the slot underneath; on a column's head (or on the mixer)
   *  its track (a sample in the first free slot); on the master its chain. */
  private dropTarget(item: BrowserItem, target: EventTarget | null): LoadTarget {
    const ref = this.slotAt(target);
    if (ref) return { kind: 'slot', ...ref };
    const node = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-track], .master-head');
    const p = this.deps.store.project;
    if (node?.classList.contains('master-head')) return { kind: 'chain', owner: MASTER };
    const track = node?.dataset.track ? p.track(node.dataset.track as TrackId) : undefined;
    const audio = item.payload?.kind === 'sample' || item.payload?.kind === 'file';
    if (!track) return audio ? { kind: 'slot', track: null, slot: 0 } : { kind: 'lane', track: null, beat: 0 };
    if (!audio) return { kind: 'chain', owner: track.id };
    const free = track.slots.findIndex(c => !c);
    return { kind: 'slot', track: track.id, slot: free < 0 ? 0 : free };
  }

  private dragMove(e: PointerEvent): void {
    const b = this.band;
    if (b) {
      if (!b.active && Math.hypot(e.clientX - b.x, e.clientY - b.y) < 5) return;
      b.active = true;
      const over = this.slotAt(document.elementFromPoint(e.clientX, e.clientY));
      if (over) this.pickRange(b.from, over);
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      const source = this.slots.get(slotKey(d.from.track, d.from.slot)), n = this.moving(d).length;
      d.ghost = el('div', { className: 'slot filled slot-ghost', textContent: n > 1 ? `${n} clip` : source?.querySelector('.clip-name')?.textContent ?? '' });
      d.ghost.style.setProperty('--clip', source?.style.getPropertyValue('--clip') ?? '');
      document.body.append(d.ghost);
    }
    d.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
    d.ghost.classList.toggle('copy', e.ctrlKey || e.metaKey);
    for (const c of this.slots.values()) c.classList.remove('drop-target');
    const over = this.slotAt(document.elementFromPoint(e.clientX, e.clientY));
    if (over) this.slots.get(slotKey(over.track, over.slot))?.classList.add('drop-target');
  }

  /** The clips a drag carries along: the chosen ones, if the grabbed clip is among them. */
  private moving(d: SlotDrag): SlotRef[] {
    return this.picked.has(slotKey(d.from.track, d.from.slot)) ? this.pickedClips() : [d.from];
  }

  private dragEnd(e: PointerEvent): void {
    const b = this.band;
    this.band = null;
    if (b?.extend && !b.active) this.pickRange(this.anchor ?? this.selected ?? b.from, b.from);
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    for (const c of this.slots.values()) c.classList.remove('drop-target');
    if (!d.ghost) {
      if (d.toggle) return this.toggle(d.from);
      this.select(d.from);
      return this.openSlot(d.from); // a click: opens the clip in the editor
    }
    d.ghost.remove();
    const to = this.slotAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!to || (to.track === d.from.track && to.slot === d.from.slot)) return;
    const tracks = this.deps.store.project.visibleTracks, column = (t: TrackId) => tracks.findIndex(x => x.id === t);
    const columns = column(to.track) - column(d.from.track), rows = to.slot - d.from.slot;
    const refs = this.moving(d);
    if (!this.apply(moveSlots(refs, columns, rows, e.ctrlKey || e.metaKey))) return;
    this.pick(refs.map(r => ({ track: tracks[column(r.track) + columns].id, slot: r.slot + rows })), to);
  }

  private slotMenu(ref: SlotRef, target: HTMLElement): MenuItem[] {
    const p = this.deps.store.project, track = p.track(ref.track)!, clip = track.slots[ref.slot];
    if (track instanceof GroupTrack) {
      return [
        { label: 'Launch the group\'s row', shortcut: 'Enter', run: () => this.deps.engine.launchSlot(track.id, ref.slot) },
        { label: 'Stop the group\'s tracks', run: () => this.deps.engine.stopTrack(track.id) },
      ];
    }
    if (!clip) {
      return [
        track.kind === 'midi'
          ? { label: 'New MIDI clip', shortcut: 'double click', run: () => { this.apply(newSlotMidiClip(ref)); this.openSlot(ref); } }
          : { label: 'Import audio…', shortcut: 'double click', run: () => this.importAudioTo(ref) },
        { label: 'Paste', shortcut: KEY.paste, disabled: !this.deps.clipboard.clips, run: () => this.pasteSelected() },
        { label: 'Stop the track', run: () => this.deps.engine.stopTrack(ref.track) },
      ];
    }
    const refs = this.pickedClips();
    if (refs.length > 1) {
      return [
        { label: `Launch ${refs.length} clips`, shortcut: 'Enter', run: () => this.launchSelected() },
        SEPARATOR,
        { label: 'Cut', shortcut: KEY.cut, run: () => this.cutSelected() },
        { label: 'Copy', shortcut: KEY.copy, run: () => this.copySelected() },
        { label: 'Duplicate', shortcut: KEY.duplicate, run: () => this.duplicateSelected() },
        SEPARATOR,
        { colors: PALETTE, current: clip.color, noneTitle: 'Track colour', pick: c => this.apply(setClipColor(refs.flatMap(r => {
          const id = p.track(r.track)?.slots[r.slot]?.id;
          return id ? [slotRef(r.track, id)] : [];
        }), c)) },
        SEPARATOR,
        { label: `Delete ${refs.length} clips`, shortcut: KEY.delete, run: () => this.clearSelected() },
      ];
    }
    const name = target.closest('.slot')?.querySelector<HTMLElement>('.clip-name');
    return [
      { label: 'Launch', shortcut: 'Enter', run: () => this.launchSelected() },
      { label: 'Open in the editor', shortcut: 'click', run: () => this.openSlot(ref) },
      SEPARATOR,
      { label: 'Cut', shortcut: KEY.cut, run: () => this.cutSelected() },
      { label: 'Copy', shortcut: KEY.copy, run: () => this.copySelected() },
      { label: 'Duplicate', shortcut: KEY.duplicate, run: () => this.duplicateSelected() },
      { label: 'Rename', run: () => name && renameInline(name, n => this.apply(updateSlotClip('Rename clip', ref.track, clip.id, c => c.withName(n)))) },
      SEPARATOR,
      { colors: PALETTE, current: clip.color, noneTitle: 'Track colour', pick: c => this.apply(setClipColor([slotRef(ref.track, clip.id)], c)) },
      SEPARATOR,
      { label: 'Delete', shortcut: KEY.delete, run: () => this.clearSelected() },
    ];
  }

  // ---------------------------------------------------------------- helpers

  /** A single slot: the cursor, and from there the selection extends. */
  private select(ref: SlotRef): void {
    this.anchor = ref;
    this.pick([ref]);
  }

  /** Chooses these slots; the cursor is `cursor`. Shift's starting point doesn't change. */
  private pick(refs: readonly SlotRef[], cursor: SlotRef = refs[0]): void {
    this.selected = cursor;
    this.picked.clear();
    for (const r of refs) this.picked.set(slotKey(r.track, r.slot), r);
    this.picked.set(slotKey(cursor.track, cursor.slot), cursor);
    this.deps.ui.selectTrack(cursor.track);
    this.showPicked();
    this.slots.get(slotKey(cursor.track, cursor.slot))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.element.focus({ preventScroll: true });
  }

  private showPicked(): void {
    for (const [key, c] of this.slots) c.classList.toggle('selected', this.picked.has(key));
  }

  /** The rectangle of slots between `from` and `to`: the cursor goes on `to`. */
  private pickRange(from: SlotRef, to: SlotRef): void {
    const tracks = this.deps.store.project.visibleTracks;
    const a = tracks.findIndex(t => t.id === from.track), b = tracks.findIndex(t => t.id === to.track);
    if (a < 0 || b < 0) return this.select(to);
    const top = Math.min(from.slot, to.slot), bottom = Math.max(from.slot, to.slot);
    const refs = tracks.slice(Math.min(a, b), Math.max(a, b) + 1).flatMap(t => Array.from({ length: bottom - top + 1 }, (_, i) => ({ track: t.id, slot: top + i })));
    this.anchor = from;
    this.pick(refs, to);
  }

  /** Ctrl+click: the clip enters or leaves the selection. */
  private toggle(ref: SlotRef): void {
    const key = slotKey(ref.track, ref.slot);
    if (!this.picked.has(key)) {
      this.anchor = ref;
      return this.pick([...this.picked.values(), ref], ref);
    }
    const rest = [...this.picked.values()].filter(r => slotKey(r.track, r.slot) !== key);
    if (rest.length) this.pick(rest, rest[rest.length - 1]);
  }

  /** The chosen slots that have a clip. */
  private pickedClips(): SlotRef[] {
    const p = this.deps.store.project;
    return [...this.picked.values()].filter(r => p.track(r.track)?.slots[r.slot]);
  }

  /** Opens the clip in the editor at the bottom; the keyboard stays with the session (Ctrl+C copies the clip). */
  private openSlot(ref: SlotRef): void {
    const clip = this.deps.store.project.track(ref.track)?.slots[ref.slot];
    if (!clip) return;
    this.deps.openClip(slotRef(ref.track, clip.id));
    this.element.focus({ preventScroll: true });
  }

  /** Applies a change; an error (e.g. an audio clip on a MIDI track) goes in the status bar. */
  private apply(e: Edit): boolean {
    try {
      this.deps.store.apply(e);
      return true;
    } catch (err) {
      this.deps.say(err instanceof TypeError ? 'Clips go on tracks of the same kind: audio with audio, MIDI with MIDI.' : `${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
