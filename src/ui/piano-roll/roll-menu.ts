/* Menu contestuale del piano roll: sulle note, sullo spazio vuoto, altrove. */
import type { Beats } from '../../core/music-time';
import { KEY, SEPARATOR, type MenuItem } from '../context-menu';
import type { RollHit } from './roll-gestures';

/** Ciò che il menu usa del piano roll. */
export interface RollMenuActions {
  readonly canPaste: boolean;
  readonly drawMode: boolean;
  readonly selection: ReadonlySet<unknown>;
  cut(): void;
  copy(): void;
  paste(at?: Beats): void;
  duplicate(): void;
  duplicateLoop(): void;
  deleteSelected(): void;
  quantize(): void;
  transpose(semitones: number): void;
  selectAll(): void;
  toggleDraw(): void;
  /** Il battito sulla griglia (all'inizio della cella) sotto il puntatore. */
  cellStart(beat: Beats): Beats;
}

const general = (r: RollMenuActions): MenuItem[] => [
  { label: 'Seleziona tutto', shortcut: KEY.selectAll, run: () => r.selectAll() },
  { label: 'Quantizza tutte le note', shortcut: KEY.quantize, run: () => { r.selectAll(); r.quantize(); } },
  { label: 'Modo disegno', shortcut: KEY.draw, checked: r.drawMode, run: () => r.toggleDraw() },
  SEPARATOR,
  { label: 'Duplica loop', shortcut: KEY.duplicateLoop, run: () => r.duplicateLoop() },
];

const noteMenu = (r: RollMenuActions): MenuItem[] => [
  { label: 'Taglia', shortcut: KEY.cut, run: () => r.cut() },
  { label: 'Copia', shortcut: KEY.copy, run: () => r.copy() },
  { label: 'Incolla', shortcut: KEY.paste, disabled: !r.canPaste, run: () => r.paste() },
  { label: 'Duplica', shortcut: KEY.duplicate, run: () => r.duplicate() },
  SEPARATOR,
  { label: 'Quantizza', shortcut: KEY.quantize, run: () => r.quantize() },
  { label: 'Un\'ottava sopra', shortcut: 'Maiusc+↑', run: () => r.transpose(12) },
  { label: 'Un\'ottava sotto', shortcut: 'Maiusc+↓', run: () => r.transpose(-12) },
  SEPARATOR,
  { label: `Elimina${r.selection.size > 1 ? ` (${r.selection.size} note)` : ''}`, shortcut: KEY.delete, run: () => r.deleteSelected() },
];

const MENUS: { readonly [K in RollHit['kind']]: (r: RollMenuActions, hit: Extract<RollHit, { kind: K }>) => MenuItem[] } = {
  note: r => noteMenu(r),
  velocity: r => noteMenu(r),
  empty: (r, hit) => [
    { label: 'Incolla qui', shortcut: KEY.paste, disabled: !r.canPaste, run: () => r.paste(r.cellStart(hit.beat)) },
    SEPARATOR,
    ...general(r),
  ],
  lane: r => general(r),
  loop: r => general(r),
  flag: r => general(r),
  ruler: r => general(r),
};

export const rollMenu = (r: RollMenuActions, hit: RollHit): MenuItem[] =>
  (MENUS[hit.kind] as (r: RollMenuActions, hit: RollHit) => MenuItem[])(r, hit);
