/* "Fuori dal corpo": dark rave techno at 140 BPM in G phrygian (G minor with the A
 * flat). No melodies: the piece is carried by the groove and the moving basses, like
 * Noisia's neuro brought into four-four.
 *
 *   Cassa       a distorted kick in G, short and cut as if by a clipper, with its
 *               pauses and ghost hits at the end of the phrase;
 *   Rullante    snare and clap on two and four, the ghosts on the offbeat with swing;
 *   Piatti      sixteenths with swing, open on the offbeat, ride in the second drop, all in a
 *               slow flanger that makes them spin;
 *   Percussioni dry ticks, metals and syncopated toms over two bars, with echo;
 *   Reese       the bass: Neuro with three detuned saws, the formant that makes it talk
 *               (the vowels follow the LFO and each note's envelope), fold and distortion, the
 *               clean sub underneath; a call-and-response riff that leaves holes…
 *   Neuro       …filled by the stabs: slices of the library's reese loops, all in G, that
 *               cut each other (choke) like Noisia's edits;
 *   Ringhio     the second bass, for the second drop: FM and LFO in triplets, nastier;
 *   Vuoto       the dissociating drone: a G–D–A flat cluster wobbling in
 *               pitch (seasickness), in the phaser and in a very long tail;
 *   Atmosfere, Voci, FX  the noises, the broken phrases in the reverb, the risers and impacts.
 *
 * Intro, groove, rise, drop, void (the break), rise, second drop, outro. The sidechain
 * pump is done with volume modulations; the slow movement of the basses with the
 * clip modulations (vowel, cutoff, fold, transpose). The assembly is in live-builder.ts;
 * the files, in scripts/build-fuori-live.ts. */
import type { Beats } from '../core/music-time';
import { DETECTOR } from '../devices/effects/compressor/compressor';
import { PHASER_MODE } from '../devices/effects/phaser/phaser';
import { VOICE_MODE } from '../devices/instruments/analog/analog';
import { padNote } from '../devices/instruments/drums/drums';
import { LFO_SHAPE, MOD_DEST, NEURO_MODE } from '../devices/instruments/neuro/neuro';
import { TEMPO_RATE } from '../devices/rates';
import type { ParamValues } from '../model/device';
import type { EnvelopePoint } from '../model/envelope';
import type { Note } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import type { ProjectStore } from '../store/project-store';
import {
  buildLive, clip, compressor, delay, instrumentParam, limiter, lowCut, multiband, phaser, reverb, VOLUME,
  type ClipSpec, type LiveSpec, type ModSpec, type PadSound, type SceneSpec, type TrackSpec,
} from './live-builder';
import { acid, BAR, chop, curve, duck, repeat, roll, steps, STEP, swing } from './patterns';

export const FUORI_LIVE_BPM = 140;

/** The sounds the live uses, by role (whoever builds the project gives the file for each). */
export const FUORI_LIVE_SOUNDS = [
  'kick', 'snare', 'clap', 'snareGhost', 'snareRoll',
  'hatClosed', 'hatShort', 'hatOpen', 'ride', 'hatNoise',
  'tick', 'tick2', 'tick3', 'metal', 'metal2', 'top', 'strange', 'tom', 'trik',
  'megareese', 'hum', 'wowowo', 'cupostep', 'trash', 'melo', 'newBase', 'z3ta', 'harMod', 'drumShape',
  'tension', 'hell', 'deepNoise', 'tank', 'strangeDrone', 'ambient', 'space', 'organ',
  'robotize', 'robotoid', 'voxDel', 'chtulu', 'cicle', 'omg',
  'riser', 'riserLow', 'riserNoise', 'fall', 'impact', 'reverseNoise', 'glitch', 'crash',
] as const;

export type FuoriLiveSound = (typeof FUORI_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'snare' | 'hats' | 'perc' | 'reese' | 'chops' | 'growl' | 'drone' | 'atmos' | 'vox' | 'fx';

/** The swing of the offbeat sixteenths (cymbals, percussion, ghosts): in sixteenths. */
const SWING = 0.14;

// ------------------------------------------------------------------ i kit

/** The slices of the reese loops: all in G, they cut each other (choke 2). */
const slice = (sound: FuoriLiveSound, decay: number, extra: Partial<PadSound<FuoriLiveSound>> = {}): PadSound<FuoriLiveSound> =>
  ({ sound, decay, choke: 2, ...extra });

const KITS = {
  // the body is the synthetic kick in G (a sine that falls and decays quickly: it leaves
  // room for the bass), the attack is the sample's distorted one, without its flat lows
  kick: [
    { model: 'kick', tune: -1, decay: 0.34, tone: 55, snap: 60, level: -4 },
    { sound: 'kick', decay: 0.08, tone: 62, level: 3 },
  ],
  snare: [
    { sound: 'snare', decay: 0.22, level: -1 },
    { sound: 'clap', decay: 0.3, tone: 55, level: -4 },
    { sound: 'snareGhost', decay: 0.09, tone: 45, level: -9, pan: -12 },
    { sound: 'snareRoll', decay: 0.12, tone: 58, level: -9 },
  ],
  hats: [
    { sound: 'hatClosed', decay: 0.07, choke: 1, pan: 8 },
    { sound: 'hatShort', decay: 0.05, choke: 1, pan: -10, level: -2 },
    { sound: 'hatOpen', decay: 0.3, choke: 1, tone: 58, level: -3, pan: 12 },
    { sound: 'ride', decay: 0.9, tone: 60, level: -7, pan: -18 },
    { sound: 'hatNoise', decay: 0.06, tone: 62, level: -6, pan: 25 },
  ],
  perc: [
    { sound: 'tick', level: -2, pan: -20 },
    { sound: 'tick2', level: -3, pan: 22 },
    { sound: 'tick3', level: -4, pan: 5 },
    { sound: 'metal', decay: 0.25, level: -6, pan: 30, tone: 60 },
    { sound: 'metal2', decay: 0.12, level: -5, pan: -28 },
    { sound: 'top', decay: 0.05, level: -6, pan: 15 },
    { sound: 'strange', level: -4, pan: -8 },
    // the tom in G, lower and dry
    { sound: 'tom', decay: 0.3, tune: -3, level: -5, pan: -15 },
    { sound: 'trik', decay: 0.35, level: -6, pan: 18 },
  ],
  chops: [
    slice('megareese', 0.2),
    slice('hum', 0.3),
    slice('wowowo', 0.42),
    slice('cupostep', 0.11, { at: 0.34, level: -3 }),
    slice('trash', 0.22, { tune: 1, level: -2 }),
    slice('melo', 0.4),
    slice('newBase', 0.2),
    slice('z3ta', 0.15, { level: -4 }),
    slice('harMod', 0.3, { at: 0.69, level: -3 }),
    slice('drumShape', 0.2, { level: -3 }),
  ],
  atmos: [
    { sound: 'tension', level: -2 },
    { sound: 'hell', level: -4 },
    { sound: 'deepNoise', level: -6 },
    { sound: 'tank', level: -3 },
    { sound: 'strangeDrone', level: -7 },
    { sound: 'ambient', level: -3 },
    { sound: 'space', level: -4 },
    { sound: 'organ', level: -2 },
  ],
  vox: [
    { sound: 'robotize', level: -4 },
    { sound: 'robotoid', level: -1 },
    { sound: 'voxDel', level: 2 },
    { sound: 'chtulu', at: 0.08, level: -3 },
    // the broken phrases of "terrible cicle", each from its start
    { sound: 'cicle', at: 1.26, decay: 1.15, level: 4 },
    { sound: 'cicle', at: 5.04, decay: 1.5, level: 4 },
    { sound: 'cicle', at: 11.02, decay: 2.55, level: 4 },
    { sound: 'omg', at: 0.02, decay: 1.5, level: 2 },
    { sound: 'cicle', at: 3.62, decay: 0.2, level: 4, choke: 3 },
    { sound: 'cicle', at: 14.2, decay: 1.96, level: 4 },
    // the robot down a fifth: demonic
    { sound: 'robotize', tune: -5, level: 1 },
  ],
  fx: [
    { sound: 'riser', level: -8 },
    { sound: 'riserLow', level: -6 },
    { sound: 'riserNoise', level: -4 },
    { sound: 'fall', level: -12 },
    { sound: 'impact', level: -2 },
    { sound: 'reverseNoise', at: 1.92, level: -4 },
    { sound: 'glitch', level: -6 },
    { sound: 'crash', level: -8, tone: 58 },
  ],
} satisfies Record<string, readonly PadSound<FuoriLiveSound>[]>;

const SN = { snare: 0, clap: 1, ghost: 2, roll: 3 } as const;
const HAT = { closed: 0, short: 1, open: 2, ride: 3, noise: 4 } as const;
const PERC = { tick: 0, tick2: 1, tick3: 2, metal: 3, metal2: 4, top: 5, strange: 6, tom: 7, trik: 8 } as const;
const ATM = { tension: 0, hell: 1, deepNoise: 2, tank: 3, strangeDrone: 4, ambient: 5, space: 6, organ: 7 } as const;
const VOX = { robotize: 0, robotoid: 1, voxDel: 2, chtulu: 3, cicleA: 4, cicleB: 5, cicleC: 6, omg: 7, stutter: 8, cicleE: 9, demon: 10 } as const;
const FX = { riser: 0, riserLow: 1, riserNoise: 2, fall: 3, impact: 4, reverseNoise: 5, glitch: 6, crash: 7 } as const;

// ------------------------------------------------------------------ the synth sounds

/** The main bass: a talking reese. Each note's envelope opens the filter and moves the
 *  vowel ("ua"), the quarter-note LFO makes it wobble, a soft S&H dirties the fold. */
const REESE: ParamValues = {
  unison: 3, detune: 20, oscA: 0, oscB: 0, oscBFine: -14, mix: 50,
  fm: 8, fmRatio: 1, fold: 18,
  filterType: 0, cutoff: 3400, resonance: 22, drive: 45, keyTrack: 25,
  formant: 55, vowel: 20, formantShift: 1,
  dist: 55, sub: 50, subOctave: 0, crossover: 110,
  voiceMode: NEURO_MODE.legato, glide: 40, velocity: 25,
  attack: 0.002, decay: 0.4, sustain: 100, release: 0.06,
  mAttack: 0.001, mDecay: 0.22, mSustain: 0, mRelease: 0.1,
  envDest: MOD_DEST.cutoff, envAmount: 35, envDest2: MOD_DEST.vowel, envAmount2: 30,
  lfo1Shape: LFO_SHAPE.triangle, lfo1Rate: TEMPO_RATE['1/4'], lfo1Retrig: 0,
  lfo1Dest: MOD_DEST.vowel, lfo1Amount: 40, lfo1Dest2: MOD_DEST.cutoff, lfo1Amount2: 10,
  lfo2Shape: LFO_SHAPE.smoothRandom, lfo2Rate: TEMPO_RATE['1/16'], lfo2Retrig: 0,
  lfo2Dest: MOD_DEST.fold, lfo2Amount: 12, lfo2Dest2: MOD_DEST.detune, lfo2Amount2: 8,
  volume: -4,
};

/** The growl of the second drop: FM at double, fold, a triplet LFO against the kick's
 *  quarters (the crooked groove) on FM and vowel. */
const GROWL: ParamValues = {
  unison: 2, detune: 12, oscA: 0, oscB: 1, oscBSemi: -12, oscBFine: 0, mix: 40,
  fm: 25, fmRatio: 3, fold: 25,
  filterType: 0, cutoff: 2600, resonance: 30, drive: 55, keyTrack: 20,
  formant: 60, vowel: 55, formantShift: -2,
  dist: 50, sub: 50, subOctave: 0, crossover: 110,
  voiceMode: NEURO_MODE.legato, glide: 30, velocity: 25,
  attack: 0.002, decay: 0.4, sustain: 100, release: 0.05,
  mAttack: 0.001, mDecay: 0.16, mSustain: 0, mRelease: 0.08,
  envDest: MOD_DEST.cutoff, envAmount: 40, envDest2: MOD_DEST.fm, envAmount2: 25,
  lfo1Shape: LFO_SHAPE.sawDown, lfo1Rate: TEMPO_RATE['1/8T'], lfo1Retrig: 0,
  lfo1Dest: MOD_DEST.fm, lfo1Amount: 35, lfo1Dest2: MOD_DEST.vowel, lfo1Amount2: -35,
  lfo2Shape: LFO_SHAPE.sampleHold, lfo2Rate: TEMPO_RATE['1/16'], lfo2Retrig: 0,
  lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 12, lfo2Dest2: MOD_DEST.formant, lfo2Amount2: 15,
  volume: -5,
};

/** The drone: a dark pad of 5 detuned copies wobbling in pitch, slowly. */
const DRONE: ParamValues = {
  oscA: 0, oscB: 0, oscBSemi: 0, oscBFine: 9, mix: 50, unison: 5, detune: 30, spread: 100,
  voiceMode: VOICE_MODE.poly, cutoff: 1100, resonance: 12, filterEnv: 15, keyTrack: 0,
  fAttack: 3, fDecay: 4, fSustain: 50, fRelease: 4,
  attack: 2.5, decay: 2, sustain: 100, release: 4,
  lfoWave: 0, lfoRate: 0.13, lfoPitch: 14, lfoCutoff: 18, velocity: 0, volume: -10,
};

// ------------------------------------------------------------------ le parti

/** Bars of a pad, one string per bar. */
const phrase = (pad: number, barsOf: readonly string[], from: Beats = 0): Note[] =>
  barsOf.flatMap((b, k) => steps(pad, b, from + k * BAR));

const K = {
  straight: 'X... X... X... X...',
  ghost: 'X... X... X... X.o.',
  skip: 'X... X... X... ....',
  push: 'X... X... X..o X...',
  eighths: 'X.X. X.X. X.X. X.X.',
  half: 'X... .... X... ....',
  rest: '.... .... .... ....',
};
/** Sixteen bars of drop kick: a ghost hit at 4 and 12, a pause at 8, the push at 16. */
const KICK_DROP = [K.straight, K.straight, K.straight, K.push, K.straight, K.straight, K.straight, K.skip,
  K.straight, K.straight, K.straight, K.push, K.straight, K.straight, K.straight, K.ghost];

const BACKBEAT = '.... X... .... X...';
/** The snare ghosts: two different bars, with swing. */
const GHOSTS = ['.... ..o. .o.. ...o', '..o. .... .o.. o..o'];

const backbeat = (count: number, fills: Readonly<Record<number, string>> = {}): Note[] =>
  Array.from({ length: count }, (_, k) => [
    ...steps(SN.snare, fills[k] ?? BACKBEAT, k * BAR),
    ...steps(SN.clap, fills[k] ?? BACKBEAT, k * BAR),
  ]).flat();
const ghosts = (count: number): Note[] => swing(Array.from({ length: count }, (_, k) => steps(SN.ghost, GHOSTS[k % 2], k * BAR)).flat(), SWING);

/** The cymbals of one bar: closed sixteenths, open on the offbeat, scattered noise. */
const HATS = {
  closed: 'xoxo xoxo xoxo xoxo',
  closedFill: 'xoxo xoxo xxxx XXXX',
  sparse: '..x. ..x. ..x. ..x.',
  open: '..X. ..X. ..X. ..X.',
  ride: 'x.o. x.o. x.o. x.o.',
  noise: '...o ..o. ...o .o..',
};
/** The closed hat of step `k`: every eighth one a fill. */
const closedHat = (k: number) => (k % 8 === 7 ? HATS.closedFill : HATS.closed);
const hats = (count: number, opts: { open?: boolean; ride?: boolean; sparse?: boolean } = {}): Note[] => swing([
  ...phrase(opts.sparse ? HAT.short : HAT.closed, Array.from({ length: count }, (_, k) => (opts.sparse ? HATS.sparse : closedHat(k)))),
  ...(opts.open ? phrase(HAT.open, Array(count).fill(HATS.open)) : []),
  ...(opts.ride ? phrase(HAT.ride, Array(count).fill(HATS.ride)) : []),
  ...phrase(HAT.noise, Array(count).fill(HATS.noise)),
], SWING);

/** The percussion: a syncopated two-bar loop (ticks, metals, toms) and, every four, the
 *  odd hit at the end of the phrase. */
const PERC_LOOP = [
  ...steps(PERC.tick, '..x. ...x ..x. x... ..x. ...x .x.. ..x.'),
  ...steps(PERC.tick2, '.o.. .o.. ...o .... .o.. .... ...o .o..'),
  ...steps(PERC.metal, '.... ..X. .... .... .... ..X. .... .X..'),
  ...steps(PERC.top, '...x ...x ...x ...x ...x ...x ...x ...x'),
  ...steps(PERC.tom, '.... .... ...X .... .... ..X. .... ....'),
];
const perc = (count: number, opts: { full?: boolean; light?: boolean } = {}): Note[] => swing([
  ...repeat(opts.light ? PERC_LOOP.filter(n => n.pitch !== padNote(PERC.tom) && n.pitch !== padNote(PERC.metal)) : PERC_LOOP, 2 * BAR, count / 2),
  ...repeat(steps(PERC.strange, '.... .... .... ...X', 3 * BAR), 4 * BAR, count / 4),
  ...(opts.full ? [
    ...repeat(steps(PERC.tick3, 'o..o .o.. o..o ..o.'), BAR, count),
    ...repeat(steps(PERC.metal2, '.... .... ..x. .... .... ...x .... ..x.'), 2 * BAR, count / 2),
    ...repeat(steps(PERC.trik, '.... .... .... ..x.', BAR), 2 * BAR, count / 2),
  ] : []),
], SWING);

/** The snare of the rise: quarters, eighths, sixteenths, thirty-seconds, growing. */
const snareBuild = (from: Beats): Note[] => [
  ...roll(SN.roll, from, 16, 1, [60, 80]),
  ...roll(SN.roll, from + 16, 16, 0.5, [80, 100]),
  ...roll(SN.roll, from + 24, 16, 0.25, [95, 115]),
  ...roll(SN.roll, from + 28, 16, 0.125, [110, 127]),
];

// --- the basses (one word per sixteenth, like a 303: "-" holds, "~" slides)

/** The rolling bass: three sixteenths after each kick. */
const ROLLING = acid([
  '. g1 G1 g1 . g1 G1 g1 . g1 G1 g1 . g1 G1 g1',
  '. g1 G1 g1 . g1 G1 g1 . g1 G1 g1 . bb1 G1 f1',
  '. g1 G1 g1 . g1 G1 g1 . g1 G1 g1 . g1 G1 g1',
  '. g1 G1 g1 . g1 G1 g1 . ab1 Ab1 ab1 . ab1 G2 g1',
].join(' '));

/** The drop riff: call (the odd bar) and a hole for the stabs' response. */
const RIFF_A = acid([
  '. G1 - - | . . g1 . | . Bb1~ G1 - | . g2 . g1',
  '. . . . | . . . . | . G1~ Ab1 - | G1 . f1 .',
  '. G1 - - | . . g1 . | . Bb1~ G1 - | . g2 g1 G2~',
  'G1 . . . | . . . . | . Db2~ C2 - | Bb1~ Ab1 G1 -',
  '. G1 - - | . . g1 . | . Bb1~ G1 - | . g2 . g1',
  '. . . . | . . . . | . G1~ Ab1 - | G1 . f1 .',
  '. G1 - - | . . g1 . | . Bb1~ G1 - | . g2 g1 .',
  '. G1 . G1 | . G1 G1 . | Ab1~ G1~ F1~ G1 | - - - -',
].join(' '));

/** The response: the reese loop slices in the riff's holes. */
const CHOPS_A = chop([
  '. . . . | . . . . | . . . . | . . . .',
  '. 2 . . | 0 . 3 3 | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. 1 . 1 | . 5 . . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. 2 . . | 0 . 4 . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
].join(' '));

/** The second drop: the growl, more syncopated, with the threatening tritone (D flat). */
const RIFF_B = acid([
  '. G1 - . | . G1 . G1 | - . Ab1 - | . . G1 .',
  '. . G2 . | G1 - . . | . Db2~ C2~ Bb1 | - G1 . .',
  '. G1 - . | . G1 . G1 | - . Ab1 - | . . G1 .',
  '. . . . | . . . . | G1~ G2~ G1 - | . Ab1 G1 .',
  '. G1 - . | . G1 . G1 | - . Ab1 - | . . G1 .',
  '. . G2 . | G1 - . . | . Db2~ C2~ Bb1 | - G1 . .',
  '. G1 - . | . G1 . G1 | - . Ab1 - | . Db2 C2 .',
  '. . . . | . . . . | . . . . | G2~ G1 - -',
].join(' '));

const CHOPS_B = chop([
  '. . . . | . . . . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. 2 . 0 | 3 3 3 3 | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. . . . | . . . . | . . . . | . . . .',
  '. 1 . 2 | . 0 . 6 | 3 . 3 . | . . . .',
].join(' '));

/** Held, tied notes (they overlap a little: Neuro in Legato slides without retriggering). */
function held(...parts: (readonly [pitch: number, bars: number])[]): Note[] {
  let at = 0;
  return parts.map(([pitch, n], i) => {
    const note = { pitch, start: at, duration: n * BAR + (i < parts.length - 1 ? 0.06 : -0.25), velocity: 100 };
    at += n * BAR;
    return note;
  });
}
const G1 = 31, AB1 = 32, F1 = 29, C2 = 36, DB2 = 37, G2 = 43, D3 = 50, AB3 = 56, EB4 = 63;

/** A chord held for the whole clip. */
const chord = (pitches: readonly number[], length: Beats, velocity = 90): Note[] =>
  pitches.map(pitch => ({ pitch, start: 0, duration: length - 0.5, velocity }));

/** A single hit of a pad. */
const hit = (pad: number, at: Beats, velocity = 110): Note => ({ pitch: padNote(pad), start: at, duration: STEP, velocity });

// ------------------------------------------------------------------ pompa e modulazioni

/** Where the kick hits (the full hits, not the ghosts). */
const kickHits = (kick: readonly Note[]): Beats[] => kick.filter(n => n.velocity >= 100).map(n => n.start);
/** The pump: down on the kick, up before the next one. */
const pump = (kick: readonly Note[], depth: number, release: Beats): ModSpec => ({ target: VOLUME, points: duck(kickHits(kick), depth, release) });
/** The pump rising (or falling) in level along the clip: each point is scaled by `level`. */
const pumpScaled = (kick: readonly Note[], depth: number, release: Beats, level: (beat: Beats) => number): ModSpec =>
  ({ target: VOLUME, points: duck(kickHits(kick), depth, release).map(p => ({ ...p, value: p.value * level(p.beat) })) });

const mod = (param: string, points: EnvelopePoint[]): ModSpec => ({ target: instrumentParam(param), points });
/** A slow wave between `a` and `b` over `length` beats, `cycles` times (for the vowel). */
const sway = (length: Beats, cycles: number, a: number, b: number): EnvelopePoint[] =>
  Array.from({ length: cycles * 4 + 1 }, (_, k) => ({ beat: (k * length) / (cycles * 4), value: [a, (a + b) / 2, b, (a + b) / 2][k % 4] }));

// ------------------------------------------------------------------ the tracks

const TRACKS: readonly TrackSpec<FuoriLiveSound, TrackKey>[] = [
  {
    key: 'kick', name: 'Cassa', volumeDb: -7, kit: KITS.kick,
    effects: [
      lowCut(28),
      compressor('Punch', { threshold: -10, ratio: 3, attack: 12, release: 40, auto: 0 }),
      // cut as if by a clipper: peaks down, body up
      limiter('Taglio cassa', { gain: 8, ceiling: -4, release: 12, lookahead: 0.5, truePeak: 0 }),
    ],
  },
  {
    key: 'snare', name: 'Rullante', volumeDb: -5, kit: KITS.snare,
    effects: [
      lowCut(170),
      compressor('Schiaffo', { threshold: -18, ratio: 4, attack: 8, release: 70, auto: 0, makeup: 2 }),
      reverb('Stanza', { size: 40, decay: 0.9, predelay: 8, damping: 7000, lowCut: 400, mix: 16 }),
    ],
  },
  {
    key: 'hats', name: 'Piatti', volumeDb: -4, kit: KITS.hats,
    effects: [lowCut(450), phaser('Hat metallici', { mode: PHASER_MODE.flanger, delay: 0.8, division: TEMPO_RATE['8 bars'], depth: 90, feedback: 70, mix: 35 })],
  },
  {
    key: 'perc', name: 'Percussioni', volumeDb: -7, kit: KITS.perc,
    effects: [
      lowCut(220),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 35, lowCut: 600, highCut: 5000, mix: 18 }),
      reverb('Stanza buia', { size: 55, decay: 1.2, damping: 5000, lowCut: 400, mix: 14 }),
    ],
  },
  {
    key: 'reese', name: 'Reese', volumeDb: -3, neuro: REESE,
    effects: [
      phaser('Gira', { stages: 2, center: 1100, division: TEMPO_RATE['1 bar'], depth: 60, feedback: 45, stereo: 100, mix: 35 }),
      multiband('Denso', { depth: 40, time: 30, xLow: 140 }),
    ],
  },
  {
    key: 'chops', name: 'Neuro', volumeDb: 1, kit: KITS.chops,
    effects: [lowCut(110), multiband('Denso', { depth: 45, time: 30, xLow: 140 })],
  },
  {
    key: 'growl', name: 'Ringhio', volumeDb: -3, neuro: GROWL,
    effects: [
      phaser('Gola', { stages: 1, center: 1400, division: TEMPO_RATE['1/2'], depth: 50, feedback: 55, stereo: 90, mix: 30 }),
      multiband('Denso', { depth: 45, time: 30, xLow: 140 }),
    ],
  },
  {
    key: 'drone', name: 'Vuoto', volumeDb: -10, analog: DRONE,
    effects: [
      lowCut(140),
      phaser('Phaser lento', { stages: 3, center: 700, division: TEMPO_RATE['4 bars'], depth: 80, feedback: 55, mix: 50 }),
      reverb('Coda infinita', { size: 100, decay: 12, predelay: 0, damping: 4000, lowCut: 200, mix: 45 }),
    ],
  },
  {
    key: 'atmos', name: 'Atmosfere', volumeDb: -9, kit: KITS.atmos,
    effects: [lowCut(180), reverb('Sala', { size: 85, decay: 4, predelay: 20, damping: 5000, lowCut: 250, mix: 32 })],
  },
  {
    key: 'vox', name: 'Voci', volumeDb: -12, kit: KITS.vox,
    effects: [
      lowCut(220),
      compressor('Voce', { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms, auto: 0, makeup: 3 }),
      delay('Eco 1/4.', { division: 9, pingPong: 1, feedback: 42, lowCut: 500, highCut: 4000, mix: 22 }),
      reverb('Lancio voce', { size: 95, decay: 5, predelay: 50, damping: 4500, lowCut: 300, mix: 32 }),
    ],
  },
  {
    key: 'fx', name: 'FX', volumeDb: -14, kit: KITS.fx,
    effects: [lowCut(60), reverb('Sala', { size: 85, decay: 3, predelay: 20, lowCut: 150, mix: 20 })],
  },
];

// ------------------------------------------------------------------ le scene

const len = (bars: number): Beats => bars * BAR;

/** Each scene's kick (the pump needs it too). */
const KICK = {
  intro: phrase(0, [...Array(7).fill(K.straight), K.ghost, ...Array(7).fill(K.straight), K.push]),
  groove: phrase(0, [...Array(7).fill(K.straight), K.skip, ...Array(7).fill(K.straight), K.ghost]),
  build: phrase(0, [K.straight, K.straight, K.straight, K.straight, K.eighths, K.eighths, K.rest, K.rest]).concat(roll(0, len(6), 12, 0.25, [70, 105])),
  drop: phrase(0, [...KICK_DROP, ...KICK_DROP.slice(0, 15), K.skip]),
  build2: phrase(0, [K.half, K.half, K.straight, K.straight, K.straight, K.straight, K.eighths, K.rest]).concat(roll(0, len(7), 8, 0.25, [80, 110])),
  outro: phrase(0, [...Array(7).fill(K.straight), K.ghost, ...Array(7).fill(K.straight), 'X... .... .... ....']),
};

/** The kick clip: each hit plays the body (pad 1) and the attack (pad 2) together. */
const kickClip = (name: string, notes: readonly Note[], length: Beats): ClipSpec =>
  clip(name, [...notes, ...notes.map(n => ({ ...n, pitch: padNote(1) }))], length);

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.intro, len(16)),
      hats: clip('Piatti radi', hats(16, { sparse: true }), len(16)),
      perc: clip('Tic', perc(16, { light: true }), len(16)),
      drone: clip('Quinta', chord([G2, D3], len(16)), len(16), [{ target: VOLUME, points: curve([0, 0.3], [len(16), 0.6]) }]),
      atmos: clip('Tensione', [hit(ATM.tension, 0), hit(ATM.tension, len(4)), hit(ATM.hell, len(8)), hit(ATM.deepNoise, len(12)), hit(ATM.tension, len(14))], len(16),
        [pumpScaled(KICK.intro, 0.5, 0.5, () => 1)]),
      vox: clip('Frasi', [hit(VOX.cicleA, len(9)), hit(VOX.robotoid, len(13) + 2)], len(16)),
      fx: clip('Glitch', [hit(FX.glitch, len(15) + 3.5)], len(16)),
    },
  },
  {
    name: 'Groove', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.groove, len(16)),
      snare: clip('Clap e fantasmi', [...backbeat(16).filter(n => n.pitch === padNote(SN.clap) || n.start >= len(8)), ...ghosts(16).filter(n => n.start >= len(8))], len(16)),
      hats: clip('Piatti', hats(16), len(16)),
      perc: clip('Perc', perc(16), len(16)),
      // the bass comes in closed and opens over sixteen bars
      reese: clip('Rotola', repeat(ROLLING, len(4), 4), len(16), [
        pumpScaled(KICK.groove, 0.25, 0.3, () => 0.8),
        mod('cutoff', curve([0, -0.32], [len(12), -0.12], [len(16), -0.06])),
        mod('formant', curve([0, -0.3], [len(16), 0])),
        mod('vowel', sway(len(16), 4, -0.1, 0.3)),
      ]),
      drone: clip('Cluster', chord([G2, D3, AB3], len(16)), len(16), [pumpScaled(KICK.groove, 0.6, 0.6, () => 0.6)]),
      atmos: clip('Tensione', [hit(ATM.tension, 0), hit(ATM.tension, len(8)), hit(ATM.tank, len(15) + 2)], len(16), [pump(KICK.groove, 0.5, 0.5)]),
      vox: clip('Frasi', [hit(VOX.cicleB, len(5)), hit(VOX.chtulu, len(12) + 2)], len(16)),
      fx: clip('Impatto', [hit(FX.impact, 0, 80), hit(FX.glitch, len(7) + 3.5), hit(FX.glitch, len(15) + 3), hit(FX.glitch, len(15) + 3.5)], len(16)),
    },
  },
  {
    name: 'Salita', bars: 8,
    clips: {
      kick: kickClip('Cassa che corre', KICK.build, len(8)),
      snare: clip('Rullo', snareBuild(0), len(8)),
      hats: clip('Piatti', hats(8, { open: true }), len(8), [{ target: VOLUME, points: curve([0, 0.8], [len(7), 1], [len(8), 0.5]) }]),
      perc: clip('Perc', perc(8), len(8)),
      // the bass opens, the fold grows, and in the last bar a single note rises an octave
      reese: clip('Si apre', [...repeat(ROLLING, len(4), 2).filter(n => n.start < len(7)), { pitch: G1, start: len(7), duration: BAR - 0.25, velocity: 120 }], len(8), [
        pumpScaled(KICK.build, 0.3, 0.3, () => 0.7),
        mod('cutoff', curve([0, -0.2], [len(7), 0.05])),
        mod('fold', curve([0, 0], [len(8), 0.35])),
        mod('transpose', curve([0, 0], [len(7), 0], [len(8), 0.25])),
      ]),
      drone: clip('Cluster che sale', chord([G2, D3, AB3, DB2 + 24], len(8)), len(8), [{ target: VOLUME, points: curve([0, 0.35], [len(8), 0.6]) }]),
      atmos: clip('Strano', [hit(ATM.strangeDrone, 0), hit(ATM.strangeDrone, len(2)), hit(ATM.strangeDrone, len(4)), hit(ATM.strangeDrone, len(6))], len(8)),
      vox: clip('Balbetta', [...roll(VOX.stutter, len(7), 8, 0.25, [90, 120]), hit(VOX.omg, len(7) + 2.5)], len(8)),
      fx: clip('Salita', [hit(FX.riser, 6.25), hit(FX.riserLow, 6.25), hit(FX.reverseNoise, len(8) - 7.375)], len(8)),
    },
  },
  {
    name: 'Drop', bars: 32,
    clips: {
      kick: kickClip('Cassa', KICK.drop, len(32)),
      snare: clip('Rullante', [...backbeat(32, { 7: '.... X... .... X.XX', 15: '.... X... .... X.XX', 31: '.... X... .... X...' }), ...ghosts(32)], len(32)),
      hats: clip('Piatti', hats(32, { open: true }), len(32)),
      perc: clip('Perc', perc(32), len(32)),
      reese: clip('Riff', repeat(RIFF_A, len(8), 4), len(32), [
        pump(KICK.drop, 0.3, 0.3),
        mod('vowel', sway(len(32), 8, -0.15, 0.25)),
        mod('fold', curve([0, 0], [len(15), 0.1], [len(16), 0], [len(31), 0.2], [len(32), 0])),
      ]),
      chops: clip('Risposte', repeat(CHOPS_A, len(8), 4), len(32)),
      drone: clip('Cluster', chord([G2, AB3], len(32)), len(32), [pumpScaled(KICK.drop, 0.4, 0.6, () => 0.45)]),
      atmos: clip('Massa', [0, 8, 16, 24].map(b => hit(ATM.ambient, len(b))), len(32), [pump(KICK.drop, 0.4, 0.5)]),
      vox: clip('Stacchi', [hit(VOX.robotize, len(7) + 2), hit(VOX.voxDel, len(15) + 2), hit(VOX.robotoid, len(23) + 2), hit(VOX.cicleB, len(30))], len(32)),
      fx: clip('Impatto', [hit(FX.impact, 0), hit(FX.crash, 0), hit(FX.fall, len(1)), hit(FX.glitch, len(7) + 3.5), hit(FX.glitch, len(15) + 3.25),
        hit(FX.glitch, len(15) + 3.5), hit(FX.crash, len(16), 90), hit(FX.glitch, len(31) + 3.5)], len(32)),
    },
  },
  {
    name: 'Vuoto', bars: 16,
    clips: {
      perc: clip('Tic lontani', perc(16, { light: true }).filter(n => n.start % len(4) >= len(2)), len(16), [{ target: VOLUME, points: curve([0, 0.7]) }]),
      // a lone reese breathing: long tied notes, the vowel coming and going, and at the end
      // an octave dive
      reese: clip('Respiro', held([G1, 4], [AB1, 2], [F1, 2], [G1, 4], [DB2, 2], [C2, 2]), len(16), [
        mod('cutoff', curve([0, -0.22], [len(4), -0.08], [len(8), -0.18], [len(12), -0.04], [len(16), -0.14])),
        mod('vowel', sway(len(16), 2, -0.2, 0.5)),
        mod('lfo1Amount', curve([0, -0.15], [len(16), 0.15])),
        mod('transpose', curve([0, 0], [len(15), 0], [len(16), -0.25])),
        { target: VOLUME, points: curve([0, 0.45], [len(8), 0.55], [len(16), 0.68]) },
      ]),
      drone: clip('Cluster nero', chord([G2, D3, AB3, EB4], len(16)), len(16), [{ target: VOLUME, points: curve([0, 0.45]) }]),
      atmos: clip('Organo', [...[0, 2, 4, 6, 8, 10, 12, 14].map(b => hit(ATM.organ, len(b), 85)), hit(ATM.hell, 0), hit(ATM.space, len(5)), hit(ATM.hell, len(9)), hit(ATM.space, len(13))], len(16)),
      vox: clip('Dissociata', [hit(VOX.cicleC, len(2)), hit(VOX.robotoid, len(6) + 2), hit(VOX.cicleE, len(9)), hit(VOX.demon, len(12)), hit(VOX.chtulu, len(13) + 2)], len(16)),
      fx: clip('Caduta', [hit(FX.fall, 0), hit(FX.riserNoise, len(16) - 25.5)], len(16)),
    },
  },
  {
    name: 'Salita 2', bars: 8,
    clips: {
      kick: kickClip('Cassa che torna', KICK.build2, len(8)),
      snare: clip('Rullo', snareBuild(0), len(8)),
      hats: clip('Piatti', hats(8, { sparse: true }), len(8)),
      perc: clip('Perc', perc(8), len(8)),
      // the bass rolls in sixteenths and rises an octave in the last two bars
      reese: clip('Corre', acid(Array(8).fill('. g1 G1 g1 . g1 G1 g1 . g1 G1 g1 . g1 G1 g1').join(' ')), len(8), [
        pumpScaled(KICK.build2, 0.3, 0.3, () => 0.7),
        mod('cutoff', curve([0, -0.2], [len(8), 0.15])),
        mod('fold', curve([0, 0], [len(8), 0.4])),
        mod('transpose', curve([0, 0], [len(6), 0], [len(8), 0.25])),
      ]),
      drone: clip('Cluster che sale', chord([G2, D3, AB3, DB2 + 24], len(8)), len(8), [{ target: VOLUME, points: curve([0, 0.35], [len(8), 0.6]) }]),
      vox: clip('Balbetta', [...roll(VOX.stutter, len(6), 16, 0.25, [80, 110]), ...roll(VOX.stutter, len(7), 16, 0.125, [100, 127]), hit(VOX.omg, len(7) + 3)], len(8)),
      fx: clip('Salita', [hit(FX.riser, 6.25), hit(FX.riserLow, 6.25), hit(FX.reverseNoise, len(8) - 7.375)], len(8)),
    },
  },
  {
    name: 'Drop 2', bars: 32,
    clips: {
      kick: kickClip('Cassa', KICK.drop, len(32)),
      snare: clip('Rullante', [...backbeat(32, { 3: '.... X... .... X..X', 7: '.... X... ...X ..X.', 11: '.... X... .... X..X', 15: '.... X... .... X.XX', 23: '.... X... ...X ..X.', 31: '.... X... .... X...' }), ...ghosts(32)], len(32)),
      hats: clip('Piatti e ride', hats(32, { open: true, ride: true }), len(32)),
      perc: clip('Perc piene', perc(32, { full: true }), len(32)),
      growl: clip('Ringhio', repeat(RIFF_B, len(8), 4), len(32), [
        pump(KICK.drop, 0.3, 0.3),
        mod('vowel', sway(len(32), 8, -0.2, 0.2)),
        mod('fm', curve([0, 0], [len(16), 0.15], [len(17), 0], [len(32), 0.2])),
      ]),
      chops: clip('Risposte', repeat(CHOPS_B, len(8), 4), len(32)),
      drone: clip('Cluster', chord([G2, AB3], len(32)), len(32), [pumpScaled(KICK.drop, 0.4, 0.6, () => 0.45)]),
      atmos: clip('Tensione', [0, 8, 16, 24].map(b => hit(b % 16 ? ATM.space : ATM.tension, len(b))), len(32), [pump(KICK.drop, 0.4, 0.5)]),
      vox: clip('Stacchi', [hit(VOX.robotoid, len(3) + 2), hit(VOX.demon, len(11) + 2), hit(VOX.voxDel, len(15) + 2), hit(VOX.cicleA, len(23)), hit(VOX.demon, len(29) + 2)], len(32)),
      fx: clip('Impatto', [hit(FX.impact, 0), hit(FX.crash, 0), hit(FX.fall, len(1)), hit(FX.glitch, len(7) + 3.5), hit(FX.glitch, len(15) + 3.5),
        hit(FX.crash, len(16), 90), hit(FX.glitch, len(23) + 3.25), hit(FX.glitch, len(31) + 3.5)], len(32)),
    },
  },
  {
    name: 'Outro', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.outro, len(16)),
      snare: clip('Clap', backbeat(8).filter(n => n.pitch === padNote(SN.clap)), len(16)),
      hats: clip('Piatti', hats(16), len(16), [{ target: VOLUME, points: curve([0, 1], [len(12), 0.8], [len(16), 0.4]) }]),
      perc: clip('Tic', perc(16, { light: true }), len(16)),
      // the bass closes again and leaves
      reese: clip('Si chiude', repeat(ROLLING, len(4), 3), len(16), [
        pump(KICK.outro, 0.25, 0.3),
        mod('cutoff', curve([0, -0.05], [len(12), -0.4])),
        mod('formant', curve([0, 0], [len(12), -0.4])),
      ]),
      drone: clip('Quinta', chord([G2, D3], len(16)), len(16), [{ target: VOLUME, points: curve([0, 0.6], [len(16), 0]) }]),
      atmos: clip('Porta', [hit(ATM.hell, 0), hit(ATM.tension, len(5)), hit(ATM.tension, len(9)), hit(ATM.deepNoise, len(13))], len(16)),
      vox: clip('Frase', [hit(VOX.cicleB, len(9))], len(16)),
      fx: clip('Impatto', [hit(FX.impact, 0, 90), hit(FX.fall, len(9))], len(16)),
    },
  },
];

export const FUORI_LIVE: LiveSpec<FuoriLiveSound, TrackKey> = {
  name: 'Fuori dal corpo',
  bpm: FUORI_LIVE_BPM,
  master: {
    volumeDb: 0,
    effects: [
      lowCut(25),
      multiband('Densità', { depth: 15, time: 55, upward: 20 }),
      compressor('Colla', { threshold: -14, ratio: 2, knee: 10, attack: 30, release: 150, scHp: 90, auto: 0, makeup: 1 }),
      limiter('Master', { gain: 14, ceiling: -0.5, release: 50, lookahead: 2 }),
    ],
  },
  tracks: TRACKS,
  scenes: SCENES,
  arrangement: [0, 1, 2, 3, 4, 5, 6, 7],
};

/** A scene's clips, for whoever wants to check them. */
export const fuoriScene = (name: string): Partial<Record<TrackKey, ClipSpec>> | undefined => SCENES.find(s => s.name === name)?.clips;

/** Builds the live in the store's (empty) project. */
export function buildFuoriLive(store: ProjectStore, sounds: Readonly<Record<FuoriLiveSound, SampleRef>>): void {
  buildLive(store, FUORI_LIVE, sounds);
}
