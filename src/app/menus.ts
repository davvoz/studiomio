/* The timeline's context menus: for each thing under the pointer, its items. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Color } from '../model/clip';
import { PALETTE } from '../model/colors';
import { placementRef, type ClipRef } from '../store/clip-ref';
import type { TrackKind } from '../store/edits';
import { KEY, SEPARATOR, type MenuItem } from '../ui/context-menu';
import type { Hit } from '../ui/timeline/geometry';

/** The commands the timeline menus use. */
export interface TimelineActions {
  readonly canPaste: boolean;
  openClip(ref: ClipRef): void;
  cutSelection(): void;
  copySelection(): void;
  deleteSelection(): void;
  /** Colours the selected clips (undefined: their track's colour). */
  colorSelection(color: Color | undefined): void;
  duplicateSelection(): void;
  /** Pastes on the track at index `trackIndex` from beat `at`. */
  pasteAt(trackIndex: number, at: Beats): void;
  splitSelectionAt(beat: Beats): void;
  consolidateSelection(): void;
  /** The selected clips into a new session scene. */
  selectionToSession(): void;
  selectAll(): void;
  readonly loopEnabled: boolean;
  toggleLoop(): void;
  /** Copies the loop range right after and moves the loop there. */
  duplicateLoop(): void;
  /** Beat snapped to the timeline grid. */
  snap(beat: Beats): Beats;
  newMidiClip(track: TrackId, beat: Beats): void;
  addTrack(kind: TrackKind): void;
  isMidiTrack(track: TrackId): boolean;
}

const newTracks = (a: TimelineActions): MenuItem[] => [
  { label: 'New audio track', run: () => a.addTrack('audio') },
  { label: 'New MIDI track', run: () => a.addTrack('midi') },
];

const MENUS: { readonly [K in Hit['kind']]: (a: TimelineActions, hit: Extract<Hit, { kind: K }>) => MenuItem[] } = {
  clip: (a, hit) => [
    { label: 'Open in the editor', shortcut: 'double click', run: () => a.openClip(placementRef(hit.track, hit.placement.id)) },
    SEPARATOR,
    { label: 'Cut', shortcut: KEY.cut, run: () => a.cutSelection() },
    { label: 'Copy', shortcut: KEY.copy, run: () => a.copySelection() },
    { label: 'Paste here', shortcut: KEY.paste, disabled: !a.canPaste, run: () => a.pasteAt(hit.trackIndex, a.snap(hit.beat)) },
    { label: 'Duplicate', shortcut: KEY.duplicate, run: () => a.duplicateSelection() },
    { label: 'Split here', shortcut: KEY.split, run: () => a.splitSelectionAt(a.snap(hit.beat)) },
    { label: 'Consolidate', shortcut: KEY.consolidate, run: () => a.consolidateSelection() },
    { label: 'Copy to session', run: () => a.selectionToSession() },
    SEPARATOR,
    { colors: PALETTE, current: hit.placement.clip.color, noneTitle: 'Track colour', pick: c => a.colorSelection(c) },
    SEPARATOR,
    { label: 'Delete', shortcut: KEY.delete, run: () => a.deleteSelection() },
  ],
  lane: (a, hit) => [
    { label: 'Paste here', shortcut: KEY.paste, disabled: !a.canPaste, run: () => a.pasteAt(hit.trackIndex, a.snap(hit.beat)) },
    ...(a.isMidiTrack(hit.track) ? [{ label: 'New MIDI clip here', shortcut: 'double-click', run: () => a.newMidiClip(hit.track, hit.beat) }] : []),
    { label: 'Select all', shortcut: KEY.selectAll, run: () => a.selectAll() },
    { label: 'Duplicate loop', shortcut: KEY.duplicateLoop, run: () => a.duplicateLoop() },
    SEPARATOR,
    ...newTracks(a),
  ],
  empty: a => [
    { label: 'Select all', shortcut: KEY.selectAll, run: () => a.selectAll() },
    { label: 'Duplicate loop', shortcut: KEY.duplicateLoop, run: () => a.duplicateLoop() },
    SEPARATOR,
    ...newTracks(a),
  ],
};

export const timelineMenu = (a: TimelineActions, hit: Hit): MenuItem[] =>
  (MENUS[hit.kind] as (a: TimelineActions, hit: Hit) => MenuItem[])(a, hit);

/** Right click on the ruler: the loop region. */
export const rulerMenu = (a: TimelineActions): MenuItem[] => [
  { label: 'Loop', shortcut: 'Ctrl+L', checked: a.loopEnabled, run: () => a.toggleLoop() },
  { label: 'Duplicate loop', shortcut: KEY.duplicateLoop, run: () => a.duplicateLoop() },
];
