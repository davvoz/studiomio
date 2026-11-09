/* The factory racks, in the browser next to those saved by the user (like Live's racks).
 * They're racks like the others: devices already set and macros mapped, only written here.
 *
 * "Tornado" is a multi-effect to play live à la Turnado: eight effects in a row, one
 * macro each. At 0 the effect isn't there (the sound passes as it is); turning it, it comes in and gets stronger.
 * On the APC40's 8 Device Control knobs, or on the keyboard, it's played like an instrument.
 * The other Audio Effect Racks are famous sounds (Fade to Grey like Live's, dub, the
 * French house filter, the cassette, shoegaze): they too with the macros at 0 let
 * the sound through as it is, and start where they're already useful.
 *
 * The Instrument Racks start from an instrument preset and add effects to it; the macros
 * move instrument and effects together, and start where the sound is already nice.
 *
 * Levare, 303, Acido FX and Macchina come from the live "Rave illegale" (src/demo/rave-live.ts).
 * Salsiccia is the master rack of the live "Cripta": it fattens the whole mix, like a Sausage Fattener.
 *
 * Wobble, Pompa, Cancello, Acido vivo, Sirena and Colpo have modulators inside (LFO and
 * Envelope) already connected: with the transport running the sound moves by itself, and the macros
 * decide how much (the modulator's depth) and how (its speed, its tail).
 *
 * The drum racks start from a Drum Machine kit (or from the Kick, the Snare, Hat and
 * Cymbals alone): the macros also move the parameters of the instruments inside the pads, by id with the
 * pad in front ("p1.kick.decay": pad 1's kick). */
import type { DeviceType } from './device-type';
import type { RackPreset, SavedDevice, SavedEffect, SavedMacro } from '../model/rack-preset';
import { MACRO_COUNT, type MacroMode } from '../model/rack';
import { LFO_SHAPE } from './dsp/lfo';
import { FILTER_TYPE } from './dsp/multimode-filter';
import { AUTO_FILTER, AUTO_FILTER_SYNC } from './effects/auto-filter/auto-filter';
import { AUTO_PAN, AUTO_PAN_SYNC } from './effects/auto-pan/auto-pan';
import { BEAT_REPEAT, GRIDS, INTERVALS, REPEAT_MODE } from './effects/beat-repeat/beat-repeat';
import { CHORUS, CHORUS_MODE, CHORUS_SYNC } from './effects/chorus/chorus';
import { CLIPPER } from './effects/clipper/clipper';
import { COMPRESSOR } from './effects/compressor/compressor';
import { DELAY, DIVISIONS } from './effects/delay/delay';
import { DRIVE, SHAPE } from './effects/drive/drive';
import { BAND, bandParam, EQ } from './effects/eq/eq';
import { GATE, pattern, STEP_RATES } from './effects/gate/gate';
import { MULTIBAND } from './effects/multiband/multiband';
import { PHASER } from './effects/phaser/phaser';
import { REDUX, REDUX_FILTER } from './effects/redux/redux';
import { REVERB } from './effects/reverb/reverb';
import { REVERSE, REVERSE_LENGTHS } from './effects/reverse/reverse';
import { STEREO } from './effects/stereo/stereo';
import { BRAKE_CURVE, BRAKE_DIVISIONS, STARTS, TAPE_STOP, TAPE_SYNC } from './effects/tape-stop/tape-stop';
import { ANALOG, VOICE_MODE as ANALOG_VOICE } from './instruments/analog/analog';
import { CYMBALS } from './instruments/cymbals/cymbals';
import { DRUMS } from './instruments/drums/drums';
import { KICK } from './instruments/kick/kick';
import { SNARE } from './instruments/snare/snare';
import { MOD_DEST as NEURO_DEST, NEURO, LFO_SHAPE as NEURO_LFO } from './instruments/neuro/neuro';
import { LFO_SHAPE as MOD_SHAPE } from './instruments/prisma/shapes';
import { LFO_SYNC, MOD_DEST, TABLE, VOICE_MODE, WAVETABLE, LFO_SHAPE as WT_LFO } from './instruments/wavetable/wavetable';
import { ENVELOPE_DEVICE, LFO_DEVICE, linkAmount, POLARITY } from './modulators/modulators';
import { TEMPO_RATE } from './rates';
import { SEQ_RATE, SEQ_SCALE } from './sequencer';

const index = (list: readonly (readonly [string, ...unknown[]])[], label: string) => list.findIndex(([l]) => l === label);

/** A device from a factory preset (null: from Init), with some parameters changed. */
function device(type: DeviceType, preset: string | null, params: Readonly<Record<string, number>> = {}): SavedDevice {
  const base = preset === null ? {} : type.presets.find(p => p.name === preset)?.params;
  if (!base) throw new RangeError(`${type.label}: preset «${preset}» doesn't exist`);
  return { type: type.type, preset, params: { ...base, ...params } };
}

const effect = (type: DeviceType, preset: string | null, params?: Readonly<Record<string, number>>): SavedEffect =>
  ({ ...device(type, preset, params), enabled: true });

/** An EQ: a high-pass at `low` Hz (24 dB) and some bells [frequency, gain, Q]. */
function eqOf(low: number, bells: readonly (readonly [freq: number, gain: number, q: number])[]): SavedEffect {
  const params: Record<string, number> = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: low, [bandParam(0, 'slope')]: 1 };
  bells.forEach(([freq, gain, q], i) => Object.assign(params, {
    [bandParam(i + 1, 'type')]: BAND.bell, [bandParam(i + 1, 'freq')]: freq, [bandParam(i + 1, 'gain')]: gain, [bandParam(i + 1, 'q')]: q,
  }));
  return effect(EQ, null, params);
}

/** The Beat Repeat to play as a button: off it lets the sound through as it is. */
const repeatButton = (grid: string): SavedEffect =>
  effect(BEAT_REPEAT, null, { only: 1, repeat: 0, grid: index(GRIDS, grid), mode: REPEAT_MODE.insert, decay: 8, volume: 0 });

/** A modulator (LFO or Envelope) of the rack and its targets, [where, amount in %]: where
 *  is `on(slot, parameter)` (a parameter of a device of the rack, the instrument at slot 0),
 *  VOLUME or PAN of the track. */
function modulator(type: DeviceType, preset: string | null, params: Readonly<Record<string, number>>,
  links: readonly (readonly [target: string, amount: number])[]): SavedEffect {
  const amounts = Object.fromEntries(links.map(([, amount], i) => [linkAmount(i + 1), amount]));
  return { ...effect(type, preset, { ...params, ...amounts }), targets: links.map(([target]) => target) };
}

const on = (device: number, param: string): string => `d${device}:${param}`;
const VOLUME = 'mixer:volume', PAN = 'mixer:pan';

/** A parameter moved by a macro: the device (by slot in the rack), the parameter, its
 *  value at 0 and at 127. */
type Move = readonly [device: number, param: string, min: number, max: number];

interface MacroSpec {
  readonly name: string;
  readonly mode?: MacroMode;
  /** Where it starts (0 … 127); missing: 0. */
  readonly value?: number;
  readonly moves: readonly Move[];
}

function rack(name: string, instrument: SavedDevice | null, effects: readonly SavedEffect[], macros: readonly MacroSpec[]): RackPreset {
  if (macros.length > MACRO_COUNT) throw new RangeError(`${name}: more than ${MACRO_COUNT} macros`);
  return {
    name, instrument, effects,
    macros: Array.from({ length: MACRO_COUNT }, (_, i): SavedMacro => {
      const m = macros[i];
      if (!m) return { name: null, value: 0, mappings: [] };
      return {
        name: m.name, value: m.value ?? 0,
        mappings: m.moves.map(([device, param, min, max]) => ({ device, param, min, max })),
        ...(m.mode ? { mode: m.mode } : {}),
      };
    }),
  };
}

/** A Tornado slot: an effect and its macro, which moves the given parameters from [at 0, at 127]. */
interface Slot {
  readonly macro: string;
  readonly mode?: MacroMode;
  readonly effect: SavedEffect;
  readonly moves: Readonly<Record<string, readonly [min: number, max: number]>>;
}

/** An Audio Effect Rack made of slots: effect i is moved by macro i. */
const slots = (name: string, list: readonly Slot[]): RackPreset =>
  rack(name, null, list.map(s => s.effect), list.map((s, i) => ({
    name: s.macro, mode: s.mode,
    moves: Object.entries(s.moves).map(([param, [min, max]]): Move => [i, param, min, max]),
  })));

export const TORNADO: RackPreset = slots('Tornado', [
  {
    // synced, on the downbeat of each quarter: more and more often, denser and denser
    macro: 'Stutter',
    effect: effect(BEAT_REPEAT, null, { interval: index(INTERVALS, '1/4'), offset: 0, gate: 2, mode: REPEAT_MODE.insert, decay: 10 }),
    moves: { chance: [0, 100], grid: [index(GRIDS, '1/16'), index(GRIDS, '1/32')], gate: [2, 4] },
  },
  {
    macro: 'Reverse',
    effect: effect(REVERSE, null, { reverse: 1, length: index(REVERSE_LENGTHS, '1/4') }),
    moves: { mix: [0, 100] },
  },
  {
    macro: 'Gate',
    effect: effect(GATE, null, { rate: index(STEP_RATES, '1/16'), release: 15 }),
    moves: { depth: [0, 100], gate: [80, 40] },
  },
  {
    macro: 'Lo-fi',
    effect: effect(REDUX, null, { filter: REDUX_FILTER.post }),
    moves: { mix: [0, 100], rate: [48000, 2500], bits: [16, 5] },
  },
  {
    // the low-pass closing, with a bit more LFO and resonance
    macro: 'Filter',
    effect: effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, lfoShape: LFO_SHAPE.triangle, lfoSync: AUTO_FILTER_SYNC.tempo, lfoDivision: TEMPO_RATE['1/2'] }),
    moves: { mix: [0, 100], freq: [20000, 300], resonance: [10, 55], lfoAmount: [0, 25] },
  },
  {
    // the Chorus with a short delay and feedback: a flanger
    macro: 'Flanger',
    effect: effect(CHORUS, null, { mode: CHORUS_MODE.chorus, delay: 3, sync: CHORUS_SYNC.tempo, division: TEMPO_RATE['2 bars'] }),
    moves: { mix: [0, 50], feedback: [0, 70], depth: [30, 60] },
  },
  {
    macro: 'Pan',
    effect: effect(AUTO_PAN, null, { shape: LFO_SHAPE.sine, sync: AUTO_PAN_SYNC.tempo, division: TEMPO_RATE['1/8'] }),
    moves: { amount: [0, 100] },
  },
  {
    // a button: held it brakes, released it starts again
    macro: 'Stop', mode: 'button',
    effect: effect(TAPE_STOP, null, { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Immediately'), curve: BRAKE_CURVE.smooth, spin: 250 }),
    moves: { stop: [0, 1] },
  },
]);

/** The 303: the "Acid" Analog with the silver box's knobs, then saturation and echo. */
export const ACID: RackPreset = (() => {
  const SYNTH = 0, DRIVE_ = 1, ECHO = 2, ROOM = 3;
  return rack('Acid', device(ANALOG, 'Acid'), [
    effect(DRIVE, 'Warm', { mix: 0 }),
    effect(DELAY, 'Ping-pong 1/8.', { highCut: 3500, lowCut: 200 }),
    effect(REVERB, 'Cymbal'),
  ], [
    { name: 'Cutoff', value: 45, moves: [[SYNTH, 'cutoff', 120, 3500]] },
    { name: 'Resonance', value: 80, moves: [[SYNTH, 'resonance', 40, 90]] },
    { name: 'Env Mod', value: 64, moves: [[SYNTH, 'filterEnv', 20, 100]] },
    { name: 'Decay', value: 50, moves: [[SYNTH, 'fDecay', 0.05, 1.2]] },
    { name: 'Accent', value: 90, moves: [[SYNTH, 'accent', 0, 100]] },
    { name: 'Glide', value: 30, moves: [[SYNTH, 'glide', 0, 250]] },
    // the saturation comes in (Dry/Wet) and pushes; the Drive holds the volume (Auto)
    { name: 'Dirty', value: 40, moves: [[DRIVE_, 'mix', 0, 100], [DRIVE_, 'drive', 4, 30], [DRIVE_, 'output', 0, -4]] },
    { name: 'Echo', value: 20, moves: [[ECHO, 'mix', 0, 35], [ECHO, 'feedback', 25, 60], [ROOM, 'mix', 0, 25]] },
  ]);
})();

/** The pad: the Wavetable "Breathing pad", widened by the Chorus, cut in time by the Gate,
 *  lengthened by echo and reverb. */
export const FOG: RackPreset = (() => {
  const SYNTH = 0, WIDE = 1, CHOP = 2, ECHO = 3, ROOM = 4;
  return rack('Fog', device(WAVETABLE, 'Breathing pad'), [
    effect(CHORUS, 'Wide chorus'),
    effect(GATE, null, { ...pattern('x.xx .xx. x.xx .x.x'), rate: index(STEP_RATES, '1/16'), gate: 70, release: 40 }),
    effect(DELAY, 'Long echo', { pingPong: 1, division: index(DIVISIONS, '1/4.') }),
    effect(REVERB, 'Hall', { decay: 6, mix: 35 }),
  ], [
    { name: 'Open', value: 75, moves: [[SYNTH, 'cutoff', 250, 16000], [SYNTH, 'resonance', 25, 5]] },
    // moves the two tables in opposite directions: the timbre changes, the volume stays
    { name: 'Morph', value: 20, moves: [[SYNTH, 'posA', 0, 90], [SYNTH, 'posB', 70, 0]] },
    { name: 'Breath', value: 80, moves: [[SYNTH, 'lfo1Amount', 0, 90], [SYNTH, 'lfo2Amount', 0, 70]] },
    { name: 'Width', value: 60, moves: [[SYNTH, 'detune', 4, 40], [SYNTH, 'spread', 30, 100], [WIDE, 'mix', 0, 60]] },
    { name: 'Slowness', value: 70, moves: [[SYNTH, 'attack', 0.005, 4], [SYNTH, 'release', 0.3, 6]] },
    { name: 'Gate', moves: [[CHOP, 'depth', 0, 100]] },
    { name: 'Echo', value: 25, moves: [[ECHO, 'mix', 0, 40], [ECHO, 'feedback', 30, 70]] },
    { name: 'Space', value: 50, moves: [[ROOM, 'mix', 10, 70], [ROOM, 'size', 50, 100], [ROOM, 'decay', 2, 14]] },
  ]);
})();

/** The neuro bass: the Neuro "Neuro ringhio" with a synced wobble on the cutoff, then phaser, OTT
 *  and the lows in mono. */
export const GROWL: RackPreset = (() => {
  const SYNTH = 0, SWIRL = 1, OTT = 2;
  return rack('Growl', device(NEURO, 'Neuro growl', {
    lfo2Shape: NEURO_LFO.sine, lfo2Dest: NEURO_DEST.cutoff, lfo2Retrig: 0,
  }), [
    effect(PHASER, 'Spinning reese'),
    effect(MULTIBAND, 'OTT'),
    effect(STEREO, 'Mono bass'),
  ], [
    { name: 'Cutoff', value: 80, moves: [[SYNTH, 'cutoff', 200, 9000]] },
    { name: 'Growl', value: 55, moves: [[SYNTH, 'fm', 0, 75], [SYNTH, 'fold', 0, 60]] },
    { name: 'Vocal', value: 60, moves: [[SYNTH, 'vowel', 0, 100], [SYNTH, 'formant', 20, 90]] },
    // the wobble: how much (Depth) and how fast (from 1/4 to 1/16, in steps)
    { name: 'Wobble', moves: [[SYNTH, 'lfo2Amount', 0, 80]] },
    { name: 'Rate', value: 40, moves: [[SYNTH, 'lfo2Rate', TEMPO_RATE['1/4'], TEMPO_RATE['1/16']]] },
    { name: 'Distortion', value: 50, moves: [[SYNTH, 'dist', 0, 90], [SYNTH, 'drive', 30, 80]] },
    { name: 'Phaser', moves: [[SWIRL, 'mix', 0, 60]] },
    { name: 'OTT', value: 50, moves: [[OTT, 'depth', 0, 100], [SYNTH, 'sub', 90, 50]] },
  ]);
})();

// ---------------------------------------------------------------- Audio Effect Rack

/** Live's transition: one knob (Fade) taking the sound into a grey trail. The filters
 *  narrow from both sides, echo and tail grow, the stereo closes and the volume drops; the
 *  other macros decide what the trail is like. With Fade at 0 the sound passes as it is. */
export const FADE_TO_GREY: RackPreset = (() => {
  const LOW = 0, HIGH = 1, ECHO = 2, ROOM = 3, IMAGE = 4;
  return rack('Fade to Grey', null, [
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.highPass, slope: 1, freq: 20, resonance: 15, mix: 0 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 15, mix: 0 }),
    effect(DELAY, null, { pingPong: 1, division: index(DIVISIONS, '1/4'), lowCut: 250, highCut: 3500, mix: 0 }),
    effect(REVERB, null, { size: 90, decay: 8, predelay: 30, damping: 5000, lowCut: 200, mix: 0 }),
    effect(STEREO, null, { bassMono: 0 }),
  ], [
    {
      name: 'Fade', moves: [
        [LOW, 'mix', 0, 100], [LOW, 'freq', 20, 450], [HIGH, 'mix', 0, 100], [HIGH, 'freq', 20000, 1800],
        [ECHO, 'mix', 0, 40], [ROOM, 'mix', 0, 60], [IMAGE, 'width', 100, 45], [IMAGE, 'gain', 0, -9],
      ],
    },
    { name: 'Echo', value: 60, moves: [[ECHO, 'feedback', 25, 85]] },
    // in steps: from 1/8. to 1/2
    { name: 'Echo time', value: 40, moves: [[ECHO, 'division', index(DIVISIONS, '1/8.'), index(DIVISIONS, '1/2')]] },
    { name: 'Tail', value: 60, moves: [[ROOM, 'decay', 2, 18], [ROOM, 'size', 60, 100]] },
    { name: 'Dark', value: 50, moves: [[ROOM, 'damping', 10000, 2000], [ECHO, 'highCut', 6000, 1200]] },
    { name: 'Resonance', value: 30, moves: [[LOW, 'resonance', 0, 60], [HIGH, 'resonance', 0, 60]] },
  ]);
})();

/** King Tubby's dub: the send to the delay, the "throw" of the self-feeding feedback,
 *  the filter sweeping it, the spring and the tape. The macros at 0: the sound passes as it is. */
export const DUB: RackPreset = (() => {
  const SWEEP = 0, ECHO = 1, SPRING = 2, TAPE = 3;
  return rack('Dub', null, [
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.highPass, slope: 0, freq: 20, resonance: 35, mix: 0 }),
    effect(DELAY, 'Dub', { mix: 0 }),
    effect(REVERB, 'Cymbal', { size: 40, decay: 2.5, diffusion: 60, mix: 0 }),
    effect(DRIVE, 'Tape', { mix: 0 }),
  ], [
    { name: 'Send', value: 50, moves: [[ECHO, 'mix', 0, 60]] },
    // beyond 90 % the delay plays by itself: the throw
    { name: 'Throw', value: 50, moves: [[ECHO, 'feedback', 40, 94]] },
    { name: 'Tempo', value: 70, moves: [[ECHO, 'division', index(DIVISIONS, '1/8'), index(DIVISIONS, '1/2')]] },
    { name: 'Dark', value: 50, moves: [[ECHO, 'highCut', 5000, 800]] },
    { name: 'Filter', moves: [[SWEEP, 'mix', 0, 100], [SWEEP, 'freq', 20, 1800]] },
    { name: 'Spring', value: 40, moves: [[SPRING, 'mix', 0, 45]] },
    { name: 'Tape', value: 30, moves: [[TAPE, 'mix', 0, 100], [TAPE, 'drive', 6, 22]] },
  ]);
})();

/** The French house filter: the resonant low-pass opening and closing, the pump
 *  in quarters (like the kick's sidechain), the phaser, a bit of dirt and the glue. */
export const FRENCH_TOUCH: RackPreset = (() => {
  const SWEEP = 0, PUMP = 1, SWIRL = 2, DIRT = 3, GLUE = 4;
  return rack('French Touch', null, [
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 40, mix: 0 }),
    // a saw wave in quarters, without stereo: the volume restarting at every hit
    effect(AUTO_PAN, null, { shape: LFO_SHAPE.sawUp, sync: AUTO_PAN_SYNC.tempo, division: TEMPO_RATE['1/4'], stereo: 0, amount: 0 }),
    effect(PHASER, 'Slow phaser', { mix: 0 }),
    effect(DRIVE, 'Warm', { mix: 0 }),
    effect(COMPRESSOR, 'Glue', { mix: 0 }),
  ], [
    { name: 'Filter', moves: [[SWEEP, 'mix', 0, 100], [SWEEP, 'freq', 20000, 180]] },
    { name: 'Resonance', value: 50, moves: [[SWEEP, 'resonance', 10, 75]] },
    { name: 'Pump', moves: [[PUMP, 'amount', 0, 85]] },
    { name: 'Phaser', moves: [[SWIRL, 'mix', 0, 60], [SWIRL, 'feedback', 30, 75]] },
    { name: 'Dirty', moves: [[DIRT, 'mix', 0, 70], [DIRT, 'drive', 6, 20]] },
    { name: 'Glue', value: 60, moves: [[GLUE, 'mix', 0, 100]] },
  ]);
})();

/** The worn cassette: the wobbling tape (wow), the saturation, the missing bits, the
 *  highs going away, the stereo narrowing and the recorder braking. */
export const CASSETTE: RackPreset = (() => {
  const WOW = 0, TAPE = 1, BITS = 2, DULL = 3, NARROW = 4, BRAKE = 5;
  return rack('Cassette', null, [
    // the wow: the fully wet Chorus is a vibrato (in Vibrato mode there's no mix), and mono like the tape
    effect(CHORUS, null, { mode: CHORUS_MODE.chorus, delay: 6, sync: CHORUS_SYNC.hz, rate: 0.7, depth: 20, width: 0, mix: 0 }),
    effect(DRIVE, 'Tape', { mix: 0 }),
    effect(REDUX, '12-bit sampler', { mix: 0 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 0, freq: 20000, resonance: 5, mix: 0 }),
    effect(STEREO, null, { bassMono: 0 }),
    effect(TAPE_STOP, 'Short brake'),
  ], [
    { name: 'Wow', value: 40, moves: [[WOW, 'mix', 0, 100], [WOW, 'depth', 10, 55]] },
    { name: 'Tape', value: 50, moves: [[TAPE, 'mix', 0, 100], [TAPE, 'drive', 6, 22]] },
    { name: 'Bit', value: 30, moves: [[BITS, 'mix', 0, 100], [BITS, 'bits', 16, 7], [BITS, 'rate', 48000, 11000]] },
    { name: 'Dull', value: 50, moves: [[DULL, 'mix', 0, 100], [DULL, 'freq', 20000, 2200]] },
    { name: 'Narrow', value: 30, moves: [[NARROW, 'width', 100, 20]] },
    { name: 'Stop', mode: 'button', moves: [[BRAKE, 'stop', 0, 1]] },
  ]);
})();

/** Shoegaze's wall of sound: the fuzz, the vibrato bar, the reverse reverb that
 *  sucks back, the echo and the endless tail, all wide. */
export const WALL: RackPreset = (() => {
  const FUZZ = 0, BEND = 1, SUCK = 2, ECHO = 3, ROOM = 4, WIDE = 5;
  return rack('Wall', null, [
    effect(DRIVE, 'Fuzz', { mix: 0 }),
    // the vibrato bar: the Chorus coming in up to fully wet
    effect(CHORUS, null, { mode: CHORUS_MODE.chorus, delay: 5, sync: CHORUS_SYNC.hz, rate: 0.35, depth: 30, width: 50, mix: 0 }),
    effect(REVERSE, '1-bar suck', { mix: 0 }),
    effect(DELAY, 'Long echo', { mix: 0 }),
    effect(REVERB, 'Endless tail', { mix: 0 }),
    effect(STEREO, null, { bassMono: 0 }),
  ], [
    { name: 'Fuzz', value: 60, moves: [[FUZZ, 'mix', 0, 100], [FUZZ, 'drive', 14, 32], [FUZZ, 'output', 0, -4]] },
    { name: 'Lever', value: 40, moves: [[BEND, 'mix', 0, 100], [BEND, 'depth', 10, 60]] },
    { name: 'Suck', moves: [[SUCK, 'mix', 0, 55]] },
    { name: 'Echo', value: 30, moves: [[ECHO, 'mix', 0, 40], [ECHO, 'feedback', 30, 70]] },
    { name: 'Wall', value: 70, moves: [[ROOM, 'mix', 0, 65], [ROOM, 'decay', 4, 20]] },
    { name: 'Width', value: 50, moves: [[WIDE, 'width', 100, 180]] },
  ]);
})();

/** The rave's 303: the hard distortion, the step gate cutting it, phaser, dotted echo and
 *  a short darkness; Ripeti is a button (a 1/16 Beat Repeat while it's held). */
export const ACID_FX: RackPreset = (() => {
  const DIRT = 0, CHOP = 1, SWIRL = 2, ECHO = 3, ROOM = 4, REPEAT = 5;
  return rack('Acid FX', null, [
    effect(DRIVE, null, { shape: SHAPE.hard, drive: 16, bias: 12, color: 25, low: 15, split: 150, tone: 9000, mix: 0, oversampling: 0 }),
    effect(GATE, null, { ...pattern('x.xx .xx. x.xx .x.x'), rate: index(STEP_RATES, '1/16'), gate: 70, release: 15, depth: 0 }),
    effect(PHASER, null, { mix: 0 }),
    effect(DELAY, null, { division: index(DIVISIONS, '1/8.'), pingPong: 1, feedback: 35, lowCut: 350, highCut: 4000, mix: 0 }),
    effect(REVERB, null, { size: 60, decay: 1.6, predelay: 10, damping: 4500, lowCut: 300, mix: 0 }),
    repeatButton('1/16'),
  ], [
    { name: 'Distortion', value: 70, moves: [[DIRT, 'mix', 0, 100], [DIRT, 'drive', 4, 26]] },
    { name: 'Cut', moves: [[CHOP, 'depth', 0, 100]] },
    { name: 'Phaser', moves: [[SWIRL, 'mix', 0, 60]] },
    { name: 'Echo', value: 30, moves: [[ECHO, 'mix', 0, 40], [ECHO, 'feedback', 20, 65]] },
    { name: 'Space', value: 15, moves: [[ROOM, 'mix', 0, 40]] },
    { name: 'Repeat', mode: 'button', moves: [[REPEAT, 'repeat', 0, 1]] },
  ]);
})();

/** The rave's master machine: three Ripeti, Al contrario and Stop nastro as buttons, the
 *  Sottrazione (the high-pass removing kick and bass before giving everything back), the Muro
 *  (low-pass) and the Lo-fi. At 0 the sound passes as it is. */
export const MACHINE: RackPreset = (() => {
  const R8 = 0, R16 = 1, R32 = 2, BACK = 3, BRAKE = 4, LOW = 5, HIGH = 6, BITS = 7;
  return rack('Machine', null, [
    repeatButton('1/8'),
    repeatButton('1/16'),
    repeatButton('1/32'),
    effect(REVERSE, null, { reverse: 1, length: index(REVERSE_LENGTHS, '1/4'), mix: 0 }),
    effect(TAPE_STOP, null, { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Immediately'), curve: BRAKE_CURVE.smooth, spin: 300 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.highPass, slope: 1, freq: 20, resonance: 10, mix: 0 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 15, mix: 0 }),
    effect(REDUX, null, { mix: 0, bits: 16, rate: 48000 }),
  ], [
    { name: 'Repeat 1/8', mode: 'button', moves: [[R8, 'repeat', 0, 1]] },
    { name: 'Repeat 1/16', mode: 'button', moves: [[R16, 'repeat', 0, 1]] },
    { name: 'Repeat 1/32', mode: 'button', moves: [[R32, 'repeat', 0, 1]] },
    { name: 'Reversed', mode: 'button', moves: [[BACK, 'mix', 0, 100]] },
    { name: 'Tape stop', mode: 'button', moves: [[BRAKE, 'stop', 0, 1]] },
    { name: 'Subtraction', moves: [[LOW, 'mix', 0, 100], [LOW, 'freq', 20, 700]] },
    { name: 'Wall', moves: [[HIGH, 'mix', 0, 100], [HIGH, 'freq', 20000, 350]] },
    { name: 'Lo-fi', moves: [[BITS, 'mix', 0, 100], [BITS, 'bits', 16, 6], [BITS, 'rate', 48000, 6000]] },
  ]);
})();

// ---------------------------------------------------------------- Instrument Rack

/** The new wave polysynth: two saws and an octave of square, the filter biting a
 *  little, light vibrato, then ensemble chorus, ping-pong echo and hall. */
export const NEW_WAVE: RackPreset = (() => {
  const SYNTH = 0, ENSEMBLE = 1, ECHO = 2, ROOM = 3;
  return rack('New wave', device(ANALOG, 'Lead', {
    oscA: 0, oscB: 1, oscBSemi: 12, oscBFine: 6, mix: 40, unison: 2, detune: 14, cutoff: 2200, resonance: 30, filterEnv: 45,
    fDecay: 0.6, fSustain: 30, attack: 0.005, decay: 0.8, sustain: 70, release: 0.5, lfoRate: 5, lfoPitch: 6, volume: -9,
  }), [
    effect(CHORUS, 'String ensemble'),
    effect(DELAY, 'Ping-pong 1/8.', { highCut: 4000, mix: 20 }),
    effect(REVERB, 'Hall', { decay: 3.5 }),
  ], [
    { name: 'Cutoff', value: 64, moves: [[SYNTH, 'cutoff', 300, 8000]] },
    { name: 'Resonance', value: 35, moves: [[SYNTH, 'resonance', 5, 80]] },
    { name: 'Envelope', value: 60, moves: [[SYNTH, 'filterEnv', 0, 90]] },
    { name: 'Attack', moves: [[SYNTH, 'attack', 0.001, 1.5], [SYNTH, 'fAttack', 0.001, 1]] },
    { name: 'Release', value: 30, moves: [[SYNTH, 'release', 0.1, 3]] },
    { name: 'Chorus', value: 60, moves: [[ENSEMBLE, 'mix', 0, 80], [ENSEMBLE, 'depth', 20, 70]] },
    { name: 'Echo', value: 45, moves: [[ECHO, 'mix', 0, 45], [ECHO, 'feedback', 20, 65]] },
    { name: 'Space', value: 45, moves: [[ROOM, 'mix', 5, 60], [ROOM, 'decay', 1.5, 8]] },
  ]);
})();

/** Oxygène's string machine strings: the slower Wavetable "Strings", in the phaser
 *  turning slowly, in the ensemble and in a long hall. */
export const OXYGEN: RackPreset = (() => {
  const SYNTH = 0, SWIRL = 1, ENSEMBLE = 2, ECHO = 3, ROOM = 4;
  return rack('Oxygen', device(WAVETABLE, 'Strings', { attack: 0.6, release: 1.5, cutoff: 4000, volume: -6 }), [
    effect(PHASER, 'Slow phaser', { mix: 60 }),
    effect(CHORUS, 'String ensemble'),
    effect(DELAY, 'Long echo', { mix: 15 }),
    effect(REVERB, 'Hall', { decay: 5, mix: 35 }),
  ], [
    { name: 'Phaser', value: 90, moves: [[SWIRL, 'mix', 0, 80], [SWIRL, 'feedback', 20, 75]] },
    // in steps: from 4 bars to 1/2 per cycle
    { name: 'Rate', value: 40, moves: [[SWIRL, 'division', TEMPO_RATE['4 bars'], TEMPO_RATE['1/2']]] },
    { name: 'Brightness', value: 70, moves: [[SYNTH, 'cutoff', 800, 10000]] },
    { name: 'Ensemble', value: 70, moves: [[ENSEMBLE, 'mix', 0, 80]] },
    { name: 'Attack', value: 40, moves: [[SYNTH, 'attack', 0.01, 3]] },
    { name: 'Release', value: 40, moves: [[SYNTH, 'release', 0.3, 6]] },
    { name: 'Echo', value: 20, moves: [[ECHO, 'mix', 0, 35]] },
    { name: 'Space', value: 50, moves: [[ROOM, 'mix', 10, 60], [ROOM, 'decay', 2, 12]] },
  ]);
})();

/** The rave hoover (Mentasm, the Alpha Juno): PWM and a saw an octave down, seven wide
 *  copies, the glide and the "swoop" rising at the attack, in the chorus. */
export const HOOVER: RackPreset = (() => {
  const SYNTH = 0, WIDE = 1, GRIT = 2, ROOM = 3;
  return rack('Hoover', device(WAVETABLE, 'Supersaw', {
    tableA: TABLE.PWM, posA: 60, tableB: TABLE.Basic, posB: 67, levelB: 60, semiB: -12, unison: 7, detune: 35, spread: 100,
    voiceMode: VOICE_MODE.legato, glide: 120, cutoff: 6000, sustain: 100, release: 0.4,
    mAttack: 0.001, mDecay: 0.3, mSustain: 0, mRelease: 0.2, envDest: MOD_DEST.pitch, envAmount: -25, envDest2: MOD_DEST.none,
    lfo1Shape: WT_LFO.triangle, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 0.6, lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 30,
    volume: -16,
  }), [
    effect(CHORUS, 'Wide chorus', { mix: 60 }),
    effect(DRIVE, 'Warm', { mix: 0 }),
    effect(REVERB, 'Hall', { mix: 20 }),
  ], [
    // the swoop: how far below the note starts (up to 12 semitones) before rising
    { name: 'Swoop', value: 64, moves: [[SYNTH, 'envAmount', 0, -50]] },
    { name: 'Glide', value: 40, moves: [[SYNTH, 'glide', 0, 400]] },
    { name: 'PWM', value: 64, moves: [[SYNTH, 'lfo1Amount', 0, 60]] },
    { name: 'Width', value: 80, moves: [[SYNTH, 'detune', 10, 50], [WIDE, 'mix', 0, 80]] },
    { name: 'Cutoff', value: 80, moves: [[SYNTH, 'cutoff', 500, 14000]] },
    { name: 'Octave down', value: 90, moves: [[SYNTH, 'levelB', 0, 70]] },
    { name: 'Grit', moves: [[GRIT, 'mix', 0, 100], [GRIT, 'drive', 6, 20]] },
    { name: 'Space', value: 35, moves: [[ROOM, 'mix', 5, 50]] },
  ]);
})();

/** The '80s polysynth brass (the OB-Xa of "Jump"): detuned saws, the
 *  filter opening at the attack, chorus, compression and a room. */
export const JUMP: RackPreset = (() => {
  const SYNTH = 0, ENSEMBLE = 1, GLUE = 2, ROOM = 3;
  return rack('Jump', device(ANALOG, 'Pad', {
    oscA: 0, oscB: 0, oscBSemi: 0, oscBFine: 10, mix: 50, unison: 3, detune: 20, spread: 80, cutoff: 900, resonance: 10,
    filterEnv: 50, keyTrack: 40, fAttack: 0.02, fDecay: 0.5, fSustain: 45, fRelease: 0.3, attack: 0.01, decay: 0.6, sustain: 85,
    release: 0.25, lfoCutoff: 0, velocity: 40, volume: -8,
  }), [
    effect(CHORUS, 'Wide chorus', { mix: 35 }),
    effect(COMPRESSOR, 'Glue'),
    effect(REVERB, 'Room'),
  ], [
    { name: 'Brightness', value: 55, moves: [[SYNTH, 'cutoff', 300, 6000]] },
    { name: 'Bite', value: 60, moves: [[SYNTH, 'filterEnv', 0, 90]] },
    // the filter opening slowly: the brass swelling
    { name: 'Swell', value: 20, moves: [[SYNTH, 'fAttack', 0.001, 0.4], [SYNTH, 'attack', 0.003, 0.15]] },
    { name: 'Thickness', value: 50, moves: [[SYNTH, 'detune', 5, 40], [SYNTH, 'oscBFine', 3, 20]] },
    { name: 'Release', value: 20, moves: [[SYNTH, 'release', 0.05, 2]] },
    { name: 'Chorus', value: 50, moves: [[ENSEMBLE, 'mix', 0, 70]] },
    { name: 'Glue', value: 50, moves: [[GLUE, 'mix', 0, 100]] },
    { name: 'Space', value: 40, moves: [[ROOM, 'mix', 5, 45]] },
  ]);
})();

/** The rave's offbeat bass: monophonic Neuro, two saws and a slightly
 *  detuned square, the filter biting with the modulation envelope, the clean sub below the
 *  crossover; the lows in mono. The sequencer is ready (off): on it leaves the downbeat to the
 *  kick. In the live it pumps sidechained to the kick: here there's no compressor (it goes after,
 *  with the kick as sidechain). */
export const OFFBEAT: RackPreset = (() => {
  const SYNTH = 0, ROOM = 2;
  return rack('Offbeat', device(NEURO, null, {
    oscA: 0, oscB: 1, oscBSemi: 0, oscBFine: -7, mix: 35, unison: 1,
    filterType: 0, cutoff: 900, resonance: 25, drive: 30, keyTrack: 40,
    dist: 20, sub: 70, subOctave: 0, crossover: 120,
    voiceMode: 0, glide: 0, attack: 0.002, decay: 0.18, sustain: 40, release: 0.07, velocity: 30,
    mAttack: 0.001, mDecay: 0.1, mSustain: 0, mRelease: 0.05, envDest: NEURO_DEST.cutoff, envAmount: 45,
    volume: -6,
    seqKick: 1, seqDensity: 70, seqRange: 25, seqScale: SEQ_SCALE['Phrygian and tritone'], seqSlide: 0, seqAccent: 25, seqGate: 60, seqPattern: 11,
  }), [
    eqOf(35, [[250, -2.5, 1], [2500, 1.5, 1]]),
    effect(REVERB, null, { size: 75, decay: 1.2, predelay: 0, diffusion: 90, damping: 2500, lowCut: 30, width: 0, mix: 0 }),
    effect(STEREO, null, { monoFreq: 150 }),
  ], [
    { name: 'Cutoff', value: 60, moves: [[SYNTH, 'cutoff', 150, 8000]] },
    { name: 'Bite', value: 60, moves: [[SYNTH, 'envAmount', 0, 80], [SYNTH, 'mDecay', 0.04, 0.25]] },
    { name: 'Tail', value: 60, moves: [[SYNTH, 'decay', 0.06, 0.6], [SYNTH, 'release', 0.02, 0.3]] },
    { name: 'Sub', value: 87, moves: [[SYNTH, 'sub', 20, 100]] },
    { name: 'Growl', moves: [[SYNTH, 'fm', 0, 55], [SYNTH, 'fold', 0, 45]] },
    { name: 'Distortion', value: 50, moves: [[SYNTH, 'dist', 0, 70], [SYNTH, 'drive', 15, 70]] },
    { name: 'Vocal', moves: [[SYNTH, 'formant', 0, 80], [SYNTH, 'vowel', 0, 100]] },
    // the bass in a small dark mono room: the boom under the kick
    { name: 'Rumble', moves: [[ROOM, 'mix', 0, 40], [ROOM, 'decay', 1.2, 2.5]] },
  ]);
})();

/** The 303 that writes itself: the Analog in Legato with glide and accent, and the step sequencer
 *  ready (Phrygian and tritone, sixteenths; it's turned on in the Sequencer section, and with the transport
 *  running it's enough to hold the root). Pattern chooses the loop, Follia takes it from a few notes to a
 *  frantic line. To put in front of Acido FX. */
export const THREE_OH_THREE: RackPreset = (() => {
  const SYNTH = 0;
  return rack('303', device(ANALOG, null, {
    oscA: 0, mix: 0, voiceMode: ANALOG_VOICE.legato, glide: 60, accent: 70,
    cutoff: 420, resonance: 80, filterEnv: 66, keyTrack: 20,
    fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -11,
    seqScale: SEQ_SCALE['Phrygian and tritone'], seqRate: SEQ_RATE['1/16'], seqLength: 16, seqGate: 55,
  }), [
    eqOf(95, [[160, -4, 1.2], [622, 2.5, 1]]),
  ], [
    { name: 'Cutoff', value: 55, moves: [[SYNTH, 'cutoff', 90, 3500]] },
    { name: 'Resonance', value: 90, moves: [[SYNTH, 'resonance', 30, 95]] },
    { name: 'Env Mod', value: 76, moves: [[SYNTH, 'filterEnv', 10, 100]] },
    { name: 'Decay', value: 40, moves: [[SYNTH, 'fDecay', 0.04, 1]] },
    { name: 'Accent', value: 90, moves: [[SYNTH, 'accent', 0, 100]] },
    { name: 'Glide', value: 38, moves: [[SYNTH, 'glide', 0, 200]] },
    // the sequencer's loop: a new one comes in at the start of the loop
    { name: 'Pattern', moves: [[SYNTH, 'seqPattern', 0, 127]] },
    // from a minimal acid (few notes, the root) to a frantic one (full, wide, slides, accents)
    { name: 'Madness', value: 40, moves: [[SYNTH, 'seqDensity', 25, 100], [SYNTH, 'seqRange', 5, 85], [SYNTH, 'seqSlide', 5, 55], [SYNTH, 'seqAccent', 15, 60]] },
  ]);
})();

// ---------------------------------------------------------------- with the modulators

/** The dubstep and neuro wobble: the Neuro "Reese scuro" with a synced LFO opening
 *  cutoff, fold and vowel together. Wobble is how much, Rate from 1/4 to 1/16 (in steps), Shape from
 *  sine to square; then OTT and the lows in mono. */
export const WOBBLE: RackPreset = (() => {
  const SYNTH = 0, LFO = 1, OTT = 2;
  return rack('Wobble', device(NEURO, 'Dark reese', { cutoff: 300, volume: -10 }), [
    modulator(LFO_DEVICE, 'Wobble 1/8', {}, [[on(SYNTH, 'cutoff'), 30], [on(SYNTH, 'fold'), 25], [on(SYNTH, 'vowel'), 40]]),
    effect(MULTIBAND, 'OTT'),
    effect(STEREO, 'Mono bass'),
  ], [
    { name: 'Cutoff', value: 50, moves: [[SYNTH, 'cutoff', 120, 3000]] },
    { name: 'Wobble', value: 90, moves: [[LFO, 'depth', 0, 100]] },
    { name: 'Rate', value: 76, moves: [[LFO, 'division', TEMPO_RATE['1/4'], TEMPO_RATE['1/16']]] },
    { name: 'Shape', moves: [[LFO, 'l1Shape', MOD_SHAPE.sine, MOD_SHAPE.square]] },
    { name: 'Growl', value: 40, moves: [[SYNTH, 'fm', 0, 60], [SYNTH, 'fold', 0, 45]] },
    { name: 'Distortion', value: 50, moves: [[SYNTH, 'dist', 0, 80], [SYNTH, 'drive', 20, 80]] },
    { name: 'Vocal', value: 40, moves: [[SYNTH, 'formant', 0, 80]] },
    { name: 'OTT', value: 50, moves: [[OTT, 'depth', 0, 100], [SYNTH, 'sub', 90, 50]] },
  ]);
})();

/** The pad pumping as if sidechained to the kick, without the kick: a synced Envelope that
 *  lowers the volume at every beat and lets it rise again. Underneath, a very slow random LFO
 *  moves cutoff and pan: the pad never stands still. */
export const PUMP_RACK: RackPreset = (() => {
  const SYNTH = 0, PUMP = 1, DRIFT = 2, ECHO = 4, ROOM = 5;
  return rack('Pump', device(ANALOG, 'Dark pad', { attack: 0.3, cutoff: 900 }), [
    modulator(ENVELOPE_DEVICE, 'Pump 1/4', {}, [[VOLUME, -95]]),
    modulator(LFO_DEVICE, 'Slow drift', {}, [[on(SYNTH, 'cutoff'), 12], [PAN, 30]]),
    effect(CHORUS, 'Wide chorus'),
    effect(DELAY, 'Long echo', { mix: 15 }),
    effect(REVERB, 'Hall', { decay: 5, mix: 30 }),
  ], [
    { name: 'Pump', value: 100, moves: [[PUMP, 'depth', 0, 100]] },
    // how long it takes to come back up
    { name: 'Climb back', value: 50, moves: [[PUMP, 'e1D', 0.08, 0.5]] },
    { name: 'Rhythm', value: 51, moves: [[PUMP, 'division', TEMPO_RATE['1/2'], TEMPO_RATE['1/8']]] },
    { name: 'Open', value: 55, moves: [[SYNTH, 'cutoff', 200, 5000]] },
    { name: 'Drift', value: 60, moves: [[DRIFT, 'depth', 0, 100]] },
    { name: 'Slowness', value: 30, moves: [[SYNTH, 'attack', 0.005, 3], [SYNTH, 'release', 0.3, 5]] },
    { name: 'Echo', value: 30, moves: [[ECHO, 'mix', 0, 40]] },
    { name: 'Space', value: 50, moves: [[ROOM, 'mix', 5, 60]] },
  ]);
})();

/** The trance gate: the Supersaw cut into sixteenths by a synced Envelope on the volume
 *  (bipolar: closed between one hit and the next, open on the hit), with the cutoff opening a little
 *  at every hit; an S&H LFO throws the hits left and right. */
export const GATED: RackPreset = (() => {
  const SYNTH = 0, GATE_ = 1, SCATTER = 2, ECHO = 3, ROOM = 4;
  return rack('Gated', device(WAVETABLE, 'Supersaw', { cutoff: 7000, release: 0.4 }), [
    modulator(ENVELOPE_DEVICE, 'Tempo gate', { pol: POLARITY.bi }, [[VOLUME, 100], [on(SYNTH, 'cutoff'), 8]]),
    modulator(LFO_DEVICE, 'Random 1/16', {}, [[PAN, 60], [on(SYNTH, 'posA'), 12]]),
    effect(DELAY, 'Ping-pong 1/8.', { mix: 20 }),
    effect(REVERB, 'Hall', { mix: 25 }),
  ], [
    { name: 'Gate', value: 127, moves: [[GATE_, 'depth', 0, 100]] },
    { name: 'Length', value: 45, moves: [[GATE_, 'gate', 15, 90]] },
    { name: 'Rhythm', value: 64, moves: [[GATE_, 'division', TEMPO_RATE['1/8'], TEMPO_RATE['1/32']]] },
    { name: 'Scatter', value: 50, moves: [[SCATTER, 'depth', 0, 100]] },
    { name: 'Cutoff', value: 85, moves: [[SYNTH, 'cutoff', 400, 14000]] },
    { name: 'Width', value: 60, moves: [[SYNTH, 'detune', 5, 45]] },
    { name: 'Echo', value: 45, moves: [[ECHO, 'mix', 0, 45]] },
    { name: 'Space', value: 40, moves: [[ROOM, 'mix', 5, 55]] },
  ]);
})();

/** The 303 turning its own knobs: a slow triangle LFO sweeps the cutoff (like
 *  the hand on the box), a sixteenth S&H dirties cutoff and env mod note by note. */
export const LIVELY_ACID: RackPreset = (() => {
  const SYNTH = 0, SWEEP = 1, CHAOS = 2, DRIVE_ = 3;
  return rack('Lively acid', device(ANALOG, 'Acid'), [
    modulator(LFO_DEVICE, '2-bar breath', {}, [[on(SYNTH, 'cutoff'), 22], [on(SYNTH, 'resonance'), 8]]),
    modulator(LFO_DEVICE, 'Random 1/16', {}, [[on(SYNTH, 'cutoff'), 12], [on(SYNTH, 'filterEnv'), 25]]),
    effect(DRIVE, 'Warm', { mix: 0 }),
    effect(DELAY, 'Ping-pong 1/8.', { highCut: 3500, lowCut: 200 }),
  ], [
    { name: 'Cutoff', value: 45, moves: [[SYNTH, 'cutoff', 120, 3500]] },
    { name: 'Resonance', value: 80, moves: [[SYNTH, 'resonance', 40, 90]] },
    { name: 'Env Mod', value: 64, moves: [[SYNTH, 'filterEnv', 20, 100]] },
    { name: 'Decay', value: 50, moves: [[SYNTH, 'fDecay', 0.05, 1.2]] },
    { name: 'Spin', value: 70, moves: [[SWEEP, 'depth', 0, 100]] },
    // from 4 bars to 1/2 per cycle, in steps
    { name: 'Spin speed', value: 42, moves: [[SWEEP, 'division', TEMPO_RATE['4 bars'], TEMPO_RATE['1/2']]] },
    { name: 'Chaos', value: 35, moves: [[CHAOS, 'depth', 0, 100]] },
    { name: 'Dirty', value: 40, moves: [[DRIVE_, 'mix', 0, 100], [DRIVE_, 'drive', 4, 30], [DRIVE_, 'output', 0, -4]] },
  ]);
})();

/** The rave siren: the Neuro with one saw, the Transpose moved by a triangle LFO
 *  (up to an octave up and down) and, with Allarme, by an eighth-note square jumping an octave:
 *  the two-tone siren. Just hold a note. */
export const SIREN_RACK: RackPreset = (() => {
  const SYNTH = 0, SIREN = 1, ALARM = 2, WIDE = 3, ECHO = 4, ROOM = 5;
  return rack('Siren', device(NEURO, null, {
    oscA: 0, mix: 0, unison: 2, detune: 12, cutoff: 3000, resonance: 20, drive: 30, dist: 15, sub: 0,
    voiceMode: 0, attack: 0.01, decay: 0.5, sustain: 100, release: 0.4, volume: -14,
  }), [
    modulator(LFO_DEVICE, null, { division: TEMPO_RATE['1 bar'], l1Shape: MOD_SHAPE.triangle }, [[on(SYNTH, 'transpose'), 25], [on(SYNTH, 'cutoff'), 6]]),
    modulator(LFO_DEVICE, 'Square 1/16', { division: TEMPO_RATE['1/8'], depth: 0 }, [[on(SYNTH, 'transpose'), 25]]),
    effect(CHORUS, 'Wide chorus', { mix: 30 }),
    effect(DELAY, 'Ping-pong 1/8.', { mix: 30 }),
    effect(REVERB, 'Hall', { mix: 30 }),
  ], [
    { name: 'Siren', value: 80, moves: [[SIREN, 'depth', 0, 100]] },
    { name: 'Rate', value: 18, moves: [[SIREN, 'division', TEMPO_RATE['2 bars'], TEMPO_RATE['1/8']]] },
    { name: 'Alarm', moves: [[ALARM, 'depth', 0, 100]] },
    { name: 'Cutoff', value: 70, moves: [[SYNTH, 'cutoff', 400, 10000]] },
    { name: 'Grit', value: 40, moves: [[SYNTH, 'dist', 0, 70], [SYNTH, 'drive', 20, 80]] },
    { name: 'Width', value: 50, moves: [[WIDE, 'mix', 0, 70]] },
    { name: 'Echo', value: 50, moves: [[ECHO, 'mix', 0, 50]] },
    { name: 'Space', value: 50, moves: [[ROOM, 'mix', 5, 60]] },
  ]);
})();

/** The biting stab: the Neuro "Stab neuro" with an Envelope at every note opening cutoff and FM
 *  for a moment (stronger with louder notes), a vibrato arriving on long notes, and
 *  the dub echo. */
export const HIT: RackPreset = (() => {
  const SYNTH = 0, BITE = 1, VIBRATO = 2, ECHO = 3, ROOM = 4;
  return rack('Hit', device(NEURO, 'Neuro stab'), [
    modulator(ENVELOPE_DEVICE, 'Pluck', { e1D: 0.2, vel: 50 }, [[on(SYNTH, 'cutoff'), 30], [on(SYNTH, 'fm'), 40]]),
    modulator(LFO_DEVICE, 'Vibrato', { depth: 0 }, [[on(SYNTH, 'transpose'), 1]]),
    effect(DELAY, 'Dub', { mix: 25 }),
    effect(REVERB, 'Hall', { mix: 20 }),
  ], [
    { name: 'Bite', value: 70, moves: [[BITE, 'depth', 0, 100]] },
    { name: 'Bite tail', value: 40, moves: [[BITE, 'e1D', 0.05, 0.8]] },
    { name: 'Cutoff', value: 50, moves: [[SYNTH, 'cutoff', 200, 4000]] },
    { name: 'Vocal', value: 30, moves: [[SYNTH, 'vowel', 0, 100]] },
    { name: 'Distortion', value: 50, moves: [[SYNTH, 'dist', 0, 80], [SYNTH, 'drive', 20, 80]] },
    { name: 'Vibrato', moves: [[VIBRATO, 'depth', 0, 100]] },
    { name: 'Echo', value: 40, moves: [[ECHO, 'mix', 0, 50]] },
    { name: 'Space', value: 30, moves: [[ROOM, 'mix', 0, 50]] },
  ]);
})();

// ---------------------------------------------------------------- drums

/** The Rave kit with the glue: saturation, compression and a small room. The macros dig
 *  into the kick (tail, rumble, note), into the snare (the room) and into the hi-hats. */
export const RAVE_DRUMS: RackPreset = (() => {
  const KIT = 0, HEAT = 1, GLUE = 2, ROOM = 3;
  return rack('Rave drums', device(DRUMS, 'Rave', { volume: -9 }), [
    effect(DRIVE, 'Warm', { mix: 0 }),
    effect(COMPRESSOR, 'Drum punch'),
    effect(REVERB, 'Room', { mix: 0 }),
  ], [
    { name: 'Kick tail', value: 50, moves: [[KIT, 'p1.kick.decay', 0.12, 0.4], [KIT, 'p1.kick.tailDecay', 0.2, 1.2]] },
    { name: 'Rumble', value: 90, moves: [[KIT, 'p1.kick.rumble', 0, 100], [KIT, 'p1.kick.rumbleTime', 0.6, 2.5]] },
    // the tuned kick: from C0 to C1, in semitones
    { name: 'Kick note', value: 42, moves: [[KIT, 'p1.kick.note', 0, 12], [KIT, 'p13.kick.note', 0, 12]] },
    { name: 'Snare room', value: 50, moves: [[KIT, 'p3.snare.room', 10, 90], [KIT, 'p3.snare.roomTime', 0.5, 2.5]] },
    { name: 'Open hat', value: 35, moves: [[KIT, 'p11.cymbals.openDecay', 0.12, 1.5]] },
    {
      name: 'Brightness', value: 70,
      moves: [[KIT, 'p7.cymbals.closedTone', 40, 90], [KIT, 'p9.cymbals.pedalTone', 40, 90], [KIT, 'p11.cymbals.openTone', 40, 90]],
    },
    { name: 'Saturation', moves: [[HEAT, 'mix', 0, 100], [HEAT, 'drive', 6, 16]] },
    { name: 'Glue', value: 80, moves: [[GLUE, 'mix', 0, 100], [ROOM, 'mix', 0, 15]] },
  ]);
})();

/** The Dub techno kit in the echo and the hall, with the filter in front: everything moves away. */
export const DUB_DRUMS: RackPreset = (() => {
  const KIT = 0, FILTER = 1, ECHO = 2, HALL = 3;
  return rack('Dub drums', device(DRUMS, 'Dub techno'), [
    effect(AUTO_FILTER, null, { freq: 20000, resonance: 25, slope: 1 }),
    effect(DELAY, 'Dub', { mix: 0 }),
    effect(REVERB, 'Hall', { mix: 0 }),
  ], [
    { name: 'Filter', moves: [[FILTER, 'freq', 20000, 250]] },
    { name: 'Echo', value: 45, moves: [[ECHO, 'mix', 0, 45]] },
    { name: 'Returns', value: 60, moves: [[ECHO, 'feedback', 20, 85]] },
    { name: 'Hall', value: 40, moves: [[HALL, 'mix', 0, 45], [HALL, 'decay', 2, 8]] },
    { name: 'Rim room', value: 50, moves: [[KIT, 'p2.snare.room', 10, 90], [KIT, 'p2.snare.roomTime', 0.8, 3]] },
    { name: 'Rumble', value: 45, moves: [[KIT, 'p1.kick.rumble', 0, 80], [KIT, 'p1.kick.tailDecay', 0.5, 2]] },
    { name: 'Open hat', value: 60, moves: [[KIT, 'p11.cymbals.openDecay', 0.3, 2.5]] },
    { name: 'Hat width', value: 80, moves: [[KIT, 'p7.cymbals.width', 20, 100], [KIT, 'p11.cymbals.width', 20, 100]] },
  ]);
})();

/** The Lo-fi kit in the old sampler: bits and rate dropping, the snare crumbling,
 *  the button stutter. */
export const BROKEN_DRUMS: RackPreset = (() => {
  const KIT = 0, BITS = 1, STUTTER = 2, GLUE = 3;
  return rack('Broken drums', device(DRUMS, 'Lo-fi', { volume: -6 }), [
    effect(REDUX, '12-bit sampler', { mix: 0 }),
    repeatButton('1/16'),
    effect(COMPRESSOR, 'Squash', { mix: 0 }),
  ], [
    { name: 'Bit', value: 40, moves: [[BITS, 'mix', 0, 100], [BITS, 'bits', 16, 5], [BITS, 'rate', 30000, 5000]] },
    { name: 'Grain', value: 60, moves: [[KIT, 'p3.snare.grain', 0, 100], [KIT, 'p5.snare.grain', 30, 100]] },
    { name: 'Stutter', mode: 'button', moves: [[STUTTER, 'repeat', 0, 1]] },
    { name: 'Squash', value: 50, moves: [[GLUE, 'mix', 0, 80]] },
    { name: 'Kick', value: 64, moves: [[KIT, 'p1.kick.drive', 0, 80], [KIT, 'p1.kick.decay', 0.06, 0.3]] },
    { name: 'Metal', value: 64, moves: [[KIT, 'p7.cymbals.variation', 10, 100], [KIT, 'p11.cymbals.variation', 10, 100]] },
    { name: 'Open hat', value: 40, moves: [[KIT, 'p11.cymbals.openDecay', 0.15, 1.5]] },
    { name: 'Room', value: 30, moves: [[KIT, 'p5.snare.room', 0, 80], [KIT, 'p5.snare.roomTime', 0.3, 2]] },
  ]);
})();

/** The Industrial kit even harder: distortion, OTT, a concrete hall. */
export const INDUSTRIAL_DRUMS: RackPreset = (() => {
  const KIT = 0, BREAK = 1, OTT = 2, HALL = 3;
  return rack('Industrial drums', device(DRUMS, 'Industrial', { volume: -10 }), [
    effect(DRIVE, 'Broken', { mix: 0 }),
    effect(MULTIBAND, 'OTT', { mix: 0, output: 0 }),
    effect(REVERB, 'Hall', { mix: 0, damping: 3000 }),
  ], [
    { name: 'Destruction', moves: [[BREAK, 'mix', 0, 50], [BREAK, 'output', 0, -6]] },
    { name: 'OTT', value: 40, moves: [[OTT, 'mix', 0, 60]] },
    { name: 'Concrete', value: 30, moves: [[HALL, 'mix', 0, 40], [HALL, 'decay', 1.5, 6]] },
    { name: 'Rumble', value: 64, moves: [[KIT, 'p13.kick.rumble', 0, 100], [KIT, 'p13.kick.rumbleDrive', 40, 100]] },
    { name: 'Snare room', value: 40, moves: [[KIT, 'p3.snare.room', 0, 90], [KIT, 'p3.snare.roomTime', 0.5, 3]] },
    { name: 'Dirty snare', value: 50, moves: [[KIT, 'p3.snare.drive', 20, 100], [KIT, 'p3.snare.grain', 0, 80]] },
    { name: 'Long cymbals', value: 40, moves: [[KIT, 'p14.cymbals.crashDecay', 1, 8], [KIT, 'p16.cymbals.rideDecay', 1, 8]] },
    { name: 'Open hat', value: 40, moves: [[KIT, 'p11.cymbals.openDecay', 0.2, 2]] },
  ]);
})();

/** A kick to build with knobs: the "Techno" Kick, an EQ and the clipper. */
export const KICK_RACK: RackPreset = (() => {
  const KICK_ = 0, CLIP = 2;
  return rack('Kick', device(KICK, 'Techno', { rumbleOn: 1, rumble: 0 }), [
    eqOf(25, [[60, 2, 1], [300, -3, 1.2], [4000, 1.5, 1]]),
    effect(CLIPPER, 'Kick', { drive: 0 }),
  ], [
    { name: 'Note', value: 53, moves: [[KICK_, 'note', 0, 12]] },
    { name: 'Punch', value: 60, moves: [[KICK_, 'snapLevel', 10, 90], [KICK_, 'pitch', 15, 45]] },
    { name: 'Fall', value: 40, moves: [[KICK_, 'pitchTime', 15, 90]] },
    { name: 'Body', value: 50, moves: [[KICK_, 'decay', 0.1, 0.5], [KICK_, 'hold', 5, 60]] },
    { name: 'Tail', value: 45, moves: [[KICK_, 'tailLevel', 0, 80], [KICK_, 'tailDecay', 0.2, 2]] },
    { name: 'Rumble', moves: [[KICK_, 'rumble', 0, 100], [KICK_, 'rumbleDrive', 30, 90]] },
    { name: 'Saturation', value: 30, moves: [[KICK_, 'drive', 0, 70]] },
    { name: 'Clip', value: 40, moves: [[CLIP, 'drive', 0, 10]] },
  ]);
})();

/** A snare to build with knobs, with the hall to throw. */
export const SNARE_RACK: RackPreset = (() => {
  const SNARE_ = 0, GLUE = 1, THROW = 2;
  return rack('Snare', device(SNARE, 'Techno', { volume: -12 }), [
    effect(COMPRESSOR, 'Drum punch', { mix: 0 }),
    effect(REVERB, 'Vocal throw', { mix: 0 }),
  ], [
    { name: 'Note', value: 40, moves: [[SNARE_, 'note', 0, 24]] },
    { name: 'Stick', value: 50, moves: [[SNARE_, 'snapLevel', 10, 90]] },
    { name: 'Skin', value: 55, moves: [[SNARE_, 'bodyLevel', 20, 90], [SNARE_, 'decay', 0.06, 0.3]] },
    { name: 'Snares', value: 64, moves: [[SNARE_, 'wiresLevel', 20, 100], [SNARE_, 'wiresDecay', 0.1, 0.6]] },
    { name: 'Grain', moves: [[SNARE_, 'grain', 0, 100]] },
    { name: 'Room', value: 45, moves: [[SNARE_, 'room', 0, 90], [SNARE_, 'roomTime', 0.3, 2.5]] },
    { name: 'Punch', value: 50, moves: [[GLUE, 'mix', 0, 100]] },
    { name: 'Throw', moves: [[THROW, 'mix', 0, 60]] },
  ]);
})();

/** The moving hi-hats: synced pan, ping-pong echo and the metallic flanger. */
export const MOVING_HATS: RackPreset = (() => {
  const HATS = 0, PAN = 1, ECHO = 2, JET = 3;
  return rack('Moving hats', device(CYMBALS, 'Dry techno'), [
    effect(AUTO_PAN, 'Eighths pan', { amount: 0 }),
    effect(DELAY, 'Ping-pong 1/8.', { mix: 0 }),
    effect(PHASER, 'Metallic hats', { mix: 0 }),
  ], [
    { name: 'Closed', value: 40, moves: [[HATS, 'closedDecay', 0.02, 0.15]] },
    { name: 'Open', value: 40, moves: [[HATS, 'openDecay', 0.15, 1.5]] },
    { name: 'Brightness', value: 70, moves: [[HATS, 'closedTone', 30, 95], [HATS, 'pedalTone', 30, 95], [HATS, 'openTone', 30, 95]] },
    { name: 'Variation', value: 30, moves: [[HATS, 'variation', 0, 100]] },
    { name: 'Noise', value: 50, moves: [[HATS, 'closedNoise', 10, 90], [HATS, 'openNoise', 10, 90]] },
    { name: 'Pan', value: 50, moves: [[PAN, 'amount', 0, 100]] },
    { name: 'Echo', value: 30, moves: [[ECHO, 'mix', 0, 40]] },
    { name: 'Jet', moves: [[JET, 'mix', 0, 60]] },
  ]);
})();

/** An effect set by hand: only these values, with the name of the sound it started from. */
const tuned = (type: DeviceType, preset: string, params: Readonly<Record<string, number>>): SavedEffect =>
  ({ type: type.type, preset, params, enabled: true });

/** For the master: compression, tape, OTT, EQ and clipper with one knob per idea. It starts already
 *  set and raises by 3 dB (Volume macro). */
export const SALSICCIA: RackPreset = (() => {
  const COMP = 0, TAPE = 1, OTT = 2, TONE = 3, CLIP = 4;
  return rack('Salsiccia', null, [
    tuned(COMPRESSOR, 'Fat', { threshold: -15.5, ratio: 4, knee: 10, attack: 6.300000000000001, release: 109, detector: 1, auto: 1, mix: 43 }),
    tuned(DRIVE, 'Tape', { shape: 2, drive: 10.5, bias: 13, color: 0, low: 60, tone: 18000, auto: 1, mix: 24 }),
    tuned(MULTIBAND, 'OTT', { depth: 100, time: 50, input: 0, output: 0, mix: 13 }),
    tuned(EQ, 'Body and air', { b2on: 1, b2freq: 70, b2gain: 0, b7on: 1, b7freq: 9000, b7gain: 0 }),
    tuned(CLIPPER, 'Clip', { drive: 0, ceiling: -0.3, knee: 40, output: 3 }),
  ], [
    { name: 'Fat', value: 55, moves: [[COMP, 'mix', 0, 100], [COMP, 'threshold', -6, -28], [TAPE, 'mix', 0, 55], [OTT, 'mix', 0, 30]] },
    { name: 'Colour', value: 64, moves: [[TAPE, 'color', -60, 60], [TAPE, 'bias', 0, 25]] },
    { name: 'Push', value: 45, moves: [[TAPE, 'drive', 4, 22]] },
    { name: 'Body', moves: [[TONE, 'b2gain', 0, 5]] },
    { name: 'Air', moves: [[TONE, 'b7gain', 0, 5]] },
    { name: 'Pump', value: 55, moves: [[COMP, 'release', 260, 35], [COMP, 'attack', 15, 2]] },
    { name: 'Clip', moves: [[CLIP, 'drive', 0, 8]] },
    { name: 'Volume', value: 106, moves: [[CLIP, 'output', -12, 6]] },
  ]);
})();

/** The factory racks, in order. */
export const FACTORY_RACKS: readonly RackPreset[] = [
  TORNADO, FADE_TO_GREY, DUB, FRENCH_TOUCH, CASSETTE, WALL, ACID_FX, MACHINE, SALSICCIA,
  ACID, FOG, GROWL, NEW_WAVE, OXYGEN, HOOVER, JUMP, OFFBEAT, THREE_OH_THREE,
  WOBBLE, PUMP_RACK, GATED, LIVELY_ACID, SIREN_RACK, HIT,
  RAVE_DRUMS, DUB_DRUMS, BROKEN_DRUMS, INDUSTRIAL_DRUMS, KICK_RACK, SNARE_RACK, MOVING_HATS,
];
