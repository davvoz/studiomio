/* "Siete pazzi": drum & bass a 175 BPM in Sol# minore, con l'amen affettato e glitchato, stacchi
 * di voce, riser e tagli. Le batterie e le voci sono i sample dell'utente sui pad:
 *
 *   Amen      l'amen (4 battute a 175) in 16 fette da un ottavo, in choke tra loro come lo slice
 *             mode di Live: in fila ricompongono il loop, rimontate fanno i chop;
 *   Glitch    colpi dell'amen al contrario, intonati su e giù, la versione "decimated" e quella
 *             già glitchata: rulli a trentaduesimi, swell al contrario, tagli;
 *   Voci      la frase cantata intera, le sue sillabe (dove cadono gli attacchi), la frase al
 *             contrario, la seconda frase e le frasi parlate per gli stacchi.
 *
 * Il reese sono due denti di sega scordati in Analog, piegati dal Drive e compressi; il sub un
 * seno a parte, così il basso resta pulito e il reese può sporcarsi. La pompa del sidechain è
 * fatta con le modulazioni di volume sulle casse e sui rullanti; gli stutter con modulazioni di
 * volume a scatti (gate). Sul master EQ, compressore "colla" e limiter. Il montaggio è in
 * live-builder.ts; i file, in scripts/build-pazzi-live.ts. */
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

/** I suoni che il live usa, per ruolo (chi costruisce il progetto dà il file di ognuno). */
export const PAZZI_LIVE_SOUNDS = [
  'kick', 'snare', 'snareBody', 'hatClosed', 'hatOpen', 'ride', 'shaker',
  'amen', 'amenCrush', 'amenGlitch',
  'vocal', 'vocal2', 'pazzi', 'aiutarmi', 'voiceCut', 'vox', 'stacco',
  'riser', 'sweepUp', 'downlifter', 'crash', 'impact', 'laser', 'tension',
] as const;

export type PazziLiveSound = (typeof PAZZI_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'snare' | 'amen' | 'glitch' | 'hats' | 'sub' | 'reese' | 'pad' | 'vox' | 'fx';

/** Un ottavo e una battuta a 175 BPM, in secondi (per affettare i file). */
const EIGHTH_S = 30 / PAZZI_LIVE_BPM;
const BAR_S = 240 / PAZZI_LIVE_BPM;

// ------------------------------------------------------------------ i kit

/** Le sillabe della frase cantata: dove cominciano, in secondi (misurate sugli attacchi). */
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
  // 16 ottavi delle prime due battute; ognuno può durare fino a quattro ottavi
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

/** I pad per nome. */
const SNARE = { main: 0, body: 1, roll: 2 } as const;
const HATS = { closed: 0, open: 1, ride: 2, shaker: 3 } as const;
const VOX = { phrase: 0, syllable: 1, reverse: 9, phrase2: 10, pazzi: 11, aiutarmi: 12, cut: 13, vox: 14, stacco: 15 } as const;
const FX = { riser: 0, sweepUp: 1, downlifter: 2, crash: 3, impact: 4, laser: 5, tension: 6 } as const;
const G = { kick: 0, snare: 1, snareHi: 2, snareRev: 3, barRev: 4, tick: 5, crush: 6, crushBar: 7, glitchA: 8, glitchB: 9, drop: 10, snareLo: 11, snareRevHi: 12, bar4: 13, tickHi: 14, snare4: 15 } as const;

// ------------------------------------------------------------------ i suoni di Analog

const ANALOG_SOUNDS = {
  sub: {
    oscA: 3, mix: 0, voiceMode: VOICE_MODE.legato, glide: 25, cutoff: 300, resonance: 0, filterEnv: 0, keyTrack: 0,
    attack: 0.004, decay: 0.3, sustain: 100, release: 0.06, velocity: 0, volume: -4,
  },
  // due denti di sega scordati di 35 centesimi: il battimento lento è il reese
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

/** L'EQ dell'amen: taglia i bassi (sono di cassa e sub) e ha il passa-basso pronto per le
 *  aperture (la banda 8, modulata dalle clip). */
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
      // compressione parallela forte: il suono "schiacciato" classico della jungle
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
      // un'eco cortissima da una parte sola (Haas): gli armonici si allargano, il centro resta
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

/** Le battute di un loop affettato, una stringa per battuta. */
const chops = (lines: readonly string[], velocity = 110): Note[] => lines.flatMap((l, k) => chop(l, k * BAR, velocity));

const AMEN = {
  straight: ['0 . 1 . 2 . 3 . 4 . 5 . 6 . 7 .', '8 . 9 . 10 . 11 . 12 . 13 . 14 . 15 .'],
  chopA: ['0 . 1 . 2 . 3 . 4 . 5 . 6 . 7 .', '8 . 9 . 10 . 10 . 12 . 13 . 14 14 6 .'],
  chopB: ['0 . 0 . 2 . 3 . 0 . 5 . 6 . 6 2', '8 . 9 . 10 . 11 . 4 4 13 . 14 . 14 14'],
};

/** Il glitch di otto battute: l'amen già glitchato, quello "decimated", swell al contrario,
 *  rulli di rullanti intonati. */
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

/** Due riempimenti di una battuta (da mettere a fine giro): uno swell al contrario con un
 *  rullo, uno con la cassa che crolla e gli stutter. */
const fillA = (at: Beats): Note[] => [...steps(G.barRev, 'x', at), ...roll(G.snareHi, at + 3, 8, 0.125, [80, 127])];
const fillB = (at: Beats): Note[] => [
  ...steps(G.drop, 'X', at), ...steps(G.snareLo, 'x', at + 1), ...roll(G.tickHi, at + 2, 8, 0.125, [70, 120]), ...steps(G.snareRev, 'x', at + 3.5),
];

/** Le note di Sol# minore che servono (MIDI). */
const N = { E1: 28, Fs1: 30, Gs1: 32, B1: 35 };

/** Il reese: quattro battute in Sol#, slide sulle code (le note "~" scivolano nella prossima). */
const REESE = acid(`
  g#2 -  -  -   -  -  -  -    -  -  g#2 -   -  -  b2~ a#2 |
  g#2 -  -  -   -  -  -  -    -  -  d#3~ c#3 -  -  b2 -  |
  g#2 -  -  -   -  -  -  -    -  -  g#2 -   -  -  b2~ a#2 |
  e2  -  -  -   -  -  -  -    f#2 -  -  -   d#2~ e2 -  -`);

/** Il sub: le stesse note un'ottava sotto, senza slide (resta fermo e pulito). */
const SUB = REESE.map(n => ({ ...n, pitch: n.pitch - 12, duration: Math.max(n.duration, 0.4) }));

/** Gli accordi: Sol#m per due battute, Si, poi Mi e Fa#. */
const chord = (pitches: readonly number[], start: Beats, duration: Beats): Note[] => pitches.map(pitch => ({ pitch, start, duration, velocity: 90 }));
const CHORDS = [...chord([56, 59, 63], 0, 8), ...chord([54, 59, 63], 8, 4), ...chord([52, 56, 59], 12, 2), ...chord([54, 58, 61], 14, 2)];

const KICK_BAR = 'X.........X.....';
const SNARE_BAR = '....X.......X...';
/** Dove cadono cassa e rullante in quattro battute (per la pompa). */
const KICKS = [0, 1, 2, 3].flatMap(b => [b * 4, b * 4 + 2.5]);
const SNARES = [0, 1, 2, 3].flatMap(b => [b * 4 + 1, b * 4 + 3]);

const PARTS = {
  kick: bars(0, KICK_BAR, 4, 'X.........X..x..'),
  kickHalf: bars(0, 'X...............', 4, 'X.......X.X.....'),
  snare: [...bars(SNARE.main, SNARE_BAR, 4, '....X.......X.xx'), ...bars(SNARE.body, SNARE_BAR, 4)],
  snareHalf: [...bars(SNARE.main, '........X.......', 4), ...bars(SNARE.body, '........X.......', 4)],
  /** Il rullo della salita: quarti, ottavi, sedicesimi, trentaduesimi, sempre più forte. */
  snareRoll: [
    ...roll(SNARE.roll, 0, 8, 1, [60, 80]), ...roll(SNARE.roll, 8, 16, 0.5, [80, 96]),
    ...roll(SNARE.roll, 16, 32, 0.25, [96, 112]), ...roll(SNARE.roll, 24, 64, 0.125, [110, 127]),
  ],
  hats: [...bars(HATS.closed, 'x.X.x.Xox.X.x.Xo', 4, 'x.X.x.Xox.X.x.X.'), ...steps(HATS.open, '..............x.', 12)],
  hatsDrop: [
    ...bars(HATS.closed, 'x.X.x.Xox.X.x.Xo', 4, 'x.X.x.Xox.X.x.X.'), ...steps(HATS.open, '..............x.', 12),
    ...bars(HATS.ride, 'x...x...x...x...', 4), ...bars(HATS.shaker, 'oooooooooooooooo', 4),
  ],
  /** Le sillabe nel drop: l'aggancio a metà del secondo giro, un trillo di sillabe alla fine. */
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

/** La pompa: reese e pad respirano su casse e rullanti, il sub solo sulle casse. */
const pump = (length: Beats, depth: number, release: Beats, hits: readonly Beats[]): ModSpec => ({
  target: VOLUME, points: duck(Array.from({ length: length / 16 }, (_, k) => hits.map(h => h + 16 * k)).flat(), depth, release),
});
const REESE_PUMP = (length: Beats) => pump(length, 0.6, 0.4, [...KICKS, ...SNARES]);
const SUB_PUMP = (length: Beats) => pump(length, 0.5, 0.35, KICKS);
const PAD_PUMP = (length: Beats) => pump(length, 0.5, 0.6, [...KICKS, ...SNARES]);

/** Il passa-basso dell'amen (banda 8 dell'EQ, effetto 1): valori in frazioni della manopola,
 *  −0,45 ≈ 900 Hz, −0,55 ≈ 450 Hz. */
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
  /** I riempimenti glitch alla fine dell'ottava e della sedicesima battuta. */
  glitchFills: clip('Riempimenti', [...fillA(28), ...fillB(60)], 64),
  crash: clip('Crash', [...steps(FX.crash, 'X'), ...steps(FX.impact, 'x')], 64),
};

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16, clips: {
      // l'amen chiuso dal passa-basso, che si apre nelle ultime otto battute
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
      // il riser dura esattamente otto battute a 175
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
      // l'amen a scatti: trentaduesimi nella terza e quarta battuta, sedicesimi nella settima
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
      // la frase al contrario arriva dentro la frase vera
      vox: clip('Frase e ritorno', [...steps(VOX.phrase, 'x', 0), ...steps(VOX.reverse, 'x', 18.875), ...steps(VOX.phrase, 'x', 32), ...steps(VOX.phrase2, 'x', 48)], 64),
      // il sub tenuto sotto la pausa, più basso che nei drop
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

/** La "registrazione": salita, stacco, due drop, il glitch, la pausa, il secondo stacco, il
 *  secondo drop e la fine. */
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

/** Costruisce il live nel progetto (vuoto) dello store. */
export function buildPazziLive(store: ProjectStore, sounds: Readonly<Record<PazziLiveSound, SampleRef>>): void {
  buildLive(store, PAZZI_LIVE, sounds);
}

