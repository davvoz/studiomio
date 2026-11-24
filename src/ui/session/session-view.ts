/* The session view, as in Live: a column per track with the clips in the slots (one row per
 * scene), below the track's stop and the mixer; after the tracks the buses (without clips, only the
 * mixer); on the right the master with the scene launch. A click on ▶ launches a clip (at the next
 * quantization boundary), ▶ of a scene launches the row. The clips are dragged from one slot to
 * another (Ctrl copies).
 * This file only builds the DOM, measures it and wires the events: the selection's rules are in
 * slot-selection, the commands in session-commands, the menus in session-menus, what a slot shows
 * and its playback in slot-face, the layout in session-layout, where drops go in session-drop. */
import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { TrackId } from '../../core/id';
import type { PlaybackEngine } from '../../engine/playback-engine';
import type { Clip } from '../../model/clip';
import type { ModTarget } from '../../model/envelope';
import { LAUNCH_QUANTA } from '../../model/launch';
import { MASTER, type ChainOwner, type Scene } from '../../model/project';
import { BusTrack, GroupTrack, type Track } from '../../model/track';
import type { ClipRef } from '../../store/clip-ref';
import type { Clipboard } from '../../store/clipboard';
import { addBus, moveBus, moveTrack, renameTrack, setBusFolded, setLaunchQuantization, type TrackDrop, type TrackKind } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { insertScene, moveScene, moveSlots, renameScene, updateSlotClip, type SlotRef } from '../../store/session-edits';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { showContextMenu, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { readPref, writePref } from '../kit/prefs';
import { renameInline } from '../inline-rename';
import { bindKeys } from '../keymap';
import type { MeterBoard } from '../meters/meter-board';
import { canStartTrackDrag, startTrackDrag, type DropSpot } from '../track-drag';
import { toggleFold } from '../track-groups';
import { clickTrack, type UiState } from '../ui-state';
import { MasterStripView, TrackStrip } from './mixer-strip';
import { SESSION_KEYS, SessionCommands, type SessionControls, type SlotRecorder } from './session-commands';
import { browserDropTarget, indexSpot, movedRefs, slotOffset, trackSpot, type Span, type Spot } from './session-drop';
import { busColumn, busRights, gridColumns, gridRows, masterColumn, ringArea, row } from './session-layout';
import { busHeadMenu, sceneMenu, slotMenu, trackHeadMenu, type SessionMenuDeps } from './session-menus';
import { RECORD_TITLE, isArmed, sessionPlayback, slotFace } from './slot-face';
import { SlotSelection, slotKey } from './slot-selection';

export type { SlotRecorder } from './session-commands';

export interface SessionViewDeps {
  readonly store: ProjectStore;
  readonly recorder: SlotRecorder;
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

const place = <T extends HTMLElement>(e: T, gridRow: number, gridColumn: number): T => {
  e.style.gridRow = String(gridRow);
  e.style.gridColumn = String(gridColumn);
  return e;
};

/** A bus stays still next to the master, as in Live, while the tracks scroll underneath. */
function pinBus(e: HTMLElement, right: string): HTMLElement {
  e.classList.add('bus-pinned');
  e.style.setProperty('--bus-right', right);
  return e;
}

/** An element's horizontal and vertical extent, for the drop decisions. */
const columnSpan = (r: DOMRect): Span => ({ start: r.left, end: r.right });
const rowSpan = (r: DOMRect): Span => ({ start: r.top, end: r.bottom });

/** Interface preferences of whoever uses this browser (if local storage is missing, never mind). */
const MIXER_PREF = 'studiomio.session.mixer';

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

/** The pointer moved far enough from where it was pressed to be a drag. */
const dragged = (start: { x: number; y: number }, e: PointerEvent): boolean => Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5;

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
  private readonly chosen: SlotSelection;
  private readonly commands: SessionCommands;
  private readonly menus: SessionMenuDeps;
  private drag: SlotDrag | null = null;
  private band: SlotBand | null = null;
  /** The picker of the audio files to put in a slot (the slot is `pickFor`). */
  private readonly picker = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
  private pickFor: SlotRef | null = null;
  /** The armed tracks when the slots were last drawn. */
  private armedShown: ReadonlySet<TrackId> = new Set();

  constructor(private readonly deps: SessionViewDeps) {
    const { store } = deps;
    this.chosen = new SlotSelection(() => store.project, cursor => this.showPick(cursor));
    this.commands = new SessionCommands(deps, this.chosen, { focus: () => this.focus() });
    this.menus = {
      store, ui: deps.ui, engine: deps.engine, clipboard: deps.clipboard, recorder: deps.recorder, commands: this.commands, selection: this.chosen,
      openDevices: owner => deps.openDevices(owner),
      pasteDeviceItems: owner => deps.pasteDeviceItems(owner),
      sceneToArrangement: index => deps.sceneToArrangement(index),
      exportScene: index => deps.exportScene(index),
      importAudioTo: ref => this.importAudioTo(ref),
    };
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
    const controls: SessionControls = { selection: this.chosen, commands: this.commands };
    bindKeys(this.element, controls, SESSION_KEYS, true);
    store.onChange(() => this.render());
    deps.ui.onChange(() => {
      // arming a track shows ● on its empty slots
      if (deps.ui.keyboardTracks !== this.armedShown) this.render();
      this.highlightTrack();
      this.placeRing();
    });
    deps.recorder.onChange(() => this.render());
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
      this.focus();
      this.refreshState();
    }
  }

  /** The chosen slot (for tests and for the app). */
  get selection(): SlotRef | null {
    return this.chosen.cursor;
  }

  private focus(): void {
    this.element.focus({ preventScroll: true });
  }

  /** Chooses some audio files to put in slot `ref` (and in those below, if there's more than one). */
  private importAudioTo(ref: SlotRef): void {
    this.pickFor = ref;
    this.picker.click();
  }

  // ---------------------------------------------------------------- drawing

  /** The columns are the visible tracks (a closed group hides those of its
   *  tracks); the buses sit on the right, next to the master. */
  private render(): void {
    this.armedShown = this.deps.ui.keyboardTracks;
    const p = this.deps.store.project, tracks = p.visibleTracks;
    const T = tracks.length, S = p.scenes.length, rights = busRights(p.buses), masterCol = masterColumn(T, p.buses.length);
    this.grid.style.gridTemplateColumns = gridColumns(T, p.buses);
    this.grid.style.gridTemplateRows = gridRows(S);
    if (this.quantize.value !== p.launchQuantization) this.quantize.value = p.launchQuantization;
    this.chosen.prune();
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
      cells.push(pinBus(place(this.busHead(b), row.head, col), rights[i]), this.busLane(b, col, rights[i]));
    });
    cells.push(place(el('div', {
      className: 'session-head master-head', textContent: 'Master', title: 'Master: a click opens the effects',
      onclick: () => this.deps.openDevices(MASTER),
    }), row.head, masterCol));
    this.scenes = p.scenes.map((scene, s) => place(this.sceneCell(scene, s), row.scene(s), masterCol));
    cells.push(...this.scenes, place(el('button', {
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

  /** A bus has no slots: its column stays empty down to the mixer (collapsed, with the vertical name). */
  private busLane(b: BusTrack, column: number, right: string): HTMLElement {
    const lane = pinBus(place(el('div', { className: 'bus-lane' }), row.scene(0), column), right);
    lane.style.gridRowEnd = String(row.stop(this.deps.store.project.scenes.length) + 1);
    lane.style.setProperty('--color', b.color);
    if (b.folded) {
      lane.classList.add('folded');
      lane.title = `${b.name}: a click expands the bus`;
      lane.append(el('span', { className: 'bus-lane-name', textContent: b.name }));
      lane.onclick = () => this.commands.apply(setBusFolded(b.id, false));
    }
    return lane;
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
    const area = ringArea(r, p.visibleTracks.length, p.scenes.length);
    this.ring.hidden = !area;
    if (!r || !area) return;
    place(this.ring, area.row, area.column);
    this.ring.style.gridRowEnd = `span ${area.rows}`;
    this.ring.style.gridColumnEnd = `span ${area.columns}`;
    const at = `${r.track}:${r.scene}`;
    if (at !== this.ringAt && this.isVisible) this.ring.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.ringAt = at;
  }

  /** The mixer strips stay in the grid: they're added, removed and moved. */
  private renderStrips(S: number): void {
    const p = this.deps.store.project, T = p.visibleTracks.length, rights = busRights(p.buses);
    const tracks = [...p.visibleTracks, ...p.buses];
    const alive = new Set(tracks.map(t => t.id));
    for (const [id, strip] of this.strips) {
      if (alive.has(id)) continue;
      strip.dispose();
      strip.element.remove();
      this.strips.delete(id);
    }
    tracks.forEach((t, i) => {
      const strip = this.strips.get(t.id) ?? this.newStrip(t.id);
      strip.update(t, p.buses);
      strip.element.classList.toggle('folded', t instanceof BusTrack && t.folded);
      if (i < T) place(strip.element, row.mixer(S), i + 1);
      else pinBus(place(strip.element, row.mixer(S), busColumn(T, i - T)), rights[i - T]);
    });
    this.master.update(p);
    place(this.master.element, row.mixer(S), masterColumn(T, p.buses.length));
  }

  private newStrip(id: TrackId): TrackStrip {
    const strip = new TrackStrip(id, this.deps.store, this.deps, this.deps.meters);
    strip.element.addEventListener('pointerdown', e => this.clickTrack(id, e));
    this.strips.set(id, strip);
    this.grid.append(strip.element);
    return strip;
  }

  // ---------------------------------------------------------------- moving the columns

  /** A head grabbed with the mouse and dragged moves its track (or its bus, among the buses). */
  private dragColumn(id: TrackId, head: HTMLElement, e: PointerEvent): void {
    if (!canStartTrackDrag(e)) return;
    const bus = this.deps.store.project.buses.findIndex(b => b.id === id);
    if (bus < 0) startTrackDrag(e, { source: head, spotAt: m => this.trackSpot(id, m), drop: drop => this.commands.apply(moveTrack(id, drop)) });
    else startTrackDrag(e, { source: head, spotAt: m => this.busSpot(bus, m), drop: to => this.commands.apply(moveBus(id, to)) });
  }

  /** A spot along the columns as the line between them, as tall as the visible grid. */
  private columnLine<T>(spot: Spot<T> | null): DropSpot<T> | null {
    if (!spot) return null;
    const box = this.scroll.getBoundingClientRect();
    return { drop: spot.drop, line: { x: spot.at - 1, y: box.top, width: 2, height: box.height } };
  }

  private headSpans(ids: readonly TrackId[]): Span[] {
    return ids.map(id => columnSpan(this.heads.get(id)!.getBoundingClientRect()));
  }

  /** Where track `id` dropped at `e` would go (over the buses and the master: at the end). */
  private trackSpot(id: TrackId, e: PointerEvent): DropSpot<TrackDrop> | null {
    const p = this.deps.store.project;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bus-pinned, .master-head, .scene, .master-strip, .stop-all');
    return this.columnLine(trackSpot(p, id, this.headSpans(p.visibleTracks.map(t => t.id)), e.clientX, !!over));
  }

  /** Where the bus at index `from` dropped at `e` would go: its index among the other buses. */
  private busSpot(from: number, e: PointerEvent): DropSpot<number> | null {
    return this.columnLine(indexSpot(from, this.headSpans(this.deps.store.project.buses.map(b => b.id)), e.clientX));
  }

  /** A scene grabbed with the mouse and dragged goes up or down, with its clips. */
  private dragScene(index: number, cell: HTMLElement, e: PointerEvent): void {
    if (!canStartTrackDrag(e)) return;
    const id = this.deps.store.project.scenes[index].id;
    startTrackDrag(e, {
      source: cell, spotAt: m => this.sceneSpot(index, m), drop: to => {
        // the chosen slot stays on its clip
        if (this.commands.apply(moveScene(id, to))) this.chosen.followSceneMove(index, to);
      },
    });
  }

  /** Where scene `from` dropped at `e` would go; the line crosses the grid. */
  private sceneSpot(from: number, e: PointerEvent): DropSpot<number> | null {
    const spot = indexSpot(from, this.scenes.map(c => rowSpan(c.getBoundingClientRect())), e.clientY);
    if (!spot) return null;
    const box = this.scroll.getBoundingClientRect();
    return { drop: spot.drop, line: { x: box.left, y: spot.at - 1, width: box.width, height: 2 } };
  }

  private clickTrack(id: TrackId, e: MouseEvent): void {
    const p = this.deps.store.project;
    clickTrack(this.deps.ui, id, e, () => [...p.visibleTracks, ...p.buses].map(t => t.id));
  }

  // ---------------------------------------------------------------- cells

  /** A column's header: a click opens the devices, double click renames, drag moves, right click the menu. */
  private columnHead(t: Track, head: HTMLElement, name: HTMLElement, menu: (rename: () => void) => MenuItem[]): HTMLElement {
    const rename = () => renameInline(name, n => this.commands.apply(renameTrack(t.id, n)));
    head.style.setProperty('--color', t.color);
    head.dataset.track = t.id;
    head.onpointerdown = e => {
      this.clickTrack(t.id, e);
      this.dragColumn(t.id, head, e);
    };
    head.onclick = e => {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.deps.openDevices(t.id);
    };
    head.ondblclick = e => {
      e.stopPropagation();
      rename();
    };
    head.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, menu(rename));
    };
    this.heads.set(t.id, head);
    return head;
  }

  /** A bus's header: like a track's, but a bus has no clips or groups; ▾ collapses its column. */
  private busHead(b: BusTrack): HTMLElement {
    const name = el('span', { className: 'session-track-name', textContent: b.name });
    const head = el('div', {
      className: `session-head bus${b.folded ? ' folded' : ''}`,
      title: `${b.name}: a click opens the effects, double click renames, drag to move it`,
    }, el('button', {
      className: 'fold', textContent: b.folded ? '▸' : '▾', title: b.folded ? 'Expand the bus' : 'Collapse the bus: its column narrows',
      onclick: (e: MouseEvent) => { e.stopPropagation(); this.commands.apply(setBusFolded(b.id, !b.folded)); },
    }), name);
    return this.columnHead(b, head, name, rename => busHeadMenu(this.menus, b, rename));
  }

  private head(t: Track): HTMLElement {
    const name = el('span', { className: 'session-track-name', textContent: t.name });
    const head = this.columnHead(t, el('div', { className: 'session-head', title: `${t.name}: a click opens instrument and effects, double click renames, drag to move it` }, name),
      name, rename => trackHeadMenu(this.menus, t, rename));
    if (t instanceof GroupTrack) {
      head.classList.add('group');
      head.prepend(el('button', {
        className: 'fold', textContent: t.folded ? '▸' : '▾', title: t.folded ? 'Open the group' : 'Close the group: hides its tracks\' columns',
        onclick: (e: MouseEvent) => { e.stopPropagation(); toggleFold(this.deps.store, t); },
      }));
    }
    const group = t.group ? this.deps.store.project.track(t.group) : undefined;
    if (group) {
      head.classList.add('in-group');
      head.style.setProperty('--group-color', group.color);
    }
    return head;
  }

  private slotCell(t: Track, s: number, className: string, color?: string): HTMLElement {
    const cell = el('div', { className });
    if (color) cell.style.setProperty('--color', color);
    cell.dataset.track = t.id;
    cell.dataset.slot = String(s);
    return cell;
  }

  /** A slot's cell, registered for the selection and the playback state. */
  private register(t: Track, s: number, cell: HTMLElement): HTMLElement {
    if (this.chosen.has({ track: t.id, slot: s })) cell.classList.add('selected');
    this.slots.set(slotKey(t.id, s), cell);
    return cell;
  }

  private slot(t: Track, s: number, clip: Clip | null): HTMLElement {
    if (t instanceof GroupTrack) return this.groupSlot(t, s);
    const ref = { track: t.id, slot: s };
    const face = slotFace(t, clip, this.deps.recorder.recordingSlot(t.id) === s, isArmed(t, this.deps.ui.keyboardTracks));
    const cell = this.slotCell(t, s, clip ? 'slot filled' : 'slot');
    cell.classList.toggle('recording', face.recording);
    if (clip) cell.style.setProperty('--clip', clip.color);
    if (face.title) cell.title = face.title;
    const button = this.slotButton(face.button, ref);
    if (clip) {
      cell.append(button, el('span', { className: 'clip-name', textContent: clip.name }), el('div', { className: 'progress' }));
    } else {
      cell.append(button);
    }
    return this.register(t, s, cell);
  }

  private slotButton(kind: ReturnType<typeof slotFace>['button'], ref: SlotRef): HTMLButtonElement {
    const { engine } = this.deps;
    if (kind === 'launch') return el('button', { className: 'launch', textContent: '▶', title: 'Launch the clip', onclick: () => engine.launchSlot(ref.track, ref.slot) });
    if (kind === 'stop') return el('button', { className: 'slot-stop', textContent: '■', title: 'Stop the track', onclick: () => engine.stopTrack(ref.track) });
    const on = kind === 'recording';
    return el('button', {
      className: on ? 'record on' : 'record', textContent: '●', title: on ? RECORD_TITLE.on : RECORD_TITLE.off,
      onclick: () => this.commands.record(ref),
    });
  }

  /** A group's slot, as in Live: if at least one of its tracks has a clip in the row, ▶
   *  launches the row of its tracks (those without a clip there stop); otherwise ■ stops them. */
  private groupSlot(t: GroupTrack, s: number): HTMLElement {
    const { engine } = this.deps;
    const clips = this.deps.store.project.soundingTracks(t.id).some(m => m.slots[s]);
    const cell = this.slotCell(t, s, clips ? 'slot group-slot has-clips' : 'slot group-slot', t.color);
    cell.append(clips
      ? el('button', { className: 'launch', textContent: '▶', title: 'Launch the row of the group\'s tracks', onclick: () => engine.launchSlot(t.id, s) })
      : el('button', { className: 'slot-stop', textContent: '■', title: 'Stop the group\'s tracks', onclick: () => engine.stopTrack(t.id) }));
    return this.register(t, s, cell);
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
    const rename = () => renameInline(name, n => this.commands.apply(renameScene(scene.id, n)));
    cell.ondblclick = rename;
    cell.onpointerdown = e => this.dragScene(index, cell, e);
    cell.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, sceneMenu(this.menus, scene, index, rename));
    };
    return cell;
  }

  // ---------------------------------------------------------------- playback state

  /** Playing clips, queued ones and tracks stopping: at every frame (the progress
   *  flows) and right after a launch. */
  private refreshState(): void {
    if (this.element.hidden) return;
    const { engine, store } = this.deps;
    const state = sessionPlayback(store.project, t => engine.sessionState(t));
    for (const [id, track] of state.tracks) {
      track.slots.forEach((slot, s) => {
        const cell = this.slots.get(slotKey(id, s));
        if (!cell) return;
        cell.classList.toggle('playing', slot.playing);
        cell.classList.toggle('queued', slot.queued);
        const bar = cell.querySelector<HTMLElement>('.progress');
        if (bar) bar.style.transform = `scaleX(${slot.progress})`;
      });
      this.stops.get(id)?.classList.toggle('queued', track.stopQueued);
      this.heads.get(id)?.classList.toggle('taken', track.taken);
    }
    // the scenes: they play if one of their clips plays
    this.scenes.forEach((cell, s) => {
      cell.classList.toggle('playing', state.scenes[s].playing);
      cell.classList.toggle('queued', state.scenes[s].queued);
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

  private slotUnder(e: PointerEvent): SlotRef | null {
    return this.slotAt(document.elementFromPoint(e.clientX, e.clientY));
  }

  private bindGrid(): void {
    const g = this.grid;
    g.addEventListener('pointerdown', e => this.pointerDown(e));
    window.addEventListener('pointermove', e => this.dragMove(e));
    window.addEventListener('pointerup', e => this.dragEnd(e));
    g.addEventListener('dblclick', e => this.doubleClick(e));
    g.addEventListener('contextmenu', e => {
      const ref = this.slotAt(e.target);
      if (!ref) return;
      e.preventDefault();
      if (this.chosen.has(ref)) this.chosen.moveCursor(ref);
      else this.chosen.select(ref);
      showContextMenu(e.clientX, e.clientY, slotMenu(this.menus, ref, () => this.renameClip(ref, e.target as HTMLElement)));
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
    const dropItem = this.deps.dropItem;
    if (dropItem) {
      acceptBrowserDrops(g, (item, e) => dropItem(item, this.dropTarget(item, e.target)), {
        // the slot (or the column's head) where it will go, highlighted
        over: e => {
          for (const c of g.querySelectorAll('.drop-target')) c.classList.remove('drop-target');
          const node = (e?.target as HTMLElement | null)?.closest?.('.slot, .session-head');
          node?.classList.add('drop-target');
        },
      });
    }
  }

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
    const ref = this.slotAt(e.target);
    if (!ref) return;
    const at = { from: ref, x: e.clientX, y: e.clientY };
    // with Shift from any slot, even full: a click extends the selection, dragging draws it
    if (e.shiftKey) {
      this.band = { ...at, active: false, extend: true };
      return;
    }
    const multi = e.ctrlKey || e.metaKey;
    const clip = this.deps.store.project.track(ref.track)?.slots[ref.slot];
    // a clip already among the chosen ones stays with the others: they're dragged together
    if (clip && (this.chosen.has(ref) || multi)) this.focus();
    else this.chosen.select(ref);
    if (clip) this.drag = { ...at, toggle: multi, ghost: null };
    else this.band = { ...at, active: false };
  }

  /** Double click on an empty slot: a new MIDI clip, or audio files to import. */
  private doubleClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    const ref = this.slotAt(e.target);
    const track = ref && this.deps.store.project.track(ref.track);
    if (!ref || !track || track.slots[ref.slot] || track instanceof GroupTrack) return;
    if (track.kind === 'midi') this.commands.newMidiClip(ref);
    else this.importAudioTo(ref);
  }

  /** Renames the clip of the slot whose menu was opened on `target`. */
  private renameClip(ref: SlotRef, target: HTMLElement): void {
    const name = target.closest('.slot')?.querySelector<HTMLElement>('.clip-name');
    const clip = this.deps.store.project.track(ref.track)?.slots[ref.slot];
    if (name && clip) renameInline(name, n => this.commands.apply(updateSlotClip('Rename clip', ref.track, clip.id, c => c.withName(n))));
  }

  /** Where a browser item dropped on `target` goes (see browserDropTarget). */
  private dropTarget(item: BrowserItem, target: EventTarget | null): LoadTarget {
    const node = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-track], .master-head');
    return browserDropTarget(this.deps.store.project, item, {
      slot: this.slotAt(target),
      master: !!node?.classList.contains('master-head'),
      track: (node?.dataset.track as TrackId | undefined) ?? null,
    });
  }

  private dragMove(e: PointerEvent): void {
    const b = this.band;
    if (b) {
      if (!b.active && !dragged(b, e)) return;
      b.active = true;
      const over = this.slotUnder(e);
      if (over) this.chosen.pickRange(b.from, over);
      return;
    }
    const d = this.drag;
    if (!d || (!d.ghost && !dragged(d, e))) return;
    d.ghost ??= this.ghost(d);
    d.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
    d.ghost.classList.toggle('copy', e.ctrlKey || e.metaKey);
    for (const c of this.slots.values()) c.classList.remove('drop-target');
    const over = this.slotUnder(e);
    if (over) this.slots.get(slotKey(over.track, over.slot))?.classList.add('drop-target');
  }

  /** What follows the pointer while clips are dragged: the clip's name, or how many they are. */
  private ghost(d: SlotDrag): HTMLElement {
    const source = this.slots.get(slotKey(d.from.track, d.from.slot)), n = this.chosen.carried(d.from).length;
    const ghost = el('div', { className: 'slot filled slot-ghost', textContent: n > 1 ? `${n} clip` : source?.querySelector('.clip-name')?.textContent ?? '' });
    ghost.style.setProperty('--clip', source?.style.getPropertyValue('--clip') ?? '');
    document.body.append(ghost);
    return ghost;
  }

  private dragEnd(e: PointerEvent): void {
    const b = this.band;
    this.band = null;
    if (b?.extend && !b.active) this.chosen.extendTo(b.from);
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    for (const c of this.slots.values()) c.classList.remove('drop-target');
    if (!d.ghost) return this.clickSlot(d);
    d.ghost.remove();
    const to = this.slotUnder(e);
    if (!to || (to.track === d.from.track && to.slot === d.from.slot)) return;
    const tracks = this.deps.store.project.visibleTracks, refs = this.chosen.carried(d.from);
    const { columns, rows } = slotOffset(tracks, d.from, to);
    if (!this.commands.apply(moveSlots(refs, columns, rows, e.ctrlKey || e.metaKey))) return;
    this.chosen.pick(movedRefs(tracks, refs, columns, rows), to);
  }

  /** A click on a clip without dragging: with Ctrl it enters or leaves the selection, otherwise it opens in the editor. */
  private clickSlot(d: SlotDrag): void {
    if (d.toggle) return this.chosen.toggle(d.from);
    this.chosen.select(d.from);
    this.commands.openSlot(d.from);
  }

  // ---------------------------------------------------------------- selection

  /** After every choice: the track of the cursor, the chosen cells, the cursor in view, the keys here. */
  private showPick(cursor: SlotRef): void {
    this.deps.ui.selectTrack(cursor.track);
    for (const c of this.slots.values()) c.classList.toggle('selected', this.chosen.has(this.slotAt(c)!));
    this.slots.get(slotKey(cursor.track, cursor.slot))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.focus();
  }
}
