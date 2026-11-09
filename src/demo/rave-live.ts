/* "Rave illegale": hard techno at 145 BPM in C phrygian with the tritone (brehho23's C–Db–F#
 * motif), conceived as an instrument to play for half an hour or more, not as a track.
 * Eight tracks (one APC40 page), each a rack with its 8 macros on the Device
 * Control knobs, and "act" scenes that are starting points: each column's clips can also be launched
 * alone, over any scene.
 *
 *   1 Cassa     only kicks: eight different bodies (brehho23's ancora, compressed, dry, hammer,
 *               distorted, industrial, gabber, boom), one per clip; the macros add the industrial
 *               grain and the click, tune, shorten, saturate, close the filter (the
 *               kick heard from outside) and send it into the boom (the isolated kicks of the breaks);
 *   2 Colpi     claps, snares, rims, metallic and industrial hits: each snare hit
 *               plays all the layers and the macros decide which are heard; Rullata (key A) is
 *               a push-button Beat Repeat: a roll over any pattern;
 *   3 Piatti    closed, open, ride, shaker, metals and a sliced top loop: each clip has them
 *               all, the macros raise and lower their density, Apertura lengthens the open ones;
 *   4 Levare    Neuro: the offbeat bass, rolling, gallop, Goa, trance, dembow, compressed and
 *               sidechained to the kick (pumping with the kick that's really there); from its root
 *               (the C at 65 Hz, as in brehho23) it leaves 49 Hz to the kick (tuned to G);
 *   5 Acido     Analog as a 303 with the step sequencer: the "Seq" clips hold only the
 *               root (or the loop) and the sequencer writes the note pattern; Pattern chooses
 *               one (it comes in at the start of the loop), Follia goes from a minimal acid to a
 *               frantic one. The other clips are brehho23's written lines. Two racks: the 303 and
 *               its effects (distortion, step gate, phaser, echo, Ripeti);
 *   6 Sampler   32 sounds in four banks of eight keys: Metallo (C1), Tamburi (G#1, brehho23's
 *               kit), Macchine (E2), Voci (C3); the macros tune, shorten,
 *               filter them, start them later or reversed;
 *   7 Rottura   the amen lowered by three semitones (so the eighth-note slices fall at 145) and the
 *               slices of the brehho23 rave break, reassembled by the clips; three buttons: Ripeti,
 *               Al contrario, Frena;
 *   8 Lunghi    looping drones that come in and out with long fades, risers that
 *               end exactly on the scene change, impacts, falls, sirens, trains:
 *               a Sampler in Classic (the held note holds the sound, the end releases it),
 *               sidechained to the kick and cut below by the high-pass.
 *
 * The master has "Macchina": three Ripeti, Al contrario and Stop nastro as buttons (Q W E R T),
 * Sottrazione (high-pass, Z) and Muro (low-pass, X). The assembly is in live-builder.ts; the
 * files, in scripts/build-rave-live.ts. */
import type { Beats } from '../core/music-time';
import { DETECTOR } from '../devices/effects/compressor/compressor';
import { DIVISIONS } from '../devices/effects/delay/delay';
import { SHAPE } from '../devices/effects/drive/drive';
import { bandParam } from '../devices/effects/eq/eq';
import { GRIDS, REPEAT_MODE } from '../devices/effects/beat-repeat/beat-repeat';
import { pattern, STEP_RATES } from '../devices/effects/gate/gate';
import { REVERSE_LENGTHS } from '../devices/effects/reverse/reverse';
import { BRAKE_CURVE, BRAKE_DIVISIONS, STARTS, TAPE_SYNC } from '../devices/effects/tape-stop/tape-stop';
import { FILTER_TYPE } from '../devices/dsp/multimode-filter';
import { VOICE_MODE } from '../devices/instruments/analog/analog';
import { padNote, padParam } from '../devices/instruments/drums/drums';
import { FILTER } from '../devices/instruments/prisma/prisma';
import { MODE, SAMPLER, SOUND_KEYS, zoneParam, type ZoneKey } from '../devices/instruments/sampler/sampler';
import { resolveParams } from '../devices/device-type';
import { SEQ_RATE, SEQ_SCALE } from '../devices/sequencer';
import type { ParamValues } from '../model/device';
import type { Note } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import type { ProjectStore } from '../store/project-store';
import {
  buildLive, clip, clipper, compressor, delay, drive, effect, eq, instrumentParam, limiter, reverb, stereo, VOLUME,
  type ClipSpec, type EffectSpec, type KeySpec, type LiveSpec, type MacroSpec, type Move, type PadSound, type RackSpec, type SceneSpec, type TrackSpec,
} from './live-builder';
import { BAR, roll, STEP, steps, swing } from './patterns';
import { AUTO_FILTER } from '../devices/effects/auto-filter/auto-filter';
import { BEAT_REPEAT } from '../devices/effects/beat-repeat/beat-repeat';
import { GATE } from '../devices/effects/gate/gate';
import { PHASER } from '../devices/effects/phaser/phaser';
import { REDUX } from '../devices/effects/redux/redux';
import { REVERSE } from '../devices/effects/reverse/reverse';
import { TAPE_STOP } from '../devices/effects/tape-stop/tape-stop';

export const RAVE_LIVE_BPM = 145;

/** The sounds the live uses, by role (whoever builds the project gives the file for each). */
export const RAVE_LIVE_SOUNDS = [
  // 1 kick: eight bodies, the grain, the click, the boom
  'ancora', 'corpus', 'secca', 'martello', 'distorta', 'industriale', 'gabber', 'boom', 'ferro', 'click', 'rimbombo',
  // 2 colpi
  'clap', 'fruity', 'omega', 'grave', 'reso', 'destorto', 'riverbero', 'ghost', 'trik', 'metalHit', 'roll', 'slash',
  // 3 piatti
  'hatClosed', 'hatSoft', 'hatOpen', 'ride', 'crash', 'tamb', 'hatMetal', 'hatNoise', 'hatAlfa', 'topLoop',
  // 6 sampler: metallo, tamburi, macchine, voci
  'metal1', 'metal2', 'cowbell', 'metallic', 'pling', 'metalDelay', 'sciabola', 'revMetal',
  'shot09', 'tom', 'tom2', 'wood', 'top', 'skull', 'skull2', 'shot17',
  'technoid', 'strangeHit', 'robot', 'growl', 'laser', 'laserRate', 'glitch', 'littleRobot',
  'kill', 'darkness', 'whisper', 'whisperF', 'again', 'medieval', 'devil', 'choirYe',
  // 7 rottura
  'amen', 'raveBreak', 'decimated', 'glitcha',
  // 8 lunghi: bordoni, salite, impatti, discese, sirene e rumori
  'halfIntro', 'darknight', 'choirFx', 'darkAtmos', 'gladiator', 'feedback', 'magicDelay', 'treno',
  'riseDa3', 'noiseUp', 'zebraUp', 'reverseNoise', 'cinematic', 'blast', 'crashFx', 'fall', 'downside', 'scendeDisto',
  'goDown', 'finishBang', 'siren', 'sirenLead', 'allarm', 'strongNoise', 'autotreno', 'space', 'hell', 'tension',
] as const;

export type RaveLiveSound = (typeof RAVE_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'snare' | 'hats' | 'bass' | 'acid' | 'perc' | 'breaks' | 'long';

const SPB = 60 / RAVE_LIVE_BPM;
const len = (bars: number): Beats => bars * BAR;
const beatsOf = (seconds: number): Beats => seconds / SPB;
const index = (list: readonly (readonly [string, ...unknown[]])[], label: string) => list.findIndex(([l]) => l === label);
const SWING = 0.06;

// the notes: in the app 36 (C1) is the C at 65 Hz, the root of brehho23's bass and acid
const DO = 36, REB = 37, MIB = 39, SIB = 34, DO_ALTO = 48;
/** The steps of the galloping bass that leave the root. */
const GALLOP_TURNS: Readonly<Record<number, number>> = { 7: REB, 14: MIB, 15: REB };
/** The mode: C phrygian with the tritone (C Db Eb F F# G Ab Bb). */
const MODE_STEPS = [0, 1, 3, 5, 6, 7, 8, 10];
/** The nearest note of the mode, below or equal. */
const inMode = (pitch: number): number => {
  let p = pitch;
  while (!MODE_STEPS.includes(((p % 12) + 12) % 12)) p--;
  return p;
};

/** A single hit of a pad (or of a Sampler key, which has the zones where the pads have the notes). */
const hit = (pad: number, at: Beats, velocity = 110, duration = STEP): Note => ({ pitch: padNote(pad), start: at, duration, velocity });
/** Bars of a pad, one string per bar, from `from`. */
const phrase = (pad: number, barsOf: readonly string[], from: Beats = 0): Note[] => barsOf.flatMap((b, k) => steps(pad, b, from + k * BAR));
/** The notes written as in projects: [pitch, start, duration, velocity]. */
const written = (list: readonly (readonly [number, number, number, number])[], shift = 0): Note[] =>
  list.map(([pitch, start, duration, velocity]) => ({ pitch: pitch + shift, start, duration, velocity }));

// ------------------------------------------------------------------ effects the builder doesn't have

const autoFilter = effect(AUTO_FILTER);
const beatRepeat = effect(BEAT_REPEAT);
const gate = effect(GATE);
const phaser = effect(PHASER);
const redux = effect(REDUX);
const reverse = effect(REVERSE);
const tapeStop = effect(TAPE_STOP);

const BELL = 2, HIGH_SHELF = 4;

/** An EQ: a high-pass at `low` Hz (24 dB) and the given bands (bells, or the stated type). */
function eqOf(name: string, low: number, bands: readonly (readonly [freq: number, gain: number, q: number, type?: number])[] = []): EffectSpec {
  const p: Record<string, number> = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: low, [bandParam(0, 'slope')]: 1 };
  bands.forEach(([freq, gain, q, type = BELL], i) => Object.assign(p, {
    [bandParam(i + 1, 'type')]: type, [bandParam(i + 1, 'freq')]: freq, [bandParam(i + 1, 'gain')]: gain, [bandParam(i + 1, 'q')]: q,
  }));
  return eq(name, p);
}

/** A fully wet and open filter: its macro closes it. */
const lowPass = (name: string) => autoFilter(name, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 15, mix: 100 });
const highPass = (name: string) => autoFilter(name, { type: FILTER_TYPE.highPass, slope: 1, freq: 20, resonance: 10, mix: 100 });
/** The Beat Repeat to play as a button: off it lets the sound through as it is. */
const repeatButton = (name: string, grid: string) =>
  beatRepeat(name, { only: 1, repeat: 0, grid: index(GRIDS, grid), mode: REPEAT_MODE.insert, decay: 8, volume: 0 });
/** The sidechain compressor on the kick: ducks on the hit and comes back up before the next. */
const pump = (name: string, threshold: number, ratio: number, release: number) =>
  compressor(name, { threshold, ratio, knee: 6, attack: 1, release, detector: DETECTOR.peak, auto: 0, makeup: 0 });

/** A button macro (on while the key is held). */
const button = (name: string, moves: readonly Move[]): MacroSpec => ({ name, mode: 'button', moves });

// ------------------------------------------------------------------ 1 cassa

/** The bodies: each tuned (in semitones) with the body between G and G# (49–52 Hz, C's fifth), with the
 *  decay before the end of the file (many are cut at 0.34 s: beyond that they'd click) and the
 *  volume matched on the render (the same loudness, ±0.5 LU, four-on-the-floor). */
const BODIES = [
  { name: 'Ancora', sound: 'ancora', tune: -1, decay: 0.42, level: 3.5 },
  { name: 'Compressa', sound: 'corpus', tune: 0, decay: 0.5, level: -1.5 },
  { name: 'Secca', sound: 'secca', tune: -1, decay: 0.3, level: 2 },
  { name: 'Martello', sound: 'martello', tune: 0, decay: 0.3, level: 1.5 },
  { name: 'Distorta', sound: 'distorta', tune: -1, decay: 0.4, level: -1 },
  { name: 'Industriale', sound: 'industriale', tune: -1, decay: 0.33, level: 0 },
  { name: 'Gabber', sound: 'gabber', tune: -1, decay: 0.3, level: 0 },
  { name: 'Boom', sound: 'boom', tune: -3, decay: 0.34, level: 2 },
] as const satisfies readonly { name: string; sound: RaveLiveSound; tune: number; decay: number; level: number }[];

const KICK = { ferro: 8, click: 9, rimbombo: 10, bassa: 11, reverse: 12, roll: 13 } as const;
const BODY = Object.fromEntries(BODIES.map((b, i) => [b.name, i])) as Record<(typeof BODIES)[number]['name'], number>;

const KICK_KIT: readonly PadSound<RaveLiveSound>[] = [
  ...BODIES.map(b => ({ sound: b.sound, tune: b.tune, decay: b.decay, level: b.level })),
  // the layers that play on every hit, off until the macro raises them: the grain of an
  // industrial kick only above (Tone to the right: high-pass) and the click
  { sound: 'ferro', tune: -2, decay: 0.12, tone: 74, level: -36 },
  { sound: 'click', decay: 0.04, tone: 80, level: -36 },
  // the isolated kicks of the breaks: the one with reverb, "ancora" down a fourth and reversed
  { sound: 'rimbombo', decay: 0.33, level: -3 },
  { sound: 'ancora', tune: -5, decay: 0.6, level: -2 },
  { sound: 'ancora', tune: -1, decay: 0.55, reverse: true, level: -6 },
  // the short kick of the rolls
  { sound: 'secca', tune: -1, decay: 0.12, level: -3 },
  // two more to try on the pads: "ancora" as in brehho23 rave (two semitones up) and the short gabber
  { sound: 'ancora', tune: 2, decay: 0.42, level: 3.5 },
  { sound: 'gabber', tune: -1, decay: 0.15, tone: 62, level: 0 },
];

const KICK_RACK: RackSpec = {
  name: 'Cassa',
  effects: [
    eqOf('Cassa', 32, [[50, -1.5, 1.4], [100, 2, 1.1], [300, -3, 1.2], [4500, 1.5, 0.8]]),
    drive('Saturazione', { shape: SHAPE.tube, drive: 6, bias: 25, low: 60, split: 100, tone: 12000, auto: 1, mix: 0, oversampling: 0 }),
    lowPass('Filtro'),
    reverb('Rimbombo', { size: 70, decay: 1.2, predelay: 0, diffusion: 85, damping: 3000, lowCut: 40, width: 0, mix: 0 }),
    clipper('Cassa', { drive: 0, ceiling: -2, knee: 20, oversampling: 0 }),
    stereo('Mono', { width: 0 }),
  ],
  macros: [
    { name: 'Ferro', moves: [[0, padParam(KICK.ferro, 'level'), -36, -2]] },
    { name: 'Click', moves: [[0, padParam(KICK.click, 'level'), -36, -4]] },
    { name: 'Impatto', value: 40, moves: [[5, 'drive', 0, 9], [5, 'output', 0, -3]] },
    // each body from its value, three semitones down and up (at half travel: as it is)
    { name: 'Accordatura', value: 64, moves: BODIES.map((b, i): Move => [0, padParam(i, 'tune'), b.tune - 3, b.tune + 3]) },
    // all the way right: as it is; left: short, to leave room for the bass
    { name: 'Coda', value: 127, moves: BODIES.map((b, i): Move => [0, padParam(i, 'decay'), b.decay * 0.35, b.decay]) },
    { name: 'Saturazione', value: 30, moves: [[2, 'mix', 0, 100], [2, 'drive', 4, 22]] },
    // the kick heard from outside the warehouse
    { name: 'Filtro', moves: [[3, 'freq', 20000, 180]] },
    { name: 'Rimbombo', moves: [[4, 'mix', 0, 40], [4, 'decay', 1.2, 4]] },
  ],
};

// the kick rhythms
const K = {
  four: 'X... X... X... X...',
  push: 'X... X... X... X..x',
  roll: 'X... X... X.x. X.xx',
  skip: 'X... X... X... ....',
  broken: 'X... .... ..X. ....',
  broken2: 'X... .... ..X. ..x.',
  half: 'X... .... X... ....',
  gallop: 'X... X..x X... X..x',
  heart: 'X..x .... X..x ....',
  double: 'X.x. X... X.x. X...',
  eighths: 'X.x. X.x. X.x. X.x.',
  sixteenths: 'XxXx XxXx XXXX XXXX',
  rest: '.... .... .... ....',
};

/** A kick clip: each hit of the body also plays the grain and the click (off until
 *  their macros raise them). */
function kickClip(name: string, body: number, barsOf: readonly string[], extra: readonly Note[] = [], once = false): ClipSpec {
  const notes = phrase(body, barsOf);
  const layers = notes.flatMap(n => [{ ...n, pitch: padNote(KICK.ferro) }, { ...n, pitch: padNote(KICK.click) }]);
  return { ...clip(name, [...notes, ...layers, ...extra], len(barsOf.length)), ...(once ? { once } : {}) };
}

const KICKS = {
  dritta: (body: keyof typeof BODY) => kickClip(`Dritta ${body.toLowerCase()}`, BODY[body], [K.four, K.four, K.four, K.push]),
  spinta: kickClip('Spinta', BODY.Ancora, [K.four, K.four, K.four, K.roll]),
  spezzata: kickClip('Spezzata', BODY.Ancora, [K.broken, K.broken, K.broken, K.broken2]),
  mezzo: kickClip('Mezzo tempo', BODY.Compressa, [K.half, K.half, K.half, K.double]),
  galoppo: kickClip('Galoppo', BODY.Distorta, [K.gallop, K.gallop, K.gallop, K.roll]),
  doppia: kickClip('Doppia', BODY.Martello, [K.double, K.four, K.double, K.push]),
  cuore: kickClip('Cuore', BODY.Ancora, [K.heart, K.heart, K.heart, K.half]),
  // one kick every two bars, with the tail; the low one reversed announces it
  isolata: clip('Isolata', [hit(KICK.rimbombo, 0, 120), hit(KICK.bassa, 0, 110), hit(KICK.reverse, len(2) - beatsOf(0.55), 90), hit(KICK.rimbombo, len(2), 116), hit(KICK.bassa, len(2), 104)], len(4)),
  // eight running bars and an empty one before the drop: played once
  rullo: kickClip('Rullo', BODY.Ancora, [K.four, K.four, K.four, K.four, K.eighths, K.eighths, K.rest, K.rest],
    [...steps(KICK.roll, K.sixteenths, len(6))], true),
};

// ------------------------------------------------------------------ 2 colpi

const SN = { clap: 0, fruity: 1, omega: 2, grave: 3, reso: 4, destorto: 5, riverbero: 6, ghost: 7, rim: 8, trik: 9, metal: 10, roll: 11, slash: 12 } as const;
/** The layers of each snare hit: clap, fruity snare (brehho23), omega, grave, reso,
 *  distorted and the one with reverb. The macros say which are heard. */
const LAYERS = [SN.clap, SN.fruity, SN.omega, SN.grave, SN.reso, SN.destorto, SN.riverbero];

const SNARE_KIT: readonly PadSound<RaveLiveSound>[] = [
  { sound: 'clap', decay: 0.3, level: 0 },
  { sound: 'fruity', decay: 0.3, tone: 56, level: -3 },
  { sound: 'omega', decay: 0.2, tone: 60, level: -6 },
  { sound: 'grave', decay: 0.4, level: -36 },
  { sound: 'reso', decay: 0.3, level: -36 },
  { sound: 'destorto', decay: 0.3, level: -36 },
  { sound: 'riverbero', decay: 0.3, level: -36 },
  { sound: 'ghost', decay: 0.1, tone: 64, level: -14, pan: -10 },
  // brehho23's rim: the synthetic rimshot down nine semitones
  { model: 'rim', tune: -9, decay: 0.124, tone: 58, level: -4 },
  { sound: 'trik', decay: 0.4, level: -6, pan: 14 },
  { sound: 'metalHit', decay: 0.17, level: -8, pan: -16 },
  { sound: 'roll', decay: 0.12, level: -4 },
  { sound: 'slash', decay: 0.3, level: -6 },
];

const SNARE_RACK: RackSpec = {
  name: 'Colpi',
  effects: [
    eqOf('Colpi', 150, [[1200, 1.5, 1], [3000, 1.5, 1]]),
    drive('Presenza', { shape: SHAPE.soft, drive: 8, color: 50, low: 80, mix: 40, oversampling: 0 }),
    compressor('Schiaffo', { threshold: -18, ratio: 4, attack: 6, release: 80, auto: 0, makeup: 2 }),
    reverb('Capannone', { size: 70, decay: 1.6, predelay: 12, damping: 5000, lowCut: 400, mix: 0 }),
    repeatButton('Rullata', '1/16'),
  ],
  macros: [
    { name: 'Clap', value: 127, moves: [[0, padParam(SN.clap, 'level'), -36, 0]] },
    { name: 'Rullante', value: 112, moves: [[0, padParam(SN.fruity, 'level'), -36, -1], [0, padParam(SN.omega, 'level'), -36, -4]] },
    { name: 'Industriale', moves: [[0, padParam(SN.destorto, 'level'), -36, -3], [0, padParam(SN.grave, 'level'), -36, -4]] },
    { name: 'Metallo', moves: [[0, padParam(SN.reso, 'level'), -36, -4], [0, padParam(SN.metal, 'level'), -36, -4]] },
    { name: 'Ghost', value: 50, moves: [[0, padParam(SN.ghost, 'level'), -36, -4]] },
    { name: 'Accordatura', value: 64, moves: SNARE_KIT.map((p, i): Move => [0, padParam(i, 'tune'), (p.tune ?? 0) - 7, (p.tune ?? 0) + 7]) },
    { name: 'Spazio', value: 20, moves: [[4, 'mix', 0, 45], [0, padParam(SN.riverbero, 'level'), -36, -4]] },
    button('Rullata', [[5, 'repeat', 0, 1]]),
  ],
};

const BACK = '.... X... .... X...';
const GHOSTS = ['.... .... .... ..o.', '.... ...o .... ....', '.... .... ..o. ...o', '.... ...o .... .o..'];
/** The snare: all the layers on the hits of `barsOf`, and the ghosts if any. */
function snare(barsOf: readonly string[], ghosts = false): Note[] {
  return [
    ...LAYERS.flatMap(p => phrase(p, barsOf)),
    ...(ghosts ? swing(phrase(SN.ghost, barsOf.map((_, k) => GHOSTS[k % 4])), SWING) : []),
  ];
}

const SNARES = {
  back: clip('2 e 4', snare([BACK, BACK, BACK, '.... X... .... X.x.']), len(4)),
  ghost: clip('2 e 4 e fantasmi', snare([BACK, BACK, BACK, '.... X... .... X..x'], true), len(4)),
  four: clip('Solo il 4', snare(['.... .... .... X...', '.... .... .... X...', '.... .... .... X...', '.... .... ..x. X...']), len(4)),
  // brehho23's dark dembow: the snare on 4 and on the offbeat of 3, the short hits underneath
  dembow: clip('Dembow', [
    ...snare(Array(4).fill('...X ..X. ...X ..X.')),
    ...phrase(SN.ghost, Array(4).fill('.o.. .... .o.. ....')), ...phrase(SN.trik, Array(4).fill('.... ..x. .... ..x.')),
  ], len(4)),
  spezzato: clip('Spezzato', [...snare(['.... X... ..x. X..x', '.... X... .... X...', '.... X... ..x. X..x', '.... X..x .x.. X.x.']), ...phrase(SN.rim, Array(4).fill('x... ..x. ...x ....'))], len(4)),
  industriale: clip('Industriale', [
    ...snare([BACK, BACK, BACK, '.... X... .... X.xx']),
    ...phrase(SN.trik, Array(4).fill('..x. ...x ..x. ....')), ...phrase(SN.metal, Array(4).fill('...x .... .x.. ....')),
  ], len(4)),
  // the rim's 3-3-2 (brehho23's percussion groove) and the clap on 4
  rim: clip('Rim 3-3-2', [...phrase(SN.rim, Array(4).fill('x..x ..x. x..x ..x.')), ...phrase(SN.clap, Array(4).fill('.... .... .... X...'))], len(4)),
  rullata: { ...clip('Rullata', [...roll(SN.roll, 0, 16, 0.25, [70, 127]), hit(SN.clap, 3.75, 127)], len(1)), once: true },
  // eight bars: the snare, then the tightening roll (eighths, sixteenths, thirty-seconds)
  salita: {
    ...clip('Salita', [
      ...snare([BACK, BACK, BACK, BACK]),
      ...roll(SN.roll, len(4), 16, 0.5, [64, 92]), ...roll(SN.roll, len(6), 16, 0.25, [90, 118]), ...roll(SN.roll, len(7), 32, 0.125, [100, 127]),
    ], len(8)),
    once: true,
  },
};

// ------------------------------------------------------------------ 3 piatti

const HT = { closed: 0, soft: 1, open: 2, ride: 3, crash: 4, tamb: 5, metal: 6, noise: 7, alfa: 8, loop: 9 } as const;
/** The top loop (2 bars of sixteenths at 175) in four quarter-note slices. */
const LOOP_SLICE_S = 60 / 175;

const HATS_KIT: readonly PadSound<RaveLiveSound>[] = [
  { sound: 'hatClosed', decay: 0.06, tone: 62, choke: 1, pan: 6 },
  { sound: 'hatSoft', decay: 0.045, tone: 70, choke: 1, level: -4, pan: -6 },
  { sound: 'hatOpen', decay: 0.2, tone: 64, choke: 1, level: -4, pan: 4 },
  { sound: 'ride', decay: 0.9, tone: 58, level: -36, pan: -8 },
  { sound: 'crash', decay: 1.6, tone: 60, level: -6 },
  { sound: 'tamb', decay: 0.08, tone: 60, level: -36, pan: -22 },
  { sound: 'hatMetal', decay: 0.3, tone: 60, level: -36, pan: 18 },
  { sound: 'hatNoise', decay: 0.08, tone: 62, level: -36, pan: -14 },
  { sound: 'hatAlfa', decay: 0.17, tone: 60, level: -36, pan: 10 },
  ...[0, 1, 2, 3].map(k => ({ sound: 'topLoop', at: k * LOOP_SLICE_S, decay: LOOP_SLICE_S, tone: 64, level: -36 } as const)),
];
const LOOP_PADS = [HT.loop, HT.loop + 1, HT.loop + 2, HT.loop + 3];

const HATS_RACK: RackSpec = {
  name: 'Piatti',
  effects: [
    eqOf('Piatti', 300, [[5000, 1.5, 0.9], [11000, -4, 0.6]]),
    lowPass('Brillantezza'),
    reverb('Stanza', { size: 35, decay: 0.8, predelay: 5, damping: 8000, lowCut: 600, mix: 10 }),
  ],
  macros: [
    { name: 'Chiusi', value: 127, moves: [[0, padParam(HT.closed, 'level'), -36, 0], [0, padParam(HT.soft, 'level'), -36, -4]] },
    { name: 'Aperti', value: 118, moves: [[0, padParam(HT.open, 'level'), -36, -2]] },
    { name: 'Ride', moves: [[0, padParam(HT.ride, 'level'), -36, -3]] },
    { name: 'Shaker', moves: [[0, padParam(HT.tamb, 'level'), -36, -6]] },
    { name: 'Loop', moves: LOOP_PADS.map((p): Move => [0, padParam(p, 'level'), -36, -4]) },
    { name: 'Metallo', moves: [HT.metal, HT.noise, HT.alfa].map((p): Move => [0, padParam(p, 'level'), -36, -6]) },
    // the open ones from a short hit to a long "tsss": the sudden openings
    { name: 'Apertura', value: 20, moves: [[0, padParam(HT.open, 'decay'), 0.12, 0.7]] },
    { name: 'Brillantezza', value: 127, moves: [[2, 'freq', 2500, 20000]] },
  ],
};

/** The cymbals: each layer with its rhythm (a repeating bar), light swing. */
function hats(bars: number, layers: Partial<Record<'closed' | 'open' | 'ride' | 'tamb' | 'metal' | 'noise' | 'alfa' | 'loop', string>>, crash = false): Note[] {
  const rep = (pad: number, p?: string) => (p ? phrase(pad, Array(bars).fill(p)) : []);
  return swing([
    ...rep(HT.closed, layers.closed), ...rep(HT.open, layers.open), ...rep(HT.ride, layers.ride), ...rep(HT.tamb, layers.tamb),
    ...rep(HT.metal, layers.metal), ...rep(HT.noise, layers.noise), ...rep(HT.alfa, layers.alfa),
    // the top loop: one slice per quarter, reassembled in order
    ...(layers.loop ? Array.from({ length: bars * 4 }, (_, k) => hit(LOOP_PADS[k % 4], k, 100)) : []),
    ...(crash ? [hit(HT.crash, 0, 120)] : []),
  ], SWING);
}

const OPEN = '..X. ..X. ..X. ..X.';
const HATS = {
  levare: clip('Levare', hats(4, { open: OPEN, tamb: '.o.. ...o .o.. .o.o', metal: '...x .... .... ..x.', loop: 'x' }), len(4)),
  sedicesimi: clip('Sedicesimi', hats(4, { closed: 'xo.o xo.o xo.o xo.o', open: OPEN, ride: 'x.o. x.o. x.o. x.o.', tamb: 'oooo oooo oooo oooo', metal: '.... ..x. .... .x..', loop: 'x' }), len(4)),
  galoppo: clip('Galoppo', hats(4, { closed: 'xx.x xx.x xx.x xx.x', open: OPEN, ride: 'x... x... x... x...', tamb: '.o.o .o.o .o.o .o.o', alfa: '..x. .... ..x. ..x.', loop: 'x' }), len(4)),
  trama: clip('Trama', hats(8, { closed: 'xoxo xoxo xoxo xoxo', open: OPEN, ride: 'x.o. x.o. x.o. x.o.', tamb: 'oooo oooo oooo oooo', metal: '...x ..x. .x.. x...', noise: '.x.. .x.. .x.. .x.o', loop: 'x' }, true), len(8)),
  // psytrance cymbals: open on the offbeat, closed in pairs, running shaker
  psy: clip('Psy', hats(4, { closed: 'x.xx x.xx x.xx x.xx', open: OPEN, tamb: 'oxox oxox oxox oxox', alfa: '.... ...x .... ...x', loop: 'x' }), len(4)),
  ride: clip('Ride', hats(4, { ride: 'X.x. X.x. X.x. X.x.', open: OPEN, metal: '.... .... ..x. ....' }), len(4)),
  // the cymbals of brehho23's dark dembow
  dembow: clip('Dembow', hats(4, { closed: 'x.o. x.o. x.o. x.o.', tamb: '.o.o .o.o .o.o .o.o', open: '.... .... .... ..x.' }), len(4)),
  rarefatti: clip('Rarefatti', [...phrase(HT.metal, ['.... .... ..x. ....', '.... .... .... ....']), ...phrase(HT.noise, ['.... ...o .... ....', '.... .... .x.. ....']), ...phrase(HT.closed, ['.... .... .... ...o', '.... .... .... ..o.'])], len(2)),
  rullata: { ...clip('Rullata', [...roll(HT.closed, 0, 28, 0.125, [60, 127]), hit(HT.open, 3.5, 127)], len(1)), once: true },
};

// ------------------------------------------------------------------ 4 levare (basso)

/** The bass: monophonic Neuro, two saws and a slightly detuned square, the filter
 *  biting with the modulation envelope, the clean sub below the crossover, the distortion. The
 *  sequencer (for the "Sequenza" clips) leaves the downbeat to the kick. */
const BASS: ParamValues = {
  oscA: 0, oscB: 1, oscBSemi: 0, oscBFine: -7, mix: 35, unison: 1,
  filterType: 0, cutoff: 900, resonance: 25, drive: 30, keyTrack: 40,
  dist: 20, sub: 70, subOctave: 0, crossover: 120,
  voiceMode: 0, glide: 0, attack: 0.002, decay: 0.18, sustain: 40, release: 0.07, velocity: 30,
  mAttack: 0.001, mDecay: 0.1, mSustain: 0, mRelease: 0.05, envDest: 1, envAmount: 45,
  volume: 0,
  seqKick: 1, seqDensity: 70, seqRange: 25, seqScale: SEQ_SCALE['Phrygian and tritone'], seqSlide: 0, seqAccent: 25, seqGate: 60, seqPattern: 11,
};

const BASS_RACK: RackSpec = {
  name: 'Levare',
  effects: [
    pump('Pompa', -18, 4, 70),
    eqOf('Levare', 35, [[250, -2.5, 1], [2500, 1.5, 1]]),
    reverb('Rumble', { size: 75, decay: 1.2, predelay: 0, diffusion: 90, damping: 2500, lowCut: 30, width: 0, mix: 0 }),
    stereo('Bassi mono', { monoFreq: 150 }),
  ],
  macros: [
    { name: 'Cutoff', value: 60, moves: [[0, 'cutoff', 150, 8000]] },
    { name: 'Morso', value: 60, moves: [[0, 'envAmount', 0, 80], [0, 'mDecay', 0.04, 0.25]] },
    { name: 'Coda', value: 60, moves: [[0, 'decay', 0.06, 0.6], [0, 'release', 0.02, 0.3]] },
    { name: 'Sub', value: 87, moves: [[0, 'sub', 20, 100]] },
    { name: 'Ringhio', moves: [[0, 'fm', 0, 55], [0, 'fold', 0, 45]] },
    { name: 'Distorsione', value: 50, moves: [[0, 'dist', 0, 70], [0, 'drive', 15, 70]] },
    { name: 'Vocale', moves: [[0, 'formant', 0, 80], [0, 'vowel', 0, 100]] },
    { name: 'Rumble', moves: [[3, 'mix', 0, 40], [3, 'decay', 1.2, 2.5]] },
  ],
};

/** A sixteenth bass: `rhythm` (one bar) with the pitches of each bar, or of each
 *  hit if `pitches` is a function. */
function bassBars(rhythm: string, roots: readonly number[], pitchOf?: (root: number, i: number) => number, gateSteps = 0.8): Note[] {
  return roots.flatMap((root, k) => steps(0, rhythm, k * BAR).map((n, i) => ({
    ...n, pitch: pitchOf ? pitchOf(root, i) : root, duration: STEP * gateSteps,
  })));
}
const OFF = '..x. ..x. ..x. ..x.';
/** The sequencer on for the whole clip (the modulation moves the switch to On). */
const seqOn = (bars: number) => ({ target: instrumentParam('seqOn'), points: [{ beat: 0, value: 1 }, { beat: len(bars), value: 1 }] });
const held = (pitch: number, start: Beats, beats: Beats): Note => ({ pitch, start, duration: beats, velocity: 100 });

/** The long-note clips play louder than the others: they lower themselves by 6 dB (the track's
 *  volume is the square of the modulation). */
const LONG_NOTES = { target: VOLUME, points: [{ beat: 0, value: 0.7 }, { beat: len(4), value: 0.7 }] };

const BASSES = {
  // on the offbeat the note holds a short eighth: the full hit between one kick and the next
  levare: clip('Levare', bassBars(OFF, [DO, DO, DO, DO], undefined, 1.6), len(4)),
  giro: clip('Levare in giro', bassBars(OFF, [DO, DO, REB, SIB], undefined, 1.6), len(4)),
  doppio: clip('Doppio levare', bassBars('..xx ..xx ..xx ..xx', [DO, DO, DO, REB]), len(4)),
  // three sixteenths after each kick, and the fall at the end (brehho23 rave's "Martello basso")
  rotolante: clip('Rotolante', bassBars('.xxx .xxx .xxx .xxx', [DO, DO, REB, SIB], (r, i) => (r === SIB && i >= 9 ? [DO_ALTO, 46, 43][(i - 9) % 3] : r)), len(4)),
  // Goa: the octave on the second sixteenth
  goa: clip('Goa', bassBars('.xxx .xxx .xxx .xxx', [DO, DO, DO, REB], (r, i) => (i % 3 === 1 ? r + 12 : r)), len(4)),
  trance: clip('Trance oscura', bassBars('.xxx .xxx .xxx .xxx', [DO, DO, REB, DO], (r, i) => inMode(r + [0, 0, 7, 0, 1, 0, 0, 12, 0, 0, 3, 0][i % 12])), len(4)),
  galoppo: clip('Galoppo', written([[DO, 0.5, 0.2, 112], [DO, 0.75, 0.2, 96]].flatMap(([p, s, d, v]) =>
    Array.from({ length: 16 }, (_, k): [number, number, number, number] => [GALLOP_TURNS[k] ?? p, s + k, d, v]))), len(4)),
  // brehho23's dembow: three plus three plus two
  dembow: clip('Dembow', written([[36, 0, 0.75, 112], [36, 0.75, 0.75, 96], [36, 1.5, 0.5, 104], [36, 2, 0.75, 112], [36, 2.75, 0.75, 96], [36, 3.5, 0.5, 104], [36, 4, 0.75, 112], [36, 4.75, 0.75, 96], [36, 5.5, 0.5, 104], [36, 6, 0.75, 112], [36, 6.75, 0.75, 96], [36, 7.5, 0.5, 104], [37, 8, 0.75, 112], [37, 8.75, 0.75, 96], [37, 9.5, 0.5, 104], [37, 10, 0.75, 112], [37, 10.75, 0.75, 96], [37, 11.5, 0.5, 104], [36, 12, 0.75, 112], [36, 12.75, 0.75, 96], [36, 13.5, 0.5, 104], [36, 14, 0.75, 112], [30, 14.75, 0.75, 96], [30, 15.5, 0.5, 104]]), len(4), [LONG_NOTES]),
  sub: clip('Sub tenuto', [held(DO, 0, 8), held(REB, 8, 4), held(SIB, 12, 4)], len(4), [LONG_NOTES]),
  sequenza: clip('Sequenza', [held(DO, 0, len(4))], len(4), [seqOn(4)]),
  sequenzaGiro: clip('Sequenza in giro', [held(DO, 0, 8), held(REB, 8, 4), held(SIB, 12, 4)], len(4), [seqOn(4)]),
};

// ------------------------------------------------------------------ 5 acido

/** The 303: brehho23's "Acid" Analog (saw, Legato, glide, accent) with the
 *  sequencer ready (Phrygian and tritone, sixteenths). */
const ACID: ParamValues = {
  oscA: 0, mix: 0, voiceMode: VOICE_MODE.legato, glide: 60, accent: 70,
  cutoff: 420, resonance: 80, filterEnv: 66, keyTrack: 20,
  fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -9,
  seqScale: SEQ_SCALE['Phrygian and tritone'], seqRate: SEQ_RATE['1/16'], seqLength: 16, seqGate: 55,
};

const ACID_RACK: RackSpec = {
  name: '303',
  effects: [eqOf('Acido', 95, [[160, -4, 1.2], [622, 2.5, 1]])],
  macros: [
    { name: 'Cutoff', value: 55, moves: [[0, 'cutoff', 90, 3500]] },
    { name: 'Risonanza', value: 90, moves: [[0, 'resonance', 30, 95]] },
    { name: 'Env Mod', value: 76, moves: [[0, 'filterEnv', 10, 100]] },
    { name: 'Decay', value: 40, moves: [[0, 'fDecay', 0.04, 1]] },
    { name: 'Accento', value: 90, moves: [[0, 'accent', 0, 100]] },
    { name: 'Glide', value: 38, moves: [[0, 'glide', 0, 200]] },
    // the sequencer's loop: a new one comes in at the start of the loop
    { name: 'Pattern', value: 0, moves: [[0, 'seqPattern', 0, 127]] },
    // from a minimal acid (few notes, the root) to a frantic one (full, wide, slides, accents)
    { name: 'Follia', value: 40, moves: [[0, 'seqDensity', 25, 100], [0, 'seqRange', 5, 85], [0, 'seqSlide', 5, 55], [0, 'seqAccent', 15, 60]] },
  ],
};

const ACID_FX: RackSpec = {
  name: 'Acido FX',
  effects: [
    drive('Distorsione', { shape: SHAPE.hard, drive: 16, bias: 12, color: 25, low: 15, split: 150, tone: 9000, mix: 0, oversampling: 0 }),
    gate('Taglio', { ...pattern('x.xx .xx. x.xx .x.x'), rate: index(STEP_RATES, '1/16'), gate: 70, release: 15, depth: 0 }),
    phaser('Phaser', { mix: 0 }),
    delay('Eco 1/8.', { division: index(DIVISIONS, '1/8.'), pingPong: 1, feedback: 35, lowCut: 350, highCut: 4000, mix: 0 }),
    reverb('Buio', { size: 60, decay: 1.6, predelay: 10, damping: 4500, lowCut: 300, mix: 0 }),
    repeatButton('Ripeti', '1/16'),
  ],
  macros: [
    { name: 'Distorsione', value: 70, moves: [[0, 'mix', 0, 100], [0, 'drive', 4, 26]] },
    { name: 'Taglio', moves: [[1, 'depth', 0, 100]] },
    { name: 'Phaser', moves: [[2, 'mix', 0, 60]] },
    { name: 'Eco', value: 30, moves: [[3, 'mix', 0, 40], [3, 'feedback', 20, 65]] },
    { name: 'Spazio', value: 15, moves: [[4, 'mix', 0, 40]] },
    button('Ripeti', [[5, 'repeat', 0, 1]]),
  ],
};

const ACIDS = {
  // the sequencer: the clip holds only the root (or the loop)
  seq: clip('Seq Do', [held(DO, 0, len(4))], len(4), [seqOn(4)]),
  seqAlto: clip('Seq Do alto', [held(DO_ALTO, 0, len(4))], len(4), [seqOn(4)]),
  seqGiro: clip('Seq giro', [held(DO, 0, 8), held(REB, 8, 4), held(SIB, 12, 4)], len(4), [seqOn(4)]),
  // the held flat second: the phrygian tension
  seqReb: clip('Seq Reb', [held(REB, 0, len(4))], len(4), [seqOn(4)]),
  // brehho23's written lines
  motivo: clip('Motivo', written([[36, 0, 0.125, 127], [36, 0.5, 0.125, 92], [36, 1, 0.125, 127], [36, 1.5, 0.125, 92], [37, 2, 0.375, 127], [37, 2.75, 0.375, 92], [30, 3.5, 0.56, 92], [36, 4, 0.125, 127], [36, 4.5, 0.125, 92], [36, 5, 0.125, 127], [36, 5.5, 0.125, 92], [37, 6, 0.375, 127], [39, 6.75, 0.31, 92], [37, 7, 0.125, 92], [30, 7.5, 0.56, 92]]), len(2)),
  martello: clip('Martello', written([[36, 0, 0.125, 127], [36, 0.25, 0.125, 92], [48, 0.5, 0.125, 127], [36, 0.75, 0.125, 92], [36, 1, 0.125, 92], [36, 1.25, 0.125, 127], [48, 1.5, 0.125, 92], [36, 1.75, 0.125, 92], [36, 2, 0.125, 127], [36, 2.25, 0.125, 92], [48, 2.5, 0.125, 127], [36, 2.75, 0.125, 92], [37, 3, 0.31, 127], [36, 3.25, 0.125, 92], [39, 3.5, 0.125, 127], [36, 3.75, 0.125, 92], [36, 4, 0.125, 127], [36, 4.25, 0.125, 92], [48, 4.5, 0.125, 127], [36, 4.75, 0.125, 92], [36, 5, 0.125, 92], [36, 5.25, 0.125, 127], [48, 5.5, 0.125, 92], [36, 5.75, 0.125, 92], [36, 6, 0.125, 127], [36, 6.25, 0.125, 92], [42, 6.5, 0.125, 127], [36, 6.75, 0.125, 92], [43, 7, 0.31, 127], [42, 7.25, 0.125, 92], [36, 7.5, 0.125, 92], [48, 7.75, 0.125, 127]]), len(2)),
  rotola: clip('Rotola', written([[36, 0, 0.125, 127], [36, 0.25, 0.125, 92], [48, 0.5, 0.31, 92], [46, 0.75, 0.125, 92], [36, 1, 0.125, 92], [37, 1.5, 0.125, 127], [36, 1.75, 0.125, 92], [36, 2, 0.125, 92], [48, 2.25, 0.125, 127], [36, 2.75, 0.125, 92], [42, 3, 0.31, 92], [43, 3.25, 0.125, 92], [36, 3.5, 0.125, 92], [34, 3.75, 0.125, 92], [36, 4, 0.125, 127], [36, 4.25, 0.125, 92], [39, 4.5, 0.31, 127], [36, 4.75, 0.125, 92], [48, 5, 0.125, 92], [36, 5.5, 0.125, 92], [49, 5.75, 0.125, 127], [36, 6, 0.125, 92], [48, 6.25, 0.125, 127], [36, 6.5, 0.125, 92], [42, 6.75, 0.125, 92], [43, 7, 0.31, 92], [36, 7.25, 0.125, 92], [39, 7.5, 0.125, 127], [37, 7.75, 0.125, 92]]), len(2)),
  squelch: clip('Squelch', written([[48, 0, 0.31, 127], [49, 0.25, 0.125, 92], [48, 0.5, 0.125, 92], [43, 1, 0.31, 127], [48, 1.25, 0.125, 92], [48, 1.75, 0.125, 127], [51, 2, 0.31, 92], [48, 2.25, 0.125, 92], [46, 2.75, 0.125, 127], [48, 3, 0.125, 92], [42, 3.5, 0.31, 127], [43, 3.75, 0.125, 92], [48, 4, 0.31, 127], [49, 4.25, 0.125, 92], [48, 4.5, 0.125, 92], [43, 5, 0.31, 127], [48, 5.25, 0.125, 92], [48, 5.75, 0.125, 127], [51, 6, 0.31, 92], [48, 6.25, 0.125, 92], [49, 6.75, 0.125, 127], [48, 7, 0.31, 92], [46, 7.25, 0.125, 92], [42, 7.5, 0.31, 127], [43, 7.75, 0.125, 92]]), len(2)),
  respiro: clip('Respiro', written([[36, 0, 1.875, 127], [37, 2, 1.375, 127], [30, 3.5, 0.56, 92], [36, 4, 1.875, 127], [39, 6, 0.875, 92], [37, 7, 0.56, 92], [30, 7.5, 0.375, 92]]), len(2)),
  // the lines of brehho23 rave
  esplosione: clip('Esplosione', written([[36, 0, 0.138, 127], [36, 0.25, 0.138, 92], [48, 0.5, 0.138, 92], [36, 0.75, 0.138, 92], [36, 1, 0.138, 92], [48, 1.25, 0.138, 127], [36, 1.5, 0.138, 92], [39, 1.75, 0.138, 92], [36, 2, 0.138, 127], [36, 2.25, 0.138, 92], [48, 2.5, 0.138, 92], [36, 2.75, 0.138, 92], [49, 3, 0.288, 92], [36, 3.25, 0.138, 92], [43, 3.5, 0.138, 127], [42, 3.75, 0.138, 92], [36, 4, 0.138, 127], [36, 4.25, 0.138, 92], [48, 4.5, 0.138, 92], [36, 4.75, 0.138, 92], [36, 5, 0.138, 92], [48, 5.25, 0.138, 127], [36, 5.5, 0.138, 92], [39, 5.75, 0.138, 92], [36, 6, 0.138, 127], [36, 6.25, 0.138, 92], [48, 6.5, 0.288, 92], [46, 6.75, 0.138, 92], [43, 7, 0.138, 92], [41, 7.25, 0.138, 127], [39, 7.5, 0.138, 92], [37, 7.75, 0.138, 92], [37, 8, 0.138, 127], [37, 8.25, 0.138, 92], [49, 8.5, 0.138, 92], [37, 8.75, 0.138, 92], [37, 9, 0.138, 92], [49, 9.25, 0.138, 127], [37, 9.5, 0.138, 92], [41, 9.75, 0.138, 92], [37, 10, 0.138, 127], [37, 10.25, 0.138, 92], [49, 10.5, 0.138, 92], [37, 10.75, 0.138, 92], [51, 11, 0.288, 92], [37, 11.25, 0.138, 92], [44, 11.5, 0.138, 127], [43, 11.75, 0.138, 92], [34, 12, 0.138, 127], [34, 12.25, 0.138, 92], [46, 12.5, 0.138, 92], [34, 12.75, 0.138, 92], [36, 13, 0.138, 127], [36, 13.25, 0.138, 92], [48, 13.5, 0.138, 92], [36, 13.75, 0.138, 92], [48, 14, 0.138, 127], [36, 14.25, 0.138, 92], [49, 14.5, 0.288, 92], [36, 14.75, 0.138, 92], [43, 15, 0.138, 127], [42, 15.25, 0.138, 92], [39, 15.5, 0.138, 127], [37, 15.75, 0.138, 92]]), len(4)),
  galoppo: clip('Galoppo', written([[36, 0, 0.288, 92], [48, 0.25, 0.138, 92], [39, 1, 0.138, 92], [36, 1.5, 0.138, 127], [37, 2.5, 0.288, 92], [36, 2.75, 0.138, 92], [43, 3.5, 0.138, 127], [36, 4, 0.288, 92], [48, 4.25, 0.138, 92], [41, 5, 0.138, 92], [36, 5.5, 0.138, 127], [43, 6.25, 0.288, 92], [44, 6.5, 0.138, 92], [42, 7, 0.138, 127], [37, 7.5, 0.138, 92], [36, 8, 0.288, 92], [48, 8.25, 0.138, 92], [39, 9, 0.138, 92], [36, 9.5, 0.138, 127], [37, 10.5, 0.288, 92], [36, 10.75, 0.138, 92], [43, 11.5, 0.138, 127], [48, 12, 0.388, 127], [36, 12.75, 0.138, 92], [46, 13, 0.288, 92], [43, 13.25, 0.138, 92], [42, 13.75, 0.138, 92], [36, 14.25, 0.138, 127], [49, 14.75, 0.288, 92], [36, 15, 0.138, 92], [39, 15.5, 0.138, 127]]), len(4)),
  // the scale rising for four bars (brehho23 rave's "Salita acido")
  salita: clip('Salita', written([[36, 0, 0.15, 100], [36, 0.25, 0.15, 92], [48, 0.5, 0.15, 92], [36, 0.75, 0.15, 92], [37, 1, 0.15, 100], [37, 1.25, 0.15, 92], [49, 1.5, 0.15, 92], [37, 1.75, 0.15, 92], [39, 2, 0.15, 100], [39, 2.25, 0.15, 92], [51, 2.5, 0.15, 92], [39, 2.75, 0.15, 92], [41, 3, 0.15, 100], [41, 3.25, 0.15, 92], [53, 3.5, 0.15, 92], [41, 3.75, 0.15, 92], [43, 4, 0.15, 100], [43, 4.25, 0.15, 92], [55, 4.5, 0.15, 92], [43, 4.75, 0.15, 92], [44, 5, 0.15, 100], [44, 5.25, 0.15, 92], [56, 5.5, 0.15, 92], [44, 5.75, 0.15, 92], [46, 6, 0.15, 100], [46, 6.25, 0.15, 92], [58, 6.5, 0.15, 92], [46, 6.75, 0.15, 92], [48, 7, 0.15, 100], [48, 7.25, 0.15, 92], [60, 7.5, 0.15, 92], [48, 7.75, 0.15, 92], [49, 8, 0.15, 127], [49, 8.25, 0.15, 92], [61, 8.5, 0.15, 92], [49, 8.75, 0.15, 92], [51, 9, 0.15, 127], [51, 9.25, 0.15, 92], [63, 9.5, 0.15, 92], [51, 9.75, 0.15, 92], [53, 10, 0.15, 127], [53, 10.25, 0.15, 92], [65, 10.5, 0.15, 92], [53, 10.75, 0.15, 92], [55, 11, 0.15, 127], [55, 11.25, 0.15, 92], [67, 11.5, 0.15, 92], [55, 11.75, 0.15, 92], [56, 12, 0.15, 127], [56, 12.25, 0.15, 92], [68, 12.5, 0.15, 92], [56, 12.75, 0.15, 92], [58, 13, 0.15, 127], [58, 13.25, 0.15, 92], [70, 13.5, 0.15, 92], [58, 13.75, 0.15, 92], [60, 14, 0.15, 127], [60, 14.25, 0.15, 92], [72, 14.5, 0.15, 92], [60, 14.75, 0.15, 92], [61, 15, 0.15, 127], [61, 15.25, 0.15, 92], [73, 15.5, 0.15, 92], [61, 15.75, 0.15, 92]]), len(4)),
};

// ------------------------------------------------------------------ 6 sampler percussivo

/** The four banks of eight keys: each zone on a single key, at its pitch (root note =
 *  the key). To grow: a file dragged onto a zone's name changes it; the free zones
 *  (up to 32) are added by dragging onto the keyboard. */
const PERC_BANKS = {
  Metallo: ['metal1', 'metal2', 'cowbell', 'metallic', 'pling', 'metalDelay', 'sciabola', 'revMetal'],
  Tamburi: ['shot09', 'tom', 'tom2', 'wood', 'top', 'skull', 'skull2', 'shot17'],
  Macchine: ['technoid', 'strangeHit', 'robot', 'growl', 'laser', 'laserRate', 'glitch', 'littleRobot'],
  Voci: ['kill', 'darkness', 'whisper', 'whisperF', 'again', 'medieval', 'devil', 'choirYe'],
} as const satisfies Record<string, readonly RaveLiveSound[]>;
const PERC_ZONES: readonly RaveLiveSound[] = Object.values(PERC_BANKS).flat();
/** The volume of each zone (matched by ear on the files' measured peaks). */
const PERC_GAIN: Partial<Record<RaveLiveSound, number>> = {
  metal1: 2, metal2: 0, cowbell: 6, metallic: 2, pling: 4, metalDelay: -2, sciabola: 2, revMetal: 4,
  shot09: -4, tom: -4, tom2: -4, wood: -6, top: 6, skull: 0, skull2: 4, shot17: 0,
  technoid: -4, strangeHit: -4, robot: -6, growl: -10, laser: -8, laserRate: -8, glitch: 0, littleRobot: 2,
  kill: 0, darkness: 0, whisper: 2, whisperF: 2, again: -6, medieval: 0, devil: 0, choirYe: -4,
};
const BANK = { Metallo: 0, Tamburi: 8, Macchine: 16, Voci: 24 } as const;

/** The zones one key each from C1 (36): the same scheme as the Drum Machine's pads. */
function zones(list: readonly RaveLiveSound[], gain: Partial<Record<RaveLiveSound, number>>, firstKey = 36): ParamValues {
  return Object.fromEntries(list.flatMap((s, i) => {
    const key = firstKey + i;
    return [[zoneParam(i, 'lo'), key], [zoneParam(i, 'hi'), key], [zoneParam(i, 'root'), key], [zoneParam(i, 'gain'), gain[s] ?? 0],
      [zoneParam(i, 'pan'), ((i * 37) % 60) - 30]];
  }));
}
const zoneSamples = (list: readonly RaveLiveSound[]): Record<string, RaveLiveSound> =>
  Object.fromEntries(list.map((s, i) => [i === 0 ? 'sample' : `z${i + 1}`, s]));

const PERC_SAMPLER: ParamValues = {
  mode: MODE.oneShot, trigger: 0, voiceMode: 0, velocity: 40, volume: -6,
  fOn: 1, fType: FILTER.lp24, fCutoff: 20000, fRes: 10,
  e1A: 0.001, e1D: 2.5, e1S: 0, e1R: 0.1,
  ...zones(PERC_ZONES, PERC_GAIN),
};
const PERC_STARTS = PERC_ZONES.map((_, i) => zoneParam(i, 'start'));

const PERC_RACK: RackSpec = {
  name: 'Sampler',
  effects: [
    eqOf('Sampler', 60, [[3500, 1, 1]]),
    redux('Sporco', { mix: 0, bits: 12, rate: 16000 }),
    delay('Eco 1/8.', { division: index(DIVISIONS, '1/8.'), pingPong: 1, feedback: 35, lowCut: 400, highCut: 5000, mix: 0 }),
    reverb('Capannone', { size: 70, decay: 2, predelay: 15, damping: 5000, lowCut: 300, mix: 0 }),
    pump('Pompa', -24, 3, 120),
  ],
  macros: [
    // all the zones follow the first one's sound: one macro moves them all
    { name: 'Altezza', value: 64, moves: [[0, 'transpose', -12, 12]] },
    { name: 'Coda', value: 110, moves: [[0, 'e1D', 0.06, 4]] },
    { name: 'Filtro', value: 127, moves: [[0, 'fCutoff', 400, 20000]] },
    { name: 'Inizio', moves: PERC_STARTS.map((p): Move => [0, p, 0, 40]) },
    { name: 'Al contrario', mode: 'toggle', moves: [[0, 'reverse', 0, 1]] },
    { name: 'Eco', value: 30, moves: [[3, 'mix', 0, 45], [3, 'feedback', 25, 65]] },
    { name: 'Spazio', value: 25, moves: [[4, 'mix', 0, 50]] },
    { name: 'Sporco', moves: [[2, 'mix', 0, 100], [2, 'bits', 12, 5]] },
  ],
};

/** A rhythm on a sampler key (bank + slot), like the pads. */
const z = (bank: keyof typeof BANK, slot: number) => BANK[bank] + slot;

const PERCS = {
  // brehho23's percussion groove (rim and One_Shot) on the Tamburi bank
  tamburi: clip('Tamburi 3-3-2', swing([
    ...phrase(z('Tamburi', 0), Array(4).fill('x.x. .x.. x..x ...o')),
    ...phrase(z('Tamburi', 2), ['.... ..x. .... ....', '.... ..x. .... ....', '.... ..x. .... ....', '.... ..x. .... .xx.']),
    ...phrase(z('Tamburi', 1), Array(4).fill('.... .... .... ..x.')),
    ...phrase(z('Tamburi', 5), Array(4).fill('...o .... .o.. o...')),
    ...phrase(z('Tamburi', 4), Array(4).fill('.... ...x .... ..x.')),
  ], SWING), len(4)),
  // brehho23's "Dembow perc"
  dembow: clip('Tamburi dembow', [
    ...phrase(z('Tamburi', 0), Array(4).fill('x.x. .x.. x..x ...o')), ...phrase(z('Tamburi', 2), Array(4).fill('.... ..x. .... ....')),
    ...phrase(z('Tamburi', 1), Array(4).fill('.... .... .... ..x.')), ...phrase(z('Tamburi', 5), Array(4).fill('...o .... .o.. o...')),
    ...phrase(z('Tamburi', 6), Array(4).fill('.o.o .o.o .o.o .o.o')),
  ], len(4)),
  // toms in groups of three sixteenths against the four: the rite
  rito: clip('Tamburi rito', [
    ...phrase(z('Tamburi', 1), ['X..x ..x. .x.. X..x', '..x. .x.. x..x ....']), ...phrase(z('Tamburi', 2), ['.... .... ..x. ....', 'x... ..x. .... ..xx']),
    ...phrase(z('Tamburi', 3), ['..x. ...x ..x. .x..', '..x. ...x .x.. ..x.']), ...phrase(z('Metallo', 2), ['.... .... .... ....', '.... .... .... x...']),
  ], len(2)),
  levare: clip('Metallo in levare', [
    ...phrase(z('Metallo', 0), ['..x. .... ..x. ....', '..x. .... .... ..x.']), ...phrase(z('Metallo', 3), ['.... ..x. .... ...x', '.... ..x. ..x. ....']),
    ...phrase(z('Metallo', 4), ['...x .... .... ....', '.... .... ...x ....']),
  ], len(2)),
  rado: clip('Metallo rado', [hit(z('Metallo', 0), 0, 100), hit(z('Metallo', 7), len(1) + 2.5, 90), hit(z('Metallo', 5), len(2) + 1.75, 96), hit(z('Metallo', 6), len(3) + 3, 90)], len(4)),
  macchine: clip('Macchine', [
    ...phrase(z('Macchine', 0), ['x..x ..x. .x.. ..x.', 'x..x ..x. .x.. x...']), ...phrase(z('Macchine', 1), ['.... x... .... x...', '.... x... .... x..x']),
    ...phrase(z('Macchine', 6), ['.... .... ...x ....', '..x. .... .... ....']), ...phrase(z('Macchine', 4), ['.... .... .... ....', '.... .... .... ..x.']),
  ], len(2)),
  psiche: clip('Psiche', [
    ...phrase(z('Macchine', 5), ['..x. .... .... ....', '.... .... ..x. ....']), ...phrase(z('Metallo', 4), ['x..x ..x. .x.. x..x', '..x. .x.. x..x ..x.']),
    ...phrase(z('Macchine', 7), ['.... .x.. .... .x..', '.... .x.. .... ....']),
  ], len(2)),
  // a voice every four bars, the whispers in between
  voci: clip('Voci', [hit(z('Voci', 0), 0, 110), hit(z('Voci', 2), len(2) + 2, 100), hit(z('Voci', 1), len(4), 110), hit(z('Voci', 3), len(6) + 2.5, 100)], len(8)),
};

// ------------------------------------------------------------------ 7 rottura

/** The amen at 175: an eighth is 0.1714 s. Down three semitones the eighth lasts 0.2038 s, almost
 *  the eighth at 145 (0.2069): the slices in a row rebuild the break, darker. */
const AMEN_EIGHTH_S = 30 / 175;
const RAVE_BEAT_S = 60 / 140;
const BREAKS_KIT: readonly PadSound<RaveLiveSound>[] = [
  ...Array.from({ length: 8 }, (_, k): PadSound<RaveLiveSound> => ({ sound: 'amen', at: k * AMEN_EIGHTH_S, tune: -3, decay: AMEN_EIGHTH_S * 1.25, choke: 1 })),
  // four beats of the brehho23 rave break (at 140: up a semitone)
  ...[0, 3, 6, 13].map((beat): PadSound<RaveLiveSound> => ({ sound: 'raveBreak', at: beat * RAVE_BEAT_S, tune: 1, decay: RAVE_BEAT_S, choke: 1, level: -3 })),
  // the amen's snare reversed (the swell) and high for the rolls
  { sound: 'amen', at: 2 * AMEN_EIGHTH_S, tune: -3, decay: 0.4, reverse: true, choke: 1 },
  { sound: 'amen', at: 2 * AMEN_EIGHTH_S, tune: 4, decay: 0.08, choke: 1 },
  { sound: 'decimated', at: 0, decay: 0.34, choke: 1, level: -2 },
  { sound: 'glitcha', at: 0, decay: 0.69, choke: 1, level: -2 },
];
const BR = { amen: 0, rave: 8, swell: 12, snareHi: 13, decimated: 14, glitcha: 15 } as const;

const BREAKS_RACK: RackSpec = {
  name: 'Rottura',
  effects: [
    eqOf('Rottura', 40, [[90, -3, 1], [2500, 1.5, 1]]),
    lowPass('Filtro'),
    highPass('Passa-alto'),
    drive('Sporco', { shape: SHAPE.hard, drive: 10, low: 40, mix: 0, oversampling: 0 }),
    repeatButton('Ripeti', '1/16'),
    reverse('Al contrario', { reverse: 1, length: index(REVERSE_LENGTHS, '1/8'), mix: 0 }),
    tapeStop('Frena', { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Immediately'), curve: BRAKE_CURVE.smooth, spin: 200 }),
  ],
  macros: [
    { name: 'Pitch', value: 64, moves: BREAKS_KIT.map((p, i): Move => [0, padParam(i, 'tune'), (p.tune ?? 0) - 7, (p.tune ?? 0) + 7]) },
    { name: 'Coda', value: 127, moves: BREAKS_KIT.map((p, i): Move => [0, padParam(i, 'decay'), (p.decay ?? 0.3) * 0.3, p.decay ?? 0.3]) },
    { name: 'Filtro', moves: [[2, 'freq', 20000, 300]] },
    { name: 'Passa-alto', moves: [[3, 'freq', 20, 900]] },
    { name: 'Sporco', value: 20, moves: [[4, 'mix', 0, 100], [4, 'drive', 6, 24]] },
    button('Ripeti', [[5, 'repeat', 0, 1]]),
    button('Al contrario', [[6, 'mix', 0, 100]]),
    button('Frena', [[7, 'stop', 0, 1]]),
  ],
};

/** A phrase of eighth-note slices: a number is the pad (the slice) starting there, "." lets it play. */
function chops(line: string, from: Beats = 0, velocity = 110): Note[] {
  return line.trim().split(/\s+/).flatMap((w, i) => (w === '.' ? [] : [{ pitch: padNote(Number(w)), start: from + i * 0.5, duration: 0.5, velocity }]));
}

const BREAKS = {
  amen: clip('Amen', [...chops('0 1 2 3 4 5 6 7'), ...chops('0 1 2 3 4 5 6 7', 4), ...chops('0 1 2 3 4 5 6 7', 8), ...chops('0 1 2 3 0 1 6 7', 12)], len(4)),
  chop: clip('Amen chop', [...chops('0 1 2 0 1 2 6 7'), ...chops('0 . 2 3 0 1 2 7', 4), ...chops('0 1 2 0 1 2 6 2', 8), ...chops('4 5 2 3 2 2 6 7', 12)], len(4)),
  mezzo: clip('Amen mezzo tempo', [...chops('0 . 1 . 2 . 3 .'), ...chops('4 . 5 . 2 . 7 .', 4)], len(2)),
  // brehho23's 3-3-2 with the amen slices
  spezzato: clip('Spezzato', [...chops('0 . . 2 . . 0 .'), ...chops('0 . . 2 . . 6 7', 4), ...chops('0 . . 2 . . 0 .', 8), ...chops('0 2 . 2 . 2 2 2', 12)], len(4)),
  rave: clip('Rottura brehho23', [hit(BR.rave, 0), hit(BR.rave + 1, 1), hit(BR.rave, 2), hit(BR.rave + 2, 3), hit(BR.rave + 3, 4), hit(BR.rave + 1, 5), hit(BR.rave + 2, 6), hit(BR.rave + 3, 7)], len(2)),
  glitch: clip('Glitch', [
    ...chops('0 1 2 3'), ...roll(BR.snareHi, 2, 8, 0.125, [80, 120]), ...chops('0 . 2 .', 3), hit(BR.decimated, 4.5), hit(BR.glitcha, 6), hit(BR.swell, 7.5),
  ], len(2)),
  // eight tightening bars: eighths, sixteenths, thirty-seconds of the snare
  tensione: {
    ...clip('Tensione', [
      ...chops('0 1 2 3 4 5 6 7'), ...chops('0 1 2 3 4 5 6 7', 4), ...chops('0 1 2 3 0 1 2 3', 8), ...chops('2 . 2 . 2 2 2 2', 12),
      ...roll(BR.snareHi, len(4), 32, 0.25, [70, 110]), ...roll(BR.snareHi, len(6), 32, 0.125, [100, 127]), hit(BR.swell, len(8) - 1, 110),
    ], len(8)),
    once: true,
  },
};

// ------------------------------------------------------------------ 8 lunghi

/** The zones of the long sounds: the key, the file, the tuning towards C (semitones), the volume and,
 *  for the drones, the loop (start and end in percent of the file). The first zone gives its sound to the
 *  others (the transitions: no loop, immediate attack); the drones have their own. */
interface LongZone {
  readonly sound: RaveLiveSound;
  readonly key: number;
  readonly tune?: number;
  readonly gain?: number;
  readonly loop?: readonly [start: number, end: number];
}
const LONG_ZONES: readonly LongZone[] = [
  // the transitions (from the first zone: the sound of all those that don't have their own)
  { sound: 'riseDa3', key: 48, gain: 0 },
  { sound: 'noiseUp', key: 49, gain: 2 },
  { sound: 'zebraUp', key: 50, gain: -2 },
  { sound: 'reverseNoise', key: 51, gain: 6 },
  { sound: 'cinematic', key: 52, gain: -2 },
  { sound: 'blast', key: 53, gain: 0 },
  { sound: 'crashFx', key: 54, gain: -2 },
  { sound: 'fall', key: 55, gain: 0 },
  { sound: 'downside', key: 56, gain: 8 },
  { sound: 'scendeDisto', key: 57, gain: -6 },
  { sound: 'goDown', key: 58, gain: -8 },
  { sound: 'finishBang', key: 59, gain: 0 },
  // the sirens and the long noises
  { sound: 'siren', key: 60, gain: -6 },
  { sound: 'sirenLead', key: 61, gain: -10, tune: 5, loop: [10, 90] },
  { sound: 'allarm', key: 62, gain: 2 },
  { sound: 'strongNoise', key: 63, gain: 0 },
  { sound: 'autotreno', key: 64, gain: 2 },
  { sound: 'space', key: 65, gain: -2 },
  { sound: 'hell', key: 66, gain: -4 },
  { sound: 'tension', key: 67, gain: -4 },
  // the looping drones, tuned to C or to the mode's notes (the fifth, the flat second)
  { sound: 'halfIntro', key: 36, tune: 4, gain: 6, loop: [20, 85] },
  { sound: 'darknight', key: 37, tune: 0, gain: -6, loop: [15, 85] },
  { sound: 'choirFx', key: 38, tune: 0, gain: -2, loop: [20, 80] },
  { sound: 'darkAtmos', key: 39, tune: 0, gain: -2, loop: [10, 90] },
  { sound: 'gladiator', key: 40, tune: 0, gain: 2, loop: [15, 85] },
  { sound: 'feedback', key: 41, tune: 0, gain: -10, loop: [20, 80] },
  { sound: 'magicDelay', key: 42, tune: 0, gain: 10, loop: [10, 85] },
  { sound: 'treno', key: 43, gain: 4 },
];
const LONG_KEY = Object.fromEntries(LONG_ZONES.map(zn => [zn.sound, zn.key])) as Record<RaveLiveSound, number>;
const DRONES = LONG_ZONES.flatMap((zn, i) => (zn.loop ? [i] : []));

/** The transitions' sound (the first zone): it plays while the note is held, then fades. */
const LONG_BASE: ParamValues = {
  mode: MODE.classic, voiceMode: 0, velocity: 30, volume: -6, loop: 0,
  e1A: 0.005, e1D: 10, e1S: 100, e1R: 0.4, fOn: 0,
};
/** The zones: keys, root note (the key minus the tuning), volumes; the drones with their sound:
 *  faded loop, slow attack and release. */
function longZones(): ParamValues {
  const full = resolveParams(SAMPLER, LONG_BASE);
  return Object.fromEntries(LONG_ZONES.flatMap((zn, i) => {
    const keys: [string, number][] = [
      [zoneParam(i, 'lo'), zn.key], [zoneParam(i, 'hi'), zn.key], [zoneParam(i, 'root'), zn.key], [zoneParam(i, 'gain'), zn.gain ?? 0],
    ];
    if (!zn.loop) return keys;
    const own: [string, number][] = SOUND_KEYS.map(k => [zoneParam(i, k), full[k]]);
    const set = (k: ZoneKey, v: number): [string, number] => [zoneParam(i, k), v];
    return [...keys, ...own, set('own', 1), set('loop', 1), set('xfade', 35), set('loopStart', zn.loop[0]), set('loopEnd', zn.loop[1]),
      set('transpose', zn.tune ?? 0), set('e1A', 2.5), set('e1R', 4)];
  }));
}

const LONG_RACK: RackSpec = {
  name: 'Lunghi',
  effects: [
    highPass('Passa-alto'),
    lowPass('Filtro'),
    pump('Pompa', -30, 4, 180),
    delay('Eco 1/4.', { division: index(DIVISIONS, '1/4.'), pingPong: 1, feedback: 30, lowCut: 300, highCut: 3500, mix: 0 }),
    reverb('Cattedrale', { size: 90, decay: 4, predelay: 30, damping: 4500, lowCut: 250, mix: 20 }),
    stereo('Larghezza', { width: 100, monoFreq: 150 }),
  ],
  macros: [
    { name: 'Filtro', moves: [[2, 'freq', 20000, 250]] },
    // halfway: nothing below 120 Hz (the place of the kick and the bass)
    { name: 'Passa-alto', value: 52, moves: [[1, 'freq', 30, 900]] },
    { name: 'Spazio', value: 40, moves: [[5, 'mix', 5, 60], [5, 'decay', 2, 10]] },
    { name: 'Eco', value: 20, moves: [[4, 'mix', 0, 40]] },
    // the echo's feedback almost to self-oscillation (it stays below 95 %)
    { name: 'Lancio', moves: [[4, 'feedback', 30, 92]] },
    { name: 'Altezza', value: 64, moves: [[0, 'transpose', -12, 12], ...DRONES.map((i): Move => [0, zoneParam(i, 'transpose'), (LONG_ZONES[i].tune ?? 0) - 12, (LONG_ZONES[i].tune ?? 0) + 12])] },
    { name: 'Dissolvenza', value: 50, moves: DRONES.flatMap((i): Move[] => [[0, zoneParam(i, 'e1A'), 0.3, 8], [0, zoneParam(i, 'e1R'), 0.5, 10]]) },
    { name: 'Larghezza', value: 70, moves: [[6, 'width', 40, 170]] },
  ],
};

/** A held note of a long sound, from `start` for `beats` beats. */
const long = (sound: RaveLiveSound, start: Beats, beats: Beats, velocity = 110): Note => ({ pitch: LONG_KEY[sound], start, duration: beats, velocity });
/** A riser ending exactly on `end`: it starts as early as it lasts. */
const riseTo = (sound: RaveLiveSound, seconds: number, end: Beats): Note => long(sound, Math.max(0, end - beatsOf(seconds)), Math.min(end, beatsOf(seconds)));

/** A clip of long sounds: no note goes past the end (the clip, or the loop, would cut it
 *  without release). */
function longClip(name: string, notes: readonly Note[], bars: number, once = false): ClipSpec {
  const end = len(bars);
  return { ...clip(name, notes.map(n => ({ ...n, duration: Math.min(n.duration, end - n.start) })), end), ...(once ? { once } : {}) };
}

const LONGS = {
  bordone: longClip('Bordone', [long('halfIntro', 0, len(16)), long('darknight', len(8), len(8), 90)], 16),
  coro: longClip('Coro', [long('choirFx', 0, len(8)), long('gladiator', len(4), len(4), 100)], 8),
  buio: longClip('Buio', [long('darkAtmos', 0, len(8)), long('feedback', len(4), len(4), 80)], 8),
  eco: longClip('Eco magica', [long('magicDelay', 0, len(8))], 8),
  sirena: longClip('Sirena', [long('sirenLead', 0, len(4), 96), long('siren', len(4), beatsOf(10.97), 100)], 8),
  treno: longClip('Treno', [long('treno', 0, beatsOf(6.29)), long('autotreno', len(8), beatsOf(9.67), 100)], 16),
  rumore: longClip('Muro di rumore', [long('strongNoise', 0, beatsOf(7.8)), long('allarm', len(4), beatsOf(10.4), 90)], 8),
  // the risers: they end on the clip's last beat, they're played once
  salita8: longClip('Salita 8', [riseTo('riseDa3', 10.97, len(8)), riseTo('reverseNoise', 5.49, len(8)), riseTo('zebraUp', 5.49, len(8))], 8, true),
  salita16: longClip('Salita 16', [riseTo('noiseUp', 10.97, len(16)), riseTo('riseDa3', 10.97, len(16)), riseTo('reverseNoise', 5.49, len(16))], 16, true),
  impatto: longClip('Impatto', [long('cinematic', 0, beatsOf(5.4)), long('crashFx', 0, beatsOf(6.9), 100)], 4, true),
  esplosione: longClip('Esplosione', [long('blast', 0, beatsOf(2.9)), long('cinematic', 0, beatsOf(5.4)), long('fall', len(1), beatsOf(10.9), 90)], 8, true),
  discesa: longClip('Discesa', [long('fall', 0, beatsOf(10.9)), long('goDown', 0, beatsOf(5.4), 90)], 8, true),
  fine: longClip('Fine', [long('finishBang', 0, beatsOf(11.6)), long('halfIntro', 0, len(8), 90)], 8, true),
};

// ------------------------------------------------------------------ master

const MASTER_RACK: RackSpec = {
  name: 'Macchina',
  effects: [
    repeatButton('Ripeti 1/8', '1/8'),
    repeatButton('Ripeti 1/16', '1/16'),
    repeatButton('Ripeti 1/32', '1/32'),
    reverse('Al contrario', { reverse: 1, length: index(REVERSE_LENGTHS, '1/4'), mix: 0 }),
    tapeStop('Stop nastro', { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Immediately'), curve: BRAKE_CURVE.smooth, spin: 300 }),
    highPass('Sottrazione'),
    lowPass('Muro'),
    redux('Lo-fi', { mix: 0, bits: 16, rate: 48000 }),
  ],
  macros: [
    button('Ripeti 1/8', [[0, 'repeat', 0, 1]]),
    button('Ripeti 1/16', [[1, 'repeat', 0, 1]]),
    button('Ripeti 1/32', [[2, 'repeat', 0, 1]]),
    button('Al contrario', [[3, 'mix', 0, 100]]),
    button('Stop nastro', [[4, 'stop', 0, 1]]),
    // the high-pass removing kick and bass: the subtractions before giving everything back
    { name: 'Sottrazione', moves: [[5, 'freq', 20, 700]] },
    { name: 'Muro', moves: [[6, 'freq', 20000, 350]] },
    { name: 'Lo-fi', moves: [[7, 'mix', 0, 100], [7, 'bits', 16, 6], [7, 'rate', 48000, 6000]] },
  ],
};

// ------------------------------------------------------------------ the tracks

const TRACKS: readonly TrackSpec<RaveLiveSound, TrackKey>[] = [
  { key: 'kick', name: 'Cassa', volumeDb: -4, kit: KICK_KIT, rack: KICK_RACK, effects: [] },
  { key: 'snare', name: 'Colpi', volumeDb: -3, kit: SNARE_KIT, rack: SNARE_RACK, effects: [] },
  { key: 'hats', name: 'Piatti', volumeDb: -6, kit: HATS_KIT, rack: HATS_RACK, effects: [] },
  { key: 'bass', name: 'Levare', volumeDb: -2, neuro: BASS, rack: BASS_RACK, effects: [], sidechain: [[0, 'kick']] },
  { key: 'acid', name: 'Acido', volumeDb: -7, analog: ACID, rack: ACID_RACK, fxRacks: [ACID_FX], effects: [] },
  {
    key: 'perc', name: 'Sampler', volumeDb: -3, instrument: { type: SAMPLER.type, params: PERC_SAMPLER }, rack: PERC_RACK,
    samples: zoneSamples(PERC_ZONES), effects: [], sidechain: [[4, 'kick']],
  },
  { key: 'breaks', name: 'Rottura', volumeDb: -8, kit: BREAKS_KIT, rack: BREAKS_RACK, effects: [] },
  {
    key: 'long', name: 'Lunghi', volumeDb: -6, instrument: { type: SAMPLER.type, params: { ...LONG_BASE, ...longZones() } }, rack: LONG_RACK,
    samples: zoneSamples(LONG_ZONES.map(zn => zn.sound)), effects: [], sidechain: [[2, 'kick']],
  },
];

// ------------------------------------------------------------------ le scene

type Clips = Partial<Record<TrackKey, ClipSpec>>;
const scene = (name: string, bars: number, clips: Clips): SceneSpec<TrackKey> => ({ name, bars, clips });

const SCENES: readonly SceneSpec<TrackKey>[] = [
  // ACT I: underground — the industrial tension, then the kick and the bass
  scene('I · Ingresso', 32, { long: LONGS.bordone, perc: PERCS.rado, hats: HATS.rarefatti }),
  scene('Cuore', 32, { kick: KICKS.cuore, bass: BASSES.sub, long: LONGS.buio, perc: PERCS.rado, hats: HATS.rarefatti }),
  scene('Macchina', 64, { kick: KICKS.dritta('Ancora'), bass: BASSES.levare, hats: HATS.levare, perc: PERCS.tamburi, long: LONGS.treno }),
  scene('Levare', 64, { kick: KICKS.dritta('Ancora'), snare: SNARES.back, hats: HATS.sedicesimi, bass: BASSES.giro, acid: ACIDS.seq, perc: PERCS.tamburi }),
  scene('Pressione', 48, { kick: KICKS.dritta('Compressa'), snare: SNARES.ghost, hats: HATS.trama, bass: BASSES.doppio, acid: ACIDS.seq, perc: PERCS.levare }),
  scene('Sottrazione', 16, { kick: KICKS.isolata, bass: BASSES.sub, acid: ACIDS.respiro, hats: HATS.rarefatti, long: LONGS.salita16 }),
  // ATTO II: martello — la hard techno
  scene('II · Martello', 64, { kick: KICKS.dritta('Martello'), snare: SNARES.back, hats: HATS.sedicesimi, bass: BASSES.rotolante, acid: ACIDS.martello, perc: PERCS.levare, long: LONGS.impatto }),
  scene('Ferro', 64, { kick: KICKS.dritta('Industriale'), snare: SNARES.industriale, hats: HATS.galoppo, bass: BASSES.giro, acid: ACIDS.squelch, perc: PERCS.macchine }),
  scene('Acido', 64, { kick: KICKS.spinta, snare: SNARES.ghost, hats: HATS.trama, bass: BASSES.doppio, acid: ACIDS.seqGiro, perc: PERCS.psiche }),
  scene('Rottura', 32, { breaks: BREAKS.amen, bass: BASSES.sub, acid: ACIDS.seq, hats: HATS.ride, long: LONGS.discesa }),
  scene('Ritorno', 64, { kick: KICKS.dritta('Distorta'), snare: SNARES.back, hats: HATS.sedicesimi, bass: BASSES.rotolante, acid: ACIDS.rotola, perc: PERCS.tamburi, long: LONGS.impatto }),
  scene('Vuoto', 32, { long: LONGS.coro, perc: PERCS.voci, acid: ACIDS.respiro }),
  scene('Salita', 8, { kick: KICKS.rullo, snare: SNARES.salita, hats: HATS.sedicesimi, bass: BASSES.levare, acid: ACIDS.salita, long: LONGS.salita8 }),
  // ACT III: psyche — acid, Goa, dark trance, the rhythms breaking
  scene('III · Goa', 64, { kick: KICKS.dritta('Secca'), snare: SNARES.back, hats: HATS.psy, bass: BASSES.goa, acid: ACIDS.seqAlto, perc: PERCS.psiche, long: LONGS.esplosione }),
  scene('Trance oscura', 64, { kick: KICKS.dritta('Secca'), snare: SNARES.ghost, hats: HATS.psy, bass: BASSES.trance, acid: ACIDS.seqReb, perc: PERCS.levare, long: LONGS.sirena }),
  scene('Spirale', 48, { kick: KICKS.spinta, snare: SNARES.spezzato, hats: HATS.trama, bass: BASSES.sequenza, acid: ACIDS.seqGiro, perc: PERCS.macchine }),
  scene('Galoppo', 64, { kick: KICKS.galoppo, snare: SNARES.back, hats: HATS.galoppo, bass: BASSES.galoppo, acid: ACIDS.galoppo, perc: PERCS.tamburi }),
  scene('Respiro', 32, { kick: KICKS.isolata, bass: BASSES.sub, acid: ACIDS.seq, long: LONGS.bordone, perc: PERCS.voci, hats: HATS.rarefatti }),
  scene('Spezzato', 64, { kick: KICKS.spezzata, snare: SNARES.dembow, hats: HATS.dembow, bass: BASSES.dembow, acid: ACIDS.motivo, perc: PERCS.dembow, breaks: BREAKS.spezzato }),
  scene('Esplosione', 64, { kick: KICKS.dritta('Gabber'), snare: SNARES.back, hats: HATS.trama, bass: BASSES.rotolante, acid: ACIDS.esplosione, perc: PERCS.levare, long: LONGS.esplosione }),
  // ACT IV: rite — the climax and the end
  scene('IV · Rito', 64, { kick: KICKS.dritta('Boom'), snare: SNARES.rim, hats: HATS.levare, bass: BASSES.giro, perc: PERCS.rito, long: LONGS.coro }),
  scene('Catena', 64, { kick: KICKS.mezzo, breaks: BREAKS.chop, snare: SNARES.spezzato, hats: HATS.sedicesimi, bass: BASSES.doppio, acid: ACIDS.seqGiro, perc: PERCS.macchine }),
  scene('Culmine', 64, { kick: KICKS.doppia, snare: SNARES.industriale, hats: HATS.trama, bass: BASSES.rotolante, acid: ACIDS.seqAlto, perc: PERCS.levare, long: LONGS.rumore }),
  scene('Caduta', 16, { breaks: BREAKS.glitch, acid: ACIDS.respiro, long: LONGS.discesa, hats: HATS.rarefatti }),
  scene('Ultimo martello', 64, { kick: KICKS.dritta('Martello'), snare: SNARES.back, hats: HATS.sedicesimi, bass: BASSES.levare, acid: ACIDS.martello, perc: PERCS.tamburi, long: LONGS.impatto }),
  scene('Fine', 32, { kick: KICKS.cuore, long: LONGS.fine, perc: PERCS.rado, hats: HATS.rarefatti }),
  // the extra clips, to launch over the scenes: transitions, fills, variants
  scene('Transizioni', 8, { kick: KICKS.rullo, snare: SNARES.rullata, hats: HATS.rullata, breaks: BREAKS.tensione, long: LONGS.salita8, acid: ACIDS.salita }),
  scene('Varianti', 16, { kick: KICKS.dritta('Ancora'), snare: SNARES.four, hats: HATS.ride, bass: BASSES.sequenzaGiro, breaks: BREAKS.rave, perc: PERCS.psiche, long: LONGS.eco, acid: ACIDS.motivo }),
  scene('Varianti 2', 16, { kick: KICKS.dritta('Distorta'), breaks: BREAKS.mezzo, bass: BASSES.trance, acid: ACIDS.seqReb, perc: PERCS.voci, long: LONGS.buio }),
];

/** The keyboard keys: the button macros and the switches needed on the fly. */
const KEYS: readonly KeySpec<TrackKey>[] = [
  { key: 'KeyQ', owner: 'master', rack: 0, macro: 0 },
  { key: 'KeyW', owner: 'master', rack: 0, macro: 1 },
  { key: 'KeyE', owner: 'master', rack: 0, macro: 2 },
  { key: 'KeyR', owner: 'master', rack: 0, macro: 3 },
  { key: 'KeyT', owner: 'master', rack: 0, macro: 4 },
  // a knob on a key jumps from one end to the other: the subtraction and the wall on the fly
  { key: 'KeyZ', owner: 'master', rack: 0, macro: 5 },
  { key: 'KeyX', owner: 'master', rack: 0, macro: 6 },
  { key: 'KeyA', owner: 'snare', rack: 0, macro: 7 },
  { key: 'KeyS', owner: 'breaks', rack: 0, macro: 5 },
  { key: 'KeyD', owner: 'breaks', rack: 0, macro: 6 },
  { key: 'KeyF', owner: 'breaks', rack: 0, macro: 7 },
  { key: 'KeyG', owner: 'acid', rack: 1, macro: 5 },
  { key: 'KeyC', owner: 'kick', rack: 0, macro: 6 },
  { key: 'KeyV', owner: 'acid', rack: 1, macro: 1 },
];

// the "recording": the acts in a row, more than half an hour
const ARRANGEMENT = SCENES.flatMap((s, i) => (s.name.startsWith('Transizioni') || s.name.startsWith('Varianti') ? [] : [i]));

export const RAVE_LIVE: LiveSpec<RaveLiveSound, TrackKey> = {
  name: 'Rave illegale',
  bpm: RAVE_LIVE_BPM,
  launch: '1bar',
  master: {
    volumeDb: 0,
    racks: [MASTER_RACK],
    effects: [
      eqOf('Master', 28, [[45, -2, 1.8], [1600, 1, 0.8], [3000, 1, 0.7], [12000, -1.5, 0.7, HIGH_SHELF]]),
      compressor('Colla', { threshold: -12, ratio: 2, knee: 8, attack: 30, release: 120, scHp: 90, auto: 0, makeup: 0 }),
      clipper('Master', { drive: 2, ceiling: -1, knee: 25 }),
      stereo('Bassi mono', { monoFreq: 110 }),
      limiter('Master', { gain: 4, ceiling: -0.8, release: 60, lookahead: 2 }),
    ],
  },
  tracks: TRACKS,
  scenes: SCENES,
  arrangement: ARRANGEMENT,
  keys: KEYS,
};

/** A scene's clips, for whoever wants to check them. */
export const raveScene = (name: string): Clips | undefined => SCENES.find(s => s.name === name)?.clips;

/** Builds the live in the store's (empty) project. */
export function buildRaveLive(store: ProjectStore, sounds: Readonly<Record<RaveLiveSound, SampleRef>>): void {
  buildLive(store, RAVE_LIVE, sounds);
}

/** For tests: the kick bodies, the sampler banks, the long-sound zones. */
export const RAVE_PARTS = { BODIES, PERC_BANKS, LONG_ZONES, KEYS, KICK_KIT };
