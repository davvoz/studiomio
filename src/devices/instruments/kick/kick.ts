/* "Kick": an instrument just for the kick, in layers as a kick is built by hand. The Snap is
 * the attack hit (a click, noise or a sample); the Body is the "thump" (a sine falling
 * from above to the note, or a kick sample); the Tail is the sub staying on the note; the
 * Rumble is techno's dark distorted tail (a reverb of the kick, filtered, saturated and
 * squashed under the hit). Everything is tuned to a note (the kick in key), and at the output
 * there's the saturation and the low cut. Here is the description (parameters and presets); the
 * sound is in kick-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import { DRIVE_TYPES } from '../../dsp/saturate';
import type { ChoiceParam, NumberParam } from '../../params';

/** The sample slots: the body's and the snap's. */
export const BODY_SLOT = 'body';
export const SNAP_SLOT = 'snap';

/** The notes to tune the kick to: from C0 (32.7 Hz) to C2 (130.8 Hz), with Live's names (C3 = 60). */
export const FIRST_NOTE = 24;
export const NOTE_COUNT = 25;
/** The note that, when the kick follows the notes, plays as the chosen note: C1, the first pad. */
export const ROOT_NOTE = 36;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;
export const noteHz = (pitch: number) => 440 * Math.pow(2, (pitch - 69) / 12);

/** The (MIDI) note of a value of the `note` parameter. */
export const kickNote = (value: number) => FIRST_NOTE + value;

export const SOURCE = { synth: 0, sample: 1 } as const;
export const SNAP_SOURCE = { click: 0, noise: 1, sample: 2 } as const;
export const FOLLOW = { fixed: 0, notes: 1 } as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const percent = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', { step: 1, ...extra });
const ms = (id: string, label: string, min: number, max: number, def: number, extra: Partial<NumberParam> = {}) =>
  num(id, label, min, max, def, 'ms', { scale: 'log', ...extra });

const bodySynth = { when: { param: 'bodySource', is: SOURCE.synth } };
const bodySample = { when: { param: 'bodySource', is: SOURCE.sample } };
const rumbleOn = { when: { param: 'rumbleOn', is: 1 } };

export const KICK: DeviceType = {
  type: 'kick',
  label: 'Kick',
  sections: [
    {
      label: 'Tone',
      params: [
        // F: the most common kick in techno (43.7 Hz)
        choice('note', 'Note', Array.from({ length: NOTE_COUNT }, (_, i) => `${noteName(FIRST_NOTE + i)} · ${noteHz(FIRST_NOTE + i).toFixed(1)} Hz`), 5),
        num('fine', 'Fine', -50, 50, 0, 'ct', { step: 1 }),
        choice('follow', 'Note', ['Fixed', 'Follows'], FOLLOW.fixed),
      ],
    },
    {
      label: 'Snap',
      params: [
        choice('snapSource', 'Source', ['Click', 'Noise', 'Sample']),
        percent('snapLevel', 'Level', 45),
        num('snapTone', 'Tone', 500, 12000, 3500, 'Hz', { scale: 'log', when: { param: 'snapSource', is: [SNAP_SOURCE.click, SNAP_SOURCE.noise] } }),
        ms('snapDecay', 'Length', 1, 400, 9),
        num('snapTune', 'Pitch', -24, 24, 0, 'st', { step: 1, when: { param: 'snapSource', is: SNAP_SOURCE.sample } }),
      ],
    },
    {
      label: 'Body',
      params: [
        choice('bodySource', 'Source', ['Synth', 'Sample']),
        percent('bodyLevel', 'Level', 85),
        num('pitch', 'Fall', 0, 60, 30, 'st', { step: 1, ...bodySynth }),
        ms('pitchTime', 'Tempo', 5, 600, 45, bodySynth),
        percent('pitchCurve', 'Curve', 50, bodySynth),
        percent('shape', 'Shape', 15, bodySynth),
        num('sampleTune', 'Pitch', -24, 24, 0, 'st', { step: 1, ...bodySample }),
        num('sampleStart', 'Start', 0, 100, 0, '%', { step: 0.1, ...bodySample }),
        ms('attack', 'Attack', 0.1, 30, 0.5),
        num('hold', 'Hold', 0, 300, 25, 'ms', { step: 1 }),
        num('decay', 'Decay', 0.02, 3, 0.28, 's', { scale: 'log' }),
      ],
    },
    {
      label: 'Tail',
      params: [
        percent('tailLevel', 'Level', 35),
        num('tailDecay', 'Length', 0.05, 5, 0.6, 's', { scale: 'log' }),
        percent('tailDrive', 'Drive', 0),
      ],
    },
    {
      label: 'Rumble',
      params: [
        choice('rumbleOn', 'Rumble', ['Off', 'On']),
        percent('rumble', 'Amount', 50, rumbleOn),
        num('rumbleTime', 'Length', 0.2, 4, 0.9, 's', { scale: 'log', ...rumbleOn }),
        num('rumbleTone', 'Tone', 40, 600, 140, 'Hz', { scale: 'log', ...rumbleOn }),
        percent('rumbleDrive', 'Drive', 55, rumbleOn),
        percent('rumbleDuck', 'Ducking', 80, rumbleOn),
      ],
    },
    {
      label: 'Output',
      params: [
        percent('drive', 'Drive', 10),
        choice('driveType', 'Saturation', DRIVE_TYPES),
        num('lowCut', 'Low cut', 15, 150, 25, 'Hz', { scale: 'log' }),
        percent('velocity', 'Velocity', 30),
        num('volume', 'Volume', -36, 6, -6, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: kickPresets(),
};

/** The ready-made kicks. The note stays the preset's: change it to put the kick in key. */
function kickPresets(): Preset[] {
  const note = (pitch: number) => pitch - FIRST_NOTE;
  return [
    { name: 'Init', params: {} },
    {
      name: '909',
      params: { note: note(31), snapSource: SNAP_SOURCE.noise, snapLevel: 40, snapTone: 4500, snapDecay: 14, pitch: 24, pitchTime: 35,
        pitchCurve: 60, shape: 25, hold: 10, decay: 0.22, tailLevel: 25, tailDecay: 0.35, drive: 20 },
    },
    {
      name: 'Long 808',
      params: { note: note(29), snapLevel: 20, snapTone: 2500, snapDecay: 4, pitch: 14, pitchTime: 60, pitchCurve: 40, shape: 0,
        hold: 40, decay: 0.5, tailLevel: 80, tailDecay: 2.4, tailDrive: 15, drive: 5 },
    },
    {
      name: 'Techno',
      params: { note: note(29), snapLevel: 50, snapTone: 3800, snapDecay: 8, pitch: 32, pitchTime: 42, pitchCurve: 55, shape: 20,
        hold: 25, decay: 0.26, tailLevel: 35, tailDecay: 0.55, drive: 18 },
    },
    {
      name: 'Rumble',
      params: { note: note(29), snapLevel: 55, snapTone: 4200, snapDecay: 7, pitch: 34, pitchTime: 38, pitchCurve: 60, shape: 30,
        hold: 20, decay: 0.22, tailLevel: 20, tailDecay: 0.4, rumbleOn: 1, rumble: 65, rumbleTime: 1.2, rumbleTone: 130, rumbleDrive: 70,
        rumbleDuck: 85, drive: 25, driveType: 0 },
    },
    {
      name: 'Industrial',
      params: { note: note(31), snapSource: SNAP_SOURCE.noise, snapLevel: 60, snapTone: 3000, snapDecay: 18, pitch: 36, pitchTime: 30,
        pitchCurve: 70, shape: 55, hold: 15, decay: 0.2, tailLevel: 30, tailDecay: 0.45, tailDrive: 40, drive: 45, driveType: 1, lowCut: 35 },
    },
    {
      name: 'Deep',
      params: { note: note(26), snapLevel: 30, snapTone: 2800, snapDecay: 6, pitch: 20, pitchTime: 70, pitchCurve: 35, shape: 5,
        hold: 35, decay: 0.4, tailLevel: 60, tailDecay: 1.2, drive: 8, lowCut: 20 },
    },
    {
      // a skin kick: little drop, the beater made of noise, no tail
      name: 'Acoustic',
      params: { note: note(33), snapSource: SNAP_SOURCE.noise, snapLevel: 50, snapTone: 2500, snapDecay: 12, pitch: 8, pitchTime: 20,
        pitchCurve: 50, shape: 10, hold: 5, decay: 0.18, tailLevel: 15, tailDecay: 0.2, drive: 5, lowCut: 30, velocity: 60, volume: -3 },
    },
    {
      name: 'Dry',
      params: { note: note(33), snapLevel: 55, snapTone: 5000, snapDecay: 5, pitch: 28, pitchTime: 25, pitchCurve: 65, shape: 20,
        hold: 8, decay: 0.12, tailLevel: 10, tailDecay: 0.15, drive: 15 },
    },
    {
      name: 'House',
      params: { note: note(31), snapLevel: 40, snapTone: 4000, snapDecay: 8, pitch: 22, pitchTime: 40, pitchCurve: 55, shape: 15,
        hold: 20, decay: 0.3, tailLevel: 40, tailDecay: 0.5, drive: 12 },
    },
    {
      name: 'Trance',
      params: { note: note(33), snapLevel: 60, snapTone: 6000, snapDecay: 6, pitch: 36, pitchTime: 30, pitchCurve: 65, shape: 30,
        hold: 15, decay: 0.24, tailLevel: 30, tailDecay: 0.4, drive: 25 },
    },
    {
      // soft and long, with a light rumble tail blending with the bass
      name: 'Dub techno',
      params: { note: note(28), snapLevel: 20, snapTone: 2000, snapDecay: 6, pitch: 18, pitchTime: 60, pitchCurve: 40, shape: 5,
        hold: 30, decay: 0.35, tailLevel: 55, tailDecay: 1, rumbleOn: 1, rumble: 35, rumbleTime: 2, rumbleTone: 90, rumbleDrive: 30,
        rumbleDuck: 60, drive: 5 },
    },
    {
      name: 'Hardgroove',
      params: { note: note(30), snapSource: SNAP_SOURCE.noise, snapLevel: 55, snapTone: 3500, snapDecay: 12, pitch: 30, pitchTime: 35,
        pitchCurve: 60, shape: 35, hold: 18, decay: 0.22, tailLevel: 25, tailDecay: 0.35, drive: 35, driveType: 1, volume: -8 },
    },
    {
      name: 'Electro',
      params: { note: note(31), snapLevel: 70, snapTone: 7000, snapDecay: 3, pitch: 12, pitchTime: 50, pitchCurve: 40, shape: 0,
        hold: 30, decay: 0.35, tailLevel: 50, tailDecay: 0.7, drive: 10 },
    },
    {
      // a short high hit, almost only click
      name: 'Minimal',
      params: { note: note(36), snapLevel: 65, snapTone: 8000, snapDecay: 2, pitch: 20, pitchTime: 20, pitchCurve: 50, shape: 0,
        hold: 5, decay: 0.1, tailLevel: 5, tailDecay: 0.1, drive: 0, volume: -2 },
    },
    {
      name: 'Breakbeat',
      params: { note: note(34), snapSource: SNAP_SOURCE.noise, snapLevel: 60, snapTone: 3000, snapDecay: 15, pitch: 10, pitchTime: 15,
        pitchCurve: 50, shape: 20, hold: 8, decay: 0.16, tailLevel: 10, tailDecay: 0.15, drive: 20, velocity: 60 },
    },
  ];
}
