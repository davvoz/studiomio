/* "Spectral Resonator": makes any sound ring at a chosen pitch, as Live's Spectral Resonator. The
 * sound is split into its spectrum; only the parts near the partials of the chosen note (and of
 * its chord) are kept, and they keep ringing for the Decay, so a drum loop or a voice becomes a
 * tuned, metallic or glassy chord. Damping darkens the higher partials, Stretch and Shift move
 * them away from the harmonic series (bells, metal), Unison doubles the note slightly detuned
 * and spread in stereo, Mod moves the partials (Chorus, Wander) or chops them in grains (Granular).
 * Resolution is the size of the spectrum: higher is more precise on low notes, but the resonance
 * arrives a little later. Here there's only the description; the sound is in spectral-resonator-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The notes of the "Note" menu: MIDI pitches from C1 to C7 (Live's names: C3 = 60). */
export const FIRST_NOTE = 24;
export const NOTE_COUNT = 73;

export const noteHz = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);
const noteLabel = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2} · ${noteHz(pitch).toFixed(1)} Hz`;

/** The chords: semitones above the note, each one rings with its own partials. */
export const CHORDS: readonly { readonly label: string; readonly steps: readonly number[] }[] = [
  { label: 'Single note', steps: [0] },
  { label: 'Octave', steps: [0, 12] },
  { label: 'Fifth', steps: [0, 7] },
  { label: 'Power', steps: [0, 7, 12] },
  { label: 'Major', steps: [0, 4, 7] },
  { label: 'Minor', steps: [0, 3, 7] },
  { label: 'Sus4', steps: [0, 5, 7] },
  { label: 'Major 7', steps: [0, 4, 7, 11] },
  { label: 'Minor 7', steps: [0, 3, 7, 10] },
  { label: 'Phrygian', steps: [0, 1, 7] },
];

/** How the partials move: still, a slow vibrato each (Chorus), a random drift (Wander) or
 *  switched on and off at random (Granular). */
export const MOD_MODES = ['None', 'Chorus', 'Wander', 'Granular'] as const;
export const MOD = { none: 0, chorus: 1, wander: 2, granular: 3 } as const;

/** The spectrum's sizes (FFT points): the resonance arrives this many samples later. */
export const RESOLUTIONS = [{ label: 'Low', size: 1024 }, { label: 'Medium', size: 2048 }, { label: 'High', size: 4096 }] as const;

export const MAX_PARTIALS = 64;
export const MAX_UNISON = 8;

export const SPECTRAL_RESONATOR: DeviceType = {
  type: 'spectralResonator',
  label: 'Spectral Resonator',
  sections: [
    {
      label: 'Pitch',
      params: [
        choice('note', 'Note', Array.from({ length: NOTE_COUNT }, (_, i) => noteLabel(FIRST_NOTE + i)), 45 - FIRST_NOTE),
        num('fine', 'Fine', -100, 100, 0, 'ct', { step: 1 }),
        choice('chord', 'Chord', CHORDS.map(c => c.label)),
      ],
    },
    {
      label: 'Resonance',
      params: [
        num('decay', 'Decay', 20, 20000, 1200, 'ms', { scale: 'log', step: 1 }),
        num('damping', 'Damping', 0, 100, 40, '%', { step: 1 }),
        num('partials', 'Partials', 1, MAX_PARTIALS, 24, '', { step: 1 }),
        num('stretch', 'Stretch', -100, 100, 0, '%', { step: 1 }),
        num('shift', 'Shift', -500, 500, 0, 'Hz', { step: 1 }),
      ],
    },
    {
      label: 'Voices',
      params: [
        num('unison', 'Unison', 1, MAX_UNISON, 1, '', { step: 1 }),
        num('detune', 'Detune', 0, 50, 15, 'ct', { step: 1 }),
        choice('mod', 'Mod', MOD_MODES),
        num('modRate', 'Rate', 0.05, 20, 0.5, 'Hz', { scale: 'log', step: 0.01, when: { param: 'mod', is: [MOD.chorus, MOD.wander, MOD.granular] } }),
        num('modAmount', 'Amount', 0, 100, 40, '%', { step: 1, when: { param: 'mod', is: [MOD.chorus, MOD.wander, MOD.granular] } }),
      ],
    },
    {
      label: 'Output',
      params: [
        num('input', 'Input', -24, 12, 0, 'dB', { step: 0.1 }),
        choice('resolution', 'Resolution', RESOLUTIONS.map(r => r.label), 1),
        num('mix', 'Dry/Wet', 0, 100, 50, '%', { step: 1 }),
        num('output', 'Output', -24, 12, 0, 'dB', { step: 0.1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Tuned drums', params: { note: 33 - FIRST_NOTE, decay: 600, damping: 55, partials: 16, input: -3, mix: 45 } },
    { name: 'Dark choir', params: { note: 41 - FIRST_NOTE, chord: 5, decay: 3000, damping: 70, unison: 4, detune: 18, mod: MOD.chorus, modRate: 0.3, input: 6.5, mix: 60 } },
    { name: 'Phrygian drone', params: { note: 40 - FIRST_NOTE, chord: 9, decay: 8000, damping: 60, unison: 3, mod: MOD.wander, modRate: 0.2, input: 3.5, mix: 55 } },
    { name: 'Metal bells', params: { note: 57 - FIRST_NOTE, decay: 2500, damping: 15, stretch: 35, partials: 20, input: 3, mix: 50 } },
    { name: 'Broken radio', params: { note: 50 - FIRST_NOTE, decay: 400, damping: 30, shift: 180, partials: 32, input: 6.5, mix: 70 } },
    { name: 'Glass grains', params: { note: 64 - FIRST_NOTE, chord: 1, decay: 1800, damping: 20, mod: MOD.granular, modRate: 8, modAmount: 70, input: 9, mix: 50 } },
    { name: 'Wide pad', params: { note: 45 - FIRST_NOTE, chord: 4, decay: 5000, damping: 50, unison: 6, detune: 25, mod: MOD.chorus, input: 5.5, mix: 65 } },
    { name: 'Sub resonance', params: { note: 28 - FIRST_NOTE, decay: 900, damping: 85, partials: 6, resolution: 2, input: -4.5, mix: 35 } },
  ],
};
