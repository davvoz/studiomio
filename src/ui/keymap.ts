/** App commands callable from the keyboard (and from the buttons). */
export interface Commands {
  togglePlay(): void;
  stopAndRewind(): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  cutSelection(): void;
  copySelection(): void;
  paste(): void;
  splitAtCursor(): void;
  /** The selected clips (or the time range) into a single clip, as in Live (Ctrl+J). */
  consolidateSelection(): void;
  selectAll(): void;
  toggleLoop(): void;
  /** Copies the loop range right after and moves the loop there (Ctrl+Shift+D). */
  duplicateLoop(): void;
  toggleMetronome(): void;
  toggleSnap(): void;
  /** Follow the playhead (Ctrl+Shift+F); if it's suspended, it resumes it. */
  toggleFollow(): void;
  zoom(factor: number): void;
  newProject(): void;
  save(): void;
  saveAs(): void;
  open(): void;
  /** Switches from arrangement to session and vice versa. */
  toggleView(): void;
  /** Groups the chosen tracks (Ctrl+G) · ungroups the chosen group (Ctrl+Shift+G). */
  groupTracks(): void;
  ungroupTracks(): void;
  /** Shows or hides the browser (Ctrl+Alt+B) · brings the cursor into its search (Ctrl+F). */
  toggleBrowser(): void;
  searchBrowser(): void;
  /** Maps the computer keyboard to the macros and parameters (Ctrl+K, as in Live). */
  toggleKeyMap(): void;
  /** Maps any controller's MIDI to the macros, parameters and mixer (Ctrl+M, as in Live). */
  toggleMidiMap(): void;
}

export interface Binding<C = Commands> {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  /** Only the shortcuts naming it look at Alt. */
  readonly alt?: boolean;
  readonly run: (c: C) => void;
}

/** Shortcuts: one line per command, no switch. `key` is KeyboardEvent.key in lowercase
 *  or KeyboardEvent.code (for keys like Space). */
export const KEYMAP: readonly Binding<Commands>[] = [
  { key: 'Space', run: c => c.togglePlay() },
  { key: 'tab', run: c => c.toggleView() },
  { key: 'Enter', run: c => c.stopAndRewind() },
  { key: 'z', ctrl: true, run: c => c.undo() },
  { key: 'z', ctrl: true, shift: true, run: c => c.redo() },
  { key: 'y', ctrl: true, run: c => c.redo() },
  { key: 'delete', run: c => c.deleteSelection() },
  { key: 'backspace', run: c => c.deleteSelection() },
  { key: 'd', ctrl: true, run: c => c.duplicateSelection() },
  { key: 'd', ctrl: true, shift: true, run: c => c.duplicateLoop() },
  { key: 'x', ctrl: true, run: c => c.cutSelection() },
  { key: 'c', ctrl: true, run: c => c.copySelection() },
  { key: 'v', ctrl: true, run: c => c.paste() },
  { key: 'e', ctrl: true, run: c => c.splitAtCursor() },
  { key: 'j', ctrl: true, run: c => c.consolidateSelection() },
  { key: 'a', ctrl: true, run: c => c.selectAll() },
  { key: 'l', ctrl: true, run: c => c.toggleLoop() },
  { key: 'm', ctrl: true, shift: true, run: c => c.toggleMetronome() },
  { key: '4', ctrl: true, run: c => c.toggleSnap() },
  { key: '+', run: c => c.zoom(1.25) },
  { key: '=', run: c => c.zoom(1.25) },
  { key: '-', run: c => c.zoom(0.8) },
  { key: 'n', ctrl: true, run: c => c.newProject() },
  { key: 's', ctrl: true, run: c => c.save() },
  { key: 's', ctrl: true, shift: true, run: c => c.saveAs() },
  { key: 'o', ctrl: true, run: c => c.open() },
  { key: 'g', ctrl: true, run: c => c.groupTracks() },
  { key: 'g', ctrl: true, shift: true, run: c => c.ungroupTracks() },
  { key: 'b', ctrl: true, alt: true, run: c => c.toggleBrowser() },
  { key: 'f', ctrl: true, run: c => c.searchBrowser() },
  { key: 'f', ctrl: true, shift: true, run: c => c.toggleFollow() },
  { key: 'k', ctrl: true, run: c => c.toggleKeyMap() },
  { key: 'm', ctrl: true, run: c => c.toggleMidiMap() },
];

/** Fields you type in: there all the keys are theirs. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);
/** Keys a slider (volume) uses for itself; the others, like Ctrl+Z, stay shortcuts. */
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** The key belongs to a text field (or a slider), not to the shortcuts. */
export function ownedByField(t: HTMLElement | null, e: KeyboardEvent): boolean {
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  return t instanceof HTMLInputElement && (TEXT_INPUTS.has(t.type) || SLIDER_KEYS.has(e.key));
}

/** The shortcut of a pressed key, if there is one. */
export function findBinding<C>(keymap: readonly Binding<C>[], e: KeyboardEvent): Binding<C> | undefined {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // Shift counts only if the shortcut names it or uses Ctrl: "+" requires Shift on many keyboards
  return keymap.find(k => (k.key === e.code || k.key === key) && !!k.ctrl === ctrl
    && (k.shift === undefined ? !(ctrl && e.shiftKey) : k.shift === e.shiftKey)
    && (k.alt === undefined || k.alt === e.altKey));
}

/** Connects the keyboard to the commands (ignoring the keys belonging to text fields). With
 *  `ownKeys` the used keys don't go further up (an editor takes priority over the timeline). */
export function bindKeys<C>(target: Document | HTMLElement, commands: C, keymap: readonly Binding<C>[], ownKeys = false): void {
  target.addEventListener('keydown', ev => {
    const e = ev as KeyboardEvent;
    if (ownedByField(e.target as HTMLElement | null, e)) return;
    const b = findBinding(keymap, e);
    if (!b) return;
    e.preventDefault();
    if (ownKeys) e.stopPropagation();
    b.run(commands);
  });
}
