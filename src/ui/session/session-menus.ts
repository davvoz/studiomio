/* The session's context menus: which items a slot, a scene, a track's or a bus's header offers,
 * and when they're disabled. Only the lists (no DOM): renaming, which edits the name in place, is
 * the view's `rename`. */
import type { PlaybackEngine } from '../../engine/playback-engine';
import { PALETTE } from '../../model/colors';
import type { ChainOwner, Scene } from '../../model/project';
import { sceneClips } from '../../model/scene-export';
import { GroupTrack, type BusTrack, type Track } from '../../model/track';
import { setClipColor, setTrackColor, slotRef } from '../../store/clip-ref';
import type { Clipboard } from '../../store/clipboard';
import { addBus, removeTrack, setBusFolded } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { deleteScene, duplicateScene, insertScene, setSceneColor, type SlotRef } from '../../store/session-edits';
import { KEY, SEPARATOR, type MenuItem } from '../context-menu';
import { addEffectItems } from '../mixer-controls';
import { groupMenuItems, newTrackHereItems } from '../track-groups';
import type { UiState } from '../ui-state';
import type { SessionCommands, SlotRecorder } from './session-commands';
import type { SlotSelection } from './slot-selection';

export interface SessionMenuDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: Pick<PlaybackEngine, 'launchSlot' | 'stopTrack' | 'launchScene'>;
  readonly clipboard: Clipboard;
  readonly recorder: SlotRecorder;
  readonly commands: SessionCommands;
  readonly selection: SlotSelection;
  openDevices(owner: ChainOwner): void;
  pasteDeviceItems(owner: ChainOwner): MenuItem[];
  sceneToArrangement(index: number): void;
  exportScene(index: number): void;
  importAudioTo(ref: SlotRef): void;
}

/** On a MIDI track: record into the slot (a clip there is replaced), or stop the recording. */
export function recordItems(d: SessionMenuDeps, ref: SlotRef, track: Track): MenuItem[] {
  if (track.kind !== 'midi') return [];
  const at = d.recorder.recordingSlot(track.id);
  const record = { run: () => d.commands.record(ref) };
  if (at !== null) return at === ref.slot ? [{ label: 'Stop recording', ...record }] : [];
  return [{ label: track.slots[ref.slot] ? 'Record here (replaces the clip)' : 'Record here', ...record }];
}

function groupSlotItems(d: SessionMenuDeps, track: GroupTrack, ref: SlotRef): MenuItem[] {
  return [
    { label: 'Launch the group\'s row', shortcut: 'Enter', run: () => d.engine.launchSlot(track.id, ref.slot) },
    { label: 'Stop the group\'s tracks', run: () => d.engine.stopTrack(track.id) },
  ];
}

function emptySlotItems(d: SessionMenuDeps, track: Track, ref: SlotRef): MenuItem[] {
  const { commands } = d;
  return [
    ...recordItems(d, ref, track),
    track.kind === 'midi'
      ? { label: 'New MIDI clip', shortcut: 'double click', run: () => commands.newMidiClip(ref) }
      : { label: 'Import audio…', shortcut: 'double click', run: () => d.importAudioTo(ref) },
    { label: 'Paste', shortcut: KEY.paste, disabled: !d.clipboard.clips, run: () => commands.pasteSelected() },
    { label: 'Stop the track', run: () => d.engine.stopTrack(ref.track) },
  ];
}

function manyClipItems(d: SessionMenuDeps, refs: readonly SlotRef[], color: string): MenuItem[] {
  const { commands } = d, p = d.store.project;
  const clipRefs = () => refs.flatMap(r => {
    const id = p.track(r.track)?.slots[r.slot]?.id;
    return id ? [slotRef(r.track, id)] : [];
  });
  return [
    { label: `Launch ${refs.length} clips`, shortcut: 'Enter', run: () => commands.launchSelected() },
    SEPARATOR,
    { label: 'Cut', shortcut: KEY.cut, run: () => commands.cutSelected() },
    { label: 'Copy', shortcut: KEY.copy, run: () => commands.copySelected() },
    { label: 'Duplicate', shortcut: KEY.duplicate, run: () => commands.duplicateSelected() },
    SEPARATOR,
    { colors: PALETTE, current: color, noneTitle: 'Track colour', pick: c => commands.apply(setClipColor(clipRefs(), c)) },
    SEPARATOR,
    { label: `Delete ${refs.length} clips`, shortcut: KEY.delete, run: () => commands.clearSelected() },
  ];
}

function clipItems(d: SessionMenuDeps, track: Track, ref: SlotRef, rename: () => void): MenuItem[] {
  const { commands } = d, clip = track.slots[ref.slot]!;
  return [
    { label: 'Launch', shortcut: 'Enter', run: () => commands.launchSelected() },
    { label: 'Open in the editor', shortcut: 'click', run: () => commands.openSlot(ref) },
    ...recordItems(d, ref, track),
    SEPARATOR,
    { label: 'Cut', shortcut: KEY.cut, run: () => commands.cutSelected() },
    { label: 'Copy', shortcut: KEY.copy, run: () => commands.copySelected() },
    { label: 'Duplicate', shortcut: KEY.duplicate, run: () => commands.duplicateSelected() },
    { label: 'Rename', run: rename },
    SEPARATOR,
    { colors: PALETTE, current: clip.color, noneTitle: 'Track colour', pick: c => commands.apply(setClipColor([slotRef(ref.track, clip.id)], c)) },
    SEPARATOR,
    { label: 'Delete', shortcut: KEY.delete, run: () => commands.clearSelected() },
  ];
}

/** A slot's menu: a group's row, an empty slot, several chosen clips or one clip (`rename` renames it). */
export function slotMenu(d: SessionMenuDeps, ref: SlotRef, rename: () => void): MenuItem[] {
  const track = d.store.project.track(ref.track)!, clip = track.slots[ref.slot];
  if (track instanceof GroupTrack) return groupSlotItems(d, track, ref);
  if (!clip) return emptySlotItems(d, track, ref);
  const refs = d.selection.clips();
  if (refs.length > 1) return manyClipItems(d, refs, clip.color);
  return clipItems(d, track, ref, rename);
}

/** A scene's menu (`index` its row; `rename` renames it). */
export function sceneMenu(d: SessionMenuDeps, scene: Scene, index: number, rename: () => void): MenuItem[] {
  const { commands } = d, p = d.store.project;
  const only = p.scenes.length < 2;
  const hasClips = sceneClips(p, index).length > 0;
  return [
    { label: 'Launch the scene', run: () => d.engine.launchScene(index) },
    { label: 'Rename', shortcut: 'double click', run: rename },
    { colors: PALETTE, current: scene.color, pick: c => c !== scene.color && commands.apply(setSceneColor(scene.id, c)) },
    { label: 'Duplicate', run: () => commands.apply(duplicateScene(scene.id)) },
    { label: 'Capture and insert scene', shortcut: 'Ctrl+Shift+I', run: () => commands.captureAndInsertScene(index) },
    { label: 'Copy to the arrangement', disabled: !hasClips, run: () => d.sceneToArrangement(index) },
    { label: 'Export audio…', run: () => d.exportScene(index) },
    { label: 'Insert a scene above', run: () => commands.apply(insertScene(index)) },
    { label: 'Insert a scene below', run: () => commands.apply(insertScene(index + 1)) },
    SEPARATOR,
    { label: 'Delete the scene', disabled: only, run: () => commands.apply(deleteScene(scene.id)) },
  ];
}

/** The items a track's and a bus's header share: devices, paste, rename, colour. */
function chainItems(d: SessionMenuDeps, t: Track, devicesLabel: string, rename: () => void): MenuItem[] {
  return [
    { label: devicesLabel, run: () => d.openDevices(t.id) },
    ...addEffectItems(d.store, t.id, () => d.openDevices(t.id)),
    ...d.pasteDeviceItems(t.id),
    { label: 'Rename', shortcut: 'double click', run: rename },
    { colors: PALETTE, current: t.color, required: true, pick: c => c && d.commands.apply(setTrackColor(t.id, c)) },
  ];
}

/** A track's (or group's) header menu. */
export function trackHeadMenu(d: SessionMenuDeps, t: Track, rename: () => void): MenuItem[] {
  return [
    ...chainItems(d, t, t.kind === 'midi' ? 'Instrument and effects' : 'Effects', rename),
    SEPARATOR,
    ...groupMenuItems(d.store, d.ui, t),
    SEPARATOR,
    { label: t instanceof GroupTrack ? 'Delete the group and its tracks' : 'Delete track', run: () => d.commands.apply(removeTrack(t.id)) },
    SEPARATOR,
    ...newTrackHereItems(d.store, t),
  ];
}

/** A bus's header menu: like a track's, but a bus has no groups and collapses its column. */
export function busHeadMenu(d: SessionMenuDeps, b: BusTrack, rename: () => void): MenuItem[] {
  const { commands } = d;
  return [
    ...chainItems(d, b, 'Effects', rename),
    { label: b.folded ? 'Expand the bus' : 'Collapse the bus', run: () => commands.apply(setBusFolded(b.id, !b.folded)) },
    SEPARATOR,
    { label: 'Delete the bus', run: () => commands.apply(removeTrack(b.id)) },
    SEPARATOR,
    { label: 'New bus', run: () => commands.apply(addBus()) },
  ];
}
