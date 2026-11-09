/* "Siete pazzi": drum & bass at 175 BPM in G# minor, with the amen sliced and glitched, vocal
 * stabs, risers and cuts. The drums and vocals are the user's samples on the pads:
 *
 *   Amen      the amen (4 bars at 175) in 16 eighth-note slices, choked to each other like Live's slice
 *             mode: in a row they rebuild the loop, reassembled they make the chops;
 *   Glitch    amen hits reversed, pitched up and down, the "decimated" version and the
 *             already glitched one: thirty-second rolls, reverse swells, cuts;
 *   Voci      the whole sung phrase, its syllables (where the attacks fall), the phrase
 *             reversed, the second phrase and the spoken phrases for the stabs.
 *
 * The reese is two detuned saws in Analog, bent by the Drive and compressed; the sub a
 * separate sine, so the bass stays clean and the reese can get dirty. The sidechain pump is
 * done with volume modulations on the kicks and snares; the stutters with chopped volume
 * modulations (gate). On the master EQ, "glue" compressor and limiter. The assembly is in
 * live-builder.ts; the files, in scripts/build-pazzi-live.ts. */
import type { Beats } from '../core/music-time';
import { DETECTOR } from '../devices/effects/compressor/compressor';
import { SHAPE } from '../devices/effects/drive/drive';
import { bandParam } from '../devices/effects/eq/eq';
import { VOICE_MODE } from '../devices/instruments/analog/analog';
import { padParam } from '../devices/instruments/drums/drums';
import type { ParamValues } from '../model/device';
import type { Note } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import type { ProjectStore } from '../store/project-store';
import {
  buildLive, clip, compressor, delay, drive, effectParam, eq, instrumentParam, limiter, lowCut, reverb, VOLUME,
  type LiveSpec, type ModSpec, type PadSound, type SceneSpec, type TrackSpec,
} from './live-builder';
import { acid, BAR, bars, chop, curve, duck, gate, repeat, roll, steps } from './patterns';

export const PAZZI_LIVE_BPM = 175;

/** The sounds the live uses, by role (whoever builds the project gives the file for each). */
export const PAZZI_LIVE_SOUNDS = [
  'kick', 'snare', 'snareBody', 'hatClosed', 'hatOpen', 'ride', 'shaker',
  'amen', 'amenCrush', 'amenGlitch',
  'vocal', 'vocal2', 'pazzi', 'aiutarmi', 'voiceCut', 'vox', 'stacco',
  'riser', 'sweepUp', 'downlifter', 'crash', 'impact', 'laser', 'tension',
] as const;

export type PazziLiveSound = (typeof PAZZI_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'snare' | 'amen' | 'glitch' | 'hats' | 'sub' | 'reese' | 'pad' | 'vox' | 'fx';

/** An eighth and a bar at 175 BPM, in seconds (to slice the files). */
const EIGHTH_S = 30 / PAZZI_LIVE_BPM;
const BAR_S = 240 / PAZZI_LIVE_BPM;

// ------------------------------------------------------------------ i kit

/** The syllables of the sung phrase: where they start, in seconds (measured on the attacks). */
const SYLLABLES = [0.116, 0.969, 1.353, 1.736, 2.456, 2.827, 3.077, 3.431];

const KITS = {
  kick: [{ sound: 'kick', tune: 3, decay: 0.32 }],
  snare: [
    { sound: 'snare', level: -2 },
    { sound: 'snareBody', decay: 0.25, level: -10 },
    { sound: 'snare', decay: 0.12, tone: 56, level: -6 },
  ],
  hats: [
    { sound: 'hatClosed', decay: 0.08, choke: 1, pan: 10, level: -2 },
    { sound: 'hatOpen', decay: 0.28, choke: 1, pan: 10, level: -4 },
    { sound: 'ride', tone: 60, pan: -15, level: -8 },
    { sound: 'shaker', pan: -20, level: 6 },
  ],
  // 16 eighths of the first two bars; each can last up to four eighths
  amen: Array.from({ length: 16 }, (_, k) => ({ sound: 'amen', at: k * EIGHTH_S, decay: 4 * EIGHTH_S, choke: 1 })),
  glitch: [
    { sound: 'amen', at: 0, tune: -5, decay: 0.15, choke: 1 },
    { sound: 'amen', at: 2 * EIGHTH_S, decay: 0.12, choke: 1 },
    { sound: 'amen', at: 2 * EIGHTH_S, tune: 12, decay: 0.06, choke: 1, level: -3 },
    { sound: 'amen', at: 2 * EIGHTH_S, decay: 0.34, reverse: true, choke: 1 },
    { sound: 'amen', at: 0, decay: BAR_S, reverse: true, choke: 1 },
    { sound: 'amen', at: 3 * EIGHTH_S, decay: 0.05, choke: 1, tone: 62 },
    { sound: 'amenCrush', at: 0, decay: 0.17, choke: 1 },
    { sound: 'amenCrush', at: 0, decay: BAR_S, choke: 1, level: -2 },
    { sound: 'amenGlitch', at: 0, decay: BAR_S, choke: 1, level: -2 },
    { sound: 'amenGlitch', at: BAR_S, decay: BAR_S, choke: 1, level: -2 },
    { sound: 'amen', at: 0, tune: -12, decay: 0.25, choke: 1 },
    { sound: 'amen', at: 2 * EIGHTH_S, tune: -7, decay: 0.2, choke: 1 },
    { sound: 'amen', at: 2 * EIGHTH_S, tune: 5, decay: 0.17, reverse: true, choke: 1 },
    { sound: 'amen', at: 3 * BAR_S, decay: BAR_S, choke: 1 },
    { sound: 'amen', at: 3 * EIGHTH_S, tune: 7, decay: 0.03, choke: 1, tone: 65 },
    { sound: 'amen', at: 3 * BAR_S + 4 * EIGHTH_S / 2, decay: 0.1, choke: 1 },
  ],
  vox: [
    { sound: 'vocal', decay: 4.6, choke: 2 },
    ...SYLLABLES.map(at => ({ sound: 'vocal' as const, at, decay: 0.38, choke: 1 })),
    { sound: 'vocal', decay: 4.5, reverse: true, choke: 2, level: -2 },
    { sound: 'vocal2', at: 27.4, decay: 2.45, choke: 2 },
    { sound: 'pazzi', at: 0.45, decay: 1.1, level: 4 },
    { sound: 'aiutarmi', level: 6, snap: 25 },
    { sound: 'voiceCut', level: -6 },
    { sound: 'vox', level: 2 },
    { sound: 'stacco', at: 1.0, decay: 1.0, level: 6 },
  ],
  fx: [
    { sound: 'riser', level: -3 },
    { sound: 'sweepUp', level: -3 },
    { sound: 'downlifter', level: -4 },
    { sound: 'crash', tone: 58, level: -2 },
    { sound: 'impact', level: 0 },
    { sound: 'laser', decay: 1.6, tone: 60, level: -8, pan: 25 },
    { sound: 'tension', level: -4 },
  ],
} satisfies Record<string, readonly PadSound<PazziLiveSound>[]>;

/** The pads by name. */
const SNARE = { main: 0, body: 1, roll: 2 } as const;
const HATS = { closed: 0, open: 1, ride: 2, shaker: 3 } as const;
const VOX = { phrase: 0, syllable: 1, reverse: 9, phrase2: 10, pazzi: 11, aiutarmi: 12, cut: 13, vox: 14, stacco: 15 } as const;
const FX = { riser: 0, sweepUp: 1, downlifter: 2, crash: 3, impact: 4, laser: 5, tension: 6 } as const;
const G = { kick: 0, snare: 1, snareHi: 2, snareRev: 3, barRev: 4, tick: 5, crush: 6, crushBar: 7, glitchA: 8, glitchB: 9, drop: 10, snareLo: 11, snareRevHi: 12, bar4: 13, tickHi: 14, snare4: 15 } as const;

// ------------------------------------------------------------------ the Analog sounds

const ANALOG_SOUNDS = {
  sub: {
    oscA: 3, mix: 0, voiceMode: VOICE_MODE.legato, glide: 25, cutoff: 300, resonance: 0, filterEnv: 0, keyTrack: 0,
    attack: 0.004, decay: 0.3, sustain: 100, release: 0.06, velocity: 0, volume: -4,
  },
  // two saws detuned by 35 cents: the slow beating is the reese
  reese: {
    oscA: 0, oscB: 0, oscBSemi: 0, oscBFine: 35, mix: 50, voiceMode: VOICE_MODE.legato, glide: 60,
    cutoff: 2600, resonance: 20, filterEnv: 15, fDecay: 0.4, fSustain: 60, keyTrack: 35,
    lfoWave: 0, lfoRate: 0.35, lfoCutoff: 30, attack: 0.005, sustain: 100, release: 0.1, velocity: 0, volume: -8,
  },
  pad: {
    oscA: 0, oscB: 0, oscBFine: 12, mix: 50, cutoff: 1600, resonance: 15, filterEnv: 20, fAttack: 0.6, fDecay: 1.5, fSustain: 60,
    attack: 0.5, decay: 1, sustain: 85, release: 1.6, lfoRate: 0.25, lfoCutoff: 12, velocity: 20, volume: -14,
  },
} satisfies Record<string, ParamValues>;

// ------------------------------------------------------------------ tracce ed effetti

/** The amen's EQ: cuts the lows (they belong to kick and sub) and has the low-pass ready for the
 *  openings (band 8, modulated by the clips). */
const AMEN_FILTER = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: 160, [bandParam(7, 'on')]: 1, [bandParam(7, 'freq')]: 20000 };

const TRACKS: readonly TrackSpec<PazziLiveSound, TrackKey>[] = [
  { key: 'kick', name: 'Cassa', volumeDb: -3, kit: KITS.kick, effects: [compressor('Punch', { threshold: -14, ratio: 3, attack: 20, release: 60, auto: 0 })] },
  {
    key: 'snare', name: 'Rullante', volumeDb: -3, kit: KITS.snare,
    effects: [
      compressor('Punch batteria', { threshold: -18, ratio: 4, attack: 15, release: 80, scHp: 120, auto: 0, makeup: 0 }),
      reverb('Piatto', { size: 45, decay: 1, predelay: 5, damping: 9000, lowCut: 300, mix: 14 }),
    ],
  },
  {
    key: 'amen', name: 'Amen', volumeDb: -5, kit: KITS.amen,
    effects: [
      eq('Filtro amen', AMEN_FILTER),
      // heavy parallel compression: jungle's classic "squashed" sound
      compressor('Schiaccia', { threshold: -30, ratio: 10, attack: 1, release: 50, mix: 45, makeup: 6, auto: 0 }),
      drive('Nastro', { shape: SHAPE.tape, drive: 6, low: 100, mix: 50 }),
      delay('Largo', { sync: 1, time: 11, feedback: 0, pingPong: 1, lowCut: 800, mix: 18 }),
    ],
  },
  {
    key: 'glitch', name: 'Glitch', volumeDb: -11, kit: KITS.glitch,
    effects: [lowCut(120), delay('Eco 1/16', { division: 2, pingPong: 1, feedback: 30, lowCut: 400, mix: 14 }), reverb('Stanza', { size: 30, decay: 0.6, mix: 12 })],
  },
  { key: 'hats', name: 'Piatti', volumeDb: -14, kit: KITS.hats, effects: [lowCut(400)] },
  { key: 'sub', name: 'Sub', volumeDb: -10, analog: ANALOG_SOUNDS.sub, effects: [compressor('Basso', { threshold: -16, ratio: 3, attack: 10, release: 100, detector: DETECTOR.rms, auto: 0 })] },
  {
    key: 'reese', name: 'Reese', volumeDb: -8, analog: ANALOG_SOUNDS.reese,
    effects: [
      drive('Piega', { shape: SHAPE.fold, drive: 18, color: 30, low: 0, tone: 10000, mix: 80 }),
      lowCut(110),
      compressor('Basso', { threshold: -20, ratio: 5, attack: 8, release: 90, detector: DETECTOR.rms, auto: 0, makeup: 3 }),
      // a very short echo on one side only (Haas): the harmonics widen, the centre stays
      delay('Largo', { sync: 1, time: 14, feedback: 0, pingPong: 1, lowCut: 700, highCut: 12000, mix: 22 }),
    ],
  },
  { key: 'pad', name: 'Pad', volumeDb: -11, analog: ANALOG_SOUNDS.pad, effects: [lowCut(250), reverb('Sala', { size: 80, decay: 3.5, predelay: 30, damping: 6000, lowCut: 300, mix: 40 })] },
  {
    key: 'vox', name: 'Voci', volumeDb: -4, kit: KITS.vox,
    effects: [
      lowCut(150),
      compressor('Voce', { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms, auto: 0, makeup: 3 }),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 35, lowCut: 400, highCut: 5000, mix: 16 }),
      reverb('Lancio voce', { size: 85, decay: 4, predelay: 50, damping: 5000, lowCut: 300, mix: 22 }),
    ],
  },
  { key: 'fx', name: 'FX', volumeDb: -9, kit: KITS.fx, effects: [lowCut(120), reverb('Sala', { size: 75, decay: 2.8, predelay: 20, mix: 20 })] },
];

// ------------------------------------------------------------------ le parti

/** The bars of a sliced loop, one string per bar. */
const chops = (lines: readonly string[], velocity = 110): Note[] => lines.flatMap((l, k) => chop(l, k * BAR, velocity));

const AMEN = {
  straight: ['0 . 1 . 2 . 3 . 4 . 5 . 6 . 7 .', '8 . 9 . 10 . 11 . 12 . 13 . 14 . 15 .'],
  chopA: ['0 . 1 . 2 . 3 . 4 . 5 . 6 . 7 .', '8 . 9 . 10 . 10 . 12 . 13 . 14 14 6 .'],
  chopB: ['0 . 0 . 2 . 3 . 0 . 5 . 6 . 6 2', '8 . 9 . 10 . 11 . 4 4 13 . 14 . 14 14'],
};

/** The eight-bar glitch: the already glitched amen, the "decimated" one, reverse swells,
 *  pitched snare rolls. */
const GLITCH_SECTION = [
  ...chops([
    '8 . . . . . . . . . . . 2 2 2 2',
    '0 . 1 . 5 5 1 . 10 . . . 3 . . .',
    '7 . . . . . . . 6 . 6 . 6 6 6 6',
    '4 . . . . . . . . . . . . . . .',
    '13 . . . . . . . 1 1 1 1 2 2 2 2',
    '0 . 5 5 1 . 0 0 11 . 5 . 1 . 12 .',
    '9 . . . . . . . 14 14 14 14 14 14 14 14',
    '10 . . . 1 1 1 1 2 2 2 2 . . . .',
  ]),
  ...roll(G.snareHi, 31, 8, 0.125, [90, 127]),
];

/** Two one-bar fills (to put at the end of a round): a reverse swell with a
 *  roll, one with the collapsing kick and the stutters. */
const fillA = (at: Beats): Note[] => [...steps(G.barRev, 'x', at), ...roll(G.snareHi, at + 3, 8, 0.125, [80, 127])];
const fillB = (at: Beats): Note[] => [
  ...steps(G.drop, 'X', at), ...steps(G.snareLo, 'x', at + 1), ...roll(G.tickHi, at + 2, 8, 0.125, [70, 120]), ...steps(G.snareRev, 'x', at + 3.5),
];

/** The G# minor notes needed (MIDI). */
const N = { E1: 28, Fs1: 30, Gs1: 32, B1: 35 };

/** The reese: four bars in G#, slides on the tails (the "~" notes slide into the next). */
const REESE = acid(`
  g#2 -  -  -   -  -  -  -    -  -  g#2 -   -  -  b2~ a#2 |
  g#2 -  -  -   -  -  -  -    -  -  d#3~ c#3 -  -  b2 -  |
  g#2 -  -  -   -  -  -  -    -  -  g#2 -   -  -  b2~ a#2 |
  e2  -  -  -   -  -  -  -    f#2 -  -  -   d#2~ e2 -  -`);

/** The sub: the same notes an octave down, without slides (it stays still and clean). */
const SUB = REESE.map(n => ({ ...n, pitch: n.pitch - 12, duration: Math.max(n.duration, 0.4) }));

/** The chords: G#m for two bars, B, then E and F#. */
const chord = (pitches: readonly number[], start: Beats, duration: Beats): Note[] => pitches.map(pitch => ({ pitch, start, duration, velocity: 90 }));
const CHORDS = [...chord([56, 59, 63], 0, 8), ...chord([54, 59, 63], 8, 4), ...chord([52, 56, 59], 12, 2), ...chord([54, 58, 61], 14, 2)];

const KICK_BAR = 'X.........X.....';
const SNARE_BAR = '....X.......X...';
/** Where kick and snare fall in four bars (for the pump). */
const KICKS = [0, 1, 2, 3].flatMap(b => [b * 4, b * 4 + 2.5]);
const SNARES = [0, 1, 2, 3].flatMap(b => [b * 4 + 1, b * 4 + 3]);

const PARTS = {
  kick: bars(0, KICK_BAR, 4, 'X.........X..x..'),
  kickHalf: bars(0, 'X...............', 4, 'X.......X.X.....'),
  snare: [...bars(SNARE.main, SNARE_BAR, 4, '....X.......X.xx'), ...bars(SNARE.body, SNARE_BAR, 4)],
  snareHalf: [...bars(SNARE.main, '........X.......', 4), ...bars(SNARE.body, '........X.......', 4)],
  /** The roll of the rise: quarters, eighths, sixteenths, thirty-seconds, louder and louder. */
  snareRoll: [
    ...roll(SNARE.roll, 0, 8, 1, [60, 80]), ...roll(SNARE.roll, 8, 16, 0.5, [80, 96]),
    ...roll(SNARE.roll, 16, 32, 0.25, [96, 112]), ...roll(SNARE.roll, 24, 64, 0.125, [110, 127]),
  ],
  hats: [...bars(HATS.closed, 'x.X.x.Xox.X.x.Xo', 4, 'x.X.x.Xox.X.x.X.'), ...steps(HATS.open, '..............x.', 12)],
  hatsDrop: [
    ...bars(HATS.closed, 'x.X.x.Xox.X.x.Xo', 4, 'x.X.x.Xox.X.x.X.'), ...steps(HATS.open, '..............x.', 12),
    ...bars(HATS.ride, 'x...x...x...x...', 4), ...bars(HATS.shaker, 'oooooooooooooooo', 4),
  ],
  /** The syllables in the drop: the hook halfway through the second round, a trill of syllables at the end. */
  voxDrop: [
    ...steps(VOX.syllable, 'X..x', 6), ...steps(VOX.syllable + 4, 'x.x.x..x', 13),
  ],
  voxDropB: [
    ...steps(VOX.syllable, 'X..x', 6), ...roll(VOX.syllable + 1, 14, 4, 0.25, [90, 120]), ...roll(VOX.syllable + 1, 15, 8, 0.125, [100, 127]),
  ],
  voxGlitch: [
    ...roll(VOX.syllable + 2, 4, 8, 0.25, [90, 120]), ...roll(VOX.syllable + 5, 12, 16, 0.125, [80, 127]),
    ...steps(VOX.cut, 'x', 20), ...roll(VOX.syllable, 28, 16, 0.125, [80, 127]), ...roll(VOX.syllable + 7, 30, 16, 0.0625, [90, 127]),
  ],
};

// ------------------------------------------------------------------ modulazioni

/** The pump: reese and pad breathe on kicks and snares, the sub only on the kicks. */
const pump = (length: Beats, depth: number, release: Beats, hits: readonly Beats[]): ModSpec => ({
  target: VOLUME, points: duck(Array.from({ length: length / 16 }, (_, k) => hits.map(h => h + 16 * k)).flat(), depth, release),
});
const REESE_PUMP = (length: Beats) => pump(length, 0.6, 0.4, [...KICKS, ...SNARES]);
const SUB_PUMP = (length: Beats) => pump(length, 0.5, 0.35, KICKS);
const PAD_PUMP = (length: Beats) => pump(length, 0.5, 0.6, [...KICKS, ...SNARES]);

/** The amen's low-pass (EQ band 8, effect 1): values in fractions of the knob,
 *  −0.45 ≈ 900 Hz, −0.55 ≈ 450 Hz. */
const AMEN_LP = (...points: (readonly [Beats, number])[]): ModSpec => ({ target: effectParam(0, bandParam(7, 'freq')), points: curve(...points) });

// ------------------------------------------------------------------ clip e scene

const C = {
  kick: clip('Cassa', PARTS.kick, 16),
  snare: clip('Rullante', PARTS.snare, 16),
  hats: clip('Piatti', PARTS.hats, 16),
  hatsDrop: clip('Piatti pieni', PARTS.hatsDrop, 16),
  amenDrop: clip('Amen chop', chops([...AMEN.chopA, ...AMEN.chopB], 100), 16),
  amenStraight: clip('Amen', chops([...AMEN.straight, ...AMEN.straight]), 16),
  sub: clip('Sub', SUB, 16, [SUB_PUMP(16)]),
  reese: clip('Reese', REESE, 16, [REESE_PUMP(16)]),
  pad: clip('Accordi', CHORDS, 16, [PAD_PUMP(16)]),
  /** The glitch fills at the end of the eighth and sixteenth bar. */
  glitchFills: clip('Riempimenti', [...fillA(28), ...fillB(60)], 64),
  crash: clip('Crash', [...steps(FX.crash, 'X'), ...steps(FX.impact, 'x')], 64),
};

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16, clips: {
      // the amen closed by the low-pass, which opens in the last eight bars
      amen: clip('Amen chiuso', repeat(chops([...AMEN.straight, ...AMEN.straight]), 16, 4), 64, [AMEN_LP([0, -0.45], [32, -0.4], [64, -0.12])]),
      pad: clip('Accordi', repeat(CHORDS, 16, 4), 64),
      vox: clip('Frase', [...steps(VOX.phrase, 'x', 0), ...steps(VOX.phrase, 'x', 32)], 64),
      fx: clip('Impatto', steps(FX.impact, 'x'), 64),
    },
  },
  {
    name: 'Salita', bars: 8, clips: {
      amen: clip('Amen aperto', repeat(chops([...AMEN.straight, ...AMEN.straight]), 16, 2), 32, [AMEN_LP([0, -0.25], [32, 0])]),
      snare: clip('Rullo', PARTS.snareRoll, 32, [{ target: instrumentParam(padParam(SNARE.roll, 'tune')), points: curve([0, 0], [16, 0.05], [32, 0.25]) }]),
      pad: clip('Accordi', repeat(CHORDS, 16, 2), 32),
      vox: clip('Sillabe in salita', [...steps(VOX.phrase, 'x', 0), ...roll(VOX.syllable, 28, 8, 0.25, [80, 110]), ...roll(VOX.syllable, 30, 16, 0.125, [100, 127])], 32),
      // the riser lasts exactly eight bars at 175
      fx: clip('Riser', steps(FX.riser, 'x'), 32),
    },
  },
  { name: 'Stacco', bars: 1, clips: { vox: clip('Siete pazzi', steps(VOX.pazzi, 'X'), 4) } },
  {
    name: 'Drop', bars: 16, clips: {
      kick: C.kick, snare: C.snare, hats: C.hats, amen: C.amenDrop, sub: C.sub, reese: C.reese,
      vox: clip('Sillabe', PARTS.voxDrop, 16), fx: C.crash,
    },
  },
  {
    name: 'Drop B', bars: 16, clips: {
      kick: C.kick, snare: C.snare, hats: C.hatsDrop, amen: C.amenDrop, sub: C.sub, glitch: C.glitchFills,
      reese: clip('Reese mosso', REESE, 16, [REESE_PUMP(16), { target: instrumentParam('cutoff'), points: curve([0, 0], [8, 0.12], [12, -0.05], [16, 0.15]) }]),
      vox: clip('Sillabe B', PARTS.voxDropB, 16),
      fx: clip('Laser', steps(FX.laser, 'x', 28), 64),
    },
  },
  {
    name: 'Glitch', bars: 8, clips: {
      kick: clip('Cassa a metà', PARTS.kickHalf, 16), snare: clip('Rullante a metà', PARTS.snareHalf, 16),
      glitch: clip('Glitch', GLITCH_SECTION, 32),
      // the chopped amen: thirty-seconds in the third and fourth bar, sixteenths in the seventh
      amen: clip('Amen a scatti', chops([...AMEN.chopB, ...AMEN.chopB, ...AMEN.chopB, ...AMEN.chopB], 100), 32, [{ target: VOLUME, points: [...gate(8, 16, 0.125), ...gate(24, 28, 0.25)] }]),
      reese: clip('Reese a scatti', repeat(REESE, 16, 2), 32, [{ target: VOLUME, points: [...gate(4, 8, 0.25), ...gate(12, 16, 0.125), ...gate(28, 32, 0.0625)] }]),
      sub: clip('Sub', repeat(SUB, 16, 2), 32, [SUB_PUMP(32)]),
      vox: clip('Sillabe glitch', PARTS.voxGlitch, 32),
      fx: clip('Salita', steps(FX.sweepUp, 'x', 13), 32),
    },
  },
  {
    name: 'Pausa', bars: 16, clips: {
      pad: clip('Accordi', repeat(CHORDS, 16, 4), 64),
      // the reversed phrase arrives inside the real phrase
      vox: clip('Frase e ritorno', [...steps(VOX.phrase, 'x', 0), ...steps(VOX.reverse, 'x', 18.875), ...steps(VOX.phrase, 'x', 32), ...steps(VOX.phrase2, 'x', 48)], 64),
      // the sub held under the pause, lower than in the drops
      sub: clip('Sub lungo', [
        { pitch: N.Gs1, start: 0, duration: 8, velocity: 100 }, { pitch: N.B1, start: 8, duration: 4, velocity: 100 },
        { pitch: N.E1, start: 12, duration: 2, velocity: 100 }, { pitch: N.Fs1, start: 14, duration: 2, velocity: 100 },
      ], 16, [{ target: VOLUME, points: curve([0, 0.6]) }]),
      amen: clip('Amen lontano', repeat(chops([...AMEN.straight, ...AMEN.straight], 90), 16, 4), 64, [AMEN_LP([0, -0.6], [32, -0.55], [64, -0.15])]),
      fx: clip('Discesa e riser', [...steps(FX.downlifter, 'x'), ...steps(FX.riser, 'x', 32)], 64),
    },
  },
  { name: 'Stacco 2', bars: 1, clips: { vox: clip('Volete aiutarmi', steps(VOX.aiutarmi, 'X'), 4), fx: clip('Tensione', steps(FX.tension, 'x'), 4) } },
  {
    name: 'Drop 2', bars: 16, clips: {
      kick: C.kick, snare: C.snare, hats: C.hatsDrop, amen: C.amenDrop, sub: C.sub, glitch: C.glitchFills,
      reese: clip('Reese sporco', REESE, 16, [REESE_PUMP(16), { target: effectParam(0, 'drive'), points: curve([0, 0.05], [16, 0.2]) }]),
      vox: clip('Seconda frase', [...steps(VOX.phrase2, 'x', 0), ...PARTS.voxDrop.filter(n => n.start >= 12)], 16),
      fx: C.crash,
    },
  },
  {
    name: 'Drop 2B', bars: 16, clips: {
      kick: C.kick, snare: C.snare, hats: C.hatsDrop, sub: C.sub,
      amen: clip('Amen chop B', chops([...AMEN.chopB, ...AMEN.chopA], 105), 16),
      glitch: clip('Riempimenti fitti', [...fillB(12), ...fillA(28), ...fillB(44), ...fillA(60)], 64),
      reese: clip('Reese aperto', REESE, 16, [REESE_PUMP(16), { target: instrumentParam('cutoff'), points: curve([0, 0.1], [16, 0.22]) }]),
      vox: clip('Sillabe B', PARTS.voxDropB, 16),
      pad: C.pad,
    },
  },
  {
    name: 'Fine', bars: 16, clips: {
      kick: C.kick, snare: C.snare, hats: C.hats,
      amen: clip('Amen che si chiude', repeat(chops([...AMEN.straight, ...AMEN.chopA]), 16, 4), 64, [AMEN_LP([0, 0], [32, -0.1], [64, -0.5])]),
      vox: clip('Ultima frase', steps(VOX.phrase, 'x', 32), 64),
      fx: clip('Discesa', steps(FX.downlifter, 'x'), 64),
    },
  },
];

/** The "recording": rise, stab, two drops, the glitch, the pause, the second stab, the
 *  second drop and the end. */
const ARRANGEMENT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const PAZZI_LIVE: LiveSpec<PazziLiveSound, TrackKey> = {
  name: 'Siete pazzi',
  bpm: PAZZI_LIVE_BPM,
  master: {
    volumeDb: 0,
    effects: [
      lowCut(25),
      compressor('Colla', { threshold: -14, ratio: 2, knee: 10, attack: 30, release: 150, scHp: 90, auto: 0, makeup: 1.5 }),
      limiter('Master', { gain: 7.5, ceiling: -0.5, release: 60, lookahead: 2 }),
    ],
  },
  tracks: TRACKS,
  scenes: SCENES,
  arrangement: ARRANGEMENT,
};

/** Builds the live in the store's (empty) project. */
export function buildPazziLive(store: ProjectStore, sounds: Readonly<Record<PazziLiveSound, SampleRef>>): void {
  buildLive(store, PAZZI_LIVE, sounds);
}

