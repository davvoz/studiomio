import { describe, expect, it } from 'vitest';
import type { AudioClip } from '../../src/model/audio-clip';
import type { MidiClip } from '../../src/model/midi-clip';
import { ProjectFormatError } from '../../src/persistence/json-reader';
import { PROJECT_VERSION, ProjectCodec } from '../../src/persistence/project-codec';
import { DEFAULT_INSTRUMENT } from '../../src/model/device';
import type { MidiTrack } from '../../src/model/track';
import { addMidiClip, loadPreset, placeSample, setInstrumentParam, setSlot, setTempo, updateClip } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

/** Un progetto con un po' di tutto. */
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
  it('andata e ritorno senza perdite', () => {
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

  it('il file è leggibile e porta formato e versione', () => {
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
    throw new Error('il file rotto è stato accettato');
  };

  it('errori chiari, con il percorso del campo', () => {
    expect(broken(j => { j.format = 'altro'; })).toMatch(/^format: non è un progetto studiomio/);
    expect(broken(j => { j.version = 99; })).toMatch(/versione più recente/);
    expect(broken(j => { j.tracks[0].arrangement[0].start = 'x'; })).toMatch(/^tracks\[0\]\.arrangement\[0\]\.start: atteso un numero/);
    expect(broken(j => { j.tracks[0].arrangement[0].clip.warp.mode = 'magia'; })).toMatch(/warp\.mode: atteso uno tra/);
    expect(broken(j => { j.tracks[1].slots[2].kind = 'video'; })).toMatch(/tipo di clip sconosciuto: video/);
    expect(broken(j => { j.tracks[0].slots[0] = j.tracks[1].slots[2]; })).toMatch(/audio non può contenere una clip midi/);
    expect(broken(j => { j.tracks[1].slots[2].region.end = -1; })).toMatch(/regione della clip vuota/);
    expect(broken(j => { j.scenes.pop(); })).toMatch(/slot ma le scene sono/);
    expect(broken(j => { j.samples = []; })).toMatch(/non è nel progetto/);
    expect(() => codec.parse('{ rotto')).toThrow(/JSON non valido/);
  });

  it('lo strumento della traccia MIDI si salva, compreso il preset', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(loadPreset(track(0), 'Basso', { cutoff: 420, oscBSemi: -12 }));
    store.apply(setInstrumentParam(track(0), 'resonance', 55));
    const back = codec.parse(codec.stringify(store.project)).tracks[0] as MidiTrack;
    expect(back.instrument).toEqual({ type: 'analog', preset: 'Basso', params: { cutoff: 420, oscBSemi: -12, resonance: 55 } });
  });

  it('un file della versione 1 si apre: le tracce MIDI ricevono lo strumento predefinito', () => {
    const json = JSON.parse(codec.stringify(richProject()));
    json.version = 1;
    delete json.tracks[1].instrument;
    const p = codec.decode(json);
    expect((p.tracks[1] as MidiTrack).instrument).toEqual(DEFAULT_INSTRUMENT);
    expect(p.tracks[0]).not.toHaveProperty('instrument');
  });

  it('un Sampler della versione 11 si apre con il Tune delle zone nel loro Transpose', () => {
    const { store, sampleId } = setup({ midi: 1, sample: true });
    const json = JSON.parse(codec.stringify(store.project));
    json.version = 11;
    json.tracks[0].instrument = { type: 'sampler', preset: null, params: { z2tune: 5, z2lo: 40, z2hi: 40 }, samples: { sample: sampleId, z2: sampleId } };
    const params = (codec.decode(json).tracks[0] as MidiTrack).instrument.params;
    expect(params).toMatchObject({ z2own: 1, z2transpose: 5, z2lo: 40 });
    expect(params).not.toHaveProperty('z2tune');
  });

  it('il suono di una clip MIDI si salva, e i suoi sample restano nel progetto', () => {
    const { store, track, sampleId } = setup({ midi: 1, sample: true });
    store.apply(addMidiClip(track(0), 0, 4));
    const id = store.project.tracks[0].arrangement[0].id;
    const sound = { type: 'sampler', preset: 'Pad', params: { z1lo: 40 }, samples: { sample: sampleId } };
    store.apply(updateClip<MidiClip>('suono', track(0), id, c => c.withSound(sound)));
    const back = codec.parse(codec.stringify(store.project.withoutUnusedSamples()));
    expect((back.tracks[0].arrangement[0].clip as MidiClip).sound).toEqual(sound);
    expect(back.sample(sampleId)).toBeDefined();
    // senza suono il campo non c'è
    const plain = JSON.parse(codec.stringify(richProject()));
    expect(plain.tracks[1].arrangement[0].clip).not.toHaveProperty('sound');
  });

  it('le clip salvate prima del reverse si aprono dritte', () => {
    const json = JSON.parse(codec.stringify(richProject()));
    delete json.tracks[0].arrangement[0].clip.reversed;
    expect((codec.decode(json).tracks[0].arrangement[0].clip as AudioClip).reversed).toBe(false);
  });
});
