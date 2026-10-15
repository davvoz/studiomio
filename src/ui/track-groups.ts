/* I gruppi di tracce dall'interfaccia: Ctrl+G, Ctrl+Maiusc+G e le voci dei menu delle tracce,
 * uguali nell'arrangement e nella session. */
import type { TrackId } from '../core/id';
import { GroupTrack, type Track } from '../model/track';
import { addTrack, groupTracks, setGroupFolded, ungroupTracks, type TrackPlace } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { MenuItem } from './context-menu';
import type { UiState } from './ui-state';

/** Raggruppa le tracce scelte e sceglie il gruppo nuovo; false se non c'è nessuna traccia scelta. */
export function groupSelectedTracks(store: ProjectStore, ui: UiState): boolean {
  const chosen = [...ui.selectedTracks].filter(id => store.project.track(id));
  if (!chosen.length) return false;
  const before = store.project;
  store.apply(groupTracks(chosen));
  const group = store.project.tracks.find(t => !before.track(t.id));
  if (group) ui.selectTrack(group.id);
  return true;
}

/** Il gruppo che Ctrl+Maiusc+G separa: la traccia scelta se è un gruppo, se no il suo gruppo. */
export function groupToUngroup(store: ProjectStore, ui: UiState): GroupTrack | null {
  const t = ui.track ? store.project.track(ui.track) : undefined;
  if (!t) return null;
  if (t instanceof GroupTrack) return t;
  const parent = t.group ? store.project.track(t.group) : undefined;
  return parent instanceof GroupTrack ? parent : null;
}

/** Separa il gruppo (vedi `groupToUngroup`) e sceglie la sua prima traccia; false se non ce n'è. */
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

/** Le voci dei gruppi nel menu di una traccia (la scelta comprende già la traccia). */
export function groupMenuItems(store: ProjectStore, ui: UiState, t: Track): MenuItem[] {
  const many = ui.selectedTracks.size > 1;
  const items: MenuItem[] = [
    { label: many ? `Raggruppa le ${ui.selectedTracks.size} tracce` : 'Raggruppa', shortcut: 'Ctrl+G', run: () => groupSelectedTracks(store, ui) },
  ];
  if (t instanceof GroupTrack) {
    items.push(
      { label: t.folded ? 'Apri il gruppo' : 'Chiudi il gruppo', run: () => toggleFold(store, t) },
      { label: 'Separa il gruppo', shortcut: 'Ctrl+Maiusc+G', run: () => { ui.selectTrack(t.id); ungroupSelectedTrack(store, ui); } },
    );
  }
  return items;
}

/** Le voci per le tracce nuove nel menu di una traccia: dopo di lei (nel suo gruppo) e, per un
 *  gruppo, anche in fondo al gruppo. */
export function newTrackHereItems(store: ProjectStore, t: Track): MenuItem[] {
  const add = (label: string, place: TrackPlace): MenuItem[] => [
    { label: `Nuova traccia audio ${label}`, run: () => store.apply(addTrack('audio', place)) },
    { label: `Nuova traccia MIDI ${label}`, run: () => store.apply(addTrack('midi', place)) },
  ];
  return [
    ...(t instanceof GroupTrack ? add('nel gruppo', { inGroup: t.id }) : []),
    ...add(t instanceof GroupTrack ? 'dopo il gruppo' : 'qui sotto', { after: t.id }),
  ];
}

/** Quanti livelli di gruppo contengono la traccia (0: nessuno). */
export const groupDepth = (store: ProjectStore, id: TrackId): number => store.project.groupsOf(id).length;
