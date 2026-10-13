import type { ProjectSession } from '../app/project-session';
import { encodeWav } from '../dsp/codec/wav';
import type { AudioClip } from '../model/audio-clip';
import type { MidiClip, Note } from '../model/midi-clip';
import type { TrackId } from '../core/id';
import { ANALOG } from '../devices/instruments/analog/analog';
import { DELAY } from '../devices/effects/delay/delay';
import { addEffect, addMidiClip, addSample, addTrack, loadEffectPreset, loadPreset, placeSample, renameTrack, resizePlacement, setMixer, updateClip } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { drumLoop } from './demo-loop';

/** Linea di basso di 2 battute (8 battiti), in La minore. */
const BASS: Note[] = [
  [45, 0, 0.75], [45, 1, 0.5], [57, 1.5, 0.5], [45, 2, 0.75], [48, 3, 0.5],
  [41, 4, 0.75], [41, 5, 0.5], [53, 5.5, 0.5], [43, 6, 0.75], [47, 7, 0.5],
].map(([pitch, start, duration]) => ({ pitch, start, duration, velocity: 100 }));

/** Accordi sulla stessa progressione: La minore, poi Fa e Sol. */
const PAD: Note[] = [
  ...[57, 60, 64].map(pitch => ({ pitch, start: 0, duration: 4, velocity: 80 })),
  ...[57, 60, 65].map(pitch => ({ pitch, start: 4, duration: 2, velocity: 80 })),
  ...[55, 59, 62].map(pitch => ({ pitch, start: 6, duration: 2, velocity: 80 })),
];

/** Lo strumento della traccia con il preset `name` di Analog. */
const withPreset = (store: ProjectStore, track: TrackId, name: string) => {
  const preset = ANALOG.presets.find(p => p.name === name)!;
  store.apply(loadPreset(track, preset.name, preset.params));
};

/** Progetto di prova: un loop di batteria a 120 BPM in quattro modalità di warp, una linea
 *  di basso e degli accordi suonati da Analog, gli accordi con un delay ping-pong. */
export async function buildDemoProject(store: ProjectStore, session: ProjectSession): Promise<void> {
  const data = { channels: drumLoop(2, 120), sampleRate: 44100 };
  // il loop finisce nella cartella del progetto come un file importato
  const sample = await session.addAudio('Loop demo 120.wav', data, new Uint8Array(encodeWav(data.channels, data.sampleRate, 16)));
  const id = sample.id;

  store.apply(addTrack('audio'));
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const [drums, bass, pad] = store.project.tracks.map(t => t.id);
  store.apply(renameTrack(drums, 'Batteria'));
  store.apply(renameTrack(bass, 'Basso'));
  store.apply(renameTrack(pad, 'Accordi'));
  // un mix con margine: il master resta sotto 0 dB
  store.apply(setMixer(drums, { volumeDb: -8 }));
  store.apply(setMixer(bass, { volumeDb: -3 }));
  store.apply(setMixer(pad, { volumeDb: -2 }));
  withPreset(store, bass, 'Basso');
  withPreset(store, pad, 'Pad');
  store.apply(addSample(sample));

  // quattro clip da 2 battute, ognuna con una modalità diversa
  const looks: ((c: AudioClip) => AudioClip)[] = [
    c => c.withName('Complex'),
    c => c.withName('Beats').withWarp({ mode: 'beats' }).withWarpOptions('beats', { preserve: 0.25 }),
    c => c.withName('Complex +5').withTranspose(5),
    c => c.withName('Re-Pitch').withWarp({ mode: 'repitch' }),
  ];
  looks.forEach((look, i) => {
    store.apply(placeSample(drums, id, i * 8));
    const pl = store.project.tracks[0].arrangement[i];
    store.apply(updateClip<AudioClip>('Demo', drums, pl.id, look));
  });

  store.apply(addMidiClip(bass, 0, 8));
  const bassPl = store.project.tracks[1].arrangement[0];
  store.apply(updateClip<MidiClip>('Demo', bass, bassPl.id, c => c.withName('Basso').addingNotes(...BASS)));
  store.apply(resizePlacement(bass, bassPl.id, { end: 32 }));

  // gli accordi entrano alla battuta 3
  store.apply(addMidiClip(pad, 8, 8));
  const padPl = store.project.tracks[2].arrangement[0];
  store.apply(updateClip<MidiClip>('Demo', pad, padPl.id, c => c.withName('Accordi').addingNotes(...PAD)));
  store.apply(resizePlacement(pad, padPl.id, { end: 32 }));

  // un delay ping-pong sugli accordi
  const pingPong = DELAY.presets.find(p => p.name === 'Ping-pong 1/8.')!;
  store.apply(addEffect(pad, DELAY.type, DELAY.label));
  const fx = store.project.track(pad)!.effects[0].id;
  store.apply(loadEffectPreset(pad, fx, pingPong.name, pingPong.params));
}
