import { describe, expect, it } from 'vitest';
import type { TrackId } from '../../src/core/id';
import { audibleTracks, MixerGraph } from '../../src/engine/mixer-graph';
import { Project } from '../../src/model/project';
import { AudioTrack, GroupTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { importSample } from '../../src/store/selection-edits';
import { addTrack, groupTracks, moveTrack, removeTrack, setGroupFolded, setMixer, ungroupTracks } from '../../src/store/edits';
import { FakeEffects, FakeGraph, FakeMeters } from '../helpers/fake-audio';
import { sampleRef, setup } from '../helpers/fixtures';

/** Four audio tracks: a b c d. */
function four() {
  const r = setup({ audio: 4 });
  const [a, b, c, d] = [0, 1, 2, 3].map(r.track);
  const names = () => r.store.project.tracks.map(t => t.name);
  const parent = (id: TrackId) => r.store.project.track(id)!.group;
  /** Groups and returns the new group. */
  const group = (ids: TrackId[]): TrackId => {
    const before = r.store.project;
    r.store.apply(groupTracks(ids));
    return r.store.project.tracks.find(t => !before.track(t.id))!.id;
  };
  return { ...r, a, b, c, d, names, parent, group };
}

describe('track groups', () => {
  it('Ctrl+G: the group takes the place of the first track and the chosen ones follow it in order', () => {
    const r = four();
    const g = r.group([r.d, r.b]);
    expect(r.names()).toEqual(['1 Audio', '1 Group', '2 Audio', '4 Audio', '3 Audio']);
    expect([r.b, r.d].map(r.parent)).toEqual([g, g]);
    expect(r.parent(r.c)).toBeNull();
    const group = r.store.project.track(g)!;
    expect(group.slots).toHaveLength(4);
    expect(r.store.project.trackBlock(g).map(t => t.name)).toEqual(['1 Group', '2 Audio', '4 Audio']);
    expect(r.store.project.soundingTracks(g).map(t => t.id)).toEqual([r.b, r.d]);
  });

  it('groups inside groups: a track chosen inside a chosen group goes with its group', () => {
    const r = four();
    const inner = r.group([r.b, r.c]);
    const outer = r.group([r.a, inner, r.c]);
    const p = r.store.project;
    expect(r.names()).toEqual(['2 Group', '1 Audio', '1 Group', '2 Audio', '3 Audio', '4 Audio']);
    expect(r.parent(inner)).toBe(outer);
    expect(r.parent(r.c)).toBe(inner);
    expect(p.groupsOf(r.c).map(g => g.id)).toEqual([inner, outer]);
    expect(p.soundingTracks(outer).map(t => t.id)).toEqual([r.a, r.b, r.c]);
    // a track inside a group, grouped with one outside: the new group sits inside the first
    const third = r.group([r.c, r.d]);
    expect(r.parent(third)).toBe(inner);
    expect(r.parent(r.d)).toBe(third);
  });

  it('the tracks of a group follow each other, after the group', () => {
    const r = four();
    const g = r.group([r.a, r.b]);
    const p = r.store.project;
    expect(() => p.updatingTrack(r.d, t => t.withGroup(g))).toThrow(/doesn't follow/);
    expect(() => p.updatingTrack(r.c, t => t.withGroup(r.a))).toThrow(/group that doesn't exist/);
    expect(() => p.movingTrack(r.b, 3)).toThrow(/doesn't follow the others/);
    // a group moves with its tracks
    expect(p.movingTrack(g, 2).tracks.map(t => t.name)).toEqual(['3 Audio', '4 Audio', '1 Group', '1 Audio', '2 Audio']);
  });

  it('dragged, a track enters the group where it\'s dropped or leaves it', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    // before a track of the group: it enters it
    r.store.apply(moveTrack(r.d, { before: r.c }));
    expect(r.names()).toEqual(['1 Audio', '1 Group', '2 Audio', '4 Audio', '3 Audio']);
    expect(r.parent(r.d)).toBe(g);
    // at the top of the group
    r.store.apply(moveTrack(r.a, { first: g }));
    expect(r.names()).toEqual(['1 Group', '1 Audio', '2 Audio', '4 Audio', '3 Audio']);
    expect(r.parent(r.a)).toBe(g);
    // at the end of all: outside the groups
    r.store.apply(moveTrack(r.b, { end: true }));
    expect(r.names()).toEqual(['1 Group', '1 Audio', '4 Audio', '3 Audio', '2 Audio']);
    expect(r.parent(r.b)).toBeNull();
    // after the group: after all its tracks, in its group (none)
    r.store.apply(moveTrack(r.b, { before: g }));
    r.store.apply(moveTrack(r.b, { after: g }));
    expect(r.names()).toEqual(['1 Group', '1 Audio', '4 Audio', '3 Audio', '2 Audio']);
    expect(r.parent(r.b)).toBeNull();
  });

  it('a dragged group carries its tracks along, but not inside itself', () => {
    const r = four();
    const g = r.group([r.a, r.b]);
    r.store.apply(moveTrack(g, { after: r.d }));
    expect(r.names()).toEqual(['3 Audio', '4 Audio', '1 Group', '1 Audio', '2 Audio']);
    expect([r.a, r.b].map(r.parent)).toEqual([g, g]);
    expect(() => r.store.apply(moveTrack(g, { before: r.b }))).toThrow();
    expect(() => r.store.apply(moveTrack(g, { first: g }))).toThrow();
    // dropped where it already was: nothing to undo
    const before = r.store.project;
    r.store.apply(moveTrack(r.c, { before: r.d }));
    expect(r.store.project).toBe(before);
    expect(r.store.undoLabel).toBe('Move track');
    r.store.undo();
    expect(r.names()).toEqual(['1 Group', '1 Audio', '2 Audio', '3 Audio', '4 Audio']);
  });

  it('ungrouping a group leaves the tracks in their place; deleting it deletes them', () => {
    const r = four();
    const inner = r.group([r.b, r.c]);
    const outer = r.group([inner]);
    r.store.apply(ungroupTracks(inner));
    expect(r.names()).toEqual(['1 Audio', '2 Group', '2 Audio', '3 Audio', '4 Audio']);
    expect([r.b, r.c].map(r.parent)).toEqual([outer, outer]);
    r.store.apply(removeTrack(outer));
    expect(r.names()).toEqual(['1 Audio', '4 Audio']);
    r.store.undo();
    r.store.undo();
    expect(r.store.project.track(inner)).toBeDefined();
  });

  it('closed, a group hides its tracks (also the groups inside, with theirs)', () => {
    const r = four();
    const inner = r.group([r.b, r.c]);
    const outer = r.group([inner, r.d]);
    const visible = () => r.store.project.visibleTracks.map(t => t.name);
    r.store.apply(setGroupFolded(inner, true));
    expect(visible()).toEqual(['1 Audio', '2 Group', '1 Group', '4 Audio']);
    r.store.apply(setGroupFolded(outer, true));
    expect(visible()).toEqual(['1 Audio', '2 Group']);
    r.store.apply(setGroupFolded(outer, false));
    expect(visible()).toEqual(['1 Audio', '2 Group', '1 Group', '4 Audio']);
  });

  it('a new track goes after a track (in its group) or at the end of a group', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    r.store.apply(addTrack('midi', { after: r.b }));
    r.store.apply(addTrack('midi', { inGroup: g }));
    r.store.apply(addTrack('midi', { after: g }));
    expect(r.names()).toEqual(['1 Audio', '1 Group', '2 Audio', '1 MIDI', '3 Audio', '2 MIDI', '3 MIDI', '4 Audio']);
    expect(r.store.project.tracks.map(t => (t.group === g ? 'g' : '-')).join('')).toBe('--gggg--');
  });

  it("the audio imported on a group goes into a new track at the end of the group", () => {
    const r = four();
    const g = r.group([r.a, r.b]);
    r.store.apply(importSample(sampleRef(r.ids), g, 0));
    const added = r.store.project.tracks[3];
    expect(added.group).toBe(g);
    expect(added.arrangement).toHaveLength(1);
  });

  it('they are saved and read back (group, membership, closing)', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    r.store.apply(setGroupFolded(g, true));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(r.store.project));
    expect(back.tracks.map(t => [t.kind, t.group])).toEqual([['audio', null], ['group', null], ['audio', g], ['audio', g], ['audio', null]]);
    expect((back.track(g) as GroupTrack).folded).toBe(true);
    expect(back.visibleTracks).toHaveLength(3);
    expect(codec.stringify(back)).toBe(codec.stringify(r.store.project));
  });

  it('a file with a group not coming before its tracks doesn\'t open', () => {
    const r = four();
    r.store.apply(groupTracks([r.b]));
    const codec = new ProjectCodec();
    const json = JSON.parse(codec.stringify(r.store.project));
    json.tracks.push(json.tracks.splice(1, 1)[0]); // the group at the end
    expect(() => codec.decode(json)).toThrow(/group that doesn't exist/);
  });
});

describe('groups in the mixer', () => {
  it('the tracks go out into the group\'s channel, the group into the master', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    const graph = new FakeGraph(), meters = new FakeMeters();
    const mixer = new MixerGraph(graph, new FakeEffects(), graph.destination, meters);
    mixer.sync(r.store.project);
    const [, a, group, b, c] = meters.created;
    const bus = graph.gains[0];
    expect(a.output.outputs).toEqual([bus]);
    expect(group.output.outputs).toEqual([bus]);
    expect(b.output.outputs).toEqual([mixer.input(g)]);
    expect(c.output.outputs).toEqual([mixer.input(g)]);
    // the group ungrouped, they go back to the master
    mixer.sync(r.store.project.ungroupingTrack(g));
    expect(b.output.outputs).toEqual([bus]);
    expect(group.disposed).toBe(true);
  });

  it('solo and mute as in Live', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    const open = () => audibleTracks(r.store.project.tracks);
    // the solo of a track of the group leaves the group open (its sound passes through it), not the others
    r.store.apply(setMixer(r.b, { solo: true }));
    expect(open()).toEqual(new Set([g, r.b]));
    // the group's solo applies to all its tracks
    r.store.apply(setMixer(r.b, { solo: false }));
    r.store.apply(setMixer(g, { solo: true }));
    expect(open()).toEqual(new Set([g, r.b, r.c]));
    // the group's mute closes its channel: the tracks stay open but pass through it
    r.store.apply(setMixer(g, { solo: false, mute: true }));
    expect(open()).toEqual(new Set([r.a, r.b, r.c, r.d]));
  });
});

it('a project without groups stays as it was (visible tracks = tracks)', () => {
  const r = setup({ audio: 2 });
  const p: Project = r.store.project;
  expect(p.visibleTracks).toEqual(p.tracks);
  expect(p.tracks.every(t => t instanceof AudioTrack && t.group === null)).toBe(true);
});
