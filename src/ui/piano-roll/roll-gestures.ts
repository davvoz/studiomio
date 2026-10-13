/* Gesti del piano roll. Come nel resto dell'app: anteprima mentre si trascina, una sola
 * modifica (un passo di annullamento) al rilascio. */
import type { Beats } from '../../core/music-time';
import type { MidiClip, Note } from '../../model/midi-clip';
import {
  addNote, moveNotes, notesInBox, resizeNotes, setVelocity, type NoteChange, type Selection,
} from '../../model/note-edits';
import {
  frameCursor, frameGestureFor, frameHit, IdleGesture, moved, type ClipGesture, type ClipHost, type FrameHit,
} from '../clip-editor/clip-frame';
import type { Pointer } from '../timeline/gestures';
import { snapTo } from '../timeline/geometry';
import type { PitchAxis } from './pitch-axis';
import { notesBottom, paintSelectionBox, ROLL } from './roll-painter';

/** Ciò che i gesti usano del piano roll. */
export interface RollHost extends ClipHost<MidiClip> {
  readonly pitches: PitchAxis;
  readonly selection: Selection;
  /** Altezza della vista (per la corsia della velocity). */
  readonly height: number;
  /** Durata delle note nuove: l'ultima usata. */
  noteLength: Beats;
  /** Modo disegno: un clic crea una nota, un clic su una nota la toglie. */
  readonly drawMode: boolean;
  select(notes: Iterable<Note>): void;
  /** Il punto dove incollare (la linea del cursore del piano roll). */
  setInsertPoint(beat: Beats): void;
  /** Applica le note nuove e seleziona quelle indicate (un passo di annullamento). */
  commitNotes(label: string, change: NoteChange): void;
  audition(pitch: number, velocity: number): void;
}

/** Un gesto del piano roll; può mostrare una selezione provvisoria e disegnare sopra. */
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

/** Cosa c'è sotto il puntatore. */
export function rollHit(host: RollHost, clip: MidiClip, x: number, y: number): RollHit {
  const frame = frameHit(host.axis, clip, x, y);
  if (frame) return frame;
  const { axis, pitches } = host;
  if (y >= notesBottom(host.height)) return velocityHit(host, clip, x);
  const pitch = pitches.yToPitch(y), beat = axis.xToBeat(x);
  // l'ultima nota disegnata è quella sopra
  for (let i = clip.notes.length - 1; i >= 0; i--) {
    const n = clip.notes[i];
    if (n.pitch !== pitch) continue;
    const x0 = axis.beatToX(n.start), x1 = axis.beatToX(n.start + n.duration);
    if (x < x0 - 1 || x > x1 + 1) continue;
    const edge = Math.min(EDGE_PX, (x1 - x0) / 3);
    const zone = x >= x1 - edge ? 'end' : x <= x0 + edge && x1 - x0 > 12 ? 'start' : 'body';
    return { kind: 'note', note: n, zone };
  }
  return { kind: 'empty', beat, pitch };
}

/** Nella corsia della velocity: la barra più vicina, preferendo le note selezionate. */
function velocityHit(host: RollHost, clip: MidiClip, x: number): RollHit {
  let best: Note | null = null, bd = VELOCITY_PX + 1;
  for (const n of clip.notes) {
    const d = Math.abs(host.axis.beatToX(n.start) + 1 - x) - (host.selection.has(n) ? 0.5 : 0);
    if (d < bd) { bd = d; best = n; }
  }
  return best ? { kind: 'velocity', note: best } : { kind: 'lane' };
}

const step = (host: RollHost, p: Pointer) => host.snapStep(p);
/** `b` agganciato alla griglia (o libero con Alt). */
const snap = (host: RollHost, p: Pointer, b: Beats) => {
  const s = step(host, p);
  return s ? snapTo(b, s) : b;
};

/** Che cosa è diventata `note` (una delle selezionate) dopo `change`. */
function counterpart(clip: MidiClip, sel: Selection, note: Note, change: NoteChange): Note | undefined {
  return change.selected[clip.notes.filter(n => sel.has(n)).indexOf(note)];
}

/** Premere su una nota: con Maiusc si aggiunge o toglie dalla selezione, altrimenti, se non
 *  era selezionata, diventa l'unica selezionata. Restituisce la selezione per il gesto. */
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

/** Trascinare le note: in orizzontale sulla griglia, in verticale per semitoni; con Ctrl le copia. */
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
    if (!host.selection.has(note)) return; // tolta con Maiusc: niente da trascinare
    const raw = host.axis.xToBeat(p.x) - host.axis.xToBeat(origin.x);
    // si aggancia l'inizio della nota presa, le altre la seguono
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
    if (this.change) return this.host.commitNotes(this.origin.ctrl ? 'Copia note' : 'Sposta note', this.change);
    // un clic senza trascinare su una nota di una selezione multipla: resta selezionata solo lei
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

/** Allungare o accorciare le note dal bordo destro o sinistro. */
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
    this.host.commitNotes('Durata delle note', this.change);
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

/** Riquadro di selezione sullo spazio vuoto (con Maiusc si aggiunge alla selezione). */
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
    // un clic senza riquadro fissa il punto d'inserimento, sulla griglia
    if (this.boxed) this.host.select(this.boxed);
    else this.host.setInsertPoint(Math.max(0, snap(this.host, this.origin, this.host.axis.xToBeat(this.origin.x))));
    this.host.invalidate();
  }

  cancel(): void {
    this.boxed = null;
    this.host.invalidate();
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

/** Modo disegno: premere crea una nota sulla griglia, trascinare a destra la allunga. */
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
    this.host.commitNotes('Aggiungi nota', this.change());
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

/** Trascinare una barra della velocity in verticale (le note selezionate la seguono). */
export class VelocityGesture implements RollGesture {
  readonly cursor = 'ns-resize';
  private change: NoteChange | null = null;

  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly note: Note, private readonly origin: Pointer) {
    if (!host.selection.has(note) && !origin.shift) host.select([note]);
  }

  move(p: Pointer): void {
    // tutta l'altezza utile della corsia = tutta la scala della velocity
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

/** Con il modo disegno: un clic su una nota la toglie. */
class EraseNoteGesture extends IdleGesture<MidiClip> implements RollGesture {
  constructor(private readonly host: RollHost, private readonly clip: MidiClip, private readonly note: Note) {
    super();
  }

  override end(): void {
    this.host.commitNotes('Elimina nota', { notes: this.clip.notes.filter(n => n !== this.note), selected: [] });
  }
}

/** Il gesto che parte premendo su ciascuna cosa. */
export const rollGestureFor: { readonly [K in RollHit['kind']]: (host: RollHost, clip: MidiClip, hit: Extract<RollHit, { kind: K }>, p: Pointer) => RollGesture } = {
  ...frameGestureFor,
  note: (h, c, hit, p) => (h.drawMode && hit.zone === 'body' ? new EraseNoteGesture(h, c, hit.note)
    : hit.zone === 'body' ? new MoveNotesGesture(h, c, hit.note, p) : new ResizeNotesGesture(h, c, hit.note, hit.zone, p)),
  empty: (h, c, hit, p) => (h.drawMode ? new DrawNoteGesture(h, c, hit.pitch, p) : new MarqueeGesture(h, c, p)),
  velocity: (h, c, hit, p) => new VelocityGesture(h, c, hit.note, p),
  lane: () => new IdleGesture<MidiClip>(),
};

export const rollCursor: { readonly [K in RollHit['kind']]: (hit: Extract<RollHit, { kind: K }>, drawMode: boolean) => string } = {
  ...frameCursor,
  note: (hit, draw) => (hit.zone !== 'body' ? 'ew-resize' : draw ? 'not-allowed' : 'grab'),
  empty: (_hit, draw) => (draw ? 'crosshair' : 'default'),
  velocity: () => 'ns-resize',
  lane: () => 'default',
};
