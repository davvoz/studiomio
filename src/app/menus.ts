/* I menu contestuali della timeline: per ogni cosa sotto il puntatore, le sue voci. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Color } from '../model/clip';
import { PALETTE } from '../model/colors';
import { placementRef, type ClipRef } from '../store/clip-ref';
import type { TrackKind } from '../store/edits';
import { KEY, SEPARATOR, type MenuItem } from '../ui/context-menu';
import type { Hit } from '../ui/timeline/geometry';

/** I comandi che i menu della timeline usano. */
export interface TimelineActions {
  readonly canPaste: boolean;
  openClip(ref: ClipRef): void;
  cutSelection(): void;
  copySelection(): void;
  deleteSelection(): void;
  /** Colora le clip selezionate (undefined: il colore della loro traccia). */
  colorSelection(color: Color | undefined): void;
  duplicateSelection(): void;
  /** Incolla sulla traccia di indice `trackIndex` dal battito `at`. */
  pasteAt(trackIndex: number, at: Beats): void;
  splitSelectionAt(beat: Beats): void;
  consolidateSelection(): void;
  selectAll(): void;
  readonly loopEnabled: boolean;
  toggleLoop(): void;
  /** Copia il tratto del loop subito dopo e ci sposta il loop. */
  duplicateLoop(): void;
  /** Battito agganciato alla griglia della timeline. */
  snap(beat: Beats): Beats;
  newMidiClip(track: TrackId, beat: Beats): void;
  addTrack(kind: TrackKind): void;
  isMidiTrack(track: TrackId): boolean;
}

const newTracks = (a: TimelineActions): MenuItem[] => [
  { label: 'Nuova traccia audio', run: () => a.addTrack('audio') },
  { label: 'Nuova traccia MIDI', run: () => a.addTrack('midi') },
];

const MENUS: { readonly [K in Hit['kind']]: (a: TimelineActions, hit: Extract<Hit, { kind: K }>) => MenuItem[] } = {
  clip: (a, hit) => [
    { label: 'Apri nell\'editor', shortcut: 'doppio clic', run: () => a.openClip(placementRef(hit.track, hit.placement.id)) },
    SEPARATOR,
    { label: 'Taglia', shortcut: KEY.cut, run: () => a.cutSelection() },
    { label: 'Copia', shortcut: KEY.copy, run: () => a.copySelection() },
    { label: 'Incolla qui', shortcut: KEY.paste, disabled: !a.canPaste, run: () => a.pasteAt(hit.trackIndex, a.snap(hit.beat)) },
    { label: 'Duplica', shortcut: KEY.duplicate, run: () => a.duplicateSelection() },
    { label: 'Dividi qui', shortcut: KEY.split, run: () => a.splitSelectionAt(a.snap(hit.beat)) },
    { label: 'Consolida', shortcut: KEY.consolidate, run: () => a.consolidateSelection() },
    SEPARATOR,
    { colors: PALETTE, current: hit.placement.clip.color, noneTitle: 'Colore della traccia', pick: c => a.colorSelection(c) },
    SEPARATOR,
    { label: 'Elimina', shortcut: KEY.delete, run: () => a.deleteSelection() },
  ],
  lane: (a, hit) => [
    { label: 'Incolla qui', shortcut: KEY.paste, disabled: !a.canPaste, run: () => a.pasteAt(hit.trackIndex, a.snap(hit.beat)) },
    ...(a.isMidiTrack(hit.track) ? [{ label: 'Nuova clip MIDI qui', shortcut: 'doppio clic', run: () => a.newMidiClip(hit.track, hit.beat) }] : []),
    { label: 'Seleziona tutto', shortcut: KEY.selectAll, run: () => a.selectAll() },
    { label: 'Duplica loop', shortcut: KEY.duplicateLoop, run: () => a.duplicateLoop() },
    SEPARATOR,
    ...newTracks(a),
  ],
  empty: a => [
    { label: 'Seleziona tutto', shortcut: KEY.selectAll, run: () => a.selectAll() },
    { label: 'Duplica loop', shortcut: KEY.duplicateLoop, run: () => a.duplicateLoop() },
    SEPARATOR,
    ...newTracks(a),
  ],
};

export const timelineMenu = (a: TimelineActions, hit: Hit): MenuItem[] =>
  (MENUS[hit.kind] as (a: TimelineActions, hit: Hit) => MenuItem[])(a, hit);

/** Tasto destro sul righello: la regione di loop. */
export const rulerMenu = (a: TimelineActions): MenuItem[] => [
  { label: 'Loop', shortcut: 'Ctrl+L', checked: a.loopEnabled, run: () => a.toggleLoop() },
  { label: 'Duplica loop', shortcut: KEY.duplicateLoop, run: () => a.duplicateLoop() },
];
