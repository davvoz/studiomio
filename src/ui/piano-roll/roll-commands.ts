/* The piano roll's commands, without the DOM: delete, select all, duplicate (also the loop), copy, cut,
 * paste, transpose, nudge, quantize, length ×2 and :2, the double click, the right click, Escape. They're
 * what the keys, the menu and the panel do. Each change is an undo step; what can't be done is said. */
import type { Beats } from '../../core/music-time';
import type { MidiClip, Note } from '../../model/midi-clip';
import {
  addNote, deleteNotes, duplicateNotes, duplicateSpan, moveNotes, quantizeNotes, type NoteChange, type Selection, type TimeRange,
} from '../../model/note-edits';
import { copyNotes, pasteNotes, type Clipboard } from '../../store/clipboard';
import { duplicateLoopAt, scaleMidiClipAt, type ClipRef } from '../../store/clip-ref';
import type { Edit } from '../../store/project-store';
import type { DrawMode } from '../draw-mode';
import type { RollHit } from './roll-gestures';
import type { RollMenuActions } from './roll-menu';

/** What the commands use of the piano roll. */
export interface RollEditor {
  /** The open clip (null: none). */
  clip(): MidiClip | null;
  selection(): Selection;
  /** The time selection (the box the notes were chosen with). */
  time(): TimeRange | null;
  /** The insertion point (where Ctrl+V pastes), if chosen. */
  insert(): Beats | null;
  /** The grid's step. */
  grid(): Beats;
  /** Length of the new notes. */
  noteLength(): Beats;
  readonly clipboard: Clipboard;
  readonly drawMode: DrawMode;
  /** Puts the clipboard's devices on the track; false if the app can't. */
  pasteDevices(): boolean;
  commitNotes(label: string, change: NoteChange): void;
  select(notes: Iterable<Note>, time?: TimeRange | null): void;
  setInsertPoint(beat: Beats): void;
  audition(pitch: number, velocity: number): void;
  say(text: string): void;
  /** Applies an edit of the open clip (one undo step); false if there's none or it fails (and it's said). */
  apply(label: string, edit: (ref: ClipRef) => Edit): boolean;
  /** Frames the whole clip again. */
  refit(): void;
  toggleFold(): void;
  close(): void;
}

export class RollCommands implements RollMenuActions {
  constructor(private readonly view: RollEditor) {}

  get selection(): Selection {
    return this.view.selection();
  }

  get drawMode(): boolean {
    return this.view.drawMode.on;
  }

  get canPaste(): boolean {
    return this.view.clipboard.notes !== null;
  }

  /** The beat on the grid (at the start of the cell) under `beat`. */
  cellStart(beat: Beats): Beats {
    const grid = this.view.grid();
    return Math.max(0, Math.floor(beat / grid + 1e-9) * grid);
  }

  deleteSelected(): void {
    const c = this.view.clip();
    if (c && this.selection.size) this.view.commitNotes('Delete notes', deleteNotes(c.notes, this.selection));
  }

  /** All the notes, with the time selection on the loop (without loop, the clip): Ctrl+A and then Ctrl+D
   *  repeats the whole clip. */
  selectAll(): void {
    const c = this.view.clip();
    if (!c) return;
    const { start, end } = c.loop.enabled ? c.loop : c.region;
    this.view.select(c.notes, { start, end });
  }

  /** Copies the chosen notes after the end of the time selection (the box), or after the notes if
   *  there isn't one; the time selection moves onto the copy, so Ctrl+D again continues in a row. */
  duplicate(): void {
    const c = this.view.clip(), time = this.view.time();
    if (!c || !this.selection.size) return;
    const span = duplicateSpan(c.notes, this.selection, this.view.grid(), time);
    this.view.commitNotes('Duplicate notes', duplicateNotes(c.notes, this.selection, this.view.grid(), time));
    if (time) this.view.select(this.selection, { start: time.end, end: time.end + span });
  }

  copy(): void {
    const c = this.view.clip();
    const copied = c && copyNotes(c.notes, this.selection);
    if (!copied) return this.view.say('Select some notes to copy.');
    this.view.clipboard.content = copied;
    const n = copied.notes.length;
    const message = n === 1 ? 'Copied 1 note: Ctrl+V pastes it' : `Copied ${n} notes: Ctrl+V pastes them`;
    this.view.say(`${message} at the insertion point (click in empty space to choose it).`);
  }

  cut(): void {
    const c = this.view.clip();
    const copied = c && copyNotes(c.notes, this.selection);
    if (!c || !copied) return this.view.say('Select some notes to cut.');
    this.view.clipboard.content = copied;
    this.view.commitNotes('Cut notes', deleteNotes(c.notes, this.selection));
  }

  /** Pastes at point `at`, at the insertion point or, if there isn't one, right after the copied notes.
   *  With devices in the clipboard they go on the track. */
  paste(at?: Beats): void {
    const c = this.view.clip(), { clipboard } = this.view, copied = clipboard.notes;
    if (!c) return;
    if (clipboard.devices && this.view.pasteDevices()) return;
    if (!copied) return this.view.say(clipboard.clips ? 'The clipboard holds clips: paste them on the timeline.' : 'The clipboard is empty.');
    const start = at ?? this.view.insert() ?? copied.origin + copied.span;
    this.view.commitNotes('Paste notes', pasteNotes(c.notes, copied, start));
    // the insertion point goes to the end: pasting again continues in a row
    this.view.setInsertPoint(start + copied.span);
  }

  /** Transposes the selected notes (or all, if none is selected). */
  transpose(semitones: number): void {
    const c = this.view.clip();
    if (!c?.notes.length) return;
    const chosen = this.selection.size > 0;
    const change = moveNotes(c.notes, chosen ? this.selection : new Set(c.notes), 0, semitones);
    this.view.commitNotes('Transpose notes', chosen ? change : { ...change, selected: [] });
    if (this.selection.size === 1) this.view.audition([...this.selection][0].pitch, 100);
  }

  /** Moves the selected notes by one grid step. */
  nudge(direction: 1 | -1): void {
    const c = this.view.clip();
    if (c && this.selection.size) this.view.commitNotes('Move notes', moveNotes(c.notes, this.selection, direction * this.view.grid(), 0));
  }

  quantize(): void {
    const c = this.view.clip();
    if (c?.notes.length) this.view.commitNotes('Quantize notes', quantizeNotes(c.notes, this.selection, Math.min(this.view.grid(), 1)));
  }

  /** :2 or ×2: the whole clip (notes, loop, modulations) lasts half or twice as long. */
  scaleTime(factor: number): void {
    const label = factor > 1 ? 'Length ×2' : 'Length :2';
    this.view.apply(label, ref => scaleMidiClipAt(label, ref, factor));
  }

  /** Live's "Dupl. Loop": the loop doubles, with the copy of its notes right after. */
  duplicateLoop(): void {
    // the clip is twice as long: it's framed whole, copy included
    if (this.view.apply('Duplicate loop', duplicateLoopAt)) this.view.refit();
  }

  toggleDraw(): void {
    this.view.drawMode.toggle();
  }

  toggleFold(): void {
    this.view.toggleFold();
  }

  /** Esc: the selection goes; without one, the editor closes. */
  escape(): void {
    if (this.selection.size) this.view.select([]);
    else this.view.close();
  }

  /** Double click: a new note in empty space (at the start of the cell), the note under it goes. Not in draw mode. */
  doubleClick(hit: RollHit): void {
    const c = this.view.clip();
    if (this.drawMode || !c) return;
    if (hit.kind === 'empty') {
      const note = { pitch: hit.pitch, start: this.cellStart(hit.beat), duration: this.view.noteLength(), velocity: 100 };
      this.view.commitNotes('Add note', addNote(c.notes, note));
      this.view.audition(hit.pitch, 100);
    } else if (hit.kind === 'note') {
      this.view.commitNotes('Delete note', deleteNotes(c.notes, new Set([hit.note])));
    }
  }

  /** Right click: an unselected note under it becomes the selection (the menu works on that). */
  pick(hit: RollHit): void {
    const note = hit.kind === 'note' || hit.kind === 'velocity' ? hit.note : null;
    if (note && !this.selection.has(note)) this.view.select([note]);
  }
}
