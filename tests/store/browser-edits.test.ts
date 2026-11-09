import { describe, expect, it } from 'vitest';
import { DRUMS } from '../../src/devices/instruments/drums/drums';
import { SAMPLE_SLOT, SAMPLER } from '../../src/devices/instruments/sampler/sampler';
import { REVERB } from '../../src/devices/effects/reverb/reverb';
import { MASTER } from '../../src/model/project';
import { AudioTrack, MidiTrack } from '../../src/model/track';
import { groupTracks, setInstrumentParam } from '../../src/store/edits';
import { loadEffect, loadInstrument, loadSampler } from '../../src/store/browser-edits';
import { sampleRef, setup } from '../helpers/fixtures';

describe('loading from the browser', () => {
  it('an instrument with the preset goes on the MIDI track, in a single step', () => {
    const r = setup({ midi: 1 });
    const kit = DRUMS.presets[1];
    r.store.apply(loadInstrument(r.track(0), DRUMS.type, DRUMS.label, kit));
    const t = r.store.project.tracks[0] as MidiTrack;
    expect(t.instrument).toMatchObject({ type: DRUMS.type, preset: kit.name, params: kit.params });
    expect(r.store.undoLabel).toBe(`Load ${kit.name}`);
    r.store.undo();
    expect((r.store.project.tracks[0] as MidiTrack).instrument.type).toBe('analog');
  });

  it('without preset: the default values; on an audio track (or none) a new MIDI track', () => {
    const r = setup({ audio: 2 });
    r.store.apply(loadInstrument(r.track(0), DRUMS.type, DRUMS.label, null));
    const tracks = r.store.project.tracks;
    expect(tracks.map(t => t.kind)).toEqual(['audio', 'midi', 'audio']); // right after the chosen one
    expect((tracks[1] as MidiTrack).instrument).toMatchObject({ type: DRUMS.type, preset: null, params: {} });
    r.store.apply(loadInstrument(null, DRUMS.type, DRUMS.label, null));
    expect(r.store.project.tracks.at(-1)).toBeInstanceOf(MidiTrack);
    r.store.undo();
    r.store.undo();
    expect(r.store.project.tracks).toHaveLength(2);
  });

  it('inside a group, the new track stays in the group; on a bus it goes at the end', () => {
    const r = setup({ audio: 2 });
    r.store.apply(groupTracks([r.track(0), r.track(1)]));
    const [group, a] = r.store.project.tracks;
    r.store.apply(loadInstrument(a.id, DRUMS.type, DRUMS.label, null));
    const added = r.store.project.tracks.find(t => t instanceof MidiTrack)!;
    expect(added.group).toBe(group.id);
  });

  it('a sample on a MIDI track\'s chain: a Sampler plays it, in a single step', () => {
    const r = setup({ midi: 1 });
    const kick = sampleRef(r.ids, { name: 'kick' });
    r.store.apply(loadSampler(r.track(0), kick));
    const instrument = () => (r.store.project.tracks[0] as MidiTrack).instrument;
    expect(instrument()).toMatchObject({ type: SAMPLER.type, params: {}, samples: { [SAMPLE_SLOT]: kick.id } });
    expect(r.store.project.samples.map(s => s.name)).toEqual(['kick']);
    expect(r.store.undoLabel).toBe('Sampler: kick');
    // on a Sampler only the sample changes: its settings stay
    r.store.apply(setInstrumentParam(r.track(0), 'transpose', 7));
    const snare = sampleRef(r.ids, { name: 'snare' });
    r.store.apply(loadSampler(r.track(0), snare));
    expect(instrument()).toMatchObject({ type: SAMPLER.type, params: { transpose: 7 }, samples: { [SAMPLE_SLOT]: snare.id } });
    r.store.undo();
    r.store.undo();
    r.store.undo();
    expect(instrument().type).toBe('analog');
    expect(r.store.project.samples).toHaveLength(0);
  });

  it('an effect with the preset at the end of the chain: of a track, of the master, or of a new audio track', () => {
    const r = setup({ midi: 1 });
    const preset = REVERB.presets[0];
    r.store.apply(loadEffect(r.track(0), REVERB.type, REVERB.label, preset));
    expect(r.store.project.tracks[0].effects.at(-1)).toMatchObject({ type: REVERB.type, preset: preset.name, params: preset.params });
    expect(r.store.undoLabel).toBe(`Load ${REVERB.label}: ${preset.name}`);
    r.store.apply(loadEffect(MASTER, REVERB.type, REVERB.label, null));
    expect(r.store.project.masterEffects.at(-1)).toMatchObject({ type: REVERB.type, preset: null });
    r.store.apply(loadEffect(null, REVERB.type, REVERB.label, null));
    const last = r.store.project.tracks.at(-1)!;
    expect(last).toBeInstanceOf(AudioTrack);
    expect(last.effects.map(e => e.type)).toEqual([REVERB.type]);
  });
});
