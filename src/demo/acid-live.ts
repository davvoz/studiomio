/* "Acido crudo": a small hard acid live at 150 BPM in A, made to play in the session.
 * The drums are the user's samples on the pads of four Drum Machines (kick, clap and
 * snares, cymbals, percussion) plus one for the effects (riser, crash, siren); the acid lines
 * are two monophonic Analogs with slides and accents, distorted by the Drive; the rumble is a sine
 * rolling on the offbeat sixteenths, between one kick and the next, saturated.
 *
 * The parts are written the way you program a drum machine or a 303 (see patterns.ts),
 * the ten scenes are the live's sections and the timeline holds a "recording" of about
 * 4 minutes, the same clips one after the other. The samples arrive ready (SampleRef):
 * whoever builds the project copies them into the folder (see scripts/build-acid-live.ts). */
import { SHAPE } from '../devices/effects/drive/drive';
import { VOICE_MODE } from '../devices/instruments/analog/analog';
import { padNote, padParam } from '../devices/instruments/drums/drums';
import type { ParamValues } from '../model/device';
import type { SampleRef } from '../model/sample';
import type { ProjectStore } from '../store/project-store';
import {
  buildLive, clip, delay, drive, effectParam, instrumentParam, lowCut, VOLUME, type LiveSpec, type PadSound,
  type SceneSpec, type TrackSpec,
} from './live-builder';
import { acid, BAR, bars, curve, repeat, steps } from './patterns';

export const ACID_LIVE_BPM = 150;

/** The sounds the live uses, by role (whoever builds the project gives the file for each). */
export const ACID_LIVE_SOUNDS = [
  'kick', 'kickHard', 'kickDeep',
  'clap', 'snare', 'snareRoll',
  'hatClosed', 'hatOpen', 'ride', 'hatAlt',
  'perc', 'metal', 'tom', 'stab',
  'crash', 'blast', 'siren', 'riser', 'downlifter', 'sweepUp', 'laser',
] as const;

export type AcidLiveSound = (typeof ACID_LIVE_SOUNDS)[number];

// ------------------------------------------------------------------ le parti

/** The pads of each Drum Machine, by name. */
const KICK = { main: 0, hard: 1, deep: 2 } as const;
const CLAP = { clap: 0, snare: 1, roll: 2 } as const;
const HATS = { closed: 0, open: 1, ride: 2, alt: 3 } as const;
const PERC = { perc: 0, metal: 1, tom: 2, stab: 3 } as const;
const FX = { crash: 0, blast: 1, siren: 2, riser: 3, downlifter: 4, sweepUp: 5, laser: 6 } as const;

const A1 = 33;

const PARTS = {
  kickDeep: bars(KICK.deep, 'x...x...x...x...', 4),
  kick: bars(KICK.main, 'X...x...x...x...', 4, 'X...x...x...x.o.'),
  // the hammer: the hard kick under the main one, and a kick roll at the end of the round
  kickHammer: [...bars(KICK.main, 'X...x...x...x...', 4, 'X...x...x.x.xxxx'), ...bars(KICK.hard, 'x...x...x...x...', 4, 'x...x...x.......')],
  /** The rumble: a sine rolling on the offbeat, after the kick's body (which sits in the first
   *  250 ms of the beat: there the rumble would cover it). */
  rumble: repeat([0.5, 0.75].map((at, k) => ({ pitch: A1, start: at, duration: 0.2, velocity: [120, 104][k] })), 1, 16),
  rumbleHammer: repeat([0.375, 0.5, 0.75].map((at, k) => ({ pitch: k === 2 ? A1 + 12 : A1, start: at, duration: k ? 0.2 : 0.1, velocity: [90, 127, 104][k] })), 1, 16),
  clap: [...bars(CLAP.clap, '....X.......X...', 4), ...bars(CLAP.snare, '....x.......x...', 4, '....x.......x.oo')],
  clapHammer: [...bars(CLAP.clap, '....X.......X...', 4), ...bars(CLAP.snare, '....x.....o.x..o', 4, '....x.....o.xoxx')],
  /** The break's roll: from quarters to sixteenths in 8 bars, louder and louder. */
  snareRoll: [
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(b => ({ pitch: padNote(CLAP.roll), start: b, duration: 0.25, velocity: 60 + b * 2 })),
    ...Array.from({ length: 16 }, (_, k) => ({ pitch: padNote(CLAP.roll), start: 8 + k * 0.5, duration: 0.25, velocity: 76 + k })),
    ...Array.from({ length: 32 }, (_, k) => ({ pitch: padNote(CLAP.roll), start: 16 + k * 0.25, duration: 0.2, velocity: 92 + k * 0.6 })),
    ...Array.from({ length: 32 }, (_, k) => ({ pitch: padNote(CLAP.roll), start: 24 + k * 0.25, duration: 0.2, velocity: 112 + k * 0.5 })),
  ],
  hatsIntro: bars(HATS.closed, '..x...x...x...x.', 4),
  hats: bars(HATS.closed, 'o.x.o.x.o.x.o.xo', 4),
  /** Full: open on the offbeat, closed on the sixteenths around (the choke stops the open one). */
  hatsFull: [...bars(HATS.open, '..x...x...x...x.', 4), ...bars(HATS.closed, 'oo.ooo.ooo.ooo.o', 4)],
  hatsDrop: [...bars(HATS.open, '..x...x...x...x.', 4), ...bars(HATS.closed, 'oo.ooo.ooo.ooo.o', 4), ...bars(HATS.ride, 'x...x...x...x...', 4)],
  hatsHammer: [...bars(HATS.alt, 'xoXoxoXoxoXoxoXo', 4), ...bars(HATS.ride, '..x...x...x...x.', 4)],
  perc: [...bars(PERC.perc, '...x..x....x.x..', 4), ...bars(PERC.metal, '................', 4, '..............x.')],
  percFull: [...bars(PERC.perc, '...x..x....x.x..', 4), ...bars(PERC.metal, '.......x........', 4), ...bars(PERC.stab, '................', 4, 'x...............')],
  /** The tom pushing in the break's last bar. */
  tomFill: steps(PERC.tom, 'x.......x...x.x.' + 'x.x.x.x.xxxxxxxx', 6 * BAR),
};

/** The acid lines, in A: root, octaves, the minor third and the scratching flat second. */
const ACID = {
  intro: repeat(acid(`
    A2 a2 a3~ g3   a2 .  C3 a2   a2 A3 .  a2   eb3~ e3 a2 g2 |
    A2 a2 a3~ g3   a2 .  C3 a2   bb2~ a2 . A3   a2 c3 E3~ g3`), 8, 4),
  full: repeat(acid(`
    A2 A3 a2 a2~   c3 a2 G3 a2   A2 a2~ bb2 a2  E3 a2 a3~ g3 |
    A2 a2 C3~ a2   a3 .  a2 G3   a2 A3 a2 eb3   e3~ a2 C3 g2`), 8, 4),
  hammer: repeat(acid(`
    A2 a2 A3 a2    a2 A2 a3 a2   A2 a2 A3 a2    G2~ a2 C3 a2 |
    A2 a2 A3 a2    a2 A2 a3 a2   A2 a2 A3 a2    E3~ eb3 a2 A3`), 8, 4),
  /** The second: square, an octave up, hypnotic. */
  lead: repeat(acid(`
    A3 .  a3 c4~   a3 .  G3 .    a3 e4~ eb4 .   A3 .  c4 . |
    A3 .  a3 c4~   a3 .  G3 a3   .  A4~ g4 e4   .  C4 bb3~ a3`), 8, 4),
};

// ------------------------------------------------------------------ i suoni

const KITS: Readonly<Record<string, readonly PadSound<AcidLiveSound>[]>> = {
  // the starting kicks are almost in G#: a semitone up, in A like the rumble
  kick: [
    { sound: 'kick', tune: 1, decay: 0.36, snap: 15 },
    { sound: 'kickHard', decay: 0.32, tone: 62, level: -8 },
    { sound: 'kickDeep', tune: 1, level: -1 },
  ],
  clap: [
    { sound: 'clap', level: 0 },
    { sound: 'snare', decay: 0.3, tone: 58, level: -7, pan: 8 },
    { sound: 'snareRoll', tone: 60, level: -4 },
  ],
  hats: [
    { sound: 'hatClosed', decay: 0.12, choke: 1, pan: 12, level: -3 },
    { sound: 'hatOpen', decay: 0.3, choke: 1, pan: 12, level: -4 },
    { sound: 'ride', tone: 62, pan: -18, level: -9 },
    { sound: 'hatAlt', decay: 0.09, tone: 60, pan: -10, level: -6 },
  ],
  perc: [
    { sound: 'perc', pan: -25, level: 0 },
    { sound: 'metal', decay: 0.7, tone: 58, pan: 30, level: -6 },
    { sound: 'tom', tune: 0, level: -2 },
    { sound: 'stab', decay: 0.8, pan: 20, level: -5 },
  ],
  fx: [
    { sound: 'crash', tone: 57, level: 0 },
    { sound: 'blast', level: -4 },
    { sound: 'siren', tone: 62, decay: 4, level: -12, pan: -15 },
    { sound: 'riser', level: 6 },
    { sound: 'downlifter', level: -4 },
    { sound: 'sweepUp', level: -5 },
    { sound: 'laser', decay: 1.6, tone: 60, level: -10, pan: 25 },
  ],
};

const ANALOG_SOUNDS = {
  rumble: {
    oscA: 3, mix: 0, voiceMode: VOICE_MODE.poly, cutoff: 260, resonance: 10, filterEnv: 25, keyTrack: 0, fDecay: 0.1, fSustain: 0,
    attack: 0.003, decay: 0.12, sustain: 35, release: 0.05, velocity: 45, volume: -3,
  },
  acid: {
    oscA: 0, mix: 0, voiceMode: VOICE_MODE.legato, glide: 55, accent: 80, cutoff: 480, resonance: 86, filterEnv: 72, keyTrack: 20,
    fDecay: 0.2, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.04, velocity: 35, volume: -8,
  },
  lead: {
    oscA: 1, mix: 0, voiceMode: VOICE_MODE.legato, glide: 70, accent: 85, cutoff: 650, resonance: 84, filterEnv: 62, keyTrack: 25,
    fDecay: 0.26, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.04, velocity: 35, volume: -11,
  },
} satisfies Record<string, ParamValues>;

// ------------------------------------------------------------------ tracks and scenes

type TrackKey = 'kick' | 'rumble' | 'acid' | 'lead' | 'clap' | 'hats' | 'perc' | 'fx';

const TRACKS: readonly TrackSpec<AcidLiveSound, TrackKey>[] = [
  { key: 'kick', name: 'Cassa', volumeDb: -2, kit: KITS.kick, effects: [drive('Crudo', { shape: SHAPE.hard, drive: 10, color: 20, low: 70, split: 110, tone: 15000, mix: 45 })] },
  {
    key: 'rumble', name: 'Rumble', volumeDb: -4, analog: ANALOG_SOUNDS.rumble,
    effects: [drive('Rumble', { shape: SHAPE.tube, drive: 22, bias: 20, low: 25, split: 80, tone: 1400 })],
  },
  {
    key: 'acid', name: 'Acido', volumeDb: -3, analog: ANALOG_SOUNDS.acid,
    effects: [
      drive('Acido crudo', { shape: SHAPE.hard, drive: 18, bias: 12, color: 25, low: 15, split: 150, tone: 9000 }),
      lowCut(90),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 38, lowCut: 300, highCut: 4500, mix: 16 }),
    ],
  },
  {
    key: 'lead', name: 'Acido 2', volumeDb: -6, pan: 0.1, analog: ANALOG_SOUNDS.lead,
    effects: [
      drive('Fuzz', { shape: SHAPE.fuzz, drive: 22, low: 40, tone: 7500, mix: 80 }),
      lowCut(160),
      delay('Eco 1/16.', { division: 4, pingPong: 1, feedback: 32, lowCut: 400, highCut: 5000, mix: 14 }),
    ],
  },
  {
    key: 'clap', name: 'Clap', volumeDb: -4, kit: KITS.clap,
    effects: [lowCut(150), delay('Spazio', { division: 5, feedback: 18, lowCut: 500, highCut: 6000, mix: 10 })],
  },
  { key: 'hats', name: 'Piatti', volumeDb: -8, kit: KITS.hats, effects: [lowCut(300)] },
  { key: 'perc', name: 'Percussioni', volumeDb: -3, kit: KITS.perc, effects: [lowCut(200), delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 42, lowCut: 500, mix: 22 })] },
  { key: 'fx', name: 'FX', volumeDb: -4, kit: KITS.fx, effects: [lowCut(120), delay('Dub', { division: 9, pingPong: 1, feedback: 55, lowCut: 300, highCut: 2500, mix: 18 })] },
];

const CUTOFF = instrumentParam('cutoff'), RESONANCE = instrumentParam('resonance');

/** The clips that come back in several scenes. */
const C = {
  kick: clip('Cassa', PARTS.kick, 16),
  rumble: clip('Rumble', PARTS.rumble, 16),
  clap: clip('Clap', PARTS.clap, 16),
  hatsFull: clip('Piatti pieni', PARTS.hatsFull, 16),
  hatsDrop: clip('Piatti drop', PARTS.hatsDrop, 16),
  perc: clip('Perc', PARTS.perc, 16),
  percFull: clip('Perc piene', PARTS.percFull, 16),
  acidFull: clip('Acido pieno', ACID.full, 32, [
    { target: CUTOFF, points: curve([0, 0], [8, 0.18], [16, 0.02], [24, 0.26], [32, 0.04]) },
    { target: RESONANCE, points: curve([0, 0], [24, 0.08], [32, 0]) },
  ]),
  lead: clip('Acido 2', ACID.lead, 32, [{ target: CUTOFF, points: curve([0, -0.05], [16, 0.16], [32, -0.05]) }]),
};

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16, clips: {
      kick: clip('Cassa fonda', PARTS.kickDeep, 16),
      hats: clip('Piatti intro', PARTS.hatsIntro, 16),
      fx: clip('Sirena', steps(FX.siren, 'x'), 64),
    },
  },
  { name: 'Cassa e rumble', bars: 16, clips: { kick: C.kick, rumble: C.rumble, hats: clip('Piatti', PARTS.hats, 16), perc: C.perc } },
  {
    name: 'Entra l\'acido', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: clip('Piatti', PARTS.hats, 16), perc: C.perc, clap: C.clap,
      // the filter opens slowly over 8 bars
      acid: clip('Acido entra', ACID.intro, 32, [{ target: CUTOFF, points: curve([0, -0.16], [32, 0.12]) }]),
    },
  },
  { name: 'Acido pieno', bars: 16, clips: { kick: C.kick, rumble: C.rumble, hats: C.hatsFull, perc: C.percFull, clap: C.clap, acid: C.acidFull } },
  {
    name: 'Break', bars: 8, clips: {
      // no kick: the acid resonates and opens, the roll rises (in pitch too), the riser reaches the drop
      acid: clip('Acido break', ACID.intro, 32, [
        { target: CUTOFF, points: curve([0, -0.2], [24, 0.22], [32, 0.3]) },
        { target: RESONANCE, points: curve([0, 0.1], [32, 0.12]) },
      ]),
      clap: clip('Rullo', PARTS.snareRoll, 32, [{ target: instrumentParam(padParam(CLAP.roll, 'tune')), points: curve([0, 0], [16, 0.04], [32, 0.25]) }]),
      perc: clip('Tom', PARTS.tomFill, 32),
      // the riser lasts 27 and a half beats: it starts so as to end on the drop
      fx: clip('Riser', [{ pitch: padNote(FX.riser), start: 4.5, duration: 0.25, velocity: 120 }], 32),
    },
  },
  {
    name: 'Drop', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: C.hatsDrop, perc: C.percFull, clap: C.clap, acid: C.acidFull, lead: C.lead,
      fx: clip('Crash', [...steps(FX.crash, 'X'), ...steps(FX.blast, 'x')], 64),
    },
  },
  {
    name: 'Acido 2', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: C.hatsFull, perc: C.perc, clap: C.clap,
      // the second line alone; in the last bar the echo rises and launches it
      lead: clip('Acido 2 solo', ACID.lead, 32, [
        { target: CUTOFF, points: curve([0, 0], [16, 0.2], [28, 0.05], [32, 0.25]) },
        { target: effectParam(2, 'mix'), points: curve([0, 0], [28, 0], [28, 0.3], [32, 0.3]) },
      ]),
      fx: clip('Laser', [{ pitch: padNote(FX.laser), start: 60, duration: 0.25, velocity: 110 }], 64),
    },
  },
  {
    name: 'Martello', bars: 16, clips: {
      kick: clip('Cassa martello', PARTS.kickHammer, 16),
      rumble: clip('Rumble martello', PARTS.rumbleHammer, 16),
      hats: clip('Piatti martello', PARTS.hatsHammer, 16),
      clap: clip('Clap martello', PARTS.clapHammer, 16),
      perc: C.percFull,
      // the acid lower and dirtier: the Drive rises in steps, the filter with it
      acid: clip('Acido martello', ACID.hammer, 32, [
        { target: CUTOFF, points: curve([0, 0.04], [8, 0.04], [8, 0.12], [16, 0.12], [16, 0.08], [24, 0.08], [24, 0.2], [32, 0.2]) },
        { target: effectParam(0, 'drive'), points: curve([0, 0], [16, 0.12], [32, 0.3]) },
      ]),
    },
  },
  {
    name: 'Break 2', bars: 8, clips: {
      acid: clip('Acido sospeso', ACID.full, 32, [
        { target: CUTOFF, points: curve([0, 0.1], [16, -0.15], [32, 0.25]) },
        { target: effectParam(2, 'feedback'), points: curve([0, 0.3], [32, 0.3]) },
      ]),
      lead: clip('Acido 2 lontano', ACID.lead, 32, [{ target: VOLUME, points: curve([0, 0.35], [32, 0.8]) }]),
      hats: clip('Ride', bars(HATS.ride, 'x...x...x...x...', 8), 32),
      // the descent after the drop, then the climb leading to the next one
      fx: clip('Discesa e salita', [
        { pitch: padNote(FX.downlifter), start: 0, duration: 0.25, velocity: 115 },
        { pitch: padNote(FX.sweepUp), start: 16, duration: 0.25, velocity: 120 },
      ], 32),
    },
  },
  {
    name: 'Outro', bars: 16, clips: {
      kick: clip('Cassa fonda', PARTS.kickDeep, 16),
      hats: clip('Piatti', PARTS.hats, 16),
      perc: C.perc,
      // the acid closes and fades out over 16 bars
      acid: clip('Acido via', repeat(ACID.intro, 32, 2), 64, [
        { target: CUTOFF, points: curve([0, 0.05], [64, -0.25]) },
        { target: VOLUME, points: curve([0, 1], [48, 0.7], [64, 0]) },
      ]),
    },
  },
];

/** The order of the scenes in the "recording" on the timeline: the second break leads back to the drop. */
const ARRANGEMENT: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 5, 9];

/** The whole live; the master has headroom (the tracks are many and loud) and a light tape
 *  Drive that glues and holds the peaks. */
export const ACID_LIVE: LiveSpec<AcidLiveSound, TrackKey> = {
  name: 'Acido crudo',
  bpm: ACID_LIVE_BPM,
  master: { volumeDb: 0, effects: [drive('Colla', { shape: SHAPE.tape, drive: 3, low: 0, tone: 20000 })] },
  tracks: TRACKS,
  scenes: SCENES,
  arrangement: ARRANGEMENT,
};

/** Builds the live in the store's (empty) project. */
export function buildAcidLive(store: ProjectStore, sounds: Readonly<Record<AcidLiveSound, SampleRef>>): void {
  buildLive(store, ACID_LIVE, sounds);
}
