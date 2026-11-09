import type { TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { resolveParams } from '../../devices/device-type';
import { instrumentType } from '../../devices/registry';
import { MidiClip, type Note } from '../../model/midi-clip';
import {
  addNote, deleteNotes, duplicateNotes, duplicateSpan, moveNotes, quantizeNotes, type NoteChange, type Selection, type TimeRange,
} from '../../model/note-edits';
import { MidiTrack } from '../../model/track';
import { copyNotes, pasteNotes, type Clipboard } from '../../store/clipboard';
import { duplicateLoopAt, findClip, scaleMidiClipAt, updateClipAt, type ClipRef, type FoundClip } from '../../store/clip-ref';
import type { ProjectStore } from '../../store/project-store';
import { BeatAxis, playheadIn, seekBeatOf } from '../clip-editor/clip-geometry';
import { addHeightHandle } from '../editor-height';
import { bindKeys, type Binding } from '../keymap';
import { showContextMenu } from '../context-menu';
import { Surface } from '../surface';
import { rollMenu } from './roll-menu';
import type { Pointer } from '../timeline/gestures';
import { gridStep } from '../timeline/geometry';
import { RollKeyboard } from './keyboard';
import { foldRows, PitchAxis, sameRows } from './pitch-axis';
import { rollCursor, rollGestureFor, rollHit, type RollGesture, type RollHit, type RollHost } from './roll-gestures';
import { notesBottom, paintRoll, ROLL } from './roll-painter';
import { RollPanel } from './roll-panel';
import { wheelTime } from '../envelopes/envelope-lane';
import { ModulationEditor } from '../envelopes/modulation-editor';
import { targetDevices, trackChain } from '../envelopes/mod-targets';

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
  readonly say: (text: string) => void;
}

interface Target {
  readonly track: MidiTrack;
  readonly clip: MidiClip;
  readonly found: FoundClip;
}

/** Height of the rows when the notes have a name (the pads): the tallest fitting all the
 *  pads, between these two (below the minimum the names can't be read). */
const NAMED_ROW = { min: 10, max: 16 } as const;

/** With Fold the rows widen to fill the view, up to this height. */
const FOLD_ROW_MAX = 20;

/** The piano roll's keyboard commands: they take priority over the timeline's. */
const ROLL_KEYS: readonly Binding<PianoRoll>[] = [
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
 *  store (it can be undone and is heard right away). */
export class PianoRoll implements RollHost {
  readonly element = Object.assign(document.createElement('section'), { className: 'clip-editor piano-roll', hidden: true, tabIndex: -1 });
  private readonly surface = new Surface('roll-canvas');
  private readonly keyboard: RollKeyboard;
  private readonly panel: RollPanel;
  private readonly mods: ModulationEditor;
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
  private names: ReadonlyMap<number, string> | null = null;
  noteLength: Beats = 0.25;
  drawMode = false;
  /** Fold (as in Live): only the rows of the pitches that have notes. It stays from one clip to the next. */
  folded = false;

  constructor(private readonly deps: PianoRollDeps) {
    this.keyboard = new RollKeyboard(pitch => this.audition(pitch, 100));
    this.panel = new RollPanel({
      rename: name => this.commit('Rename clip', c => c.withName(name)),
      toggleDraw: () => this.toggleDraw(),
      toggleFold: () => this.toggleFold(),
      quantize: () => this.quantize(),
      transpose: n => this.transpose(n),
      scaleTime: f => this.scaleTime(f),
      duplicateLoop: () => this.duplicateLoop(),
      openInstrument: () => { const t = this.target(); if (t) deps.openInstrument(t.track.id); },
      takeSound: () => { const t = this.target(); if (t) this.commit('Clip sound', c => c.withSound(t.track.instrument)); },
      clearSound: () => this.commit('Remove the clip sound', c => c.withSound(null)),
      close: () => this.close(),
    });
    const roll = this;
    this.mods = new ModulationEditor({
      clipboard: deps.clipboard,
      get axis() { return roll._axis; },
      curves: () => roll.clip(),
      span: () => { const c = roll.clip(); return c && { start: c.region.start, end: c.loop.enabled ? c.loop.end : c.region.end }; },
      grid: () => roll.grid,
      signature: () => deps.store.project.signature,
      playhead: () => { const t = roll.target(); return t ? playheadIn(t.found, deps.engine) : null; },
      commit: (label, target, points) => roll.commit(label, c => c.withEnvelope(target, points) as MidiClip),
      wheel: (e, x) => roll.setAxis(wheelTime(e, x, roll._axis)),
      devices: () => { const t = roll.target()?.track ?? null; return t && targetDevices(t); },
      chain: () => { const t = roll.target()?.track ?? null; return t && trackChain(t); },
      layout: visible => roll.element.classList.toggle('with-lane', visible),
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
    bindKeys(this.element, this, ROLL_KEYS, true);
    deps.store.onChange(() => this.sync());
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
    const ref = this.ref;
    if (!ref || !this.target()) return;
    try {
      this.deps.store.apply(updateClipAt<MidiClip>(label, ref, fn));
    } catch (e) {
      this.deps.say(`${label}: ${e instanceof Error ? e.message : e}`);
    }
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

  // ---------------------------------------------------------------- commands

  deleteSelected(): void {
    const c = this.clip();
    if (c && this._selection.size) this.commitNotes('Delete notes', deleteNotes(c.notes, this._selection));
  }

  /** All the notes, with the time selection on the loop (without loop, the clip): Ctrl+A and then Ctrl+D
   *  repeats the whole clip. */
  selectAll(): void {
    const c = this.clip();
    if (!c) return;
    const { start, end } = c.loop.enabled ? c.loop : c.region;
    this.select(c.notes, { start, end });
  }

  /** Copies the chosen notes after the end of the time selection (the box), or after the notes if
   *  there isn't one; the time selection moves onto the copy, so Ctrl+D again continues in a row. */
  duplicate(): void {
    const c = this.clip(), time = this.time;
    if (!c || !this._selection.size) return;
    const span = duplicateSpan(c.notes, this._selection, this.grid, time);
    this.commitNotes('Duplicate notes', duplicateNotes(c.notes, this._selection, this.grid, time));
    if (time) this.select(this._selection, { start: time.end, end: time.end + span });
  }

  copy(): void {
    const c = this.clip();
    const copied = c && copyNotes(c.notes, this._selection);
    if (!copied) return this.deps.say('Select some notes to copy.');
    this.deps.clipboard.content = copied;
    const n = copied.notes.length;
    this.deps.say(`${n === 1 ? 'Copied 1 note: Ctrl+V pastes it' : `Copied ${n} notes: Ctrl+V pastes them`} at the insertion point (click in empty space to choose it).`);
  }

  cut(): void {
    const c = this.clip();
    const copied = c && copyNotes(c.notes, this._selection);
    if (!c || !copied) return this.deps.say('Select some notes to cut.');
    this.deps.clipboard.content = copied;
    this.commitNotes('Cut notes', deleteNotes(c.notes, this._selection));
  }

  /** Pastes at point `at`, at the insertion point or, if there isn't one, right after the copied notes. */
  paste(at?: Beats): void {
    const c = this.clip(), copied = this.deps.clipboard.notes;
    if (!c) return;
    if (this.deps.clipboard.devices && this.deps.pasteDevices) return this.deps.pasteDevices();
    if (!copied) return this.deps.say(this.deps.clipboard.clips ? 'The clipboard holds clips: paste them on the timeline.' : 'The clipboard is empty.');
    const start = at ?? this.insert ?? copied.origin + copied.span;
    this.commitNotes('Paste notes', pasteNotes(c.notes, copied, start));
    // the insertion point goes to the end: pasting again continues in a row
    this.setInsertPoint(start + copied.span);
  }

  get canPaste(): boolean {
    return this.deps.clipboard.notes !== null;
  }

  cellStart(beat: Beats): Beats {
    return Math.max(0, Math.floor(beat / this.grid + 1e-9) * this.grid);
  }

  /** Transposes the selected notes (or all, if none is selected). */
  transpose(semitones: number): void {
    const c = this.clip();
    if (!c?.notes.length) return;
    const sel = this._selection.size ? this._selection : new Set(c.notes);
    const change = moveNotes(c.notes, sel, 0, semitones);
    this.commitNotes('Transpose notes', this._selection.size ? change : { ...change, selected: [] });
    if (this._selection.size === 1) this.audition([...this._selection][0].pitch, 100);
  }

  /** :2 or ×2: the whole clip (notes, loop, modulations) lasts half or twice as long. */
  scaleTime(factor: number): void {
    const ref = this.ref;
    if (!ref || !this.target()) return;
    const label = factor > 1 ? 'Length ×2' : 'Length :2';
    try {
      this.deps.store.apply(scaleMidiClipAt(label, ref, factor));
    } catch (e) {
      this.deps.say(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Live's "Dupl. Loop": the loop doubles, with the copy of its notes right after. */
  duplicateLoop(): void {
    const ref = this.ref;
    if (!ref || !this.target()) return;
    try {
      this.deps.store.apply(duplicateLoopAt(ref));
      // the clip is twice as long: it's framed whole, copy included
      this.fit();
      this.invalidate();
    } catch (e) {
      this.deps.say(`Duplicate loop: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Moves the selected notes by one grid step. */
  nudge(direction: 1 | -1): void {
    const c = this.clip();
    if (c && this._selection.size) this.commitNotes('Move notes', moveNotes(c.notes, this._selection, direction * this.grid, 0));
  }

  quantize(): void {
    const c = this.clip();
    if (c?.notes.length) this.commitNotes('Quantize notes', quantizeNotes(c.notes, this._selection, Math.min(this.grid, 1)));
  }

  toggleDraw(): void {
    this.drawMode = !this.drawMode;
    this.sync();
  }

  toggleFold(): void {
    this.folded = !this.folded;
    this.fitPitches();
    this.sync();
  }

  escape(): void {
    if (this._selection.size) this.select([]);
    else this.close();
  }

  // ---------------------------------------------------------------- state

  private get grid(): Beats {
    return gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 12);
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
    const instrument = t.track.instrument;
    const label = `${instrumentType(instrument.type)?.label ?? instrument.type}${instrument.preset ? ` · ${instrument.preset}` : ''}`;
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
    this.panel.update(t.clip, label, this.drawMode, this.folded, this._selection.size, this.deps.store.project.signature.beatsPerBar);
    this.invalidate();
  }

  /** The names the track's instrument gives the notes (the drum machine's pads), or null. */
  private noteNames(): ReadonlyMap<number, string> | null {
    const instrument = this.target()?.track.instrument;
    const type = instrument && instrumentType(instrument.type);
    const names = type && instrument
      ? type.noteNames?.(resolveParams(type, instrument.params), this.deps.store.project.sampleNames(instrument)) : undefined;
    return names?.size ? names : null;
  }

  /** Frames the clip and its notes (with the pads, all the pads). */
  private fit(): void {
    const c = this.clip();
    if (!c || this.surface.width < 10) return;
    this._axis = BeatAxis.fit(c.region.start, Math.max(c.region.end, c.loop.enabled ? c.loop.end : 0), this.surface.width);
    this.fitPitches();
    this.fitPending = false;
  }

  /** Vertically: with Fold all the rows, as tall as they can be; without, the notes in the centre. */
  private fitPitches(): void {
    const c = this.clip();
    if (!c) return;
    const folded = this.folded ? foldRows(c.notes.map(n => n.pitch)) : null;
    if (folded) {
      const h = Math.max(this.names ? NAMED_ROW.min : 8, Math.min(FOLD_ROW_MAX, Math.floor(this.notesHeight / folded.length)));
      return this.setPitches(new PitchAxis(h, 0, ROLL.ruler, folded).scrolled(0, this.notesHeight));
    }
    const pitches = [...c.notes.map(n => n.pitch), ...(this.names?.keys() ?? [])];
    const [lo, hi] = pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : [60, 72];
    const fitting = Math.floor(this.notesHeight / (hi - lo + 2));
    const rows = new PitchAxis(this.names ? Math.max(NAMED_ROW.min, Math.min(NAMED_ROW.max, fitting)) : 12, 0, ROLL.ruler);
    this.setPitches(rows.centeredOn(lo, hi, this.notesHeight));
  }

  /** With Fold the rows follow the notes: a note at a new pitch adds one, the last
   *  note removed from a pitch removes it. Without notes all the rows are shown. */
  private followFold(clip: MidiClip): void {
    const rows = this.folded ? foldRows(clip.notes.map(n => n.pitch)) : null;
    if (sameRows(rows, this._pitches.rows)) return;
    if ((rows === null) !== (this._pitches.rows === null)) this.fitPitches();
    else this.setPitches(this._pitches.withRows(rows, this.notesHeight));
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

  private pointer(e: MouseEvent, el: HTMLElement): Pointer {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private hit(p: Pointer): { clip: MidiClip; hit: RollHit } | null {
    const clip = this.clip();
    return clip ? { clip, hit: rollHit(this, clip, p.x, p.y) } : null;
  }

  private bind(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = this.pointer(e, el);
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
      const p = this.pointer(e, el);
      if (this.gesture) return this.gesture.move(p);
      const h = this.hit(p);
      el.style.cursor = h ? (rollCursor[h.hit.kind] as (hit: RollHit, draw: boolean) => string)(h.hit, this.drawMode) : 'default';
    });
    el.addEventListener('pointerup', e => {
      const g = this.gesture;
      this.gesture = null;
      g?.end(this.pointer(e, el));
      el.style.cursor = '';
      this.invalidate();
    });
    el.addEventListener('pointercancel', () => { this.gesture?.cancel(); this.gesture = null; });
    // double click: new note on empty space, deletion on a note
    el.addEventListener('dblclick', e => {
      if (this.drawMode) return;
      const h = this.hit(this.pointer(e, el));
      if (h?.hit.kind === 'empty') {
        const b = this.cellStart(h.hit.beat);
        this.commitNotes('Add note', addNote(h.clip.notes, { pitch: h.hit.pitch, start: b, duration: this.noteLength, velocity: 100 }));
        this.audition(h.hit.pitch, 100);
      } else if (h?.hit.kind === 'note') {
        const note = h.hit.note;
        this.commitNotes('Delete note', deleteNotes(h.clip.notes, new Set([note])));
      }
    });
    el.addEventListener('wheel', e => this.wheel(e, this.pointer(e, el).x), { passive: false });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const h = this.hit(this.pointer(e, el));
      if (!h) return;
      this.element.focus();
      const note = h.hit.kind === 'note' || h.hit.kind === 'velocity' ? h.hit.note : null;
      // right click on an unselected note: it becomes the selection
      if (note && !this._selection.has(note)) this.select([note]);
      showContextMenu(e.clientX, e.clientY, rollMenu(this, h.hit));
    });
  }

  /** Wheel: vertically scrolls the notes; Shift horizontally; Ctrl zooms the time, Alt the rows. */
  /** Wheel: scrolls vertically (Shift: horizontally). With Ctrl it zooms: horizontally on the
   *  grid, vertically on the piano keys (`keys`), as on the axes underneath. With
   *  Ctrl+Shift or Alt it zooms vertically also from the grid. */
  private wheel(e: WheelEvent, x: number, keys = false): void {
    e.preventDefault();
    const a = this._axis, pa = this._pitches;
    const y = e.clientY - this.surface.canvas.getBoundingClientRect().top;
    const ctrl = e.ctrlKey || e.metaKey;
    // Shift+wheel: Chromium on Windows already delivers it as deltaX (with deltaY at 0)
    if (e.altKey || (ctrl && (keys || e.shiftKey))) this.setPitches(pa.zoomed(pa.rowHeight * Math.exp(-(e.deltaY || e.deltaX) * 0.002), y, this.notesHeight));
    else if (ctrl) this.setAxis(a.zoomed(a.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x));
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.setAxis(a.scrolled(a.startBeat + (e.deltaX || e.deltaY) / a.pxPerBeat));
    else this.setPitches(pa.scrolled(pa.scrollY + e.deltaY, this.notesHeight));
  }
}

const sameNames = (a: ReadonlyMap<number, string> | null, b: ReadonlyMap<number, string> | null): boolean =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every(([k, v]) => b.get(k) === v));
