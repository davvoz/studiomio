import type { ProjectSession } from '../app/project-session';
import { encodeWav } from '../dsp/codec/wav';
import type { AudioClip } from '../model/audio-clip';
import type { Clip } from '../model/clip';
import type { MidiClip, Note } from '../model/midi-clip';
import type { TrackId } from '../core/id';
import { ANALOG } from '../devices/instruments/analog/analog';
import { DELAY } from '../devices/effects/delay/delay';
import { DRUMS, padNote } from '../devices/instruments/drums/drums';
import {
  addEffect, addMidiClip, addSample, addTrack, loadEffectPreset, loadPreset, placeSample, renameTrack, resizePlacement, setInstrument,
  setMixer, setSlot, updateClip,
} from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { renameScene } from '../store/session-edits';
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

/** Note di batteria: [pad, battito, velocity] → note sui pad della Drum Machine (da C1). */
const hits = (list: readonly (readonly [number, number, number])[]): Note[] =>
  list.map(([pad, start, velocity]) => ({ pitch: padNote(pad), start, duration: 0.25, velocity }));

/** I pad del kit di partenza usati qui. */
const KICK = 0, RIM = 1, CLAP = 3, HAT = 6, SHAKER = 8, OPEN_HAT = 10;

const range = (n: number, step: number, from = 0) => Array.from({ length: n }, (_, i) => from + i * step);

/** Un beat di 2 battute: cassa in quattro, clap sul 2 e sul 4, hi-hat in levare, shaker in sedicesimi. */
const BEAT: Note[] = hits([
  ...range(8, 1).map(b => [KICK, b, 120] as const),
  ...[1, 3, 5, 7].map(b => [CLAP, b, 110] as const),
  ...range(8, 1, 0.5).filter(b => b !== 3.5 && b !== 7.5).map(b => [HAT, b, 96] as const),
  ...[3.5, 7.5].map(b => [OPEN_HAT, b, 92] as const),
  ...range(16, 0.5, 0.25).map(b => [SHAKER, b, 58] as const),
  ...[2.75, 6.25].map(b => [RIM, b, 82] as const),
]);

/** Solo hi-hat e shaker, da mettere sopra il loop audio. */
const HATS: Note[] = hits([
  ...range(16, 0.5).map(b => [HAT, b, b % 1 ? 100 : 64] as const),
  ...range(16, 0.5, 0.25).map(b => [SHAKER, b, 52] as const),
]);

/** Lo strumento della traccia con il preset `name` di Analog. */
const withPreset = (store: ProjectStore, track: TrackId, name: string) => {
  const preset = ANALOG.presets.find(p => p.name === name)!;
  store.apply(loadPreset(track, preset.name, preset.params));
};

/** Progetto di prova: un loop di batteria a 120 BPM in quattro modalità di warp, una linea
 *  di basso e degli accordi suonati da Analog, gli accordi con un delay ping-pong, una
 *  Drum Machine con hi-hat sopra il loop e un beat suo nella session. */
export async function buildDemoProject(store: ProjectStore, session: ProjectSession): Promise<void> {
  const data = { channels: drumLoop(2, 120), sampleRate: 44100 };
  // il loop finisce nella cartella del progetto come un file importato
  const sample = await session.addAudio('Loop demo 120.wav', data, new Uint8Array(encodeWav(data.channels, data.sampleRate, 16)));
  const id = sample.id;

  store.apply(addTrack('audio'));
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const [drums, bass, pad, machine] = store.project.tracks.map(t => t.id);
  store.apply(renameTrack(drums, 'Batteria'));
  store.apply(renameTrack(bass, 'Basso'));
  store.apply(renameTrack(pad, 'Accordi'));
  store.apply(renameTrack(machine, 'Drum Machine'));
  store.apply(setInstrument(machine, { type: DRUMS.type, preset: 'Init', params: {} }));
  store.apply(setMixer(machine, { volumeDb: -6 }));
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

  // gli hi-hat della Drum Machine entrano con gli accordi
  store.apply(addMidiClip(machine, 8, 8));
  const hatsPl = store.project.tracks[3].arrangement[0];
  store.apply(updateClip<MidiClip>('Demo', machine, hatsPl.id, c => c.withName('Hi-hat').addingNotes(...HATS)));
  store.apply(resizePlacement(machine, hatsPl.id, { end: 32 }));

  buildDemoSession(store, drums, bass, pad);
  buildDrumMachineScenes(store, machine);
}

/** Nella session la Drum Machine ha gli hi-hat nelle scene piene e un beat suo nell'ultima
 *  scena, dove il loop audio tace. */
function buildDrumMachineScenes(store: ProjectStore, machine: TrackId): void {
  const hats = store.project.track(machine)!.arrangement[0].clip as MidiClip;
  const clip = (name: string, notes: readonly Note[]) =>
    hats.withId(store.ids.next('clip')).withName(name).withNotes(notes).withLoop({ ...hats.loop, enabled: true });
  store.apply(setSlot(machine, 2, clip('Hi-hat', HATS)));
  store.apply(setSlot(machine, 3, clip('Hi-hat', HATS)));
  store.apply(setSlot(machine, 4, clip('Beat', BEAT)));
  store.apply(renameScene(store.project.scenes[4].id, 'Drum Machine'));
  // l'ultima scena: basso e arpeggio sopra il beat della Drum Machine
  const p = store.project;
  const [bass, pad] = [p.tracks[1], p.tracks[2]];
  const copyOf = (c: Clip | null) => c && c.withId(store.ids.next('clip'));
  const bassClip = copyOf(bass.slots[1]), arp = copyOf(pad.slots[3]);
  if (bassClip) store.apply(setSlot(bass.id, 4, bassClip));
  if (arp) store.apply(setSlot(pad.id, 4, arp));
}

/** La session del demo: quattro scene da lanciare, con le stesse clip della timeline e
 *  qualche variazione (basso all'ottava, accordi spezzati). */
function buildDemoSession(store: ProjectStore, drums: TrackId, bass: TrackId, pad: TrackId): void {
  const p = store.project;
  const [drumClips, bassClip, padClip] = [p.track(drums)!, p.track(bass)!, p.track(pad)!].map(t => t.arrangement.map(x => x.clip));
  const copy = <C extends Clip>(c: C, name: string, change: (c: C) => C = x => x) =>
    change(c.withId(store.ids.next('clip')).withName(name)).withLoop({ ...c.loop, enabled: true });
  const scenes: { name: string; drums: number; bass: ((c: MidiClip) => MidiClip) | null; pad: ((c: MidiClip) => MidiClip) | null }[] = [
    { name: 'Intro', drums: 3, bass: null, pad: c => c },
    { name: 'Groove', drums: 0, bass: c => c, pad: null },
    { name: 'Pieno', drums: 1, bass: c => c, pad: c => c },
    { name: 'Ottava sopra', drums: 2, bass: c => c.withNotes(c.notes.map(n => ({ ...n, pitch: n.pitch + 12 }))), pad: c => c.withNotes(arpeggiate(c.notes)) },
  ];
  scenes.forEach((scene, i) => {
    store.apply(renameScene(store.project.scenes[i].id, scene.name));
    store.apply(setSlot(drums, i, copy(drumClips[scene.drums], drumClips[scene.drums].name)));
    if (scene.bass) store.apply(setSlot(bass, i, copy(bassClip[0] as MidiClip, i === 3 ? 'Basso alto' : 'Basso', scene.bass)));
    if (scene.pad) store.apply(setSlot(pad, i, copy(padClip[0] as MidiClip, i === 3 ? 'Arpeggio' : 'Accordi', scene.pad)));
  });
}

/** Gli accordi spezzati in ottavi: una nota per volta, dal basso all'alto. */
function arpeggiate(notes: readonly Note[]): Note[] {
  const out: Note[] = [];
  for (let beat = 0; beat < 8; beat += 0.5) {
    const chord = notes.filter(n => n.start <= beat && beat < n.start + n.duration).map(n => n.pitch).sort((a, b) => a - b);
    if (chord.length) out.push({ pitch: chord[(beat * 2) % chord.length] + 12, start: beat, duration: 0.45, velocity: 90 });
  }
  return out;
}
