/* "Prisma": the big wavetable synth, like Serum (without effects). Two wavetable
 * oscillators with the warps (sync, bend, PWM, asymmetry, mirror, FM/AM/RM from the other oscillator…)
 * and a unison of up to 16 copies, the sub, the noise, two filters (in series or in parallel, each
 * source chooses where to go), four envelopes with curves (the first is the volume), four
 * drawable LFOs and four macros. Everything moves from the modulation matrix: 16 slots,
 * each with a source, a target (almost every knob), the amount as a fraction of the
 * knob's travel, the polarity, a curve and an "aux" source scaling it. In the panel
 * a source is dragged onto a knob and the modulation is born there.
 * Here there's only the description (parameters, sources, targets); the presets are in
 * prisma-presets.ts, the sound in prisma-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { LFO_SYNC, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { TABLE_NAMES } from '../wavetable/tables';
import { LFO_POINTS, LFO_SHAPE, LFO_SHAPES, pointCountParam, pointParam, pointsForShape } from './shapes';
import { prismaPresets } from './prisma-presets';

export { LFO_SYNC, VOICE_MODE };

/** At most this many unison copies of an oscillator. */
export const MAX_UNISON = 16;
/** Slots of the modulation matrix. */
export const MOD_SLOTS = 16;
export const OSCS = ['a', 'b'] as const;
export type OscKey = typeof OSCS[number];
export const LFOS = 4;
export const ENVS = 4;
export const MACROS = 4;

/** An oscillator's tables: the generated ones, then the imported file (one WAV per oscillator). */
export const PRISMA_TABLES = [...TABLE_NAMES, 'Imported file'] as const;
export const USER_TABLE = PRISMA_TABLES.length - 1;
/** The slot of the sample imported as a table for the oscillator. */
export const tableSlot = (o: OscKey): string => `wt${o.toUpperCase()}`;

/** The warps: how the oscillator reads its table. The phase ones (sync, bend, PWM, asymmetry)
 *  bend the period's time; the others change the sound read; FM, AM and RM take
 *  the other oscillator (which must be on: even at level zero it acts as modulator). */
export const WARPS = ['None', 'Sync', 'Soft sync', 'Bend +', 'Bend −', 'Bend ±', 'PWM', 'Asym. +', 'Asym. −', 'Mirror',
  'Flip', 'Quantize', 'FM', 'AM', 'RM', 'FM from the Sub'] as const;
export const WARP = {
  none: 0, sync: 1, softSync: 2, bendUp: 3, bendDown: 4, bendBoth: 5, pwm: 6, asymUp: 7, asymDown: 8, mirror: 9,
  flip: 10, quantize: 11, fm: 12, am: 13, rm: 14, subFm: 15,
} as const;
/** The warps reading the other oscillator. */
export const CROSS_WARPS: readonly number[] = [WARP.fm, WARP.am, WARP.rm];

export const SUB_SHAPES = ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse'] as const;
export const NOISE_TYPES = ['White', 'Pink', 'Brown', 'Digital', 'Crackle'] as const;
export const NOISE = { white: 0, pink: 1, brown: 2, digital: 3, crackle: 4 } as const;

export const FILTER_TYPES = ['LP 12', 'LP 24', 'LP Ladder', 'HP 12', 'HP 24', 'BP 12', 'BP 24', 'Notch', 'Peak', 'Comb +', 'Comb −',
  'Formant', 'Phaser'] as const;
export const FILTER = {
  lp12: 0, lp24: 1, ladder: 2, hp12: 3, hp24: 4, bp12: 5, bp24: 6, notch: 7, peak: 8, combUp: 9, combDown: 10, formant: 11, phaser: 12,
} as const;
/** Where each source goes. In series the first filter goes into the second: "Both" is like "Filter 1". */
export const ROUTES = ['Filter 1', 'Filter 2', 'Both', 'Direct'] as const;
export const ROUTE = { f1: 0, f2: 1, both: 2, direct: 3 } as const;
export const FILTER_MODES = ['Series', 'Parallel'] as const;
export const FILTER_MODE = { serial: 0, parallel: 1 } as const;

/** Note: the LFO restarts at every note. Free: all the voices follow the same cycle. Once:
 *  it does a single cycle and stays on the last value (a drawn envelope). */
export const LFO_TRIGS = ['Note', 'Free', 'Once'] as const;
export const LFO_TRIG = { note: 0, free: 1, once: 2 } as const;
export { LFO_SHAPE, LFO_SHAPES };

export const ON_OFF = ['Off', 'On'] as const;
export const POLARITIES = ['Uni', 'Bi'] as const;

/** The modulation sources, in the order of the options. They all go from 0 to 1; the matrix makes them
 *  bipolar if the slot is "Bi". */
export const SOURCES = ['—', 'Env 1', 'Env 2', 'Env 3', 'Env 4', 'LFO 1', 'LFO 2', 'LFO 3', 'LFO 4', 'Velocity', 'Note', 'Random',
  'Gate', 'Macro 1', 'Macro 2', 'Macro 3', 'Macro 4'] as const;
export const SRC = {
  none: 0, env1: 1, env2: 2, env3: 3, env4: 4, lfo1: 5, lfo2: 6, lfo3: 7, lfo4: 8, velocity: 9, note: 10, random: 11, gate: 12,
  macro1: 13, macro2: 14, macro3: 15, macro4: 16,
} as const;
export const isLfoSource = (src: number): boolean => src >= SRC.lfo1 && src <= SRC.lfo4;
export const isEnvSource = (src: number): boolean => src >= SRC.env1 && src <= SRC.env4;

/** The parameters of a matrix slot. */
export const slotParam = (n: number, field: 'Src' | 'Dst' | 'Amt' | 'Pol' | 'Curve' | 'Aux'): string => `m${n}${field}`;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number, max = 10) => num(id, label, 0.001, max, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
const onOff = (id: string, on: boolean) => choice(id, 'On', ON_OFF, on ? 1 : 0);
const unisonOn = (o: OscKey) => ({ param: `${o}Unison`, is: Array.from({ length: MAX_UNISON - 1 }, (_, i) => i + 2) });

/** An oscillator; `pos`: where the position starts (A starts from the Base table's saw). */
const oscParams = (o: OscKey, on: boolean, table: number, pos: number): ParamSpec[] => [
  onOff(`${o}On`, on),
  choice(`${o}Table`, 'Table', PRISMA_TABLES, table),
  percent(`${o}Pos`, 'Position', pos),
  choice(`${o}Warp`, 'Warp', WARPS),
  percent(`${o}WarpAmt`, 'Amount', 0),
  num(`${o}Oct`, 'Octave', -4, 4, 0, '', { step: 1 }),
  num(`${o}Semi`, 'Semitones', -12, 12, 0, 'st', { step: 1 }),
  num(`${o}Fine`, 'Fine', -100, 100, 0, 'ct', { step: 1 }),
  num(`${o}Unison`, 'Unison', 1, MAX_UNISON, 1, '', { step: 1 }),
  num(`${o}Detune`, 'Detune', 0, 100, 25, 'ct', { step: 1, when: unisonOn(o) }),
  { ...percent(`${o}Blend`, 'Blend', 75), when: unisonOn(o) },
  { ...percent(`${o}Width`, 'Stereo', 80), when: unisonOn(o) },
  { ...percent(`${o}Spread`, 'Pos. ±', 0), when: unisonOn(o) },
  num(`${o}Phase`, 'Phase', 0, 360, 0, '°', { step: 1 }),
  percent(`${o}Rand`, 'Random', 100),
  percent(`${o}Level`, 'Level', 75),
  num(`${o}Pan`, 'Pan', -100, 100, 0, 'pan', { step: 1 }),
];

const filterParams = (f: 1 | 2, on: boolean, type: number, cutoff: number): ParamSpec[] => [
  onOff(`f${f}On`, on),
  choice(`f${f}Type`, 'Type', FILTER_TYPES, type),
  num(`f${f}Cutoff`, 'Cutoff', 20, 20000, cutoff, 'Hz', { scale: 'log' }),
  percent(`f${f}Res`, 'Resonance', 0),
  percent(`f${f}Drive`, 'Drive', 0),
  percent(`f${f}Var`, 'Var', 50),
  percent(`f${f}Key`, 'Key track', 0),
  percent(`f${f}Mix`, 'Mix', 100),
];

/** Envelope `n`: the first is the volume (full sustain), the others start as a pluck. */
const envParams = (n: number): ParamSpec[] => {
  const amp = n === 1;
  return [
    time(`e${n}A`, 'Attack', amp ? 0.002 : 0.005),
    time(`e${n}H`, 'Hold', 0.001),
    time(`e${n}D`, 'Decay', amp ? 1 : 0.5),
    percent(`e${n}S`, 'Sustain', amp ? 100 : 0),
    time(`e${n}R`, 'Release', amp ? 0.05 : 0.3),
    num(`e${n}Ac`, 'Curve A', -100, 100, 0, '', { step: 1 }),
    num(`e${n}Dc`, 'Curve D', -100, 100, 60, '', { step: 1 }),
    num(`e${n}Rc`, 'Curve R', -100, 100, 60, '', { step: 1 }),
  ];
};

/** LFO `n`, with the points of the drawn shape (hidden: they move only from the drawing). */
const lfoParams = (n: number, division: number): ParamSpec[] => {
  const start = pointsForShape(LFO_SHAPE.triangle);
  const hidden = { hidden: true };
  const points: ParamSpec[] = [num(pointCountParam(n), 'Points', 2, LFO_POINTS, start.length, '', { step: 1, ...hidden })];
  for (let k = 1; k <= LFO_POINTS; k++) {
    const p = start[k - 1];
    points.push(
      num(pointParam(n, 'X', k), `Point ${k} x`, 0, 1, p?.x ?? 1, '', hidden),
      num(pointParam(n, 'Y', k), `Point ${k} y`, 0, 1, p?.y ?? 0, '', hidden),
      num(pointParam(n, 'C', k), `Point ${k} curve`, -100, 100, 0, '', { step: 1, ...hidden }),
    );
  }
  return [
    choice(`l${n}Shape`, 'Shape', LFO_SHAPES),
    choice(`l${n}Sync`, 'Sync', ['Tempo', 'Hz'], LFO_SYNC.tempo),
    choice(`l${n}Div`, 'Division', TEMPO_RATES.map(([l]) => l), division, { when: { param: `l${n}Sync`, is: LFO_SYNC.tempo } }),
    // synced the Hz knob doesn't count (it stays the reference for whoever modulates it: the rate
    // multiplies as it moves)
    num(`l${n}Rate`, 'Rate', 0.02, 50, 2, 'Hz', { scale: 'log', when: { param: `l${n}Sync`, is: LFO_SYNC.hz } }),
    choice(`l${n}Trig`, 'Restart', LFO_TRIGS),
    num(`l${n}Phase`, 'Phase', 0, 360, 0, '°', { step: 1 }),
    time(`l${n}Delay`, 'Delay', 0.001),
    time(`l${n}Rise`, 'Rise', 0.001),
    percent(`l${n}Smooth`, 'Smooth', 0),
    ...points,
  ];
};

const slotParams = (n: number): ParamSpec[] => {
  const hidden = { hidden: true };
  return [
    choice(slotParam(n, 'Src'), 'Source', SOURCES, 0, hidden),
    num(slotParam(n, 'Amt'), `Amount ${n}`, -100, 100, 0, '%', { step: 1 }),
    choice(slotParam(n, 'Dst'), 'Target', ['—', ...DESTINATIONS.map(d => d.label)], 0, hidden),
    choice(slotParam(n, 'Pol'), 'Polarity', POLARITIES, 0, hidden),
    num(slotParam(n, 'Curve'), 'Curve', -100, 100, 0, '', { step: 1, ...hidden }),
    choice(slotParam(n, 'Aux'), 'Aux', SOURCES, 0, hidden),
  ];
};

/** A matrix target: a numeric parameter, with the group for the menus. The rate
 *  of a synced LFO multiplies like the one in Hz (the knob is logarithmic). */
export interface Destination {
  readonly param: string;
  readonly group: string;
  readonly label: string;
}

const oscDestinations = (o: OscKey): Destination[] => {
  const group = `Osc ${o.toUpperCase()}`;
  return [
    ['Pos', 'Position'], ['WarpAmt', 'Warp'], ['Semi', 'Pitch'], ['Fine', 'Fine'], ['Detune', 'Detune'], ['Blend', 'Blend'],
    ['Width', 'Stereo'], ['Spread', 'Pos. ±'], ['Phase', 'Phase'], ['Level', 'Level'], ['Pan', 'Pan'],
  ].map(([p, label]) => ({ param: `${o}${p}`, group, label: `${group} · ${label}` }));
};

const filterDestinations = (f: 1 | 2): Destination[] => {
  const group = `Filter ${f}`;
  return [['Cutoff', 'Cutoff'], ['Res', 'Resonance'], ['Drive', 'Drive'], ['Var', 'Var'], ['Mix', 'Mix']]
    .map(([p, label]) => ({ param: `f${f}${p}`, group, label: `${group} · ${label}` }));
};

const envDestinations = (n: number): Destination[] => {
  const group = `Env ${n}`;
  return [['A', 'Attack'], ['D', 'Decay'], ['S', 'Sustain'], ['R', 'Release']]
    .map(([p, label]) => ({ param: `e${n}${p}`, group, label: `${group} · ${label}` }));
};

/** The targets in the order of the options (after "—"). */
export const DESTINATIONS: readonly Destination[] = [
  ...oscDestinations('a'),
  ...oscDestinations('b'),
  { param: 'subLevel', group: 'Sub', label: 'Sub · Level' },
  { param: 'subPan', group: 'Sub', label: 'Sub · Pan' },
  { param: 'nTone', group: 'Noise', label: 'Noise · Tone' },
  { param: 'nLevel', group: 'Noise', label: 'Noise · Level' },
  { param: 'nPan', group: 'Noise', label: 'Noise · Pan' },
  ...filterDestinations(1),
  ...filterDestinations(2),
  ...[1, 2, 3, 4].flatMap(envDestinations),
  ...[1, 2, 3, 4].map(n => ({ param: `l${n}Rate`, group: 'LFO', label: `LFO ${n} · Rate` })),
  { param: 'tune', group: 'Global', label: 'Global · Pitch' },
  { param: 'volume', group: 'Global', label: 'Global · Volume' },
];

/** The target option of a parameter (0: it isn't a target). */
const DEST_INDEX = new Map(DESTINATIONS.map((d, i) => [d.param, i + 1]));
export const destinationOf = (param: string): number => DEST_INDEX.get(param) ?? 0;

export const PRISMA: DeviceType = {
  type: 'prisma',
  label: 'Prisma',
  sections: [
    { label: 'Oscillator A', params: oscParams('a', true, 0, 67) },
    { label: 'Oscillator B', params: oscParams('b', false, 2, 0) },
    {
      label: 'Sub',
      params: [onOff('subOn', false), choice('subShape', 'Shape', SUB_SHAPES), num('subOct', 'Octave', -3, 1, -1, '', { step: 1 }),
        percent('subLevel', 'Level', 75), num('subPan', 'Pan', -100, 100, 0, 'pan', { step: 1 })],
    },
    {
      label: 'Noise',
      params: [onOff('nOn', false), choice('nType', 'Type', NOISE_TYPES), percent('nTone', 'Tone', 100), percent('nLevel', 'Level', 40),
        num('nPan', 'Pan', -100, 100, 0, 'pan', { step: 1 })],
    },
    { label: 'Filter 1', params: filterParams(1, true, FILTER.lp12, 20000) },
    { label: 'Filter 2', params: filterParams(2, false, FILTER.hp12, 20) },
    {
      label: 'Routes',
      params: [
        choice('fMode', 'Filters', FILTER_MODES),
        choice('aRoute', 'Osc A', ROUTES), choice('bRoute', 'Osc B', ROUTES), choice('subRoute', 'Sub', ROUTES), choice('nRoute', 'Noise', ROUTES),
      ],
    },
    { label: 'Env 1 · volume', params: envParams(1) },
    { label: 'Env 2', params: envParams(2) },
    { label: 'Env 3', params: envParams(3) },
    { label: 'Env 4', params: envParams(4) },
    { label: 'LFO 1', params: lfoParams(1, TEMPO_RATE['1/4']) },
    { label: 'LFO 2', params: lfoParams(2, TEMPO_RATE['1/8']) },
    { label: 'LFO 3', params: lfoParams(3, TEMPO_RATE['1 bar']) },
    { label: 'LFO 4', params: lfoParams(4, TEMPO_RATE['1/16']) },
    { label: 'Macro', params: [1, 2, 3, 4].map(n => percent(`macro${n}`, `Macro ${n}`, 0)) },
    {
      label: 'Voice',
      params: [
        choice('voiceMode', 'Mode', VOICE_MODES),
        num('glide', 'Glide', 0, 1000, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        num('tune', 'Pitch', -24, 24, 0, 'st', { step: 1 }),
        num('volume', 'Volume', -36, 6, -12, 'dB', { step: 0.5 }),
      ],
    },
    { label: 'Matrix', params: Array.from({ length: MOD_SLOTS }, (_, i) => slotParams(i + 1)).flat() },
  ],
  // the presets use this file's constants: they're built at the first read
  get presets() {
    return prismaPresets();
  },
};
