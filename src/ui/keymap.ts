/** Comandi dell'app richiamabili da tastiera (e dai pulsanti). */
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
  selectAll(): void;
  toggleLoop(): void;
  toggleMetronome(): void;
  toggleSnap(): void;
  zoom(factor: number): void;
  save(): void;
  open(): void;
  /** Passa da arrangement a session e viceversa. */
  toggleView(): void;
  /** Raggruppa le tracce scelte (Ctrl+G) · separa il gruppo scelto (Ctrl+Maiusc+G). */
  groupTracks(): void;
  ungroupTracks(): void;
}

export interface Binding<C = Commands> {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly run: (c: C) => void;
}

/** Scorciatoie: una riga per comando, nessun switch. `key` è KeyboardEvent.key in minuscolo
 *  oppure KeyboardEvent.code (per i tasti come Spazio). */
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
  { key: 'x', ctrl: true, run: c => c.cutSelection() },
  { key: 'c', ctrl: true, run: c => c.copySelection() },
  { key: 'v', ctrl: true, run: c => c.paste() },
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
  { key: 'g', ctrl: true, run: c => c.groupTracks() },
  { key: 'g', ctrl: true, shift: true, run: c => c.ungroupTracks() },
];

/** Campi in cui si scrive: lì tutti i tasti sono loro. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);
/** Tasti che un cursore (volume) usa per sé; gli altri, come Ctrl+Z, restano scorciatoie. */
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

function ownedByField(t: HTMLElement | null, e: KeyboardEvent): boolean {
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  return t instanceof HTMLInputElement && (TEXT_INPUTS.has(t.type) || SLIDER_KEYS.has(e.key));
}

/** Collega la tastiera ai comandi (ignorando i tasti che spettano ai campi di testo). Con
 *  `ownKeys` i tasti usati non arrivano più su (un editor ha la precedenza sulla timeline). */
export function bindKeys<C>(target: Document | HTMLElement, commands: C, keymap: readonly Binding<C>[], ownKeys = false): void {
  target.addEventListener('keydown', ev => {
    const e = ev as KeyboardEvent;
    if (ownedByField(e.target as HTMLElement | null, e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Maiusc conta solo se la scorciatoia lo nomina o usa Ctrl: "+" richiede Maiusc su molte tastiere
    const b = keymap.find(k => (k.key === e.code || k.key === key) && !!k.ctrl === ctrl
      && (k.shift === undefined ? !(ctrl && e.shiftKey) : k.shift === e.shiftKey));
    if (!b) return;
    e.preventDefault();
    if (ownKeys) e.stopPropagation();
    b.run(commands);
  });
}
