/* "Sampler": plays an audio file on the keyboard, like Live's Simpler and Sampler. Three modes:
 * Classic (the sample at the key's pitch, with the loop holding the note while it's
 * held), One-Shot (from start to end at every hit, the release doesn't stop it) and Slice (the
 * sample cut into slices, one per key from C1 up, at the transients or in equal parts). Then the
 * filter (the same types as Prisma), three envelopes with curves (volume, filter, pitch) and an
 * LFO on pitch, filter, volume and pan.
 * The positions (start, end, loop, slices) are fractions of the sample as it's seen: with
 * Reverse the sample is reversed and the positions apply to the reversed sample.
 * Here there's only the description (parameters and presets); the sound is in sampler-core.ts. */
import type { ParamValues } from '../../../model/device';
import { resolveParams, type DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { LFO_SYNC, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { FILTER, FILTER_TYPES } from '../prisma/prisma';

export { LFO_SYNC, VOICE_MODE };

/** The sample's slot in the device (the first zone's). */
export const SAMPLE_SLOT = 'sample';

/** At most this many zones: each a sample, on the keys from `lo` to `hi` and on the velocities from `vlo` to
 *  `vhi`, as in Live's Sampler. A note plays all the zones containing it. */
export const MAX_ZONES = 32;
/** The parameters of the three envelopes (volume, filter, pitch). */
const ENV_KEYS = ['e1A', 'e1H', 'e1D', 'e1S', 'e1R', 'e1Ac', 'e1Dc', 'e1Rc', 'e2A', 'e2H', 'e2D', 'e2S', 'e2R', 'e2Ac', 'e2Dc', 'e2Rc', 'e3A', 'e3H', 'e3D', 'e3S', 'e3R', 'e3Ac', 'e3Dc', 'e3Rc'] as const;
/** A zone's sound: how the sample is read (loop, reverse), the pitch, the filter, the
 *  envelopes and the LFO. The zones from the second on take them from the first until they have their own
 *  (`own`). The whole Sampler keeps the mode, the voice (Poly, Mono, Legato: a single voice belongs to
 *  all the zones) with the glide, and the output. */
export const SOUND_KEYS = [
  'loop', 'xfade', 'loopRelease', 'reverse',
  'transpose', 'detune', 'keyTrack', 'pitchEnv',
  'fOn', 'fType', 'fCutoff', 'fRes', 'fDrive', 'fVar', 'fKey', 'fEnv', 'fVel',
  ...ENV_KEYS,
  'lfoShape', 'lfoSync', 'lfoDiv', 'lfoRate', 'lfoTrig', 'lfoFade', 'lfoPitch', 'lfoCutoff', 'lfoVolume', 'lfoPan',
] as const;
/** A zone's parameters. The first's for the positions, the root note and the sound are the
 *  single sample's parameters (`start`, `root`, `loop`, `fCutoff`…), so a Sampler with a single
 *  sample stays as it was. `own` (from the second zone): the sound is its own and not the first's. */
export type ZoneKey = 'lo' | 'hi' | 'vlo' | 'vhi' | 'root' | 'gain' | 'pan' | 'start' | 'end' | 'loopStart' | 'loopEnd'
  | 'own' | (typeof SOUND_KEYS)[number];
/** The zone keys that for the first zone are the parameters with their name. */
export const FIRST_ZONE_KEYS: ReadonlySet<ZoneKey> = new Set<ZoneKey>(['root', 'start', 'end', 'loopStart', 'loopEnd', ...SOUND_KEYS]);
const SOUND: ReadonlySet<ZoneKey> = new Set(SOUND_KEYS);
/** The sample slot of zone `i` (from 0): "sample", then "z2", "z3"… */
export const zoneSlot = (i: number): string => (i === 0 ? SAMPLE_SLOT : `z${i + 1}`);
/** The zone of a sample slot, or −1. */
export const zoneOfSlot = (slot: string): number => {
  if (slot === SAMPLE_SLOT) return 0;
  const m = /^z(\d+)$/.exec(slot);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 1 && i < MAX_ZONES ? i : -1;
};
/** The id of parameter `key` of zone `i` (from 0): "z1lo", "z2root"… ("root", "start"… for the first). */
export const zoneParam = (i: number, key: ZoneKey): string => (i === 0 && FIRST_ZONE_KEYS.has(key) ? key : `z${i + 1}${key}`);
/** The parameter zone `i` takes `key` from: its own, or the first's if the zone's sound
 *  follows the first. */
export const zoneSource = (values: Readonly<Record<string, number>>, i: number, key: ZoneKey): string =>
  zoneParam(i > 0 && SOUND.has(key) && values[zoneParam(i, 'own')] !== 1 ? 0 : i, key);
/** The values making the sound of zone `i` its own (copied from the first), if it isn't already. */
export const ownSound = (values: Readonly<Record<string, number>>, i: number): Record<string, number> =>
  i === 0 || values[zoneParam(i, 'own')] === 1 ? {}
    : { [zoneParam(i, 'own')]: 1, ...Object.fromEntries(SOUND_KEYS.map(k => [zoneParam(i, k), values[k]])) };
/** The parameters a preset doesn't touch: the zone map depends on the loaded samples (and a
 *  zone's own sound belongs to that sample; that of the zones following the first is changed by it). */
const ZONE_PARAM = /^z\d+[a-zA-Z]\w*$/;

export const MODES = ['Classic', 'One-Shot', 'Slice'] as const;
export const MODE = { classic: 0, oneShot: 1, slice: 2 } as const;
/** Classic's loop: forward (with the crossfade between end and start) or back and forth. */
export const LOOPS = ['Off', 'Forward', 'Ping-pong'] as const;
export const LOOP = { off: 0, forward: 1, pingPong: 2 } as const;
/** Once the note is released, the loop continues (and fades with the release) or the sample goes on to the end. */
export const LOOP_RELEASES = ['In the loop', 'To the end'] as const;
export const LOOP_RELEASE = { stay: 0, exit: 1 } as const;
/** In One-Shot and Slice: Trigger plays everything even if the note ends earlier; Gate stops
 *  (with the release) when the note ends. */
export const TRIGGERS = ['Trigger', 'Gate'] as const;
export const TRIGGER = { trigger: 0, gate: 1 } as const;
export const SLICE_BY = ['Transients', 'Grid'] as const;
export const SLICE = { transients: 0, grid: 1 } as const;
export const SLICE_GRIDS = [4, 8, 16, 32, 64] as const;
/** At most this many slices (and the notes from C1 up playing them). */
export const MAX_SLICES = 64;
/** The first slice's note: C1, like the Drum Machine's pads and Simpler's slices. */
export const FIRST_SLICE_NOTE = 36;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↑', 'Saw ↓', 'Square', 'S&H', 'Smooth random'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawUp: 2, sawDown: 3, square: 4, sampleHold: 5, smoothRandom: 6 } as const;
/** Note: the LFO restarts at every note. Free: all the voices follow the same cycle. */
export const LFO_TRIGS = ['Note', 'Free'] as const;
export const LFO_TRIG = { note: 0, free: 1 } as const;

export const ON_OFF = ['Off', 'On'] as const;
/** The filter types using "Var" (comb, formant, phaser). */
export const VAR_FILTERS: readonly number[] = [FILTER.combUp, FILTER.combDown, FILTER.formant, FILTER.phaser];
export { FILTER, FILTER_TYPES };

/** The envelopes, in the order of their parameters (`e1A`, `e2A`…). */
export const ENV_NAMES = ['Volume', 'Filter', 'Pitch'] as const;
export const ENV = { amp: 1, filter: 2, pitch: 3 } as const;

/** How many octaves the filter envelope, the velocity and the LFO move the cutoff, at most. */
export const FILTER_ENV_OCTAVES = 6;
export const FILTER_VEL_OCTAVES = 4;
export const LFO_CUTOFF_OCTAVES = 3;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** A MIDI note's name as in Live (60 = C3). */
export const noteName = (p: number): string => `${NAMES[p % 12]}${Math.floor(p / 12) - 2}`;
export const NOTE_NAMES = Array.from({ length: 128 }, (_, p) => noteName(p));

/** The parameters of the slices found at the transients (hidden: they move from the drawing). */
export const sliceParam = (k: number): string => `sl${k}`;
export const SLICE_COUNT = 'slices';
export const SENSITIVITY = 'sens';

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number, max = 10) => num(id, label, 0.001, max, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
/** A position in the sample, in percent (no step: long samples need finesse). */
const position = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', extra);

const looping = { param: 'loop', is: [LOOP.forward, LOOP.pingPong] };
const filterOn = { param: 'fOn', is: 1 };

/** Envelope `n` (1 volume, 2 filter, 3 pitch): like Prisma's, with the curves. */
const envParams = (n: number): ParamSpec[] => {
  const amp = n === ENV.amp;
  return [
    time(`e${n}A`, 'Attack', amp ? 0.001 : 0.005),
    time(`e${n}H`, 'Hold', 0.001),
    time(`e${n}D`, 'Decay', amp ? 1 : 0.5),
    percent(`e${n}S`, 'Sustain', amp ? 100 : 0),
    time(`e${n}R`, 'Release', amp ? 0.05 : 0.3),
    num(`e${n}Ac`, 'Curve A', -100, 100, 0, '', { step: 1 }),
    num(`e${n}Dc`, 'Curve D', -100, 100, 60, '', { step: 1 }),
    num(`e${n}Rc`, 'Curve R', -100, 100, 60, '', { step: 1 }),
  ];
};

const SAMPLE_PARAMS: ParamSpec[] = [
  choice('mode', 'Mode', MODES),
  position('start', 'Start', 0),
  position('end', 'End', 100),
  choice('reverse', 'Reverse', ON_OFF),
  choice('trigger', 'Note', TRIGGERS, TRIGGER.trigger, { when: { param: 'mode', is: [MODE.oneShot, MODE.slice] } }),
  choice('loop', 'Loop', LOOPS, LOOP.off, { when: { param: 'mode', is: MODE.classic } }),
  position('loopStart', 'Loop da', 0, { when: looping }),
  position('loopEnd', 'Loop a', 100, { when: looping }),
  num('xfade', 'Fade', 0, 50, 0, '%', { step: 1, when: { param: 'loop', is: LOOP.forward } }),
  choice('loopRelease', 'Release', LOOP_RELEASES, LOOP_RELEASE.stay, { when: looping }),
  choice('sliceBy', 'Slices', SLICE_BY, SLICE.transients, { when: { param: 'mode', is: MODE.slice } }),
  choice('sliceGrid', 'Grid', SLICE_GRIDS.map(String), 2, { when: { param: 'sliceBy', is: SLICE.grid } }),
];

const PITCH_PARAMS: ParamSpec[] = [
  choice('root', 'Root note', NOTE_NAMES, 60, { when: { param: 'mode', is: [MODE.classic, MODE.oneShot] } }),
  num('transpose', 'Transpose', -48, 48, 0, 'st', { step: 1 }),
  num('detune', 'Detune', -50, 50, 0, 'ct', { step: 1 }),
  { ...percent('keyTrack', 'Key track', 100), when: { param: 'mode', is: [MODE.classic, MODE.oneShot] } },
  choice('voiceMode', 'Voice', VOICE_MODES),
  num('glide', 'Glide', 0, 1000, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
  num('pitchEnv', 'Env pitch', -48, 48, 0, 'st', { step: 0.1 }),
];

const FILTER_PARAMS: ParamSpec[] = [
  choice('fOn', 'On', ON_OFF),
  choice('fType', 'Type', FILTER_TYPES, FILTER.lp24, { when: filterOn }),
  num('fCutoff', 'Cutoff', 20, 20000, 6000, 'Hz', { scale: 'log', when: filterOn }),
  { ...percent('fRes', 'Resonance', 0), when: filterOn },
  { ...percent('fDrive', 'Drive', 0), when: filterOn },
  { ...percent('fVar', 'Var', 50), when: { param: 'fType', is: VAR_FILTERS } },
  { ...percent('fKey', 'Key track', 0), when: filterOn },
  { ...percent('fEnv', 'Envelope', 0, -100), when: filterOn },
  { ...percent('fVel', 'Velocity', 0), when: filterOn },
];

const LFO_PARAMS: ParamSpec[] = [
  choice('lfoShape', 'Shape', LFO_SHAPES),
  choice('lfoSync', 'Sync', ['Tempo', 'Hz'], LFO_SYNC.hz),
  choice('lfoDiv', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/8'], { when: { param: 'lfoSync', is: LFO_SYNC.tempo } }),
  num('lfoRate', 'Rate', 0.05, 30, 4, 'Hz', { scale: 'log', when: { param: 'lfoSync', is: LFO_SYNC.hz } }),
  choice('lfoTrig', 'Restart', LFO_TRIGS),
  num('lfoFade', 'Entry', 0, 5, 0, 's', { step: 0.01 }),
  num('lfoPitch', '→ Pitch', 0, 12, 0, 'st', { step: 0.01 }),
  percent('lfoCutoff', '→ Cutoff', 0),
  percent('lfoVolume', '→ Volume', 0),
  percent('lfoPan', '→ Pan', 0),
];

const ENV_PARAMS = [ENV.amp, ENV.filter, ENV.pitch].map(envParams);

/** The first zone's parameters the others have the same, with their name. */
const FIRST_ZONE = new Map([...SAMPLE_PARAMS, ...PITCH_PARAMS, ...FILTER_PARAMS, ...ENV_PARAMS.flat(), ...LFO_PARAMS].map(p => [p.id, p]));

/** Parameter `key` of zone `i`: like the first zone's, hidden, and with the conditions
 *  on the zone's parameters (e.g. "Loop from" counts if the zone has the loop). */
const ofZone = (i: number, key: ZoneKey): ParamSpec => {
  const p = FIRST_ZONE.get(key)!, when = p.when;
  const zoneWhen = when && FIRST_ZONE_KEYS.has(when.param as ZoneKey) ? { ...when, param: zoneParam(i, when.param as ZoneKey) } : when;
  return { ...p, id: zoneParam(i, key), hidden: true, ...(zoneWhen ? { when: zoneWhen } : {}) };
};

/** The zones' parameters (hidden: they move from the zone editor, the waveform and the
 *  panel's controls when the zone is being viewed). */
const zoneParams = (): ParamSpec[] => Array.from({ length: MAX_ZONES }, (_, i): ParamSpec[] => {
  const hidden = { hidden: true };
  const own: ParamSpec[] = i === 0 ? [] : [
    ...(['root', 'start', 'end', 'loopStart', 'loopEnd'] as const).map(k => ofZone(i, k)),
    choice(zoneParam(i, 'own'), 'Own sound', ON_OFF, 0, hidden),
    ...SOUND_KEYS.map(k => ofZone(i, k)),
  ];
  return [
    choice(zoneParam(i, 'lo'), 'From', NOTE_NAMES, 0, hidden),
    choice(zoneParam(i, 'hi'), 'To', NOTE_NAMES, 127, hidden),
    num(zoneParam(i, 'vlo'), 'Vel. from', 1, 127, 1, '', { step: 1, ...hidden }),
    num(zoneParam(i, 'vhi'), 'Vel. to', 1, 127, 127, '', { step: 1, ...hidden }),
    num(zoneParam(i, 'gain'), 'Volume', -36, 12, 0, 'dB', { step: 0.5, ...hidden }),
    num(zoneParam(i, 'pan'), 'Pan', -100, 100, 0, 'pan', { step: 1, ...hidden }),
    ...own,
  ];
}).flat();

const sliceParams = (): ParamSpec[] => {
  const hidden = { hidden: true };
  return [
    num(SLICE_COUNT, 'Slices', 0, MAX_SLICES, 0, '', { step: 1, ...hidden }),
    num(SENSITIVITY, 'Sensitivity', 0, 100, 50, '%', { step: 1, ...hidden }),
    ...Array.from({ length: MAX_SLICES }, (_, i) => num(sliceParam(i + 1), `Slice ${i + 1}`, 0, 1, 0, '', hidden)),
  ];
};

export const SAMPLER: DeviceType = {
  type: 'sampler',
  label: 'Sampler',
  sections: [
    { label: 'Sample', params: [...SAMPLE_PARAMS, ...sliceParams(), ...zoneParams()] },
    { label: 'Pitch', params: PITCH_PARAMS },
    { label: 'Filter', params: FILTER_PARAMS },
    { label: 'Volume envelope', params: ENV_PARAMS[0] },
    { label: 'Filter envelope', params: ENV_PARAMS[1] },
    { label: 'Pitch envelope', params: ENV_PARAMS[2] },
    { label: 'LFO', params: LFO_PARAMS },
    {
      label: 'Output',
      params: [
        percent('velocity', 'Velocity', 50),
        num('pan', 'Pan', -100, 100, 0, 'pan', { step: 1 }),
        num('volume', 'Volume', -36, 6, -6, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'One-shot', params: { mode: MODE.oneShot, e1R: 0.02 } },
    { name: 'Sustained loop', params: { loop: LOOP.forward, loopStart: 30, loopEnd: 90, xfade: 30, e1A: 0.01, e1R: 0.6 } },
    {
      name: 'Slow pad',
      params: { loop: LOOP.pingPong, loopStart: 25, loopEnd: 85, e1A: 1.2, e1D: 2, e1S: 85, e1R: 2.5, e1Ac: 40, fOn: 1, fType: FILTER.lp24,
        fCutoff: 1800, fRes: 15, lfoRate: 0.25, lfoCutoff: 25, lfoPan: 30, volume: -9 },
    },
    {
      name: 'Bass',
      params: { voiceMode: VOICE_MODE.legato, glide: 60, fOn: 1, fType: FILTER.ladder, fCutoff: 380, fRes: 45, fEnv: 55, fKey: 40,
        e2D: 0.25, e2S: 10, e1D: 1, e1S: 90, e1R: 0.06, velocity: 40, volume: -8 },
    },
    {
      name: 'Pluck',
      params: { fOn: 1, fType: FILTER.lp24, fCutoff: 500, fRes: 25, fEnv: 70, e2D: 0.3, e2S: 0, e1D: 0.5, e1S: 0, e1R: 0.25 },
    },
    { name: 'Reversed', params: { reverse: 1, e1A: 0.15, e1Ac: -60, e1R: 0.08 } },
    { name: 'Vibrato', params: { e1A: 0.05, e1R: 0.4, lfoRate: 5.5, lfoFade: 0.6, lfoPitch: 0.3, lfoTrig: LFO_TRIG.note } },
    {
      name: 'Lo-fi',
      params: { fOn: 1, fType: FILTER.bp12, fCutoff: 1400, fRes: 30, fDrive: 60, detune: -12, lfoRate: 0.4, lfoPitch: 0.12, volume: -8 },
    },
    { name: 'Fall', params: { mode: MODE.oneShot, pitchEnv: -24, e3A: 0.001, e3D: 0.8, e3S: 0, e3Dc: 40 } },
    { name: 'Slices in 16', params: { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 2, voiceMode: VOICE_MODE.mono, e1R: 0.02 } },
  ],
  noteNames: (values, samples) => {
    if (values.mode === MODE.slice) return new Map(Array.from({ length: sliceStarts(values).length }, (_, i) => [FIRST_SLICE_NOTE + i, `Slice ${i + 1}`]));
    // zones on a single key (a kit of sounds, one per key) give the name of their sample
    const names = new Map<number, string>();
    for (const [slot, name] of samples ?? []) {
      const i = zoneOfSlot(slot);
      if (i < 0) continue;
      const lo = values[zoneParam(i, 'lo')], hi = values[zoneParam(i, 'hi')];
      if (lo === hi) names.set(lo, names.has(lo) ? `${names.get(lo)} + ${name}` : name);
    }
    return names;
  },
  keepsOnPreset: id => id === 'root' || ZONE_PARAM.test(id),
};

/** A zone as engine and interface use it: its keys, velocities and the root note. */
export interface ZoneMap {
  readonly index: number;
  readonly lo: number;
  readonly hi: number;
  readonly vlo: number;
  readonly vhi: number;
  readonly root: number;
}

/** The map of zone `i` with these values. */
export const zoneMap = (values: Readonly<Record<string, number>>, i: number): ZoneMap => {
  const v = (key: ZoneKey) => values[zoneParam(i, key)];
  return { index: i, lo: Math.min(v('lo'), v('hi')), hi: Math.max(v('lo'), v('hi')), vlo: Math.min(v('vlo'), v('vhi')), vhi: Math.max(v('vlo'), v('vhi')), root: v('root') };
};

/** The values putting zone `i` on keys `lo`…`hi` with root note `root` (the velocities
 *  all come back). */
export const zoneKeys = (i: number, lo: number, hi: number, root: number): Record<string, number> =>
  ({ [zoneParam(i, 'lo')]: lo, [zoneParam(i, 'hi')]: hi, [zoneParam(i, 'root')]: root });

/** All the parameters of zone `i` at the defaults (for a new or removed zone). */
export const zoneDefaults = (i: number): Record<string, number> => {
  const keys: ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'root', 'gain', 'pan', 'start', 'end', 'loopStart', 'loopEnd'];
  // the first zone's sound is the Sampler's parameters: it stays
  if (i > 0) keys.push('own', ...SOUND_KEYS);
  const specs = SAMPLER.sections.flatMap(s => s.params);
  return Object.fromEntries(keys.map(k => zoneParam(i, k)).map(id => [id, specs.find(p => p.id === id)!.default]));
};

/** The parameters of a Sampler saved up to 0.3.18, when zones had Tune and Fine, with
 *  those values in the Transpose and Detune of the zone's sound (the same parameters as today
 *  otherwise). A zone following the first that the conversion would change takes its own
 *  sound, so they all sound as they did. `samples`: the slots of the loaded samples; without (a saved
 *  rack) the zones with some parameter count. */
export function upgradeZoneTune(params: ParamValues, samples?: Readonly<Record<string, unknown>>): ParamValues {
  const stale = Object.keys(params).filter(k => /^z\d+(tune|fine)$/.test(k));
  if (!stale.length) return params;
  const shift = Array.from({ length: MAX_ZONES }, (_, i) => (params[`z${i + 1}tune`] ?? 0) + (params[`z${i + 1}fine`] ?? 0) / 100);
  const named = new Set(Object.keys(params).map(k => Number(/^z(\d+)[a-zA-Z]/.exec(k)?.[1]) - 1));
  const used = (i: number) => (samples ? !!samples[zoneSlot(i)] : named.has(i));
  const v = resolveParams(SAMPLER, params);
  const out: Record<string, number> = { ...params };
  for (const k of stale) delete out[k];
  // the first zone's Tune goes into the Sampler's Transpose, which the zones following it take
  for (let i = 1; i < MAX_ZONES; i++) if (used(i) && (shift[0] || shift[i])) Object.assign(out, ownSound(v, i));
  for (let i = 0; i < MAX_ZONES; i++) {
    const now = { ...v, ...out };
    if (!shift[i] || (i > 0 && now[zoneParam(i, 'own')] !== 1)) continue;
    const semis = now[zoneParam(i, 'transpose')] + now[zoneParam(i, 'detune')] / 100 + shift[i];
    const st = Math.max(-48, Math.min(48, Math.round(semis)));
    out[zoneParam(i, 'transpose')] = st;
    out[zoneParam(i, 'detune')] = Math.max(-50, Math.min(50, Math.round((semis - st) * 100)));
  }
  return out;
}

/** The note written in a file's name ("Piano C3.wav", "bass_f#1", "Vox-Eb2"), as
 *  Live writes it (C3 = 60), or null. */
export function noteInName(name: string): number | null {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  // the last note written in the name, separated from other letters ("Bd1" isn't a D1)
  const found = [...base.matchAll(/(?<![a-z])([a-g])([#b♯♭]?)(-?[0-8])(?![0-9])/gi)].at(-1);
  if (!found) return null;
  const pc = ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 } as Record<string, number>)[found[1].toLowerCase()];
  const acc = found[2] === '#' || found[2] === '♯' ? 1 : found[2] ? -1 : 0;
  const p = pc + acc + (Number(found[3]) + 2) * 12;
  return p >= 0 && p <= 127 ? p : null;
}

/** The keys of zones with these root notes, like a multisample: each goes from halfway
 *  from the note below to halfway to the one above (the lowest from C-2, the highest up to G8);
 *  zones with the same root note take the same keys. */
export function spreadRanges(roots: readonly number[]): { lo: number; hi: number }[] {
  const unique = [...new Set(roots)].sort((a, b) => a - b);
  return roots.map(r => {
    const k = unique.indexOf(r), prev = unique[k - 1], next = unique[k + 1];
    return { lo: prev === undefined ? 0 : Math.floor((prev + r) / 2) + 1, hi: next === undefined ? 127 : Math.floor((r + next) / 2) };
  });
}

/** Where samples loaded together go, one per zone: if there's more than one and all the names say
 *  a note ("Piano C3"), that's the root note and the zones share the keyboard (see
 *  spreadRanges); otherwise one key each from `first` up, with the root note on the key
 *  (they play at their own pitch, like a drum kit's pads). */
export function layoutZones(names: readonly string[], first: number): { lo: number; hi: number; root: number }[] {
  const notes = names.map(noteInName);
  if (names.length > 1 && notes.every(n => n !== null)) {
    const roots = notes as number[];
    return spreadRanges(roots).map((r, i) => ({ ...r, root: roots[i] }));
  }
  return names.map((_, i) => {
    const key = Math.max(0, Math.min(127, first + i));
    return { lo: key, hi: key, root: key };
  });
}

/** The slice starts (fractions of the sample, in order) inside the Start…End region: in
 *  equal parts with the grid; at the found transients (the hidden parameters), plus the start. The
 *  end of a slice is the start of the next (of the last: End). */
export function sliceStarts(values: Readonly<Record<string, number>>): number[] {
  const a = clamp01(values.start / 100), b = Math.max(a, clamp01(values.end / 100));
  if (b - a <= 0) return [];
  if (values.sliceBy === SLICE.grid) {
    const n = SLICE_GRIDS[values.sliceGrid] ?? 16;
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / n);
  }
  const count = Math.max(0, Math.min(MAX_SLICES, Math.round(values[SLICE_COUNT] ?? 0)));
  const inside: number[] = [];
  for (let k = 1; k <= count; k++) {
    const x = values[sliceParam(k)];
    // a transient right on the start is the first slice; those outside the region don't play
    if (x > a + 1e-6 && x < b - 1e-6) inside.push(x);
  }
  inside.sort((x, y) => x - y);
  return [a, ...inside].slice(0, MAX_SLICES);
}

/** The parameters describing the slices `points` (fractions of the sample, already in order). */
export function sliceValues(points: readonly number[]): Record<string, number> {
  const kept = points.slice(0, MAX_SLICES);
  const out: Record<string, number> = { [SLICE_COUNT]: kept.length };
  for (let k = 1; k <= MAX_SLICES; k++) out[sliceParam(k)] = k <= kept.length ? Math.round(kept[k - 1] * 1e6) / 1e6 : 0;
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
