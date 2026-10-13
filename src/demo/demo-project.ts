import type { AudioSystem } from '../app/audio-system';
import type { AudioClip } from '../model/audio-clip';
import type { MidiClip, Note } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import { addMidiClip, addSample, addTrack, placeSample, renameTrack, resizePlacement, updateClip } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { drumLoop } from './demo-loop';

/** Linea di basso di 2 battute (8 battiti), in La minore. */
const BASS: Note[] = [
  [45, 0, 0.75], [45, 1, 0.5], [57, 1.5, 0.5], [45, 2, 0.75], [48, 3, 0.5],
  [41, 4, 0.75], [41, 5, 0.5], [53, 5.5, 0.5], [43, 6, 0.75], [47, 7, 0.5],
].map(([pitch, start, duration]) => ({ pitch, start, duration, velocity: 100 }));

/** Progetto di prova: un loop di batteria a 120 BPM in quattro modalità di warp e una
 *  linea di basso MIDI in loop. */
export async function buildDemoProject(store: ProjectStore, audio: AudioSystem): Promise<void> {
  const data = { channels: drumLoop(2, 120), sampleRate: 44100 };
  const id = store.ids.next('sample');
  await audio.addSample(id, data);
  const analysis = await audio.dsp.analyze(id, 0.5);
  const sample: SampleRef = {
    id, name: 'Loop demo 120', file: 'audio/loop-demo.wav',
    sampleRate: data.sampleRate, channels: 2, frames: data.channels[0].length,
    analysis: { tempo: analysis.tempo, sensitivity: 0.5, transients: analysis.transients.map(t => t / data.sampleRate) },
  };

  store.apply(addTrack('audio'));
  store.apply(addTrack('midi'));
  const [drums, bass] = store.project.tracks.map(t => t.id);
  store.apply(renameTrack(drums, 'Batteria'));
  store.apply(renameTrack(bass, 'Basso'));
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
}
