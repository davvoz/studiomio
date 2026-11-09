/* The piano roll's context menu: on the notes, on empty space, elsewhere. */
import type { Beats } from '../../core/music-time';
import { KEY, SEPARATOR, type MenuItem } from '../context-menu';
import type { RollHit } from './roll-gestures';

/** What the menu uses of the piano roll. */
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
  /** The beat on the grid (at the start of the cell) under the pointer. */
  cellStart(beat: Beats): Beats;
}

const general = (r: RollMenuActions): MenuItem[] => [
  { label: 'Select all', shortcut: KEY.selectAll, run: () => r.selectAll() },
  { label: 'Quantize all notes', shortcut: KEY.quantize, run: () => { r.selectAll(); r.quantize(); } },
  { label: 'Draw mode', shortcut: KEY.draw, checked: r.drawMode, run: () => r.toggleDraw() },
  SEPARATOR,
  { label: 'Duplicate loop', shortcut: KEY.duplicateLoop, run: () => r.duplicateLoop() },
];

const noteMenu = (r: RollMenuActions): MenuItem[] => [
  { label: 'Cut', shortcut: KEY.cut, run: () => r.cut() },
  { label: 'Copy', shortcut: KEY.copy, run: () => r.copy() },
  { label: 'Paste', shortcut: KEY.paste, disabled: !r.canPaste, run: () => r.paste() },
  { label: 'Duplicate', shortcut: KEY.duplicate, run: () => r.duplicate() },
  SEPARATOR,
  { label: 'Quantize', shortcut: KEY.quantize, run: () => r.quantize() },
  { label: 'An octave up', shortcut: 'Shift+↑', run: () => r.transpose(12) },
  { label: 'An octave down', shortcut: 'Shift+↓', run: () => r.transpose(-12) },
  SEPARATOR,
  { label: `Delete${r.selection.size > 1 ? ` (${r.selection.size} notes)` : ''}`, shortcut: KEY.delete, run: () => r.deleteSelected() },
];

const MENUS: { readonly [K in RollHit['kind']]: (r: RollMenuActions, hit: Extract<RollHit, { kind: K }>) => MenuItem[] } = {
  note: r => noteMenu(r),
  velocity: r => noteMenu(r),
  empty: (r, hit) => [
    { label: 'Paste here', shortcut: KEY.paste, disabled: !r.canPaste, run: () => r.paste(r.cellStart(hit.beat)) },
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
