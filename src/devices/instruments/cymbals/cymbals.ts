/* "Hat and Cymbals": an instrument just for the drum kit's metals. Six pieces, on the notes of the
 * General MIDI map (so drum parts written elsewhere play right): closed hi-hat,
 * pedal and open, crash, ride and the ride bell. Each piece is a synth (the "metal": six
 * squares detuned from each other as in the 808, plus noise and a bell's partials, filtered) or a
 * sample, with pitch, decay, brightness, level and pan. As in a real hi-hat, the
 * closed and the pedal stop the open one. For all: the kind of metal, the hit-to-hit
 * variation (no "machine gun"), the stereo width, the saturation. Here is the description;
 * the sound is in cymbals-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection } from '../../params';

/** A piece: its name, its note and the values it starts with. */
export interface Piece {
  readonly id: string;
  readonly label: string;
  readonly note: number;
  readonly decay: number;
  readonly tune: number;
  readonly tone: number;
  readonly noise: number;
  readonly bell: number;
  readonly level: number;
  readonly pan: number;
  /** The hi-hat pieces: the closed and the pedal stop the open one. */
  readonly hat?: 'closes' | 'open';
}

export const PIECES: readonly Piece[] = [
  { id: 'closed', label: 'Closed hat', note: 42, decay: 0.07, tune: 0, tone: 60, noise: 35, bell: 0, level: -4, pan: 15, hat: 'closes' },
  { id: 'pedal', label: 'Pedal hat', note: 44, decay: 0.05, tune: -1, tone: 45, noise: 25, bell: 0, level: -7, pan: 15, hat: 'closes' },
  { id: 'open', label: 'Open hat', note: 46, decay: 0.55, tune: 0, tone: 58, noise: 40, bell: 0, level: -6, pan: 15, hat: 'open' },
  { id: 'crash', label: 'Crash', note: 49, decay: 2.4, tune: -3, tone: 50, noise: 60, bell: 5, level: -8, pan: -25 },
  { id: 'ride', label: 'Ride', note: 51, decay: 3, tune: 0, tone: 55, noise: 20, bell: 30, level: -9, pan: 30 },
  { id: 'bell', label: 'Bell', note: 53, decay: 1.6, tune: 2, tone: 70, noise: 5, bell: 85, level: -10, pan: 30 },
];

export type PieceKey = 'source' | 'tune' | 'decay' | 'tone' | 'noise' | 'bell' | 'level' | 'pan';

/** The id of parameter `key` of piece `index`: "closedDecay", "rideBell"… */
export const pieceParam = (index: number, key: PieceKey): string => `${PIECES[index].id}${key[0].toUpperCase()}${key.slice(1)}`;

/** The sample slot of piece `index`: its id ("closed", "ride"…). */
export const pieceSlot = (index: number): string => PIECES[index].id;

export const pieceOfSlot = (slot: string): number => PIECES.findIndex(p => p.id === slot);

export const pieceOfNote = (pitch: number): number => PIECES.findIndex(p => p.note === pitch);

export const SOURCE = { synth: 0, sample: 1 } as const;
/** The metal of the synth pieces: the 808's squares, another more detuned group, or the squares
 *  multiplied in pairs (ring modulation: more metallic, almost a gong). */
export const METALS = ['808', 'Rough', 'Ring'] as const;
export const MAX_DECAY = 8;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', { step: 1, ...extra });

function pieceSection(i: number): ParamSection {
  const p = PIECES[i], id = (key: PieceKey) => pieceParam(i, key);
  const synth = { when: { param: id('source'), is: SOURCE.synth } };
  const source: ChoiceParam = { kind: 'choice', id: id('source'), label: 'Source', options: ['Synth', 'Sample'], default: SOURCE.synth };
  return {
    label: p.label,
    params: [
      source,
      num(id('tune'), 'Pitch', -24, 24, p.tune, 'st', { step: 1 }),
      num(id('decay'), 'Decay', 0.01, MAX_DECAY, p.decay, 's', { scale: 'log' }),
      percent(id('tone'), 'Brightness', p.tone),
      percent(id('noise'), 'Noise', p.noise, synth),
      percent(id('bell'), 'Bell', p.bell, synth),
      num(id('level'), 'Level', -36, 6, p.level, 'dB', { step: 0.5 }),
      num(id('pan'), 'Pan', -100, 100, p.pan, 'pan', { step: 1 }),
    ],
  };
}

/** The values of a piece for a preset: only the given ones. */
const piece = (index: number, values: Partial<Record<PieceKey, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(values).map(([key, v]) => [pieceParam(index, key as PieceKey), v]));

const PRESETS: readonly Preset[] = [
  { name: 'Init', params: {} },
  {
    name: '808',
    params: { metal: 0, variation: 10, width: 30, ...piece(0, { decay: 0.05, tone: 55, noise: 15 }), ...piece(2, { decay: 0.7, noise: 15 }),
      ...piece(3, { decay: 1.8, noise: 30, tone: 45 }) },
  },
  {
    name: 'Dry techno',
    params: { metal: 1, variation: 25, width: 45, drive: 20, ...piece(0, { decay: 0.035, tone: 72, noise: 55 }),
      ...piece(1, { decay: 0.03, tone: 65 }), ...piece(2, { decay: 0.3, tone: 70, noise: 55 }),
      ...piece(4, { decay: 1.8, tone: 68, bell: 45, noise: 30 }) },
  },
  {
    name: 'Industrial',
    params: { metal: 2, variation: 30, width: 50, drive: 45, ...piece(0, { decay: 0.06, tone: 50, noise: 45, tune: -4 }),
      ...piece(2, { decay: 0.5, tone: 48, noise: 50, tune: -4 }), ...piece(3, { decay: 3.5, tune: -8, tone: 40, noise: 70 }),
      ...piece(4, { tune: -5, bell: 50 }) },
  },
  {
    // dark, dirty and a bit different at every hit
    name: 'Lo-fi',
    params: { metal: 0, variation: 55, width: 25, drive: 30, ...piece(0, { decay: 0.06, tone: 38, noise: 30 }),
      ...piece(2, { decay: 0.45, tone: 40, noise: 35 }), ...piece(4, { decay: 2.4, tone: 40, bell: 35, noise: 20 }) },
  },
  {
    name: 'Acoustic',
    params: { metal: 1, variation: 40, width: 60, ...piece(0, { decay: 0.09, tone: 52, noise: 60 }),
      ...piece(2, { decay: 0.9, tone: 50, noise: 65 }), ...piece(3, { decay: 3, tone: 45, noise: 75 }),
      ...piece(4, { decay: 3.6, tone: 50, noise: 35, bell: 25 }) },
  },
  {
    name: '909',
    params: { metal: 1, variation: 15, width: 35, drive: 10, ...piece(0, { decay: 0.06, tone: 75, noise: 40 }),
      ...piece(2, { decay: 0.45, tone: 72, noise: 45 }), ...piece(3, { decay: 2.8, tone: 65, noise: 70 }),
      ...piece(4, { decay: 3.2, tone: 70, bell: 40 }), volume: 0 },
  },
  {
    // very short hats for the rolls
    name: 'Trap',
    params: { metal: 0, variation: 30, width: 50, ...piece(0, { decay: 0.025, tone: 80, noise: 30, level: -3 }),
      ...piece(1, { decay: 0.02, tone: 75 }), ...piece(2, { decay: 0.25, tone: 75 }), ...piece(3, { decay: 2, tone: 70 }), volume: 2 },
  },
  {
    name: 'Dub',
    params: { metal: 0, variation: 35, width: 80, ...piece(0, { decay: 0.1, tone: 45, noise: 50 }),
      ...piece(2, { decay: 1.2, tone: 42, noise: 55 }), ...piece(3, { decay: 4, tone: 40, noise: 60 }),
      ...piece(4, { decay: 5, tone: 45, bell: 25 }), volume: -1 },
  },
  {
    // the ring metal, tuned low and long: gongs and bells
    name: 'Gong',
    params: { metal: 2, variation: 10, width: 70, ...piece(2, { decay: 2, tune: -8, tone: 40 }),
      ...piece(3, { decay: 7, tune: -12, tone: 35, noise: 30, bell: 60 }), ...piece(4, { decay: 6, tune: -7, bell: 80 }),
      ...piece(5, { decay: 5, tune: -5 }) },
  },
  {
    name: 'Minimal',
    params: { metal: 1, variation: 10, width: 20, ...piece(0, { decay: 0.03, tone: 85, noise: 20 }),
      ...piece(2, { decay: 0.2, tone: 80 }), ...piece(4, { decay: 1.5, tone: 80, bell: 55 }), volume: 6 },
  },
];

export const CYMBALS: DeviceType = {
  type: 'cymbals',
  label: 'Hats and Cymbals',
  sections: [
    ...PIECES.map((_, i) => pieceSection(i)),
    {
      label: 'All',
      params: [
        { kind: 'choice', id: 'metal', label: 'Metal', options: METALS, default: 0 },
        percent('variation', 'Variation', 20),
        percent('width', 'Width', 40),
        percent('drive', 'Drive', 0),
        percent('velocity', 'Velocity', 60),
        num('volume', 'Volume', -36, 6, -4, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: PRESETS,
  noteNames: () => new Map(PIECES.map(p => [p.note, p.label])),
};
