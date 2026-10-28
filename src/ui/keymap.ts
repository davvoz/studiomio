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
  /** Le clip selezionate (o il tratto di tempo) in una clip sola, come in Live (Ctrl+J). */
  consolidateSelection(): void;
  selectAll(): void;
  toggleLoop(): void;
  /** Copia il tratto del loop subito dopo e ci sposta il loop (Ctrl+Maiusc+D). */
  duplicateLoop(): void;
  toggleMetronome(): void;
  toggleSnap(): void;
  /** Segui la testina (Ctrl+Maiusc+F); se è sospeso, lo riprende. */
  toggleFollow(): void;
  zoom(factor: number): void;
  newProject(): void;
  save(): void;
  saveAs(): void;
  open(): void;
  /** Passa da arrangement a session e viceversa. */
  toggleView(): void;
  /** Raggruppa le tracce scelte (Ctrl+G) · separa il gruppo scelto (Ctrl+Maiusc+G). */
  groupTracks(): void;
  ungroupTracks(): void;
  /** Mostra o nasconde il browser (Ctrl+Alt+B) · porta il cursore nella sua ricerca (Ctrl+F). */
  toggleBrowser(): void;
  searchBrowser(): void;
  /** Mappa la tastiera del computer sulle macro e sui parametri (Ctrl+K, come in Live). */
  toggleKeyMap(): void;
  /** Mappa il MIDI di un controller qualsiasi sulle macro, sui parametri e sul mixer (Ctrl+M, come in Live). */
  toggleMidiMap(): void;
}

export interface Binding<C = Commands> {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  /** Solo le scorciatoie che lo nominano guardano Alt. */
  readonly alt?: boolean;
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

/** Campi in cui si scrive: lì tutti i tasti sono loro. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);
/** Tasti che un cursore (volume) usa per sé; gli altri, come Ctrl+Z, restano scorciatoie. */
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Il tasto spetta a un campo di testo (o un cursore), non alle scorciatoie. */
export function ownedByField(t: HTMLElement | null, e: KeyboardEvent): boolean {
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  return t instanceof HTMLInputElement && (TEXT_INPUTS.has(t.type) || SLIDER_KEYS.has(e.key));
}

/** La scorciatoia di un tasto premuto, se c'è. */
export function findBinding<C>(keymap: readonly Binding<C>[], e: KeyboardEvent): Binding<C> | undefined {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // Maiusc conta solo se la scorciatoia lo nomina o usa Ctrl: "+" richiede Maiusc su molte tastiere
  return keymap.find(k => (k.key === e.code || k.key === key) && !!k.ctrl === ctrl
    && (k.shift === undefined ? !(ctrl && e.shiftKey) : k.shift === e.shiftKey)
    && (k.alt === undefined || k.alt === e.altKey));
}

/** Collega la tastiera ai comandi (ignorando i tasti che spettano ai campi di testo). Con
 *  `ownKeys` i tasti usati non arrivano più su (un editor ha la precedenza sulla timeline). */
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
