/* Piano roll gestures. As in the rest of the app: preview while dragging, a single
 * change (one undo step) on release. */
import type { Beats } from '../../core/music-time';
import type { MidiClip, Note } from '../../model/midi-clip';
import {
  addNote, moveNotes, notesInBox, resizeNotes, setVelocity, type NoteChange, type Selection, type TimeRange,
} from '../../model/note-edits';
import {
  frameCursor, frameGestureFor, frameHit, IdleGesture, moved, type ClipGesture, type ClipHost, type FrameHit,
} from '../clip-editor/clip-frame';
import type { Pointer } from '../timeline/gestures';
import { snapTo } from '../timeline/geometry';
import type { PitchAxis } from './pitch-axis';
import { notesBottom, paintSelectionBox, ROLL } from './roll-painter';

/** What the gestures use of the piano roll. */
export interface RollHost extends ClipHost<MidiClip> {
  readonly pitches: PitchAxis;
  readonly selection: Selection;
  /** Height of the view (for the velocity lane). */
  readonly height: number;
  /** Length of the new notes: the last one used. */
  noteLength: Beats;
  /** Draw mode: a click creates a note, a click on a note removes it. */
  readonly drawMode: boolean;
  /** The time selection (the drawn box), or null. */
  readonly timeSelection: TimeRange | null;
  /** Chooses the notes; `time` is the time selection going with them (without, there's none). */
  select(notes: Iterable<Note>, time?: TimeRange | null): void;
  /** The point to paste at (the line of the piano roll's cursor). */
  setInsertPoint(beat: Beats): void;
  /** Applies the new notes and selects the indicated ones (one undo step). */
  commitNotes(label: string, change: NoteChange): void;
  audition(pitch: number, velocity: number): void;
}

/** A piano roll gesture; it can show a provisional selection and draw on top. */
export interface RollGesture extends ClipGesture<MidiClip> {
  previewSelection?(): Selection | null;
  paint?(g: CanvasRenderingContext2D): void;
}

export type RollHit =
  | FrameHit
  | { readonly kind: 'note'; readonly note: Note; readonly zone: 'body' | 'start' | 'end' }
  | { readonly kind: 'empty'; readonly beat: Beats; readonly pitch: number }
  | { readonly kind: 'velocity'; readonly note: Note }
  | { readonly kind: 'lane' };

const EDGE_PX = 6, VELOCITY_PX = 5;

/** What's under the pointer. */
export function rollHit(host: RollHost, clip: MidiClip, x: number, y: number): RollHit {
  const frame = frameHit(host.axis, clip, x, y);
  if (frame) return frame;
  const { axis, pitches } = host;
  if (y >= notesBottom(host.height)) return velocityHit(host, clip, x);
  const pitch = pitches.yToPitch(y), beat = axis.xToBeat(x);
  // the last note drawn is the one on top
  for (let i = clip.notes.length - 1; i >= 0; i--) {
    const n = clip.notes[i];
    if (n.pitch !== pitch) continue;
    const x0 = axis.beatToX(n.start), x1 = axis.beatToX(n.start + n.duration);
    if (x < x0 - 1 || x > x1 + 1) continue;
    const edge = Math.min(EDGE_PX, (x1 - x0) / 3);
    let zone: 'start' | 'end' | 'body' = 'body';
    if (x >= x1 - edge) zone = 'end';
    else if (x <= x0 + edge && x1 - x0 > 12) zone = 'start';
    return { kind: 'note', note: n, zone };
  }
  return { kind: 'empty', beat, pitch };
}

/** In the velocity lane: the nearest bar, preferring the selected notes. */
function velocityHit(host: RollHost, clip: MidiClip, x: number): RollHit {
  let best: Note | null = null, bd = VELOCITY_PX + 1;
  for (const n of clip.notes) {
    const d = Math.abs(host.axis.beatToX(n.start) + 1 - x) - (host.selection.has(n) ? 0.5 : 0);
    if (d < bd) { bd = d; best = n; }
  }
  return best ? { kind: 'velocity', note: best } : { kind: 'lane' };
}

const step = (host: RollHost, p: Pointer) => host.snapStep(p);
/** `b` snapped to the grid (or free with Alt). */
const snap = (host: RollHost, p: Pointer, b: Beats) => {
  const s = step(host, p);
  return s ? snapTo(b, s) : b;
};

/** What `note` (one of the selected) became after `change`. */
function counterpart(clip: MidiClip, sel: Selection, note: Note, change: NoteChange): Note | undefined {
  return change.selected[clip.notes.filter(n => sel.has(n)).indexOf(note)];
}

/** Pressing on a note: with Shift it's added to or removed from the selection, otherwise, if it
 *  wasn't selected, it becomes the only selected one. Returns the selection for the gesture. */
function pressNote(host: RollHost, note: Note, p: Pointer): Selection {
  if (p.shift) {
    const s = new Set(host.selection);
    if (s.has(note)) s.delete(note);
    else s.add(note);
    host.select(s);
  } else if (!host.selection.has(note)) host.select([note]);
  host.audition(note.pitch, note.velocity);
  return host.selection;
}

/** Dragging the notes: horizontally on the grid, vertically by semitones; with Ctrl it copies them. */
export class MoveNotesGesture implements RollGesture {
  readonly cursor = 'grabbing';
  private change: NoteChange | null = null;
  private lastPitch: number;
  private readonly wasSelected: boolean;

  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly note: Note, private readonly origin: Pointer) {
    this.lastPitch = note.pitch;
    this.wasSelected = host.selection.has(note);
    pressNote(host, note, origin);
  }

  move(p: Pointer): void {
    const { host, note, origin } = this;
    if (!this.change && !moved(p, origin)) return;
    if (!host.selection.has(note)) return; // removed with Shift: nothing to drag
    const raw = host.axis.xToBeat(p.x) - host.axis.xToBeat(origin.x);
    // the start of the grabbed note snaps, the others follow it
    const dBeat = snap(host, p, note.start + raw) - note.start;
    const dPitch = host.pitches.yToPitch(p.y) - host.pitches.yToPitch(origin.y);
    this.change = moveNotes(this.clip.notes, host.selection, dBeat, dPitch, origin.ctrl);
    const pitch = counterpart(this.clip, host.selection, note, this.change)?.pitch ?? note.pitch;
    if (pitch !== this.lastPitch) {
      this.lastPitch = pitch;
      host.audition(pitch, note.velocity);
    }
    host.invalidate();
  }

  end(): void {
    if (this.change) return this.host.commitNotes(this.origin.ctrl ? 'Copy notes' : 'Move notes', this.change);
    // a click without dragging on a note of a multiple selection: only it stays selected
    if (this.wasSelected && !this.origin.shift) this.host.select([this.note]);
  }

  cancel(): void {
    this.change = null;
    this.host.invalidate();
  }

  preview(clip: MidiClip): MidiClip {
    return this.change ? clip.withNotes(this.change.notes) : clip;
  }

  previewSelection(): Selection | null {
    return this.change ? new Set(this.change.selected) : null;
  }
}

/** Lengthening or shortening the notes from the right or left edge. */
export class ResizeNotesGesture implements RollGesture {
  readonly cursor = 'ew-resize';
  private change: NoteChange | null = null;

  constructor(
    private readonly host: RollHost, private readonly clip: MidiClip, private readonly note: Note,
    private readonly edge: 'start' | 'end', private readonly origin: Pointer,
  ) {
    if (!host.selection.has(note)) host.select([note]);
  }

  move(p: Pointer): void {
    const { host, note, edge, origin } = this;
    if (!this.change && !moved(p, origin)) return;
    const raw = host.axis.xToBeat(p.x) - host.axis.xToBeat(origin.x);
    const at = edge === 'end' ? note.start + note.duration : note.start;
    this.change = resizeNotes(this.clip.notes, host.selection, edge, snap(host, p, at + raw) - at);
    host.invalidate();
  }

  end(): void {
    if (!this.change) return;
    const resized = counterpart(this.clip, this.host.selection, this.note, this.change);
    if (resized) this.host.noteLength = resized.duration;
    this.host.commitNotes('Note length', this.change);
  }

  cancel(): void {
    this.change = null;
    this.host.invalidate();
  }

  preview(clip: MidiClip): MidiClip {
    return this.change ? clip.withNotes(this.change.notes) : clip;
  }

  previewSelection(): Selection | null {
    return this.change ? new Set(this.change.selected) : null;
  }
}

/** Selection box on empty space (with Shift it's added to the selection). */
export class MarqueeGesture implements RollGesture {
  readonly cursor = 'crosshair';
  private current: Pointer;
  private readonly base: Selection;
  private boxed: Selection | null = null;

  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly origin: Pointer) {
    this.current = origin;
    this.base = origin.shift ? host.selection : new Set();
    if (!origin.shift) host.select([]);
  }

  move(p: Pointer): void {
    this.current = p;
    if (!moved(p, this.origin)) return;
    const { axis, pitches } = this.host;
    const inBox = notesInBox(this.clip.notes, axis.xToBeat(this.origin.x), axis.xToBeat(p.x), pitches.yToPitch(this.origin.y), pitches.yToPitch(p.y));
    this.boxed = new Set([...this.base, ...inBox]);
    this.host.invalidate();
  }

  end(): void {
    // a click without a box fixes the insertion point, on the grid
    if (this.boxed) this.host.select(this.boxed, this.timeRange());
    else this.host.setInsertPoint(Math.max(0, snap(this.host, this.origin, this.host.axis.xToBeat(this.origin.x))));
    this.host.invalidate();
  }

  cancel(): void {
    this.boxed = null;
    this.host.invalidate();
  }

  /** The box's time range, widened to the grid (with Shift joined to the existing one):
   *  Ctrl+D puts the copy at its end. */
  private timeRange(): TimeRange {
    const { axis } = this.host;
    const a = axis.xToBeat(this.origin.x), b = axis.xToBeat(this.current.x);
    const g = this.host.snapStep(this.current);
    let start = Math.max(0, Math.min(a, b)), end = Math.max(a, b);
    if (g) {
      start = Math.floor(start / g + 1e-9) * g;
      end = Math.max(start + g, Math.ceil(end / g - 1e-9) * g);
    }
    const prev = this.origin.shift ? this.host.timeSelection : null;
    return prev ? { start: Math.min(prev.start, start), end: Math.max(prev.end, end) } : { start, end };
  }

  preview(clip: MidiClip): MidiClip {
    return clip;
  }

  previewSelection(): Selection | null {
    return this.boxed;
  }

  paint(g: CanvasRenderingContext2D): void {
    if (this.boxed) paintSelectionBox(g, this.origin.x, this.origin.y, this.current.x, this.current.y);
  }
}

/** Draw mode: pressing creates a note on the grid, dragging right lengthens it. */
export class DrawNoteGesture implements RollGesture {
  readonly cursor = 'crosshair';
  private readonly start: Beats;
  private length: Beats;

  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly pitch: number, origin: Pointer) {
    const s = step(host, origin);
    const b = host.axis.xToBeat(origin.x);
    this.start = Math.max(0, s ? Math.floor(b / s + 1e-9) * s : b);
    this.length = host.noteLength;
    host.audition(pitch, 100);
  }

  move(p: Pointer): void {
    const s = step(this.host, p) ?? 1 / 64;
    const end = Math.max(this.start + s, Math.ceil((this.host.axis.xToBeat(p.x)) / s - 1e-9) * s);
    this.length = Math.max(this.host.noteLength, end - this.start);
    this.host.invalidate();
  }

  end(): void {
    this.host.noteLength = this.length;
    this.host.commitNotes('Add note', this.change());
  }

  cancel(): void {
    this.host.invalidate();
  }

  preview(clip: MidiClip): MidiClip {
    return clip.withNotes(this.change().notes);
  }

  previewSelection(): Selection | null {
    return new Set(this.change().selected);
  }

  private change(): NoteChange {
    return addNote(this.clip.notes, { pitch: this.pitch, start: this.start, duration: this.length, velocity: 100 });
  }
}

/** Dragging a velocity bar vertically (the selected notes follow it). */
export class VelocityGesture implements RollGesture {
  readonly cursor = 'ns-resize';
  private change: NoteChange | null = null;

  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly note: Note, private readonly origin: Pointer) {
    if (!host.selection.has(note) && !origin.shift) host.select([note]);
  }

  move(p: Pointer): void {
    // the whole useful height of the lane = the whole velocity scale
    const velocity = this.note.velocity + ((this.origin.y - p.y) / (ROLL.velocity - 10)) * 127;
    this.change = setVelocity(this.clip.notes, this.host.selection, this.note, velocity);
    this.host.invalidate();
  }

  end(): void {
    if (this.change) this.host.commitNotes('Velocity', this.change);
  }

  cancel(): void {
    this.change = null;
    this.host.invalidate();
  }

  preview(clip: MidiClip): MidiClip {
    return this.change ? clip.withNotes(this.change.notes) : clip;
  }

  previewSelection(): Selection | null {
    return this.change ? new Set(this.change.selected) : null;
  }
}

/** With draw mode: a click on a note removes it. */
class EraseNoteGesture extends IdleGesture<MidiClip> implements RollGesture {
  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly note: Note) {
    super();
  }

  override end(): void {
    this.host.commitNotes('Delete note', { notes: this.clip.notes.filter(n => n !== this.note), selected: [] });
  }
}

/** The gesture starting by pressing on each thing. */
export const rollGestureFor: { readonly [K in RollHit['kind']]: (host: RollHost, clip: MidiClip, hit: Extract<RollHit, { kind: K }>, p: Pointer) => RollGesture } = {
  ...frameGestureFor,
  note: (h, c, hit, p) => {
    if (hit.zone !== 'body') return new ResizeNotesGesture(h, c, hit.note, hit.zone, p);
    return h.drawMode ? new EraseNoteGesture(h, c, hit.note) : new MoveNotesGesture(h, c, hit.note, p);
  },
  empty: (h, c, hit, p) => (h.drawMode ? new DrawNoteGesture(h, c, hit.pitch, p) : new MarqueeGesture(h, c, p)),
  velocity: (h, c, hit, p) => new VelocityGesture(h, c, hit.note, p),
  lane: () => new IdleGesture<MidiClip>(),
};

export const rollCursor: { readonly [K in RollHit['kind']]: (hit: Extract<RollHit, { kind: K }>, drawMode: boolean) => string } = {
  ...frameCursor,
  note: (hit, draw) => {
    if (hit.zone !== 'body') return 'ew-resize';
    return draw ? 'not-allowed' : 'grab';
  },
  empty: (_hit, draw) => (draw ? 'crosshair' : 'default'),
  velocity: () => 'ns-resize',
  lane: () => 'default',
};
