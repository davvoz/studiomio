/* "Snare": uno strumento solo per il rullante, a strati come si costruisce a mano. Il Colpo è la
 * bacchetta che tocca (un click, del rumore o un sample); la Pelle è il tono del tamburo (i due
 * modi della membrana, intonati sulla nota, con una piccola caduta d'intonazione, o un sample);
 * la Cordiera è il frusciare delle molle sotto (rumore filtrato, che parte un attimo dopo e può
 * essere sgranato come un campionatore vecchio); la Stanza è la stanza intorno, un riverbero
 * stereo corto. In uscita la saturazione, il taglio dei bassi e la velocity, che fa anche i colpi
 * piano più scuri, come su un rullante vero. Qui c'è la descrizione; il suono è in snare-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import { DRIVE_TYPES } from '../../dsp/saturate';
import type { ChoiceParam, NumberParam } from '../../params';

/** I posti dei sample: quello della pelle e quello del colpo. */
export const BODY_SLOT = 'body';
export const SNAP_SLOT = 'snap';

/** Le note su cui accordare la pelle: da A1 (110 Hz) ad A3 (440 Hz), con i nomi di Live (C3 = 60). */
export const FIRST_NOTE = 45;
export const NOTE_COUNT = 25;
/** La nota che, quando il rullante segue le note, suona come la nota scelta: D1, il rullante General MIDI. */
export const ROOT_NOTE = 38;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;
export const noteHz = (pitch: number) => 440 * Math.pow(2, (pitch - 69) / 12);
export const snareNote = (value: number) => FIRST_NOTE + value;

export const SOURCE = { synth: 0, sample: 1 } as const;
export const SNAP_SOURCE = { click: 0, noise: 1, sample: 2 } as const;
export const FOLLOW = { fixed: 0, notes: 1 } as const;
/** Il secondo modo della membrana: 1,59 volte la nota (il modo (2,1) di una pelle tesa). */
export const OVERTONE = 1.59;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const percent = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', { step: 1, ...extra });
const ms = (id: string, label: string, min: number, max: number, def: number, extra: Partial<NumberParam> = {}) =>
  num(id, label, min, max, def, 'ms', { scale: 'log', ...extra });

const bodySynth = { when: { param: 'bodySource', is: SOURCE.synth } };
const bodySample = { when: { param: 'bodySource', is: SOURCE.sample } };
const roomOn = { when: { param: 'roomOn', is: 1 } };

export const SNARE: DeviceType = {
  type: 'snare',
  label: 'Snare',
  sections: [
    {
      label: 'Tono',
      params: [
        // G: un rullante medio (196 Hz)
        choice('note', 'Nota', Array.from({ length: NOTE_COUNT }, (_, i) => `${noteName(FIRST_NOTE + i)} · ${Math.round(noteHz(FIRST_NOTE + i))} Hz`), 10),
        num('fine', 'Fine', -50, 50, 0, 'ct', { step: 1 }),
        choice('follow', 'Note', ['Fissa', 'Segue'], FOLLOW.fixed),
      ],
    },
    {
      label: 'Colpo',
      params: [
        choice('snapSource', 'Sorgente', ['Click', 'Rumore', 'Sample']),
        percent('snapLevel', 'Livello', 50),
        num('snapTone', 'Tono', 800, 12000, 4000, 'Hz', { scale: 'log', when: { param: 'snapSource', is: [SNAP_SOURCE.click, SNAP_SOURCE.noise] } }),
        ms('snapDecay', 'Durata', 1, 400, 6),
        num('snapTune', 'Intonazione', -24, 24, 0, 'st', { step: 1, when: { param: 'snapSource', is: SNAP_SOURCE.sample } }),
      ],
    },
    {
      label: 'Pelle',
      params: [
        choice('bodySource', 'Sorgente', ['Synth', 'Sample']),
        percent('bodyLevel', 'Livello', 60),
        num('pitch', 'Caduta', 0, 24, 6, 'st', { step: 1, ...bodySynth }),
        ms('pitchTime', 'Tempo', 2, 200, 20, bodySynth),
        percent('overtone', 'Armonico', 45, bodySynth),
        percent('shape', 'Forma', 10, bodySynth),
        num('sampleTune', 'Intonazione', -24, 24, 0, 'st', { step: 1, ...bodySample }),
        num('sampleStart', 'Inizio', 0, 100, 0, '%', { step: 0.1, ...bodySample }),
        num('decay', 'Decay', 0.02, 2, 0.13, 's', { scale: 'log' }),
      ],
    },
    {
      label: 'Cordiera',
      params: [
        percent('wiresLevel', 'Livello', 70),
        num('wiresTone', 'Tono', 300, 8000, 1600, 'Hz', { scale: 'log' }),
        num('wiresDecay', 'Decay', 0.03, 2, 0.22, 's', { scale: 'log' }),
        ms('wiresDelay', 'Ritardo', 0.1, 30, 2),
        percent('grain', 'Grana', 0),
      ],
    },
    {
      label: 'Stanza',
      params: [
        choice('roomOn', 'Stanza', ['Off', 'On']),
        percent('room', 'Quantità', 30, roomOn),
        num('roomTime', 'Lunghezza', 0.1, 3, 0.6, 's', { scale: 'log', ...roomOn }),
        num('roomTone', 'Tono', 800, 16000, 6000, 'Hz', { scale: 'log', ...roomOn }),
      ],
    },
    {
      label: 'Uscita',
      params: [
        percent('drive', 'Drive', 5),
        choice('driveType', 'Saturazione', DRIVE_TYPES),
        num('lowCut', 'Taglio bassi', 20, 500, 90, 'Hz', { scale: 'log' }),
        percent('velocity', 'Velocity', 50),
        percent('velTone', 'Vel → tono', 50),
        num('volume', 'Volume', -36, 6, -6, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: snarePresets(),
};

/** I rullanti pronti. La nota resta quella del preset: si cambia per accordarlo. */
function snarePresets(): Preset[] {
  const note = (pitch: number) => pitch - FIRST_NOTE;
  return [
    { name: 'Init', params: {} },
    {
      name: '909',
      params: { note: note(57), snapSource: SNAP_SOURCE.click, snapLevel: 55, snapTone: 5000, snapDecay: 4, bodyLevel: 55, pitch: 8,
        pitchTime: 15, overtone: 55, decay: 0.1, wiresLevel: 75, wiresTone: 2200, wiresDecay: 0.18, wiresDelay: 1, drive: 15 },
    },
    {
      name: '808',
      params: { note: note(55), snapLevel: 25, bodyLevel: 70, pitch: 3, pitchTime: 30, overtone: 70, shape: 0, decay: 0.16,
        wiresLevel: 55, wiresTone: 3500, wiresDecay: 0.12, wiresDelay: 0.5, lowCut: 120 },
    },
    {
      name: 'Techno',
      params: { note: note(53), snapSource: SNAP_SOURCE.noise, snapLevel: 50, snapTone: 3500, snapDecay: 10, bodyLevel: 55, pitch: 10,
        pitchTime: 25, overtone: 35, shape: 25, decay: 0.15, wiresLevel: 80, wiresTone: 1400, wiresDecay: 0.3, roomOn: 1, room: 35,
        roomTime: 0.9, roomTone: 5000, drive: 25 },
    },
    {
      name: 'Industriale',
      params: { note: note(50), snapSource: SNAP_SOURCE.noise, snapLevel: 70, snapTone: 3000, snapDecay: 14, bodyLevel: 50, pitch: 14,
        pitchTime: 18, overtone: 30, shape: 60, decay: 0.12, wiresLevel: 85, wiresTone: 1100, wiresDecay: 0.35, grain: 35, roomOn: 1,
        room: 40, roomTime: 1.4, roomTone: 3500, drive: 55, driveType: 1, volume: -13 },
    },
    {
      name: 'Rimshot',
      params: { note: note(62), snapSource: SNAP_SOURCE.click, snapLevel: 85, snapTone: 6500, snapDecay: 3, bodyLevel: 70, pitch: 2,
        pitchTime: 8, overtone: 80, shape: 40, decay: 0.07, wiresLevel: 30, wiresTone: 2500, wiresDecay: 0.08, lowCut: 200 },
    },
    {
      name: 'Lo-fi',
      params: { note: note(52), snapSource: SNAP_SOURCE.noise, snapLevel: 40, snapTone: 2500, snapDecay: 8, bodyLevel: 60, pitch: 5,
        overtone: 40, shape: 30, decay: 0.14, wiresLevel: 75, wiresTone: 1200, wiresDecay: 0.25, grain: 70, drive: 35, driveType: 1 },
    },
    {
      name: 'Stanza grande',
      params: { note: note(55), snapLevel: 45, bodyLevel: 60, pitch: 7, overtone: 50, decay: 0.18, wiresLevel: 70, wiresTone: 1800,
        wiresDecay: 0.3, roomOn: 1, room: 60, roomTime: 1.8, roomTone: 7000 },
    },
    {
      name: 'Acustica',
      params: { note: note(56), snapSource: SNAP_SOURCE.noise, snapLevel: 45, snapTone: 4500, snapDecay: 5, bodyLevel: 65, pitch: 4,
        pitchTime: 12, overtone: 60, shape: 5, decay: 0.2, wiresLevel: 65, wiresTone: 2000, wiresDecay: 0.35, wiresDelay: 4, roomOn: 1,
        room: 25, roomTime: 0.5, velocity: 70, velTone: 80 },
    },
    {
      name: 'Breakbeat',
      params: { note: note(55), snapSource: SNAP_SOURCE.noise, snapLevel: 60, snapTone: 5000, snapDecay: 6, bodyLevel: 60, pitch: 5,
        overtone: 55, shape: 20, decay: 0.14, wiresLevel: 80, wiresTone: 2500, wiresDecay: 0.25, wiresDelay: 2, drive: 30, roomOn: 1,
        room: 20, roomTime: 0.4, velocity: 70, velTone: 70, volume: -9 },
    },
    {
      name: 'Trap',
      params: { note: note(60), snapSource: SNAP_SOURCE.click, snapLevel: 70, snapTone: 8000, snapDecay: 3, bodyLevel: 45, pitch: 10,
        pitchTime: 10, decay: 0.08, wiresLevel: 85, wiresTone: 3500, wiresDecay: 0.16, wiresDelay: 0.5, roomOn: 1, room: 35, roomTime: 0.9,
        roomTone: 9000, lowCut: 180 },
    },
    {
      name: 'Dubstep',
      params: { note: note(50), snapSource: SNAP_SOURCE.noise, snapLevel: 70, snapTone: 3000, snapDecay: 12, bodyLevel: 65, pitch: 12,
        pitchTime: 25, overtone: 40, shape: 40, decay: 0.2, wiresLevel: 85, wiresTone: 1300, wiresDecay: 0.35, roomOn: 1, room: 55,
        roomTime: 2, roomTone: 4000, drive: 40, volume: -14 },
    },
    {
      // niente bacchetta: le molle lunghe e piano, come le spazzole jazz
      name: 'Spazzole',
      params: { note: note(52), snapSource: SNAP_SOURCE.noise, snapLevel: 15, snapTone: 2000, snapDecay: 20, bodyLevel: 35, pitch: 2,
        decay: 0.12, wiresLevel: 70, wiresTone: 3000, wiresDecay: 0.6, wiresDelay: 8, grain: 20, roomOn: 1, room: 20, roomTime: 0.6,
        lowCut: 150, velocity: 80, velTone: 70 },
    },
    {
      name: 'Elettro',
      params: { note: note(57), snapSource: SNAP_SOURCE.click, snapLevel: 50, snapTone: 6000, snapDecay: 3, bodyLevel: 80, pitch: 14,
        pitchTime: 30, overtone: 60, shape: 0, decay: 0.12, wiresLevel: 50, wiresTone: 4500, wiresDecay: 0.1, lowCut: 120 },
    },
  ];
}
