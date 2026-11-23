/* The timeline's editing commands on the selected clips (keys, menus): delete, colour, duplicate,
 * copy, cut, paste at the cursor, split, select all, duplicate the loop, a new MIDI clip. Only
 * the decisions and the messages: the changes are the store's edits. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { PlaybackEngine } from '../engine/playback-engine';
import type { Color } from '../model/clip';
import { Clipboard, copyClips, pasteClips } from '../store/clipboard';
import { placementRef, setClipColor } from '../store/clip-ref';
import { addMidiClip } from '../store/edits';
import { edit, type ProjectStore } from '../store/project-store';
import { addedPlacements, cutOutRange, deleteMany, duplicateLoopRegion, duplicateMany, splitMany } from '../store/selection-edits';
import { resolveSelection } from '../ui/timeline/planning';
import type { UiState } from '../ui/ui-state';

export interface TimelineCommandDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly clipboard: Clipboard;
  readonly engine: Pick<PlaybackEngine, 'position' | 'playing' | 'seek'>;
  /** Brings a beat into view. */
  reveal(beat: Beats): void;
  /** The clipboard holds devices: they go on the chosen track. */
  pasteDevices(): void;
  say(text: string): void;
}

/** What Ctrl+C says. */
export const copiedMessage = (n: number): string =>
  (n === 1 ? 'Copied 1 clip: Ctrl+V pastes it at the cursor.' : `Copied ${n} clips: Ctrl+V pastes them at the cursor.`);

/** What Ctrl+V says with nothing to paste in the timeline. */
export const nothingToPaste = (clipboard: Clipboard): string =>
  (clipboard.notes ? 'The clipboard holds notes: paste them in the piano roll.' : 'The clipboard is empty.');

export class TimelineCommands {
  constructor(private readonly deps: TimelineCommandDeps) {}

  /** The selected clips, as references. */
  private selection() {
    return resolveSelection(this.deps.store.project, this.deps.ui.selection);
  }

  /** Selects the clips `apply` adds. */
  private selectAdded(apply: () => void): void {
    const { store, ui } = this.deps, before = store.project;
    apply();
    ui.select(addedPlacements(before, store.project).map(r => r.id));
  }

  /** With a time range selected only that is deleted, as in Live. */
  deleteSelection(): void {
    const { store, ui } = this.deps, refs = this.selection(), range = ui.range;
    if (!refs.length) return;
    if (!range) {
      store.apply(deleteMany(refs));
      return;
    }
    const cut = cutOutRange(store.project, store.ids, refs, range);
    store.apply(edit('Delete clip', (_p, ctx) => deleteMany(cut.pieces).apply(cut.project, ctx)));
  }

  colorSelection(color: Color | undefined): void {
    const refs = this.selection().map(r => placementRef(r.track, r.id));
    if (refs.length) this.deps.store.apply(setClipColor(refs, color));
  }

  duplicateSelection(): void {
    const refs = this.selection();
    if (refs.length) this.selectAdded(() => this.deps.store.apply(duplicateMany(refs)));
  }

  copySelection(): void {
    const copied = copyClips(this.deps.store.project, this.selection());
    if (!copied) return this.deps.say('Select some clips to copy.');
    this.deps.clipboard.content = copied;
    this.deps.say(copiedMessage(copied.items.length));
  }

  cutSelection(): void {
    const refs = this.selection();
    const copied = copyClips(this.deps.store.project, refs);
    if (!copied) return this.deps.say('Select some clips to cut.');
    this.deps.clipboard.content = copied;
    this.deps.store.apply(deleteMany(refs));
  }

  /** Pastes at the cursor, on the tracks it was copied from; devices, on the chosen track. */
  paste(): void {
    const { clipboard, store, engine } = this.deps;
    if (clipboard.devices) return this.deps.pasteDevices();
    const copied = clipboard.clips;
    if (!copied) return this.deps.say(nothingToPaste(clipboard));
    const index = store.project.visibleTracks.findIndex(t => t.id === copied.sourceTrack);
    this.pasteAt(Math.max(0, index), engine.position);
  }

  pasteAt(trackIndex: number, at: Beats): void {
    const { clipboard, store, engine, ui, say } = this.deps;
    const copied = clipboard.clips;
    if (!copied) return;
    const before = store.project;
    store.apply(pasteClips(copied, trackIndex, at));
    const added = addedPlacements(before, store.project);
    if (!added.length) return say('No suitable track here: audio clips go on audio tracks, MIDI ones on MIDI tracks.');
    ui.select(added.map(r => r.id));
    // the cursor goes to the end of what was pasted: Ctrl+V again continues in a row
    if (!engine.playing) engine.seek(at + copied.span);
    if (added.length < copied.items.length) say(`Pasted ${added.length} of ${copied.items.length} clips: the others have no suitable track.`);
  }

  /** Splits the selected clips (or, without a selection, all of them) at the cursor; with a time
   *  range selected it splits at its edges, as in Live, and the piece inside stays selected. */
  splitAtCursor(): void {
    const { store, ui, engine } = this.deps, range = ui.range;
    if (!range) return this.splitSelectionAt(engine.position);
    const cut = cutOutRange(store.project, store.ids, this.selection(), range);
    store.apply(edit('Split', () => cut.project));
    ui.select(cut.pieces.map(r => r.id));
  }

  splitSelectionAt(beat: Beats): void {
    const p = this.deps.store.project, chosen = this.selection();
    const refs = chosen.length ? chosen : p.tracks.flatMap(t => t.arrangement.map(x => ({ track: t.id, id: x.id })));
    this.deps.store.apply(splitMany(refs, beat));
  }

  selectAll(): void {
    this.deps.ui.select(this.deps.store.project.tracks.flatMap(t => t.arrangement.map(x => x.id)));
  }

  /** Copies the loop range right after, moves the loop there and selects the copied clips. */
  duplicateLoop(): void {
    const { store } = this.deps;
    this.selectAdded(() => store.apply(duplicateLoopRegion()));
    const { start, end } = store.project.loop, sig = store.project.signature;
    this.deps.reveal(start);
    this.deps.say(`Loop duplicated: it's now from ${sig.format(start)} to ${sig.format(end)}. Ctrl+Shift+D again for another round.`);
  }

  /** A one-bar MIDI clip at the bar of `beat`. */
  newMidiClip(track: TrackId, beat: Beats): void {
    const bar = this.deps.store.project.signature.beatsPerBar;
    this.deps.store.apply(addMidiClip(track, Math.floor(beat / bar) * bar, bar));
  }

  /** `beat` on the grid, if the grid is on. */
  snap(beat: Beats): Beats {
    const { ui, store } = this.deps;
    const step = ui.gridStep(ui.geometry.pxPerBeat, store.project.signature);
    return ui.snap ? Math.max(0, Math.round(beat / step) * step) : beat;
  }
}
