import type { TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { MidiClip, type Note } from '../../model/midi-clip';
import type { NoteChange, Selection, TimeRange } from '../../model/note-edits';
import { MidiTrack } from '../../model/track';
import type { Clipboard } from '../../store/clipboard';
import { findClip, updateClipAt, type ClipRef, type FoundClip } from '../../store/clip-ref';
import type { Edit, ProjectStore } from '../../store/project-store';
import { BeatAxis, playheadIn, seekBeatOf } from '../clip-editor/clip-geometry';
import { showContextMenu } from '../context-menu';
import type { DrawMode } from '../draw-mode';
import { addHeightHandle } from '../editor-height';
import { targetDevices, trackChain } from '../envelopes/mod-targets';
import { ModulationEditor } from '../envelopes/modulation-editor';
import { bindKeys, type Binding } from '../keymap';
import { Surface } from '../kit/canvas';
import { pointerIn, type Pointer } from '../kit/pointer';
import { takeWheel, wheelBeats } from '../kit/wheel';
import type { UiState } from '../ui-state';
import { RollKeyboard } from './keyboard';
import { PitchAxis } from './pitch-axis';
import { RollCommands } from './roll-commands';
import { rollCursor, rollGestureFor, rollHit, type RollGesture, type RollHit, type RollHost } from './roll-gestures';
import { rollMenu } from './roll-menu';
import { notesBottom, paintRoll, ROLL } from './roll-painter';
import { RollPanel } from './roll-panel';
import { fitRows, followRows, instrumentLabel, noteNames, sameNames, type NoteNames } from './roll-rows';
import { rollWheel } from './roll-wheel';

export interface PianoRollDeps {
  readonly store: ProjectStore;
  readonly engine: PlaybackEngine;
  /** Plays a note right away with the track's instrument. */
  readonly audition: (track: TrackId, pitch: number, velocity: number) => void;
  readonly openInstrument: (track: TrackId) => void;
  /** The clipboard holds devices: Ctrl+V puts them on the track. */
  readonly pasteDevices?: () => void;
  /** Clipboard shared with the timeline. */
  readonly clipboard: Clipboard;
  /** The app's draw mode (B): notes here, steps in the modulation lanes. */
  readonly drawMode: DrawMode;
  /** For the grid chosen by the user. */
  readonly ui: UiState;
  readonly say: (text: string) => void;
}

interface Target {
  readonly track: MidiTrack;
  readonly clip: MidiClip;
  readonly found: FoundClip;
}

/** The piano roll's keyboard commands: they take priority over the timeline's. */
const ROLL_KEYS: readonly Binding<RollCommands>[] = [
  { key: 'delete', run: r => r.deleteSelected() },
  { key: 'backspace', run: r => r.deleteSelected() },
  { key: 'a', ctrl: true, run: r => r.selectAll() },
  { key: 'd', ctrl: true, run: r => r.duplicate() },
  { key: 'd', ctrl: true, shift: true, run: r => r.duplicateLoop() },
  { key: 'x', ctrl: true, run: r => r.cut() },
  { key: 'c', ctrl: true, run: r => r.copy() },
  { key: 'v', ctrl: true, run: r => r.paste() },
  { key: 'arrowup', run: r => r.transpose(1) },
  { key: 'arrowdown', run: r => r.transpose(-1) },
  { key: 'arrowup', shift: true, run: r => r.transpose(12) },
  { key: 'arrowdown', shift: true, run: r => r.transpose(-12) },
  { key: 'arrowleft', run: r => r.nudge(-1) },
  { key: 'arrowright', run: r => r.nudge(1) },
  { key: 'q', run: r => r.quantize() },
  { key: 'b', run: r => r.toggleDraw() },
  { key: 'f', run: r => r.toggleFold() },
  { key: 'escape', run: r => r.escape() },
];

/** Note editor of a MIDI clip: keyboard on the left, notes on the grid, velocity at the
 *  bottom, ruler with loop and flags as in the audio editor. Every change goes through the
 *  store (it can be undone and is heard right away). This is the DOM: the commands are in
 *  `RollCommands`, the rows in roll-rows, the wheel in roll-wheel, the gestures in roll-gestures. */
export class PianoRoll implements RollHost {
  readonly element = Object.assign(document.createElement('section'), { className: 'clip-editor piano-roll', hidden: true, tabIndex: -1 });
  private readonly surface = new Surface('roll-canvas');
  private readonly keyboard: RollKeyboard;
  private readonly panel: RollPanel;
  private readonly mods: ModulationEditor;
  private readonly commands: RollCommands;
  private ref: ClipRef | null = null;
  private _axis = new BeatAxis();
  private _pitches = new PitchAxis(12, 0, ROLL.ruler);
  private _selection = new Set<Note>();
  private gesture: RollGesture | null = null;
  private insert: Beats | null = null;
  /** The time selection: the box the notes were chosen with (Ctrl+D copies after its end). */
  private time: TimeRange | null = null;
  private dirty = true;
  private fitPending = false;
  /** The notes' names given by the instrument (the drum machine), or null. */
  private names: NoteNames | null = null;
  noteLength: Beats = 0.25;
  /** Fold (as in Live): only the rows of the pitches that have notes. It stays from one clip to the next. */
  folded = false;

  constructor(private readonly deps: PianoRollDeps) {
    this.keyboard = new RollKeyboard(pitch => this.audition(pitch, 100));
    const commands = this.commands = new RollCommands({
      clip: () => this.clip(),
      selection: () => this._selection,
      time: () => this.time,
      insert: () => this.insert,
      grid: () => this.grid,
      noteLength: () => this.noteLength,
      clipboard: deps.clipboard,
      drawMode: deps.drawMode,
      pasteDevices: () => {
        if (!deps.pasteDevices) return false;
        deps.pasteDevices();
        return true;
      },
      commitNotes: (label, change) => this.commitNotes(label, change),
      select: (notes, time) => this.select(notes, time),
      setInsertPoint: beat => this.setInsertPoint(beat),
      audition: (pitch, velocity) => this.audition(pitch, velocity),
      say: text => deps.say(text),
      apply: (label, edit) => this.apply(label, edit),
      refit: () => {
        this.fit();
        this.invalidate();
      },
      toggleFold: () => this.toggleFold(),
      close: () => this.close(),
    });
    this.panel = new RollPanel({
      rename: name => this.commit('Rename clip', c => c.withName(name)),
      toggleDraw: () => commands.toggleDraw(),
      toggleFold: () => commands.toggleFold(),
      quantize: () => commands.quantize(),
      transpose: n => commands.transpose(n),
      scaleTime: f => commands.scaleTime(f),
      duplicateLoop: () => commands.duplicateLoop(),
      openInstrument: () => { const t = this.target(); if (t) deps.openInstrument(t.track.id); },
      takeSound: () => { const t = this.target(); if (t) this.commit('Clip sound', c => c.withSound(t.track.instrument)); },
      clearSound: () => this.commit('Remove the clip sound', c => c.withSound(null)),
      close: () => this.close(),
    });
    // the lane's axis is a property: read it through a function (no alias of this)
    const axis = () => this._axis;
    this.mods = new ModulationEditor({
      clipboard: deps.clipboard,
      get axis() { return axis(); },
      curves: () => this.clip(),
      span: () => { const c = this.clip(); return c && { start: c.region.start, end: c.loop.enabled ? c.loop.end : c.region.end }; },
      grid: () => this.grid,
      signature: () => deps.store.project.signature,
      playhead: () => { const t = this.target(); return t ? playheadIn(t.found, deps.engine) : null; },
      drawMode: deps.drawMode,
      commit: (label, target, points) => this.commit(label, c => c.withEnvelope(target, points) as MidiClip),
      wheel: (e, x) => this.setAxis(wheelBeats(this._axis, takeWheel(e), x)),
      devices: () => { const t = this.target()?.track ?? null; return t && targetDevices(t); },
      chain: () => { const t = this.target()?.track ?? null; return t && trackChain(t); },
      layout: visible => this.element.classList.toggle('with-lane', visible),
    });
    this.panel.element.append(this.mods.controls);
    const wrap = Object.assign(document.createElement('div'), { className: 'editor-canvas-wrap' });
    wrap.append(this.surface.canvas);
    const keys = Object.assign(document.createElement('div'), { className: 'roll-keys-wrap' });
    keys.append(this.keyboard.element);
    this.element.append(this.panel.element, keys, wrap, this.mods.side, this.mods.lane.element);
    addHeightHandle(this.element);
    new ResizeObserver(() => {
      this.surface.resize(wrap.clientWidth, wrap.clientHeight);
      this.keyboard.resize(keys.clientWidth, wrap.clientHeight);
      if (this.fitPending) this.fit();
      else if (this.folded) this.fitPitches();
      else this.setPitches(this._pitches.scrolled(this._pitches.scrollY, this.notesHeight));
    }).observe(wrap);
    this.bind(this.surface.canvas);
    this.keyboard.element.addEventListener('wheel', e => this.wheel(e, 0, true), { passive: false });
    this.keyboard.element.title = 'Ctrl+wheel: vertical zoom';
    bindKeys(this.element, commands, ROLL_KEYS, true);
    deps.store.onChange(() => this.sync());
    deps.drawMode.onChange(() => this.sync());
    deps.ui.onGridChange(() => this.invalidate());
    requestAnimationFrame(this.frame);
  }

  get isOpen(): boolean {
    return this.ref !== null;
  }

  /** The open clip (on the timeline or in a slot), if any. */
  get openClip(): ClipRef | null {
    return this.ref;
  }

  /** The modulation editor (for automated tests). */
  get modulation(): ModulationEditor {
    return this.mods;
  }

  /** Opens the clip; returns false if it isn't a MIDI clip. */
  open(ref: ClipRef): boolean {
    this.ref = ref;
    if (!this.target()) {
      this.ref = null;
      return false;
    }
    this._selection = new Set();
    this.insert = null;
    this.time = null;
    this.element.hidden = false;
    this.names = this.noteNames();
    this.fitPending = true;
    this.fit();
    this.sync();
    this.mods.opened();
    this.element.focus();
    return true;
  }

  close(): void {
    this.ref = null;
    this.gesture = null;
    this.element.hidden = true;
  }

  // ---------------------------------------------------------------- RollHost

  get axis(): BeatAxis {
    return this._axis;
  }

  get pitches(): PitchAxis {
    return this._pitches;
  }

  get selection(): Selection {
    return this._selection;
  }

  get height(): number {
    return this.surface.height;
  }

  snapStep(p: Pointer): Beats | null {
    return p.alt ? null : this.grid;
  }

  commit(label: string, fn: (c: MidiClip) => MidiClip): void {
    this.apply(label, ref => updateClipAt<MidiClip>(label, ref, fn));
  }

  commitNotes(label: string, change: NoteChange): void {
    this.commit(label, c => c.withNotes(change.notes));
    this.select(change.selected);
  }

  get timeSelection(): TimeRange | null {
    return this.time;
  }

  select(notes: Iterable<Note>, time: TimeRange | null = null): void {
    this._selection = new Set(notes);
    this.time = time;
    this.sync();
  }

  setInsertPoint(beat: Beats): void {
    this.insert = beat;
    this.invalidate();
  }

  audition(pitch: number, velocity: number): void {
    const t = this.target();
    if (t) this.deps.audition(t.track.id, pitch, velocity);
  }

  seekContent(content: Beats): void {
    const t = this.target();
    const beat = t && seekBeatOf(t.found, content);
    if (beat !== null && beat !== undefined) this.deps.engine.seek(beat);
  }

  setAxis(axis: BeatAxis): void {
    this._axis = axis;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  get drawMode(): boolean {
    return this.deps.drawMode.on;
  }

  // ---------------------------------------------------------------- state

  /** Applies an edit of the open clip (one undo step); false if there's none or it fails (and it's said). */
  private apply(label: string, edit: (ref: ClipRef) => Edit): boolean {
    const ref = this.ref;
    if (!ref || !this.target()) return false;
    try {
      this.deps.store.apply(edit(ref));
      return true;
    } catch (e) {
      this.deps.say(`${label}: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  private toggleFold(): void {
    this.folded = !this.folded;
    this.fitPitches();
    this.sync();
  }

  private get grid(): Beats {
    return this.deps.ui.gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 12);
  }

  private get notesHeight(): number {
    return Math.max(1, notesBottom(this.surface.height) - ROLL.ruler);
  }

  private clip(): MidiClip | null {
    return this.target()?.clip ?? null;
  }

  private target(): Target | null {
    const found = this.ref && findClip(this.deps.store.project, this.ref);
    if (!found || !(found.clip instanceof MidiClip) || !(found.track instanceof MidiTrack)) return null;
    return { track: found.track, clip: found.clip, found };
  }

  /** Aligns selection, panel and drawing with the project; closes if the clip no longer exists. */
  private sync(): void {
    if (!this.isOpen) return;
    const t = this.target();
    if (!t) return this.close();
    const notes = new Set(t.clip.notes);
    if ([...this._selection].some(n => !notes.has(n))) this._selection = new Set([...this._selection].filter(n => notes.has(n)));
    const names = this.noteNames();
    if (!sameNames(names, this.names)) {
      const hadNames = this.names !== null;
      this.names = names;
      if (hadNames !== (names !== null)) this.fit();
    }
    this.followFold(t.clip);
    this.keyboard.setNames(this.names);
    this.element.classList.toggle('named-keys', this.names !== null);
    this.mods.sync();
    this.panel.update(t.clip, instrumentLabel(t.track.instrument), this.drawMode, this.folded, this._selection.size, this.deps.store.project.signature.beatsPerBar);
    this.invalidate();
  }

  private noteNames(): NoteNames | null {
    const t = this.target();
    return t ? noteNames(t.track, this.deps.store.project) : null;
  }

  /** Frames the clip and its notes (with the pads, all the pads). */
  private fit(): void {
    const c = this.clip();
    if (!c || this.surface.width < 10) return;
    this._axis = BeatAxis.fit(c.region.start, Math.max(c.region.end, c.loop.enabled ? c.loop.end : 0), this.surface.width);
    this.fitPitches();
    this.fitPending = false;
  }

  private fitPitches(): void {
    const c = this.clip();
    if (c) this.setPitches(fitRows(c.notes.map(n => n.pitch), this.names, this.folded, this.notesHeight));
  }

  /** With Fold the rows follow the notes. */
  private followFold(clip: MidiClip): void {
    const rows = followRows(this._pitches, clip.notes.map(n => n.pitch), this.folded, this.notesHeight);
    if (rows === 'refit') this.fitPitches();
    else if (rows) this.setPitches(rows);
  }

  private setPitches(p: PitchAxis): void {
    this._pitches = p;
    this.keyboard.setAxis(p);
    this.invalidate();
  }

  // ---------------------------------------------------------------- drawing and input

  private readonly frame = () => {
    const engine = this.deps.engine;
    if (this.isOpen && (this.dirty || engine.playing)) {
      this.dirty = false;
      const t = this.target();
      if (t) {
        const clip = this.gesture ? this.gesture.preview(t.clip) : t.clip;
        const { g, width, height } = this.surface;
        paintRoll({
          g, width, height, axis: this._axis, pitches: this._pitches, clip,
          selection: this.gesture?.previewSelection?.() ?? this._selection,
          signature: this.deps.store.project.signature, grid: this.grid,
          playhead: playheadIn(t.found, engine), insert: this.insert, time: this.gesture ? null : this.time, named: this.names,
        });
        this.gesture?.paint?.(g);
      }
    }
    if (this.isOpen) this.mods.frame();
    requestAnimationFrame(this.frame);
  };

  private hit(p: Pointer): { clip: MidiClip; hit: RollHit } | null {
    const clip = this.clip();
    return clip ? { clip, hit: rollHit(this, clip, p.x, p.y) } : null;
  }

  private bind(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = pointerIn(e, el);
      const h = this.hit(p);
      if (!h) return;
      e.preventDefault();
      this.element.focus();
      el.setPointerCapture(e.pointerId);
      const make = rollGestureFor[h.hit.kind] as (host: RollHost, c: MidiClip, hit: RollHit, p: Pointer) => RollGesture;
      this.gesture = make(this, h.clip, h.hit, p);
      el.style.cursor = this.gesture.cursor;
      this.invalidate();
    });
    el.addEventListener('pointermove', e => {
      const p = pointerIn(e, el);
      if (this.gesture) return this.gesture.move(p);
      const h = this.hit(p);
      el.style.cursor = h ? (rollCursor[h.hit.kind] as (hit: RollHit, draw: boolean) => string)(h.hit, this.drawMode) : 'default';
    });
    el.addEventListener('pointerup', e => {
      const g = this.gesture;
      this.gesture = null;
      g?.end(pointerIn(e, el));
      el.style.cursor = '';
      this.invalidate();
    });
    el.addEventListener('pointercancel', () => { this.gesture?.cancel(); this.gesture = null; });
    // double click: new note on empty space, deletion on a note
    el.addEventListener('dblclick', e => {
      const h = this.hit(pointerIn(e, el));
      if (h) this.commands.doubleClick(h.hit);
    });
    el.addEventListener('wheel', e => this.wheel(e, pointerIn(e, el).x), { passive: false });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const h = this.hit(pointerIn(e, el));
      if (!h) return;
      this.element.focus();
      // right click on an unselected note: it becomes the selection
      this.commands.pick(h.hit);
      showContextMenu(e.clientX, e.clientY, rollMenu(this.commands, h.hit));
    });
  }

  /** Wheel: scrolls the rows (Shift: the time); with Ctrl it zooms, on the piano keys (`keys`) the rows. */
  private wheel(e: WheelEvent, x: number, keys = false): void {
    const w = takeWheel(e);
    const y = e.clientY - this.surface.canvas.getBoundingClientRect().top;
    const move = rollWheel(w, { axis: this._axis, pitches: this._pitches, x, y, notesHeight: this.notesHeight, keys });
    if ('axis' in move) this.setAxis(move.axis);
    else this.setPitches(move.pitches);
  }
}
