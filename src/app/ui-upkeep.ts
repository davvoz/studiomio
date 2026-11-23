/* The interface's choices kept valid when the project changes: deleted clips leave the selection,
 * removed tracks leave the armed ones, a deleted track is no longer the chosen one, and a track
 * hidden in a closed group passes the choice to the visible group. */
import type { Project } from '../model/project';
import { BusTrack } from '../model/track';
import type { UiState } from '../ui/ui-state';

export function keepUiInProject(p: Project, ui: UiState): void {
  const alive = new Set(p.tracks.flatMap(t => t.arrangement.map(x => x.id)));
  if ([...ui.selection].some(id => !alive.has(id))) ui.select([...ui.selection].filter(id => alive.has(id)));
  ui.keepKeyboardTracks(id => !!p.track(id));
  const chosen = ui.track;
  if (!chosen) return;
  if (!p.track(chosen)) ui.selectTrack(null);
  else if (!(p.track(chosen) instanceof BusTrack) && !p.visibleTracks.some(t => t.id === chosen)) {
    ui.selectTrack(p.groupsOf(chosen).findLast(g => g.folded)?.id ?? null);
  }
}
