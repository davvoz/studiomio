/* What the session's commands do on the chosen slots: launch, delete, duplicate, copy, cut, paste,
 * capture a scene, record, open a clip. Only the decisions: the changes are the store's edits, the
 * view only calls these (from keys, menus and mouse). */
import type { Unsubscribe } from '../../core/emitter';
import type { TrackId } from '../../core/id';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { slotRef, type ClipRef } from '../../store/clip-ref';
import { copySlotClips, pasteSlots, pasteToSlot, type Clipboard } from '../../store/clipboard';
import type { Edit, ProjectStore } from '../../store/project-store';
import { captureScene, clearSlots, duplicateSlots, newSlotMidiClip, type SlotRef } from '../../store/session-edits';
import type { Binding } from '../keymap';
import type { UiState } from '../ui-state';
import { belowBlock, type SlotSelection } from './slot-selection';

/** Recording into the slots (see app/session-recorder). */
export interface SlotRecorder {
  /** The slot the track is recording into, null if none. */
  recordingSlot(track: TrackId): number | null;
  /** Starts recording into the slot, or ends the track's take. */
  toggle(ref: SlotRef): void;
  onChange(fn: () => void): Unsubscribe;
}

export interface SessionCommandDeps {
  readonly store: ProjectStore;
  readonly engine: Pick<PlaybackEngine, 'launchSlot' | 'playingClips'>;
  readonly clipboard: Clipboard;
  readonly recorder: SlotRecorder;
  readonly ui: Pick<UiState, 'keyboardTracks' | 'toggleKeyboardTrack'>;
  openClip(ref: ClipRef): void;
  /** Puts the clipboard's devices on the chosen track. */
  pasteDevices(): void;
  say(text: string): void;
}

/** What only the view can do: give the keyboard back to the session. */
export interface SessionViewHooks {
  focus(): void;
}

/** The message of a change that didn't apply, for the status bar. */
export function editFailure(err: unknown): string {
  if (err instanceof TypeError) return 'Clips go on tracks of the same kind: audio with audio, MIDI with MIDI.';
  return err instanceof Error ? err.message : String(err);
}

/** "Clip copied" or "N clips copied", with what Ctrl+V does next. */
export function copiedMessage(n: number): string {
  const message = n > 1 ? `${n} clips copied` : 'Clip copied';
  return `${message}: Ctrl+V pastes ${n > 1 ? 'them' : 'it'} from a slot on, or in the timeline at the cursor.`;
}

export class SessionCommands {
  constructor(private readonly deps: SessionCommandDeps, private readonly selection: SlotSelection, private readonly view: SessionViewHooks) {}

  /** Applies a change; an error (e.g. an audio clip on a MIDI track) goes in the status bar. */
  apply(e: Edit): boolean {
    try {
      this.deps.store.apply(e);
      return true;
    } catch (err) {
      this.deps.say(editFailure(err));
      return false;
    }
  }

  launchSelected(): void {
    const { engine } = this.deps, cursor = this.selection.cursor;
    if (this.selection.size > 1) for (const r of this.selection.clips()) engine.launchSlot(r.track, r.slot);
    else if (cursor) engine.launchSlot(cursor.track, cursor.slot);
  }

  clearSelected(): void {
    const refs = this.selection.clips();
    if (refs.length) this.apply(clearSlots(refs));
  }

  duplicateSelected(): void {
    const refs = this.selection.clips();
    if (!refs.length || !this.apply(duplicateSlots(refs))) return;
    this.selection.pick(belowBlock(refs));
  }

  /** Capture and insert scene: below `index` (the cursor's scene, otherwise the last) a scene with
   *  the playing clips, which keep playing from there. */
  captureAndInsertScene(index = this.selection.cursor?.slot ?? this.deps.store.project.scenes.length - 1): void {
    const playing = this.deps.engine.playingClips();
    if (!this.apply(captureScene(index, playing))) return;
    const cursor = this.selection.cursor;
    if (cursor) this.selection.select({ ...cursor, slot: index + 1 });
    if (!playing.size) this.deps.say('No clip is playing: an empty scene was inserted.');
  }

  copySelected(): boolean {
    const copied = copySlotClips(this.deps.store.project, this.selection.clips());
    if (!copied) return false;
    this.deps.clipboard.content = copied;
    this.deps.say(copiedMessage(copied.items.length));
    return true;
  }

  cutSelected(): void {
    if (this.copySelected()) this.clearSelected();
  }

  pasteSelected(): void {
    const { clipboard, store } = this.deps;
    if (clipboard.devices) return this.deps.pasteDevices();
    const s = this.selection.cursor, content = clipboard.clips;
    if (!s) return;
    if (!content) return this.deps.say('The clipboard has no clips.');
    const refs = pasteSlots(store.project, content, s.track, s.slot);
    if (this.apply(pasteToSlot(content, s.track, s.slot)) && refs.length > 1) this.selection.pick(refs, s);
  }

  /** Records into the slot (arming the track if it isn't), or ends the track's take. */
  record(ref: SlotRef): void {
    const { ui, recorder } = this.deps;
    if (recorder.recordingSlot(ref.track) === null && !ui.keyboardTracks.has(ref.track)) ui.toggleKeyboardTrack(ref.track);
    recorder.toggle(ref);
  }

  /** Opens the clip in the editor at the bottom; the keyboard stays with the session (Ctrl+C copies the clip). */
  openSlot(ref: SlotRef): void {
    const clip = this.deps.store.project.track(ref.track)?.slots[ref.slot];
    if (!clip) return;
    this.deps.openClip(slotRef(ref.track, clip.id));
    this.view.focus();
  }

  /** An empty MIDI clip in the slot, opened in the editor. */
  newMidiClip(ref: SlotRef): void {
    this.apply(newSlotMidiClip(ref));
    this.openSlot(ref);
  }
}

/** What the session's keys act on. */
export interface SessionControls {
  readonly selection: SlotSelection;
  readonly commands: SessionCommands;
}

/** The session's keyboard commands (on the chosen slot): they take priority over the general ones. */
export const SESSION_KEYS: readonly Binding<SessionControls>[] = [
  // before the bare arrows, which also apply with Shift
  { key: 'arrowup', shift: true, run: c => c.selection.extend(0, -1) },
  { key: 'arrowdown', shift: true, run: c => c.selection.extend(0, 1) },
  { key: 'arrowleft', shift: true, run: c => c.selection.extend(-1, 0) },
  { key: 'arrowright', shift: true, run: c => c.selection.extend(1, 0) },
  { key: 'a', ctrl: true, run: c => c.selection.selectAll() },
  { key: 'enter', run: c => c.commands.launchSelected() },
  { key: 'delete', run: c => c.commands.clearSelected() },
  { key: 'backspace', run: c => c.commands.clearSelected() },
  { key: 'd', ctrl: true, run: c => c.commands.duplicateSelected() },
  { key: 'i', ctrl: true, shift: true, run: c => c.commands.captureAndInsertScene() },
  { key: 'c', ctrl: true, run: c => c.commands.copySelected() },
  { key: 'x', ctrl: true, run: c => c.commands.cutSelected() },
  { key: 'v', ctrl: true, run: c => c.commands.pasteSelected() },
  { key: 'arrowup', run: c => c.selection.move(0, -1) },
  { key: 'arrowdown', run: c => c.selection.move(0, 1) },
  { key: 'arrowleft', run: c => c.selection.move(-1, 0) },
  { key: 'arrowright', run: c => c.selection.move(1, 0) },
];
