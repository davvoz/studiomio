import type { PlacementId, TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { instrumentType } from '../../instruments/registry';
import type { Placement } from '../../model/arrangement';
import { MidiClip, type Note } from '../../model/midi-clip';
import {
  addNote, deleteNotes, duplicateNotes, moveNotes, quantizeNotes, type NoteChange, type Selection,
} from '../../model/note-edits';
import { MidiTrack } from '../../model/track';
import { updateClip } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { BeatAxis, contentBeatAt, timelineBeatOf } from '../clip-editor/clip-geometry';
import { bindKeys, type Binding } from '../keymap';
import { Surface } from '../surface';
import type { Pointer } from '../timeline/gestures';
import { gridStep } from '../timeline/geometry';
import { RollKeyboard } from './keyboard';
import { PitchAxis } from './pitch-axis';
import { rollCursor, rollGestureFor, rollHit, type RollGesture, type RollHit, type RollHost } from './roll-gestures';
import { notesBottom, paintRoll, ROLL } from './roll-painter';
import { RollPanel } from './roll-panel';

export interface PianoRollDeps {
  readonly store: ProjectStore;
  readonly engine: PlaybackEngine;
  /** Suona subito una nota con lo strumento della traccia. */
  readonly audition: (track: TrackId, pitch: number, velocity: number) => void;
  readonly openInstrument: (track: TrackId) => void;
  readonly say: (text: string) => void;
}

interface Target {
  readonly track: MidiTrack;
  readonly placement: Placement<MidiClip>;
}

const KEYS_WIDTH = 52;

/** Comandi da tastiera del piano roll: hanno la precedenza su quelli della timeline. */
const ROLL_KEYS: readonly Binding<PianoRoll>[] = [
  { key: 'delete', run: r => r.deleteSelected() },
  { key: 'backspace', run: r => r.deleteSelected() },
  { key: 'a', ctrl: true, run: r => r.selectAll() },
  { key: 'd', ctrl: true, run: r => r.duplicate() },
  { key: 'arrowup', run: r => r.transpose(1) },
  { key: 'arrowdown', run: r => r.transpose(-1) },
  { key: 'arrowup', shift: true, run: r => r.transpose(12) },
  { key: 'arrowdown', shift: true, run: r => r.transpose(-12) },
  { key: 'arrowleft', run: r => r.nudge(-1) },
  { key: 'arrowright', run: r => r.nudge(1) },
  { key: 'q', run: r => r.quantize() },
  { key: 'b', run: r => r.toggleDraw() },
  { key: 'escape', run: r => r.escape() },
];

/** Editor delle note di una clip MIDI: tastiera a sinistra, note sulla griglia, velocity in
 *  basso, righello con loop e bandierine come nell'editor audio. Ogni modifica passa dallo
 *  store (si annulla e si sente subito). */
export class PianoRoll implements RollHost {
  readonly element = Object.assign(document.createElement('section'), { className: 'clip-editor piano-roll', hidden: true, tabIndex: -1 });
  private readonly surface = new Surface('roll-canvas');
  private readonly keyboard: RollKeyboard;
  private readonly panel: RollPanel;
  private placementId: PlacementId | null = null;
  private _axis = new BeatAxis();
  private _pitches = new PitchAxis(12, 0, ROLL.ruler);
  private _selection = new Set<Note>();
  private gesture: RollGesture | null = null;
  private dirty = true;
  private fitPending = false;
  noteLength: Beats = 0.25;
  drawMode = false;

  constructor(private readonly deps: PianoRollDeps) {
    this.keyboard = new RollKeyboard(pitch => this.audition(pitch, 100));
    this.panel = new RollPanel({
      rename: name => this.commit('Rinomina clip', c => c.withName(name)),
      toggleDraw: () => this.toggleDraw(),
      quantize: () => this.quantize(),
      transpose: n => this.transpose(n),
      openInstrument: () => { const t = this.target(); if (t) deps.openInstrument(t.track.id); },
      close: () => this.close(),
    });
    const wrap = Object.assign(document.createElement('div'), { className: 'editor-canvas-wrap' });
    wrap.append(this.surface.canvas);
    const keys = Object.assign(document.createElement('div'), { className: 'roll-keys-wrap' });
    keys.append(this.keyboard.element);
    this.element.append(this.panel.element, keys, wrap);
    new ResizeObserver(() => {
      this.surface.resize(wrap.clientWidth, wrap.clientHeight);
      this.keyboard.resize(KEYS_WIDTH, wrap.clientHeight);
      if (this.fitPending) this.fit();
      this.setPitches(this._pitches.scrolled(this._pitches.scrollY, this.notesHeight));
    }).observe(wrap);
    this.bind(this.surface.canvas);
    this.keyboard.element.addEventListener('wheel', e => this.wheel(e, 0), { passive: false });
    bindKeys(this.element, this, ROLL_KEYS, true);
    deps.store.onChange(() => this.sync());
    requestAnimationFrame(this.frame);
  }

  get isOpen(): boolean {
    return this.placementId !== null;
  }

  /** La clip posata aperta, se c'è. */
  get openPlacement(): PlacementId | null {
    return this.placementId;
  }

  /** Apre la clip posata `id`; restituisce false se non è una clip MIDI. */
  open(id: PlacementId): boolean {
    this.placementId = id;
    if (!this.target()) {
      this.placementId = null;
      return false;
    }
    this._selection = new Set();
    this.element.hidden = false;
    this.fitPending = true;
    this.fit();
    this.sync();
    this.element.focus();
    return true;
  }

  close(): void {
    this.placementId = null;
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
    const t = this.target();
    if (!t) return;
    try {
      this.deps.store.apply(updateClip<MidiClip>(label, t.track.id, t.placement.id, fn));
    } catch (e) {
      this.deps.say(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  commitNotes(label: string, change: NoteChange): void {
    this.commit(label, c => c.withNotes(change.notes));
    this.select(change.selected);
  }

  select(notes: Iterable<Note>): void {
    this._selection = new Set(notes);
    this.sync();
  }

  audition(pitch: number, velocity: number): void {
    const t = this.target();
    if (t) this.deps.audition(t.track.id, pitch, velocity);
  }

  seekContent(content: Beats): void {
    const t = this.target();
    const beat = t && timelineBeatOf(t.placement, content);
    if (beat !== null && beat !== undefined) this.deps.engine.seek(beat);
  }

  setAxis(axis: BeatAxis): void {
    this._axis = axis;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  // ---------------------------------------------------------------- comandi

  deleteSelected(): void {
    const c = this.clip();
    if (c && this._selection.size) this.commitNotes('Elimina note', deleteNotes(c.notes, this._selection));
  }

  selectAll(): void {
    const c = this.clip();
    if (c) this.select(c.notes);
  }

  duplicate(): void {
    const c = this.clip();
    if (c && this._selection.size) this.commitNotes('Duplica note', duplicateNotes(c.notes, this._selection, this.grid));
  }

  /** Traspone le note selezionate (o tutte, se nessuna è selezionata). */
  transpose(semitones: number): void {
    const c = this.clip();
    if (!c?.notes.length) return;
    const sel = this._selection.size ? this._selection : new Set(c.notes);
    const change = moveNotes(c.notes, sel, 0, semitones);
    this.commitNotes('Trasponi note', this._selection.size ? change : { ...change, selected: [] });
    if (this._selection.size === 1) this.audition([...this._selection][0].pitch, 100);
  }

  /** Sposta le note selezionate di un passo di griglia. */
  nudge(direction: 1 | -1): void {
    const c = this.clip();
    if (c && this._selection.size) this.commitNotes('Sposta note', moveNotes(c.notes, this._selection, direction * this.grid, 0));
  }

  quantize(): void {
    const c = this.clip();
    if (c?.notes.length) this.commitNotes('Quantizza note', quantizeNotes(c.notes, this._selection, Math.min(this.grid, 1)));
  }

  toggleDraw(): void {
    this.drawMode = !this.drawMode;
    this.sync();
  }

  escape(): void {
    if (this._selection.size) this.select([]);
    else this.close();
  }

  // ---------------------------------------------------------------- stato

  private get grid(): Beats {
    return gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 12);
  }

  private get notesHeight(): number {
    return Math.max(1, notesBottom(this.surface.height) - ROLL.ruler);
  }

  private clip(): MidiClip | null {
    return this.target()?.placement.clip ?? null;
  }

  private target(): Target | null {
    if (!this.placementId) return null;
    for (const t of this.deps.store.project.tracks) {
      const pl = t.placement(this.placementId);
      if (pl && pl.clip instanceof MidiClip && t instanceof MidiTrack) return { track: t, placement: pl as Placement<MidiClip> };
    }
    return null;
  }

  /** Allinea selezione, pannello e disegno al progetto; chiude se la clip non esiste più. */
  private sync(): void {
    if (!this.isOpen) return;
    const t = this.target();
    if (!t) return this.close();
    const notes = new Set(t.placement.clip.notes);
    if ([...this._selection].some(n => !notes.has(n))) this._selection = new Set([...this._selection].filter(n => notes.has(n)));
    const instrument = t.track.instrument;
    const label = `${instrumentType(instrument.type)?.label ?? instrument.type}${instrument.preset ? ` · ${instrument.preset}` : ''}`;
    this.panel.update(t.placement.clip, label, this.drawMode, this._selection.size, this.deps.store.project.signature.beatsPerBar);
    this.invalidate();
  }

  /** Inquadra la clip e le sue note. */
  private fit(): void {
    const c = this.clip();
    if (!c || this.surface.width < 10) return;
    this._axis = BeatAxis.fit(c.region.start, Math.max(c.region.end, c.loop.enabled ? c.loop.end : 0), this.surface.width);
    const pitches = c.notes.map(n => n.pitch);
    const [lo, hi] = pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : [60, 72];
    this.setPitches(this._pitches.centeredOn(lo, hi, this.notesHeight));
    this.fitPending = false;
  }

  private setPitches(p: PitchAxis): void {
    this._pitches = p;
    this.keyboard.setAxis(p);
    this.invalidate();
  }

  // ---------------------------------------------------------------- disegno e input

  private readonly frame = () => {
    const engine = this.deps.engine;
    if (this.isOpen && (this.dirty || engine.playing)) {
      this.dirty = false;
      const t = this.target();
      if (t) {
        const clip = this.gesture ? this.gesture.preview(t.placement.clip) : t.placement.clip;
        const { g, width, height } = this.surface;
        paintRoll({
          g, width, height, axis: this._axis, pitches: this._pitches, clip,
          selection: this.gesture?.previewSelection?.() ?? this._selection,
          signature: this.deps.store.project.signature, grid: this.grid,
          playhead: engine.playing ? contentBeatAt(t.placement, engine.position) : null,
        });
        this.gesture?.paint?.(g);
      }
    }
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
    // doppio clic: nuova nota sullo spazio vuoto, eliminazione su una nota
    el.addEventListener('dblclick', e => {
      if (this.drawMode) return;
      const h = this.hit(this.pointer(e, el));
      if (h?.hit.kind === 'empty') {
        const b = Math.max(0, Math.floor(h.hit.beat / this.grid + 1e-9) * this.grid);
        this.commitNotes('Aggiungi nota', addNote(h.clip.notes, { pitch: h.hit.pitch, start: b, duration: this.noteLength, velocity: 100 }));
        this.audition(h.hit.pitch, 100);
      } else if (h?.hit.kind === 'note') {
        const note = h.hit.note;
        this.commitNotes('Elimina nota', deleteNotes(h.clip.notes, new Set([note])));
      }
    });
    el.addEventListener('wheel', e => this.wheel(e, this.pointer(e, el).x), { passive: false });
  }

  /** Rotella: in verticale scorre le note; Maiusc in orizzontale; Ctrl zooma il tempo, Alt le righe. */
  private wheel(e: WheelEvent, x: number): void {
    e.preventDefault();
    const a = this._axis, pa = this._pitches;
    const y = e.clientY - this.surface.canvas.getBoundingClientRect().top;
    if (e.ctrlKey || e.metaKey) this.setAxis(a.zoomed(a.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x));
    else if (e.altKey) this.setPitches(pa.zoomed(pa.rowHeight * Math.exp(-(e.deltaY || e.deltaX) * 0.002), y, this.notesHeight));
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.setAxis(a.scrolled(a.startBeat + (e.deltaX || e.deltaY) / a.pxPerBeat));
    else this.setPitches(pa.scrolled(pa.scrollY + e.deltaY, this.notesHeight));
  }
}
