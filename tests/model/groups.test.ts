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

/** Quattro tracce audio: a b c d. */
function four() {
  const r = setup({ audio: 4 });
  const [a, b, c, d] = [0, 1, 2, 3].map(r.track);
  const names = () => r.store.project.tracks.map(t => t.name);
  const parent = (id: TrackId) => r.store.project.track(id)!.group;
  /** Raggruppa e restituisce il gruppo nuovo. */
  const group = (ids: TrackId[]): TrackId => {
    const before = r.store.project;
    r.store.apply(groupTracks(ids));
    return r.store.project.tracks.find(t => !before.track(t.id))!.id;
  };
  return { ...r, a, b, c, d, names, parent, group };
}

describe('gruppi di tracce', () => {
  it('Ctrl+G: il gruppo prende il posto della prima traccia e le scelte lo seguono in ordine', () => {
    const r = four();
    const g = r.group([r.d, r.b]);
    expect(r.names()).toEqual(['1 Audio', '1 Gruppo', '2 Audio', '4 Audio', '3 Audio']);
    expect([r.b, r.d].map(r.parent)).toEqual([g, g]);
    expect(r.parent(r.c)).toBeNull();
    const group = r.store.project.track(g)!;
    expect(group.slots).toHaveLength(4);
    expect(r.store.project.trackBlock(g).map(t => t.name)).toEqual(['1 Gruppo', '2 Audio', '4 Audio']);
    expect(r.store.project.soundingTracks(g).map(t => t.id)).toEqual([r.b, r.d]);
  });

  it('gruppi dentro gruppi: una traccia scelta dentro un gruppo scelto va con il suo gruppo', () => {
    const r = four();
    const inner = r.group([r.b, r.c]);
    const outer = r.group([r.a, inner, r.c]);
    const p = r.store.project;
    expect(r.names()).toEqual(['2 Gruppo', '1 Audio', '1 Gruppo', '2 Audio', '3 Audio', '4 Audio']);
    expect(r.parent(inner)).toBe(outer);
    expect(r.parent(r.c)).toBe(inner);
    expect(p.groupsOf(r.c).map(g => g.id)).toEqual([inner, outer]);
    expect(p.soundingTracks(outer).map(t => t.id)).toEqual([r.a, r.b, r.c]);
    // una traccia dentro un gruppo, raggruppata con una fuori: il gruppo nuovo sta dentro il primo
    const third = r.group([r.c, r.d]);
    expect(r.parent(third)).toBe(inner);
    expect(r.parent(r.d)).toBe(third);
  });

  it('le tracce di un gruppo stanno di seguito, dopo il gruppo', () => {
    const r = four();
    const g = r.group([r.a, r.b]);
    const p = r.store.project;
    expect(() => p.updatingTrack(r.d, t => t.withGroup(g))).toThrow(/di seguito/);
    expect(() => p.updatingTrack(r.c, t => t.withGroup(r.a))).toThrow(/gruppo che non c'è/);
    expect(() => p.movingTrack(r.b, 3)).toThrow(/di seguito/);
    // un gruppo si sposta con le sue tracce
    expect(p.movingTrack(g, 2).tracks.map(t => t.name)).toEqual(['3 Audio', '4 Audio', '1 Gruppo', '1 Audio', '2 Audio']);
  });

  it('trascinata, una traccia entra nel gruppo dove la si lascia o ne esce', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    // prima di una traccia del gruppo: ci entra
    r.store.apply(moveTrack(r.d, { before: r.c }));
    expect(r.names()).toEqual(['1 Audio', '1 Gruppo', '2 Audio', '4 Audio', '3 Audio']);
    expect(r.parent(r.d)).toBe(g);
    // in cima al gruppo
    r.store.apply(moveTrack(r.a, { first: g }));
    expect(r.names()).toEqual(['1 Gruppo', '1 Audio', '2 Audio', '4 Audio', '3 Audio']);
    expect(r.parent(r.a)).toBe(g);
    // in fondo a tutte: fuori dai gruppi
    r.store.apply(moveTrack(r.b, { end: true }));
    expect(r.names()).toEqual(['1 Gruppo', '1 Audio', '4 Audio', '3 Audio', '2 Audio']);
    expect(r.parent(r.b)).toBeNull();
    // dopo il gruppo: dopo tutte le sue tracce, nel gruppo di lui (nessuno)
    r.store.apply(moveTrack(r.b, { before: g }));
    r.store.apply(moveTrack(r.b, { after: g }));
    expect(r.names()).toEqual(['1 Gruppo', '1 Audio', '4 Audio', '3 Audio', '2 Audio']);
    expect(r.parent(r.b)).toBeNull();
  });

  it('un gruppo trascinato porta con sé le sue tracce, ma non dentro sé stesso', () => {
    const r = four();
    const g = r.group([r.a, r.b]);
    r.store.apply(moveTrack(g, { after: r.d }));
    expect(r.names()).toEqual(['3 Audio', '4 Audio', '1 Gruppo', '1 Audio', '2 Audio']);
    expect([r.a, r.b].map(r.parent)).toEqual([g, g]);
    expect(() => r.store.apply(moveTrack(g, { before: r.b }))).toThrow();
    expect(() => r.store.apply(moveTrack(g, { first: g }))).toThrow();
    // lasciata dove già stava: niente da annullare
    const before = r.store.project;
    r.store.apply(moveTrack(r.c, { before: r.d }));
    expect(r.store.project).toBe(before);
    expect(r.store.undoLabel).toBe('Sposta traccia');
    r.store.undo();
    expect(r.names()).toEqual(['1 Gruppo', '1 Audio', '2 Audio', '3 Audio', '4 Audio']);
  });

  it('separare un gruppo lascia le tracce al loro posto; eliminarlo le elimina', () => {
    const r = four();
    const inner = r.group([r.b, r.c]);
    const outer = r.group([inner]);
    r.store.apply(ungroupTracks(inner));
    expect(r.names()).toEqual(['1 Audio', '2 Gruppo', '2 Audio', '3 Audio', '4 Audio']);
    expect([r.b, r.c].map(r.parent)).toEqual([outer, outer]);
    r.store.apply(removeTrack(outer));
    expect(r.names()).toEqual(['1 Audio', '4 Audio']);
    r.store.undo();
    r.store.undo();
    expect(r.store.project.track(inner)).toBeDefined();
  });

  it('chiuso, un gruppo nasconde le sue tracce (anche i gruppi dentro, con le loro)', () => {
    const r = four();
    const inner = r.group([r.b, r.c]);
    const outer = r.group([inner, r.d]);
    const visible = () => r.store.project.visibleTracks.map(t => t.name);
    r.store.apply(setGroupFolded(inner, true));
    expect(visible()).toEqual(['1 Audio', '2 Gruppo', '1 Gruppo', '4 Audio']);
    r.store.apply(setGroupFolded(outer, true));
    expect(visible()).toEqual(['1 Audio', '2 Gruppo']);
    r.store.apply(setGroupFolded(outer, false));
    expect(visible()).toEqual(['1 Audio', '2 Gruppo', '1 Gruppo', '4 Audio']);
  });

  it('una traccia nuova va dopo una traccia (nel suo gruppo) o in fondo a un gruppo', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    r.store.apply(addTrack('midi', { after: r.b }));
    r.store.apply(addTrack('midi', { inGroup: g }));
    r.store.apply(addTrack('midi', { after: g }));
    expect(r.names()).toEqual(['1 Audio', '1 Gruppo', '2 Audio', '1 MIDI', '3 Audio', '2 MIDI', '3 MIDI', '4 Audio']);
    expect(r.store.project.tracks.map(t => (t.group === g ? 'g' : '-')).join('')).toBe('--gggg--');
  });

  it("l'audio importato su un gruppo va in una traccia nuova in fondo al gruppo", () => {
    const r = four();
    const g = r.group([r.a, r.b]);
    r.store.apply(importSample(sampleRef(r.ids), g, 0));
    const added = r.store.project.tracks[3];
    expect(added.group).toBe(g);
    expect(added.arrangement).toHaveLength(1);
  });

  it('si salvano e si rileggono (gruppo, appartenenza, chiusura)', () => {
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

  it('un file con un gruppo che non viene prima delle sue tracce non si apre', () => {
    const r = four();
    r.store.apply(groupTracks([r.b]));
    const codec = new ProjectCodec();
    const json = JSON.parse(codec.stringify(r.store.project));
    json.tracks.push(json.tracks.splice(1, 1)[0]); // il gruppo in fondo
    expect(() => codec.decode(json)).toThrow(/gruppo che non c'è/);
  });
});

describe('gruppi nel mixer', () => {
  it('le tracce escono nel canale del gruppo, il gruppo nel master', () => {
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
    // separato il gruppo, tornano al master
    mixer.sync(r.store.project.ungroupingTrack(g));
    expect(b.output.outputs).toEqual([bus]);
    expect(group.disposed).toBe(true);
  });

  it('solo e mute come in Live', () => {
    const r = four();
    const g = r.group([r.b, r.c]);
    const open = () => audibleTracks(r.store.project.tracks);
    // il solo di una traccia del gruppo lascia aperto il gruppo (ci passa il suo suono), non le altre
    r.store.apply(setMixer(r.b, { solo: true }));
    expect(open()).toEqual(new Set([g, r.b]));
    // il solo del gruppo vale per tutte le sue tracce
    r.store.apply(setMixer(r.b, { solo: false }));
    r.store.apply(setMixer(g, { solo: true }));
    expect(open()).toEqual(new Set([g, r.b, r.c]));
    // il mute del gruppo chiude il suo canale: le tracce restano aperte ma passano di lì
    r.store.apply(setMixer(g, { solo: false, mute: true }));
    expect(open()).toEqual(new Set([r.a, r.b, r.c, r.d]));
  });
});

it('un progetto senza gruppi resta com\'era (tracce visibili = tracce)', () => {
  const r = setup({ audio: 2 });
  const p: Project = r.store.project;
  expect(p.visibleTracks).toEqual(p.tracks);
  expect(p.tracks.every(t => t instanceof AudioTrack && t.group === null)).toBe(true);
});
