import { describe, expect, it } from 'vitest';
import type { TrackId } from '../../src/core/id';
import { addMidiClip, groupTracks, setGroupFolded } from '../../src/store/edits';
import { copyClips, pasteClips } from '../../src/store/clipboard';
import { hitTest, TimelineGeometry } from '../../src/ui/timeline/geometry';
import { planMove } from '../../src/ui/timeline/planning';
import { groupSelectedTracks, groupToUngroup, ungroupSelectedTrack } from '../../src/ui/track-groups';
import { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

/** m0 [group: m1 m2] m3, all MIDI, with a 4-beat clip on m0. */
function rig() {
  const r = setup({ midi: 4 });
  const [m0, m1, m2, m3] = [0, 1, 2, 3].map(r.track);
  r.store.apply(addMidiClip(m0, 0, 4));
  r.store.apply(groupTracks([m1, m2]));
  const g = r.store.project.tracks[1].id;
  const clip = r.store.project.tracks[0].arrangement[0];
  return { ...r, m0, m1, m2, m3, g, clip };
}

describe('groups in the timeline', () => {
  it('the rows are the visible tracks: the group closed, its tracks disappear', () => {
    const r = rig();
    const geo = new TimelineGeometry(24, 0, 0, 72);
    const row = (i: number) => hitTest(r.store.project, geo, 10, i * 72 + 30);
    expect(row(1)).toMatchObject({ kind: 'lane', track: r.g });
    expect(row(4)).toMatchObject({ kind: 'lane', track: r.m3 });
    r.store.apply(setGroupFolded(r.g, true));
    expect(row(2)).toMatchObject({ kind: 'lane', track: r.m3 });
    expect(row(3)).toMatchObject({ kind: 'empty' });
  });

  it('a clip doesn\'t go on a group\'s row, but it does on its tracks and past a closed group', () => {
    const r = rig();
    const ref = [{ track: r.m0, id: r.clip.id }];
    expect(planMove(r.store.project, ref, 0, 1, false)[0].to).toBe(r.m0); // row 1 is the group: it stays where it is
    expect(planMove(r.store.project, ref, 0, 2, false)[0].to).toBe(r.m1);
    r.store.apply(setGroupFolded(r.g, true));
    expect(planMove(r.store.project, ref, 0, 2, false)[0].to).toBe(r.m3);
  });

  it('copy and paste count the visible rows', () => {
    const r = rig();
    r.store.apply(setGroupFolded(r.g, true));
    const copied = copyClips(r.store.project, [{ track: r.m0, id: r.clip.id }])!;
    r.store.apply(pasteClips(copied, 2, 8)); // row 2 = m3
    expect(r.store.project.track(r.m3)!.arrangement).toHaveLength(1);
  });
});

describe('choosing several tracks and Ctrl+G', () => {
  it('Shift chooses a range, Ctrl adds and removes; Ctrl+G groups and chooses the group', () => {
    const r = setup({ audio: 4 });
    const ui = new UiState();
    const order = r.store.project.tracks.map(t => t.id), t = (i: number) => order[i];
    ui.selectTrack(t(1));
    ui.extendTrackSelection(t(3), 'range', order);
    expect([...ui.selectedTracks]).toEqual([t(1), t(2), t(3)]);
    ui.extendTrackSelection(t(2), 'toggle', order);
    expect([...ui.selectedTracks]).toEqual([t(1), t(3)]);
    expect(groupSelectedTracks(r.store, ui)).toBe(true);
    const g = ui.track as TrackId;
    expect(r.store.project.trackBlock(g).map(t => t.id)).toEqual([g, t(1), t(3)]);
    expect(ui.selectedTracks).toEqual(new Set([g]));
    // Ctrl+Shift+G from a track of the group ungroups its group
    ui.selectTrack(t(3));
    expect(groupToUngroup(r.store, ui)?.id).toBe(g);
    expect(ungroupSelectedTrack(r.store, ui)).toBe(true);
    expect(r.store.project.track(g)).toBeUndefined();
    expect(ui.track).toBe(t(1));
  });
});
