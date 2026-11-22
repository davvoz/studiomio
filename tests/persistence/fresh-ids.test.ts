import { describe, expect, it } from 'vitest';
import { MASTER } from '../../src/model/project';
import { withFreshIds } from '../../src/persistence/fresh-ids';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, placeSample, setMasterAutomation, setModTarget } from '../../src/store/edits';
import { groupDevices } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

describe('fresh ids', () => {
  it('no old id remains, and with the ids put back the project is the same', () => {
    const s = setup({ audio: 1, midi: 1, sample: true });
    const [audio, midi] = [0, 1].map(s.track);
    s.store.apply(placeSample(audio, s.sampleId, 0));
    s.store.apply(addEffect(midi, 'lfo', 'LFO'));
    s.store.apply(addEffect(midi, 'delay', 'Delay'));
    const [lfo, delay] = s.store.project.effectsOf(midi);
    s.store.apply(setModTarget(midi, lfo.id, 0, { kind: 'device', device: delay.id, param: 'mix' }));
    s.store.apply(groupDevices(midi, [lfo.id, delay.id]));
    s.store.apply(addEffect(MASTER, 'reverb', 'Reverb'));
    const reverb = s.store.project.masterEffects[0].id;
    s.store.apply(setMasterAutomation({ kind: 'device', device: reverb, param: 'mix' }, [{ beat: 0, value: 0.5 }]));
    const before = s.store.project, codec = new ProjectCodec();

    const after = withFreshIds(before, s.ids);
    const text = codec.stringify(after);
    const old = [...before.tracks.map(t => t.id), lfo.id, delay.id, reverb, before.racksOf(midi)[0].id, s.sampleId,
      before.tracks[0].clips[0].id, before.tracks[0].arrangement[0].id];
    for (const id of old) expect(text).not.toMatch(new RegExp(`"${id}[":]`));

    // the new ids, one by one in the same places, give back the old file
    const back = [...after.tracks.map(t => t.id), ...after.tracks[1].effects.map(e => e.id), after.masterEffects[0].id,
      after.tracks[1].racks[0].id, after.samples[0].id, after.tracks[0].clips[0].id, after.tracks[0].arrangement[0].id];
    const restored = back.reduce((t, id, i) => t.replaceAll(`"${id}"`, `"${old[i]}"`).replaceAll(`"${id}:`, `"${old[i]}:`), text);
    expect(restored).toBe(codec.stringify(before));
  });
});
