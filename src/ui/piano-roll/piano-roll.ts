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
  /** Suona subito una nota con lo strumento della traccia. */
  readonly audition: (track: TrackId, pitch: number, velocity: number) => void;
  readonly openInstrument: (track: TrackId) => void;
  /** Appunti condivisi con la timeline. */
  readonly clipboard: Clipboard;
  readonly say: (text: string) => void;
}

interface Target {
  readonly track: MidiTrack;
  readonly clip: MidiClip;
  readonly found: FoundClip;
}

/** Altezza delle righe quando le note hanno un nome (i pad): la più alta che fa stare tutti i
 *  pad, tra queste due (sotto la minima i nomi non si leggono). */
const NAMED_ROW = { min: 10, max: 16 } as const;

/** Con il Fold le righe si allargano per riempire la vista, fino a questa altezza. */
const FOLD_ROW_MAX = 20;

/** Comandi da tastiera del piano roll: hanno la precedenza su quelli della timeline. */
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

/** Editor delle note di una clip MIDI: tastiera a sinistra, note sulla griglia, velocity in
 *  basso, righello con loop e bandierine come nell'editor audio. Ogni modifica passa dallo
 *  store (si annulla e si sente subito). */
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
  /** La selezione di tempo: il riquadro con cui si sono scelte le note (Ctrl+D copia dopo la sua fine). */
  private time: TimeRange | null = null;
  private dirty = true;
  private fitPending = false;
  /** I nomi delle note dati dallo strumento (la drum machine), o null. */
  private names: ReadonlyMap<number, string> | null = null;
  noteLength: Beats = 0.25;
  drawMode = false;
  /** Fold (come in Live): solo le righe delle altezze che hanno note. Resta tra una clip e l'altra. */
  folded = false;

  constructor(private readonly deps: PianoRollDeps) {
    this.keyboard = new RollKeyboard(pitch => this.audition(pitch, 100));
    this.panel = new RollPanel({
      rename: name => this.commit('Rinomina clip', c => c.withName(name)),
      toggleDraw: () => this.toggleDraw(),
      toggleFold: () => this.toggleFold(),
      quantize: () => this.quantize(),
      transpose: n => this.transpose(n),
      scaleTime: f => this.scaleTime(f),
      duplicateLoop: () => this.duplicateLoop(),
      openInstrument: () => { const t = this.target(); if (t) deps.openInstrument(t.track.id); },
      takeSound: () => { const t = this.target(); if (t) this.commit('Suono della clip', c => c.withSound(t.track.instrument)); },
      clearSound: () => this.commit('Togli il suono della clip', c => c.withSound(null)),
      close: () => this.close(),
    });
    const roll = this;
    this.mods = new ModulationEditor({
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
    this.keyboard.element.addEventListener('wheel', e => this.wheel(e, 0), { passive: false });
    bindKeys(this.element, this, ROLL_KEYS, true);
    deps.store.onChange(() => this.sync());
    requestAnimationFrame(this.frame);
  }

  get isOpen(): boolean {
    return this.ref !== null;
  }

  /** La clip aperta (sulla timeline o in uno slot), se c'è. */
  get openClip(): ClipRef | null {
    return this.ref;
  }

  /** L'editor delle modulazioni (per i test automatici). */
  get modulation(): ModulationEditor {
    return this.mods;
  }

  /** Apre la clip; restituisce false se non è una clip MIDI. */
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

  // ---------------------------------------------------------------- comandi

  deleteSelected(): void {
    const c = this.clip();
    if (c && this._selection.size) this.commitNotes('Elimina note', deleteNotes(c.notes, this._selection));
  }

  /** Tutte le note, con la selezione di tempo sul loop (senza loop, la clip): Ctrl+A e poi Ctrl+D
   *  ripete la clip intera. */
  selectAll(): void {
    const c = this.clip();
    if (!c) return;
    const { start, end } = c.loop.enabled ? c.loop : c.region;
    this.select(c.notes, { start, end });
  }

  /** Copia le note scelte dopo la fine della selezione di tempo (il riquadro), o dopo le note se
   *  non c'è; la selezione di tempo passa sulla copia, così Ctrl+D di nuovo continua in fila. */
  duplicate(): void {
    const c = this.clip(), time = this.time;
    if (!c || !this._selection.size) return;
    const span = duplicateSpan(c.notes, this._selection, this.grid, time);
    this.commitNotes('Duplica note', duplicateNotes(c.notes, this._selection, this.grid, time));
    if (time) this.select(this._selection, { start: time.end, end: time.end + span });
  }

  copy(): void {
    const c = this.clip();
    const copied = c && copyNotes(c.notes, this._selection);
    if (!copied) return this.deps.say('Seleziona delle note da copiare.');
    this.deps.clipboard.content = copied;
    const n = copied.notes.length;
    this.deps.say(`${n === 1 ? 'Copiata 1 nota: Ctrl+V la incolla' : `Copiate ${n} note: Ctrl+V le incolla`} al punto d'inserimento (clic nel vuoto per sceglierlo).`);
  }

  cut(): void {
    const c = this.clip();
    const copied = c && copyNotes(c.notes, this._selection);
    if (!c || !copied) return this.deps.say('Seleziona delle note da tagliare.');
    this.deps.clipboard.content = copied;
    this.commitNotes('Taglia note', deleteNotes(c.notes, this._selection));
  }

  /** Incolla al punto `at`, al punto d'inserimento o, se non c'è, subito dopo le note copiate. */
  paste(at?: Beats): void {
    const c = this.clip(), copied = this.deps.clipboard.notes;
    if (!c) return;
    if (!copied) return this.deps.say(this.deps.clipboard.clips ? 'Negli appunti ci sono delle clip: incollale sulla timeline.' : 'Gli appunti sono vuoti.');
    const start = at ?? this.insert ?? copied.origin + copied.span;
    this.commitNotes('Incolla note', pasteNotes(c.notes, copied, start));
    // il punto d'inserimento va alla fine: incollando di nuovo si continua in fila
    this.setInsertPoint(start + copied.span);
  }

  get canPaste(): boolean {
    return this.deps.clipboard.notes !== null;
  }

  cellStart(beat: Beats): Beats {
    return Math.max(0, Math.floor(beat / this.grid + 1e-9) * this.grid);
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

  /** :2 o ×2: la clip intera (note, loop, modulazioni) dura la metà o il doppio. */
  scaleTime(factor: number): void {
    const ref = this.ref;
    if (!ref || !this.target()) return;
    const label = factor > 1 ? 'Durata ×2' : 'Durata :2';
    try {
      this.deps.store.apply(scaleMidiClipAt(label, ref, factor));
    } catch (e) {
      this.deps.say(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** "Dupl. Loop" di Live: il loop raddoppia, con la copia delle sue note subito dopo. */
  duplicateLoop(): void {
    const ref = this.ref;
    if (!ref || !this.target()) return;
    try {
      this.deps.store.apply(duplicateLoopAt(ref));
      // la clip è lunga il doppio: la si inquadra tutta, copia compresa
      this.fit();
      this.invalidate();
    } catch (e) {
      this.deps.say(`Duplica loop: ${e instanceof Error ? e.message : e}`);
    }
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

  toggleFold(): void {
    this.folded = !this.folded;
    this.fitPitches();
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
    return this.target()?.clip ?? null;
  }

  private target(): Target | null {
    const found = this.ref && findClip(this.deps.store.project, this.ref);
    if (!found || !(found.clip instanceof MidiClip) || !(found.track instanceof MidiTrack)) return null;
    return { track: found.track, clip: found.clip, found };
  }

  /** Allinea selezione, pannello e disegno al progetto; chiude se la clip non esiste più. */
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

  /** I nomi che lo strumento della traccia dà alle note (i pad della drum machine), o null. */
  private noteNames(): ReadonlyMap<number, string> | null {
    const instrument = this.target()?.track.instrument;
    const type = instrument && instrumentType(instrument.type);
    const names = type && instrument
      ? type.noteNames?.(resolveParams(type, instrument.params), this.deps.store.project.sampleNames(instrument)) : undefined;
    return names?.size ? names : null;
  }

  /** Inquadra la clip e le sue note (con i pad, tutti i pad). */
  private fit(): void {
    const c = this.clip();
    if (!c || this.surface.width < 10) return;
    this._axis = BeatAxis.fit(c.region.start, Math.max(c.region.end, c.loop.enabled ? c.loop.end : 0), this.surface.width);
    this.fitPitches();
    this.fitPending = false;
  }

  /** In verticale: con il Fold tutte le righe, alte quanto possono; senza, le note al centro. */
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

  /** Con il Fold le righe seguono le note: una nota a un'altezza nuova ne aggiunge una, l'ultima
   *  nota tolta da un'altezza la toglie. Senza note si vedono tutte le righe. */
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

  // ---------------------------------------------------------------- disegno e input

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
    // doppio clic: nuova nota sullo spazio vuoto, eliminazione su una nota
    el.addEventListener('dblclick', e => {
      if (this.drawMode) return;
      const h = this.hit(this.pointer(e, el));
      if (h?.hit.kind === 'empty') {
        const b = this.cellStart(h.hit.beat);
        this.commitNotes('Aggiungi nota', addNote(h.clip.notes, { pitch: h.hit.pitch, start: b, duration: this.noteLength, velocity: 100 }));
        this.audition(h.hit.pitch, 100);
      } else if (h?.hit.kind === 'note') {
        const note = h.hit.note;
        this.commitNotes('Elimina nota', deleteNotes(h.clip.notes, new Set([note])));
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
      // tasto destro su una nota non selezionata: diventa la selezione
      if (note && !this._selection.has(note)) this.select([note]);
      showContextMenu(e.clientX, e.clientY, rollMenu(this, h.hit));
    });
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

const sameNames = (a: ReadonlyMap<number, string> | null, b: ReadonlyMap<number, string> | null): boolean =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every(([k, v]) => b.get(k) === v));
