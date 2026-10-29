/* "Kick": uno strumento solo per la cassa, a strati come si costruisce un kick a mano. Lo Snap è
 * il colpo d'attacco (un click, del rumore o un sample); il Corpo è il "tump" (un seno che cade
 * dall'alto fino alla nota, o un sample di cassa); la Coda è il sub che resta sulla nota; il
 * Rumble è la coda scura e distorta della techno (un riverbero della cassa, filtrato, saturato e
 * schiacciato sotto il colpo). Tutto è accordato su una nota (la cassa in tonalità), e in uscita
 * c'è la saturazione e il taglio dei bassi. Qui c'è la descrizione (parametri e preset); il
 * suono è in kick-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import { DRIVE_TYPES } from '../../dsp/saturate';
import type { ChoiceParam, NumberParam } from '../../params';

/** I posti dei sample: quello del corpo e quello dello snap. */
export const BODY_SLOT = 'body';
export const SNAP_SLOT = 'snap';

/** Le note su cui accordare la cassa: da C0 (32,7 Hz) a C2 (130,8 Hz), con i nomi di Live (C3 = 60). */
export const FIRST_NOTE = 24;
export const NOTE_COUNT = 25;
/** La nota che, quando la cassa segue le note, suona come la nota scelta: C1, il primo pad. */
export const ROOT_NOTE = 36;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;
export const noteHz = (pitch: number) => 440 * Math.pow(2, (pitch - 69) / 12);

/** La nota (MIDI) di un valore del parametro `note`. */
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
      label: 'Tono',
      params: [
        // F: la cassa più comune nella techno (43,7 Hz)
        choice('note', 'Nota', Array.from({ length: NOTE_COUNT }, (_, i) => `${noteName(FIRST_NOTE + i)} · ${noteHz(FIRST_NOTE + i).toFixed(1)} Hz`), 5),
        num('fine', 'Fine', -50, 50, 0, 'ct', { step: 1 }),
        choice('follow', 'Note', ['Fissa', 'Segue'], FOLLOW.fixed),
      ],
    },
    {
      label: 'Snap',
      params: [
        choice('snapSource', 'Sorgente', ['Click', 'Rumore', 'Sample']),
        percent('snapLevel', 'Livello', 45),
        num('snapTone', 'Tono', 500, 12000, 3500, 'Hz', { scale: 'log', when: { param: 'snapSource', is: [SNAP_SOURCE.click, SNAP_SOURCE.noise] } }),
        ms('snapDecay', 'Durata', 1, 400, 9),
        num('snapTune', 'Intonazione', -24, 24, 0, 'st', { step: 1, when: { param: 'snapSource', is: SNAP_SOURCE.sample } }),
      ],
    },
    {
      label: 'Corpo',
      params: [
        choice('bodySource', 'Sorgente', ['Synth', 'Sample']),
        percent('bodyLevel', 'Livello', 85),
        num('pitch', 'Caduta', 0, 60, 30, 'st', { step: 1, ...bodySynth }),
        ms('pitchTime', 'Tempo', 5, 600, 45, bodySynth),
        percent('pitchCurve', 'Curva', 50, bodySynth),
        percent('shape', 'Forma', 15, bodySynth),
        num('sampleTune', 'Intonazione', -24, 24, 0, 'st', { step: 1, ...bodySample }),
        num('sampleStart', 'Inizio', 0, 100, 0, '%', { step: 0.1, ...bodySample }),
        ms('attack', 'Attacco', 0.1, 30, 0.5),
        num('hold', 'Hold', 0, 300, 25, 'ms', { step: 1 }),
        num('decay', 'Decay', 0.02, 3, 0.28, 's', { scale: 'log' }),
      ],
    },
    {
      label: 'Coda',
      params: [
        percent('tailLevel', 'Livello', 35),
        num('tailDecay', 'Lunghezza', 0.05, 5, 0.6, 's', { scale: 'log' }),
        percent('tailDrive', 'Drive', 0),
      ],
    },
    {
      label: 'Rumble',
      params: [
        choice('rumbleOn', 'Rumble', ['Off', 'On']),
        percent('rumble', 'Quantità', 50, rumbleOn),
        num('rumbleTime', 'Lunghezza', 0.2, 4, 0.9, 's', { scale: 'log', ...rumbleOn }),
        num('rumbleTone', 'Tono', 40, 600, 140, 'Hz', { scale: 'log', ...rumbleOn }),
        percent('rumbleDrive', 'Drive', 55, rumbleOn),
        percent('rumbleDuck', 'Ducking', 80, rumbleOn),
      ],
    },
    {
      label: 'Uscita',
      params: [
        percent('drive', 'Drive', 10),
        choice('driveType', 'Saturazione', DRIVE_TYPES),
        num('lowCut', 'Taglio bassi', 15, 150, 25, 'Hz', { scale: 'log' }),
        percent('velocity', 'Velocity', 30),
        num('volume', 'Volume', -36, 6, -6, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: kickPresets(),
};

/** Le casse pronte. La nota resta quella del preset: si cambia per mettere la cassa in tonalità. */
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
      name: '808 lunga',
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
      name: 'Industriale',
      params: { note: note(31), snapSource: SNAP_SOURCE.noise, snapLevel: 60, snapTone: 3000, snapDecay: 18, pitch: 36, pitchTime: 30,
        pitchCurve: 70, shape: 55, hold: 15, decay: 0.2, tailLevel: 30, tailDecay: 0.45, tailDrive: 40, drive: 45, driveType: 1, lowCut: 35 },
    },
    {
      name: 'Profonda',
      params: { note: note(26), snapLevel: 30, snapTone: 2800, snapDecay: 6, pitch: 20, pitchTime: 70, pitchCurve: 35, shape: 5,
        hold: 35, decay: 0.4, tailLevel: 60, tailDecay: 1.2, drive: 8, lowCut: 20 },
    },
    {
      name: 'Secca',
      params: { note: note(33), snapLevel: 55, snapTone: 5000, snapDecay: 5, pitch: 28, pitchTime: 25, pitchCurve: 65, shape: 20,
        hold: 8, decay: 0.12, tailLevel: 10, tailDecay: 0.15, drive: 15 },
    },
  ];
}
