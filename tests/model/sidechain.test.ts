import { describe, expect, it } from 'vitest';
import type { DeviceId, TrackId } from '../../src/core/id';
import { MixerGraph } from '../../src/engine/mixer-graph';
import { MASTER, type ChainOwner } from '../../src/model/project';
import { sidechainLinks, sidechainSources } from '../../src/model/sidechain';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, groupTracks, removeEffect, removeTrack, setEffectParam, setEffectSidechain } from '../../src/store/edits';
import { FakeEffects, FakeGraph } from '../helpers/fake-audio';
import { setup } from '../helpers/fixtures';

/** Tre tracce audio (cassa, basso, pad) con un compressore ciascuna. */
function rig() {
  const r = setup({ audio: 3 });
  const [kick, bass, pad] = [0, 1, 2].map(r.track);
  const comp = (owner: ChainOwner): DeviceId => {
    r.store.apply(addEffect(owner, 'compressor', 'Compressore'));
    return r.store.project.effectsOf(owner).at(-1)!.id;
  };
  const c = { kick: comp(kick), bass: comp(bass), pad: comp(pad) };
  const key = (owner: ChainOwner, device: DeviceId, source: TrackId | null) => r.store.apply(setEffectSidechain(owner, device, source));
  const links = () => sidechainLinks(r.store.project);
  return { ...r, kick, bass, pad, c, comp, key, links };
}

describe('sidechain nel modello', () => {
  it('il compressore del basso ascolta la cassa; senza scelta ascolta sé stesso', () => {
    const r = rig();
    expect(r.links()).toEqual([]);
    r.key(r.bass, r.c.bass, r.kick);
    expect(r.store.project.effectsOf(r.bass)[0].sidechain).toBe(r.kick);
    expect(r.links()).toEqual([{ owner: r.bass, device: r.c.bass, source: r.kick }]);
    r.key(r.bass, r.c.bass, null);
    expect(r.store.project.effectsOf(r.bass)[0]).not.toHaveProperty('sidechain');
    expect(r.links()).toEqual([]);
  });

  it('niente anelli: non sé stessa, non a vicenda, non il gruppo che la contiene', () => {
    const r = rig();
    // A ascolta B e B ascolta A (il menu non lo offre, ma un file può averlo): vince la traccia
    // che viene prima, l'altra non sente niente
    r.key(r.bass, r.c.bass, r.kick);
    r.key(r.kick, r.c.kick, r.bass);
    expect(r.links().map(l => l.owner)).toEqual([r.kick]);
    expect(sidechainSources(r.store.project, r.kick, r.c.kick)).toEqual([r.pad]);
    // ...passando per un terzo: cassa → basso → pad → cassa
    r.key(r.kick, r.c.kick, null);
    r.key(r.pad, r.c.pad, r.bass);
    expect(sidechainSources(r.store.project, r.kick, r.c.kick)).toEqual([]);
    // sé stessa mai; la scelta dell'effetto stesso non conta (si può cambiare)
    expect(sidechainSources(r.store.project, r.bass, r.c.bass)).toEqual([r.kick]);
  });

  it('gruppi: il gruppo ascolta una sua traccia, non il contrario', () => {
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

  it('il master può ascoltare qualunque traccia', () => {
    const r = rig();
    const onMaster = r.comp(MASTER);
    expect(sidechainSources(r.store.project, MASTER, onMaster)).toEqual([r.kick, r.bass, r.pad]);
    r.key(MASTER, onMaster, r.kick);
    expect(r.links()).toEqual([{ owner: MASTER, device: onMaster, source: r.kick }]);
  });

  it('togliere la traccia ascoltata: chi la ascoltava torna ad ascoltare sé stesso', () => {
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
    // e con annulla torna tutto com'era
    r.store.undo();
    expect(r.store.project.effectsOf(r.bass)[0].sidechain).toBe(r.kick);
  });
});

describe('sidechain nel file', () => {
  const codec = new ProjectCodec();

  it('si salva e si riapre; senza sidechain il campo non c\'è', () => {
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

  it('un progetto della versione 9 (prima del sidechain) si apre identico', () => {
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

describe('sidechain nel mixer', () => {
  /** Il punto di ascolto di un canale: dopo gli effetti, prima del volume. */
  const tapOf = (mixer: MixerGraph, id: TrackId) => (mixer as unknown as { strips: Map<TrackId, { tap: unknown }> }).strips.get(id)!.tap;

  it('collega il suono della cassa (dopo i suoi effetti) al rilevatore del compressore del basso', () => {
    const r = rig();
    const graph = new FakeGraph(), host = new FakeEffects();
    const mixer = new MixerGraph(graph, host);
    mixer.sync(r.store.project);
    const sc = (owner: ChainOwner, id: DeviceId) => host.created.find(e => mixer.effect(owner, id) === e)!.sidechain!;
    const tap = (id: TrackId) => tapOf(mixer, id) as { outputs: unknown[] };
    const kickEffect = mixer.effect(r.kick, r.c.kick)!;
    // senza sidechain dal punto di ascolto si va solo al volume
    expect(tap(r.kick).outputs).toHaveLength(1);

    r.key(r.bass, r.c.bass, r.kick);
    mixer.sync(r.store.project);
    expect(tap(r.kick).outputs).toContain(sc(r.bass, r.c.bass));
    // l'uscita degli effetti della cassa arriva al punto di ascolto
    expect((kickEffect.output as unknown as { outputs: unknown[] }).outputs).toEqual([tapOf(mixer, r.kick)]);

    // un'altra sorgente: si stacca dalla cassa e si attacca al pad
    r.key(r.bass, r.c.bass, r.pad);
    mixer.sync(r.store.project);
    expect(tap(r.kick).outputs).toHaveLength(1);
    expect(tap(r.pad).outputs).toContain(sc(r.bass, r.c.bass));

    // un aggiornamento qualunque non ricollega
    r.store.apply(setEffectParam(r.bass, r.c.bass, 'ratio', 8));
    mixer.sync(r.store.project);
    expect(tap(r.pad).outputs.filter(o => o === sc(r.bass, r.c.bass))).toHaveLength(1);

    // la traccia ascoltata se ne va: niente errori, niente collegamenti
    r.store.apply(removeTrack(r.pad));
    expect(() => mixer.sync(r.store.project)).not.toThrow();
    expect(r.links()).toEqual([]);
  });

  it('il compressore tolto e rimesso: il collegamento va sul nuovo', () => {
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

  it('un anello non si collega', () => {
    const r = rig();
    const graph = new FakeGraph(), host = new FakeEffects();
    const mixer = new MixerGraph(graph, host);
    r.key(r.bass, r.c.bass, r.bass);
    mixer.sync(r.store.project);
    expect((tapOf(mixer, r.bass) as { outputs: unknown[] }).outputs).toHaveLength(1);
  });
});
