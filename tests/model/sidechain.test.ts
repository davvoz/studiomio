import { describe, expect, it } from 'vitest';
import type { DeviceId, TrackId } from '../../src/core/id';
import { MixerGraph } from '../../src/engine/mixer-graph';
import { MASTER, type ChainOwner } from '../../src/model/project';
import { sidechainLinks, sidechainSources } from '../../src/model/sidechain';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, groupTracks, removeEffect, removeTrack, setEffectParam, setEffectSidechain } from '../../src/store/edits';
import { FakeEffects, FakeGraph } from '../helpers/fake-audio';
import { setup } from '../helpers/fixtures';

/** Three audio tracks (kick, bass, pad) with a compressor each. */
function rig() {
  const r = setup({ audio: 3 });
  const [kick, bass, pad] = [0, 1, 2].map(r.track);
  const comp = (owner: ChainOwner): DeviceId => {
    r.store.apply(addEffect(owner, 'compressor', 'Compressor'));
    return r.store.project.effectsOf(owner).at(-1)!.id;
  };
  const c = { kick: comp(kick), bass: comp(bass), pad: comp(pad) };
  const key = (owner: ChainOwner, device: DeviceId, source: TrackId | null) => r.store.apply(setEffectSidechain(owner, device, source));
  const links = () => sidechainLinks(r.store.project);
  return { ...r, kick, bass, pad, c, comp, key, links };
}

describe('sidechain in the model', () => {
  it('the bass compressor listens to the kick; without a choice it listens to itself', () => {
    const r = rig();
    expect(r.links()).toEqual([]);
    r.key(r.bass, r.c.bass, r.kick);
    expect(r.store.project.effectsOf(r.bass)[0].sidechain).toBe(r.kick);
    expect(r.links()).toEqual([{ owner: r.bass, device: r.c.bass, source: r.kick }]);
    r.key(r.bass, r.c.bass, null);
    expect(r.store.project.effectsOf(r.bass)[0]).not.toHaveProperty('sidechain');
    expect(r.links()).toEqual([]);
  });

  it('no loops: not itself, not each other, not the group containing it', () => {
    const r = rig();
    // A listens to B and B listens to A (the menu doesn't offer it, but a file can have it): the track
    // coming first wins, the other hears nothing
    r.key(r.bass, r.c.bass, r.kick);
    r.key(r.kick, r.c.kick, r.bass);
    expect(r.links().map(l => l.owner)).toEqual([r.kick]);
    expect(sidechainSources(r.store.project, r.kick, r.c.kick)).toEqual([r.pad]);
    // ...going through a third: kick → bass → pad → kick
    r.key(r.kick, r.c.kick, null);
    r.key(r.pad, r.c.pad, r.bass);
    expect(sidechainSources(r.store.project, r.kick, r.c.kick)).toEqual([]);
    // itself never; the choice of the effect itself doesn't count (it can be changed)
    expect(sidechainSources(r.store.project, r.bass, r.c.bass)).toEqual([r.kick]);
  });

  it('groups: the group listens to one of its tracks, not the opposite', () => {
    const r = rig();
    const before = r.store.project;
    r.store.apply(groupTracks([r.kick, r.bass]));
    const group = r.store.project.tracks.find(t => !before.track(t.id))!.id;
    const onGroup = r.comp(group);
    expect(sidechainSources(r.store.project, group, onGroup)).toEqual([r.kick, r.bass, r.pad]);
    expect(sidechainSources(r.store.project, r.bass, r.c.bass)).toEqual([r.kick, r.pad]);
    r.key(r.bass, r.c.bass, group);
    expect(r.links()).toEqual([]);
  });

  it('the master can listen to any track', () => {
    const r = rig();
    const onMaster = r.comp(MASTER);
    expect(sidechainSources(r.store.project, MASTER, onMaster)).toEqual([r.kick, r.bass, r.pad]);
    r.key(MASTER, onMaster, r.kick);
    expect(r.links()).toEqual([{ owner: MASTER, device: onMaster, source: r.kick }]);
  });

  it('removing the listened track: whoever listened to it goes back to listening to itself', () => {
    const r = rig();
    const onMaster = r.comp(MASTER);
    r.key(r.bass, r.c.bass, r.kick);
    r.key(MASTER, onMaster, r.kick);
    r.key(r.pad, r.c.pad, r.bass);
    r.store.apply(removeTrack(r.kick));
    const p = r.store.project;
    expect(p.effectsOf(r.bass)[0]).not.toHaveProperty('sidechain');
    expect(p.masterEffects[0]).not.toHaveProperty('sidechain');
    expect(p.effectsOf(r.pad)[0].sidechain).toBe(r.bass);
    // and with undo everything goes back as it was
    r.store.undo();
    expect(r.store.project.effectsOf(r.bass)[0].sidechain).toBe(r.kick);
  });
});

describe('sidechain in the file', () => {
  const codec = new ProjectCodec();

  it('it\'s saved and reopened; without sidechain the field isn\'t there', () => {
    const r = rig();
    r.key(r.bass, r.c.bass, r.kick);
    const text = codec.stringify(r.store.project);
    const json = JSON.parse(text);
    expect(json.tracks[1].effects[0].sidechain).toBe(r.kick);
    expect(json.tracks[0].effects[0]).not.toHaveProperty('sidechain');
    const back = codec.parse(text);
    expect(back.effectsOf(r.bass)[0].sidechain).toBe(r.kick);
    expect(codec.stringify(back)).toBe(text);
  });

  it('a version 9 project (before the sidechain) opens identical', () => {
    const r = rig();
    r.store.apply(setEffectParam(r.bass, r.c.bass, 'threshold', -30));
    const json = JSON.parse(codec.stringify(r.store.project));
    json.version = 9;
    const p = codec.decode(json);
    expect(p.tracks.map(t => t.effects)).toEqual(r.store.project.tracks.map(t => t.effects));
    expect(p.tracks.flatMap(t => t.effects).some(e => 'sidechain' in e)).toBe(false);
    expect(sidechainLinks(p)).toEqual([]);
  });
});

describe('sidechain in the mixer', () => {
  /** A channel's listening point: after the effects, before the volume. */
  const tapOf = (mixer: MixerGraph, id: TrackId) => (mixer as unknown as { strips: Map<TrackId, { tap: unknown }> }).strips.get(id)!.tap;

  it('connects the kick\'s sound (after its effects) to the detector of the bass compressor', () => {
    const r = rig();
    const graph = new FakeGraph(), host = new FakeEffects();
    const mixer = new MixerGraph(graph, host);
    mixer.sync(r.store.project);
    const sc = (owner: ChainOwner, id: DeviceId) => host.created.find(e => mixer.effect(owner, id) === e)!.sidechain!;
    const tap = (id: TrackId) => tapOf(mixer, id) as { outputs: unknown[] };
    const kickEffect = mixer.effect(r.kick, r.c.kick)!;
    // without sidechain from the listening point it goes only to the volume
    expect(tap(r.kick).outputs).toHaveLength(1);

    r.key(r.bass, r.c.bass, r.kick);
    mixer.sync(r.store.project);
    expect(tap(r.kick).outputs).toContain(sc(r.bass, r.c.bass));
    // the output of the kick's effects reaches the listening point
    expect((kickEffect.output as unknown as { outputs: unknown[] }).outputs).toEqual([tapOf(mixer, r.kick)]);

    // another source: it detaches from the kick and attaches to the pad
    r.key(r.bass, r.c.bass, r.pad);
    mixer.sync(r.store.project);
    expect(tap(r.kick).outputs).toHaveLength(1);
    expect(tap(r.pad).outputs).toContain(sc(r.bass, r.c.bass));

    // any update doesn't reconnect
    r.store.apply(setEffectParam(r.bass, r.c.bass, 'ratio', 8));
    mixer.sync(r.store.project);
    expect(tap(r.pad).outputs.filter(o => o === sc(r.bass, r.c.bass))).toHaveLength(1);

    // the listened track goes away: no errors, no connections
    r.store.apply(removeTrack(r.pad));
    expect(() => mixer.sync(r.store.project)).not.toThrow();
    expect(r.links()).toEqual([]);
  });

  it('the compressor removed and put back: the connection goes to the new one', () => {
    const r = rig();
    const graph = new FakeGraph(), host = new FakeEffects();
    const mixer = new MixerGraph(graph, host);
    const onMaster = r.comp(MASTER);
    r.key(MASTER, onMaster, r.kick);
    mixer.sync(r.store.project);
    const tap = tapOf(mixer, r.kick) as { outputs: unknown[] };
    const first = mixer.effect(MASTER, onMaster)!.sidechain;
    expect(tap.outputs).toContain(first);
    r.store.apply(removeEffect(MASTER, onMaster));
    mixer.sync(r.store.project);
    expect(tap.outputs).not.toContain(first);
    expect(tap.outputs).toHaveLength(1);
  });

  it('a loop isn\'t connected', () => {
    const r = rig();
    const graph = new FakeGraph(), host = new FakeEffects();
    const mixer = new MixerGraph(graph, host);
    r.key(r.bass, r.c.bass, r.bass);
    mixer.sync(r.store.project);
    expect((tapOf(mixer, r.bass) as { outputs: unknown[] }).outputs).toHaveLength(1);
  });
});
