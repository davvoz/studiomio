/* Track groups from the interface: Ctrl+G, Ctrl+Shift+G and the items of the track menus,
 * the same in the arrangement and in the session. */
import { GroupTrack, type Track } from '../model/track';
import { addTrack, groupTracks, setGroupFolded, ungroupTracks, type TrackPlace } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { MenuItem } from './context-menu';
import type { UiState } from './ui-state';

/** Groups the chosen tracks and chooses the new group; false if no track is chosen. */
export function groupSelectedTracks(store: ProjectStore, ui: UiState): boolean {
  const chosen = [...ui.selectedTracks].filter(id => store.project.track(id));
  if (!chosen.length) return false;
  const before = store.project;
  store.apply(groupTracks(chosen));
  const group = store.project.tracks.find(t => !before.track(t.id));
  if (group) ui.selectTrack(group.id);
  return true;
}

/** The group Ctrl+Shift+G ungroups: the chosen track if it's a group, otherwise its group. */
export function groupToUngroup(store: ProjectStore, ui: UiState): GroupTrack | null {
  const t = ui.track ? store.project.track(ui.track) : undefined;
  if (!t) return null;
  if (t instanceof GroupTrack) return t;
  const parent = t.group ? store.project.track(t.group) : undefined;
  return parent instanceof GroupTrack ? parent : null;
}

/** Ungroups the group (see `groupToUngroup`) and chooses its first track; false if there isn't one. */
export function ungroupSelectedTrack(store: ProjectStore, ui: UiState): boolean {
  const g = groupToUngroup(store, ui);
  if (!g) return false;
  const first = store.project.trackBlock(g.id)[1];
  store.apply(ungroupTracks(g.id));
  ui.selectTrack(first?.id ?? null);
  return true;
}

export const toggleFold = (store: ProjectStore, group: GroupTrack): void => {
  store.apply(setGroupFolded(group.id, !group.folded));
};

/** The group items in a track's menu (the selection already includes the track). */
export function groupMenuItems(store: ProjectStore, ui: UiState, t: Track): MenuItem[] {
  const many = ui.selectedTracks.size > 1;
  const items: MenuItem[] = [
    { label: many ? `Group the ${ui.selectedTracks.size} tracks` : 'Group', shortcut: 'Ctrl+G', run: () => groupSelectedTracks(store, ui) },
  ];
  if (t instanceof GroupTrack) {
    items.push(
      { label: t.folded ? 'Open the group' : 'Close the group', run: () => toggleFold(store, t) },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', run: () => { ui.selectTrack(t.id); ungroupSelectedTrack(store, ui); } },
    );
  }
  return items;
}

/** The items for new tracks in a track's menu: after it (in its group) and, for a
 *  group, also at the end of the group. */
export function newTrackHereItems(store: ProjectStore, t: Track): MenuItem[] {
  const add = (label: string, place: TrackPlace): MenuItem[] => [
    { label: `New audio track ${label}`, run: () => store.apply(addTrack('audio', place)) },
    { label: `New MIDI track ${label}`, run: () => store.apply(addTrack('midi', place)) },
  ];
  return [
    ...(t instanceof GroupTrack ? add('in the group', { inGroup: t.id }) : []),
    ...add(t instanceof GroupTrack ? 'after the group' : 'below', { after: t.id }),
  ];
}

