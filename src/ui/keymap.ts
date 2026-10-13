/** Comandi dell'app richiamabili da tastiera (e dai pulsanti). */
export interface Commands {
  togglePlay(): void;
  stopAndRewind(): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  splitAtCursor(): void;
  selectAll(): void;
  toggleLoop(): void;
  toggleMetronome(): void;
  toggleSnap(): void;
  zoom(factor: number): void;
  save(): void;
  open(): void;
}

interface Binding {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly run: (c: Commands) => void;
}

/** Scorciatoie: una riga per comando, nessun switch. `key` è KeyboardEvent.key in minuscolo
 *  oppure KeyboardEvent.code (per i tasti come Spazio). */
export const KEYMAP: readonly Binding[] = [
  { key: 'Space', run: c => c.togglePlay() },
  { key: 'Enter', run: c => c.stopAndRewind() },
  { key: 'z', ctrl: true, run: c => c.undo() },
  { key: 'z', ctrl: true, shift: true, run: c => c.redo() },
  { key: 'y', ctrl: true, run: c => c.redo() },
  { key: 'delete', run: c => c.deleteSelection() },
  { key: 'backspace', run: c => c.deleteSelection() },
  { key: 'd', ctrl: true, run: c => c.duplicateSelection() },
  { key: 'e', ctrl: true, run: c => c.splitAtCursor() },
  { key: 'a', ctrl: true, run: c => c.selectAll() },
  { key: 'l', ctrl: true, run: c => c.toggleLoop() },
  { key: 'm', ctrl: true, shift: true, run: c => c.toggleMetronome() },
  { key: '4', ctrl: true, run: c => c.toggleSnap() },
  { key: '+', run: c => c.zoom(1.25) },
  { key: '=', run: c => c.zoom(1.25) },
  { key: '-', run: c => c.zoom(0.8) },
  { key: 's', ctrl: true, run: c => c.save() },
  { key: 'o', ctrl: true, run: c => c.open() },
];

/** Collega la tastiera ai comandi (ignorando i tasti premuti nei campi di testo). */
export function bindKeys(target: Document, commands: Commands, keymap = KEYMAP): void {
  target.addEventListener('keydown', e => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Maiusc conta solo se la scorciatoia lo nomina o usa Ctrl: "+" richiede Maiusc su molte tastiere
    const b = keymap.find(k => (k.key === e.code || k.key === key) && !!k.ctrl === ctrl
      && (k.shift === undefined ? !(ctrl && e.shiftKey) : k.shift === e.shiftKey));
    if (!b) return;
    e.preventDefault();
    b.run(commands);
  });
}
