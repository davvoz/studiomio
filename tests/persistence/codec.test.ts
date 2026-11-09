import { describe, expect, it } from 'vitest';
import type { AudioClip } from '../../src/model/audio-clip';
import type { MidiClip } from '../../src/model/midi-clip';
import { ProjectFormatError } from '../../src/persistence/json-reader';
import { PROJECT_VERSION, ProjectCodec } from '../../src/persistence/project-codec';
import { DEFAULT_INSTRUMENT } from '../../src/model/device';
import type { MidiTrack } from '../../src/model/track';
import { addMidiClip, loadPreset, placeSample, setInstrumentParam, setSlot, setTempo, updateClip } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

/** A project with a bit of everything. */
function richProject() {
  const { store, track, sampleId } = setup({ audio: 1, midi: 1, sample: true });
  store.apply(setTempo(97.5));
  store.apply(placeSample(track(0), sampleId, 2));
  const audioId = store.project.tracks[0].arrangement[0].id;
  store.apply(updateClip<AudioClip>('warp', track(0), audioId, c => c
    .withMarkers(c.warp.markers.withMarkerAt(1.3).markers.withMarkerBeat(1, 2.75))
    .withWarp({ mode: 'beats' })
    .withWarpOptions('beats', { preserve: 0.25, loop: 'pingpong' })
    .withTranspose(-3).withDetune(12).withGain(-4.5).withReversed(true, 4)));
  store.apply(addMidiClip(track(1), 8, 4));
  const midiId = store.project.tracks[1].arrangement[0].id;
  store.apply(updateClip<MidiClip>('note', track(1), midiId, c => c.addingNotes(
    { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
    { pitch: 67, start: 1.5, duration: 0.25, velocity: 64 },
  )));
  store.apply(setSlot(track(1), 2, store.project.tracks[1].arrangement[0].clip));
  return store.project;
}

const codec = new ProjectCodec();

describe('ProjectCodec', () => {
  it('round trip without losses', () => {
    const p = richProject();
    const text = codec.stringify(p);
    const back = codec.parse(text);
    expect(codec.stringify(back)).toBe(text);
    expect(back.tempo.bpm).toBe(97.5);
    const audio = back.tracks[0].arrangement[0].clip as AudioClip;
    expect(audio.warp.mode).toBe('beats');
    expect(audio.warp.options.beats).toEqual({ preserve: 0.25, loop: 'pingpong', envelope: 100 });
    expect(audio.warp.markers.equals((p.tracks[0].arrangement[0].clip as AudioClip).warp.markers)).toBe(true);
    expect(audio.gainDb).toBe(-4.5);
    expect(audio.reversed).toBe(true);
    expect((back.tracks[1].slots[2] as MidiClip).notes).toHaveLength(2);
  });

  it('the file is readable and carries format and version', () => {
    const json = JSON.parse(codec.stringify(richProject()));
    expect(json.format).toBe('studiomio-project');
    expect(json.version).toBe(PROJECT_VERSION);
    expect(json.tracks[1].arrangement[0].clip.notes[0]).toEqual([60, 0, 0.5, 100]);
  });

  const broken = (mutate: (json: any) => void) => {
    const json = JSON.parse(codec.stringify(richProject()));
    mutate(json);
    try {
      codec.decode(json);
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectFormatError);
      return (e as Error).message;
    }
    throw new Error('the broken file was accepted');
  };

  it('clear errors, with the field\'s path', () => {
    expect(broken(j => { j.format = 'other'; })).toMatch(/^format: not a studiomio project/);
    expect(broken(j => { j.version = 99; })).toMatch(/newer version/);
    expect(broken(j => { j.tracks[0].arrangement[0].start = 'x'; })).toMatch(/^tracks\[0\]\.arrangement\[0\]\.start: expected a number/);
    expect(broken(j => { j.tracks[0].arrangement[0].clip.warp.mode = 'magic'; })).toMatch(/warp\.mode: expected one of/);
    expect(broken(j => { j.tracks[1].slots[2].kind = 'video'; })).toMatch(/unknown clip kind: video/);
    expect(broken(j => { j.tracks[0].slots[0] = j.tracks[1].slots[2]; })).toMatch(/audio track can't contain a midi clip/);
    expect(broken(j => { j.tracks[1].slots[2].region.end = -1; })).toMatch(/empty clip region/);
    expect(broken(j => { j.scenes.pop(); })).toMatch(/slots but there are/);
    expect(broken(j => { j.samples = []; })).toMatch(/isn't in the project/);
    expect(() => codec.parse('{ broken')).toThrow(/invalid JSON/);
  });

  it('the MIDI track\'s instrument is saved, preset included', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(loadPreset(track(0), 'Bass', { cutoff: 420, oscBSemi: -12 }));
    store.apply(setInstrumentParam(track(0), 'resonance', 55));
    const back = codec.parse(codec.stringify(store.project)).tracks[0] as MidiTrack;
    expect(back.instrument).toEqual({ type: 'analog', preset: 'Bass', params: { cutoff: 420, oscBSemi: -12, resonance: 55 } });
  });

  it('a version 1 file opens: the MIDI tracks receive the default instrument', () => {
    const json = JSON.parse(codec.stringify(richProject()));
    json.version = 1;
    delete json.tracks[1].instrument;
    const p = codec.decode(json);
    expect((p.tracks[1] as MidiTrack).instrument).toEqual(DEFAULT_INSTRUMENT);
    expect(p.tracks[0]).not.toHaveProperty('instrument');
  });

  it('a version 11 Sampler opens with the zones\' Tune in their Transpose', () => {
    const { store, sampleId } = setup({ midi: 1, sample: true });
    const json = JSON.parse(codec.stringify(store.project));
    json.version = 11;
    json.tracks[0].instrument = { type: 'sampler', preset: null, params: { z2tune: 5, z2lo: 40, z2hi: 40 }, samples: { sample: sampleId, z2: sampleId } };
    const params = (codec.decode(json).tracks[0] as MidiTrack).instrument.params;
    expect(params).toMatchObject({ z2own: 1, z2transpose: 5, z2lo: 40 });
    expect(params).not.toHaveProperty('z2tune');
  });

  it('a MIDI clip\'s sound is saved, and its samples stay in the project', () => {
    const { store, track, sampleId } = setup({ midi: 1, sample: true });
    store.apply(addMidiClip(track(0), 0, 4));
    const id = store.project.tracks[0].arrangement[0].id;
    const sound = { type: 'sampler', preset: 'Pad', params: { z1lo: 40 }, samples: { sample: sampleId } };
    store.apply(updateClip<MidiClip>('sound', track(0), id, c => c.withSound(sound)));
    const back = codec.parse(codec.stringify(store.project.withoutUnusedSamples()));
    expect((back.tracks[0].arrangement[0].clip as MidiClip).sound).toEqual(sound);
    expect(back.sample(sampleId)).toBeDefined();
    // without sound the field isn't there
    const plain = JSON.parse(codec.stringify(richProject()));
    expect(plain.tracks[1].arrangement[0].clip).not.toHaveProperty('sound');
  });

  it('the clips saved before reverse open straight', () => {
    const json = JSON.parse(codec.stringify(richProject()));
    delete json.tracks[0].arrangement[0].clip.reversed;
    expect((codec.decode(json).tracks[0].arrangement[0].clip as AudioClip).reversed).toBe(false);
  });
});
