import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { MASTER, Project } from '../../src/model/project';
import { importPart, importSummary, mergingImport, type ImportChoice } from '../../src/model/project-import';
import { GroupTrack } from '../../src/model/track';
import { withFreshIds } from '../../src/persistence/fresh-ids';
import { addBus, addEffect, groupTracks, placeSample, setEffectSidechain, setSend, setSlot } from '../../src/store/edits';
import { groupDevices, mapMacro } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

/** kick (audio, with a sample on the timeline and in scene 4), bass and pad (MIDI, in a group),
 *  a bus the bass sends to, a compressor on the bass listening to the kick, a rack on the pad and a
 *  limiter on the master. */
function source() {
  const s = setup({ audio: 1, midi: 2, sample: true });
  const [kick, bass, pad] = [0, 1, 2].map(s.track);
  s.store.apply(placeSample(kick, s.sampleId, 0));
  s.store.apply(setSlot(kick, 3, s.store.project.track(kick)!.clips[0]));
  s.store.apply(addBus());
  const bus = s.store.project.buses[0].id;
  s.store.apply(setSend(bass, bus, -6));
  s.store.apply(addEffect(bass, 'compressor', 'Compressor'));
  s.store.apply(setEffectSidechain(bass, s.store.project.effectsOf(bass)[0].id, kick));
  s.store.apply(addEffect(pad, 'delay', 'Delay'));
  s.store.apply(addEffect(pad, 'reverb', 'Reverb'));
  const [delay, reverb] = s.store.project.effectsOf(pad);
  s.store.apply(groupDevices(pad, [delay.id, reverb.id]));
  s.store.apply(mapMacro(pad, s.store.project.racksOf(pad)[0].id, 0, delay.id, 'mix'));
  s.store.apply(addEffect(MASTER, 'limiter', 'Limiter'));
  s.store.apply(groupTracks([bass, pad]));
  const group = s.store.project.tracks.find(t => t instanceof GroupTrack)!.id;
  return { ...s, project: s.store.project, kick, bass, pad, bus, group };
}

const choice = (tracks: readonly TrackId[], more: Partial<ImportChoice> = {}): ImportChoice => ({ tracks, master: false, clips: false, ...more });

describe('what is taken from another project', () => {
  it('a track without what stays out: no sidechain, no send, no group, no clips', () => {
    const s = source();
    const part = importPart(s.project, choice([s.bass]))!;
    expect(part.tracks.map(t => t.id)).toEqual([s.bass]);
    const bass = part.track(s.bass)!;
    expect(bass.group).toBeNull();
    expect(bass.effects[0]).not.toHaveProperty('sidechain');
    expect(bass.sends).toEqual({});
    expect(part.buses).toEqual([]);
    expect(part.masterEffects).toEqual([]);
    expect(part.samples).toEqual([]);
  });

  it('a group brings all its tracks; the bus keeps the sends', () => {
    const s = source();
    const part = importPart(s.project, choice([s.group, s.bus]))!;
    expect(part.tracks.map(t => t.id)).toEqual([s.group, s.bass, s.pad]);
    expect(part.track(s.bass)!.sends).toEqual({ [s.bus]: -6 });
    expect(part.racksOf(s.pad)[0].macros[0].mappings).toHaveLength(1);
  });

  it('with the clips the samples they use come too; the master only if chosen', () => {
    const s = source();
    const without = importPart(s.project, choice([s.kick]))!;
    expect(without.track(s.kick)!.clips).toEqual([]);
    const part = importPart(s.project, choice([s.kick, s.bass], { clips: true, master: true }))!;
    expect(part.track(s.kick)!.clips).toHaveLength(2);
    expect(part.track(s.bass)!.effects[0].sidechain).toBe(s.kick);
    expect(part.samples.map(x => x.id)).toEqual([s.sampleId]);
    expect(part.masterEffects.map(e => e.type)).toEqual(['limiter']);
    expect(importSummary(part)).toBe('2 tracks and 1 master device');
  });

  it('nothing chosen: nothing to import', () => {
    const s = source();
    expect(importPart(s.project, choice([]))).toBeNull();
    expect(importPart(s.project, choice([], { master: true }))!.tracks).toEqual([]);
    expect(importPart(Project.empty('e', sequentialIds()), choice([], { master: true }))).toBeNull();
  });
});

describe('merging into this project', () => {
  it('into a copy of the same project: new ids, references that follow, fewer scenes', () => {
    const s = source();
    const target = s.project.removingScene(s.project.scenes[3].id);
    const all = choice([s.kick, s.group, s.bus], { clips: true, master: true });
    const part = withFreshIds(importPart(s.project, all)!, s.ids);
    const merged = mergingImport(target, part);

    expect(merged.tracks).toHaveLength(8);
    expect(merged.buses).toHaveLength(2);
    expect(merged.masterEffects.map(e => e.type)).toEqual(['limiter', 'limiter']);
    expect(merged.samples).toHaveLength(2);
    const [kick, group, bass, pad] = merged.tracks.slice(4);
    expect([kick.name, group.name, bass.name, pad.name]).toEqual(s.project.tracks.map(t => t.name));
    expect([bass.group, pad.group]).toEqual([group.id, group.id]);
    expect(bass.effects[0].sidechain).toBe(kick.id);
    expect(Object.keys(bass.sends)).toEqual([merged.buses[1].id]);
    const rack = pad.racks[0];
    expect(rack.devices).toEqual(pad.effects.map(e => e.id));
    expect(rack.macros[0].mappings[0].device).toBe(pad.effects[0].id);
    // the slot of the fourth scene doesn't exist here: only the timeline clip arrives
    expect(kick.slots).toEqual([null, null, null]);
    expect(kick.clips).toHaveLength(1);
    expect(merged.usedSampleIds()).toEqual(new Set(merged.samples.map(x => x.id)));
  });
});
