/* "Sottosuolo": techno underground scura e ipnotica a 133 BPM in Sol# frigio (Sol# minore con
 * il La naturale: il secondo grado abbassato che non risolve mai). Il pezzo lo porta il groove
 * del basso e della cassa, non una melodia: come nei magazzini, conta quello che si sente sotto
 * i piedi.
 *
 *   Cassa       due strati: il corpo pulito di una cassa già in Sol# (un seno che scende, con
 *               il suo click) e la grana di una cassa industriale tenuta solo sopra i 230 Hz;
 *               il Clipper le toglie i picchi dell'attacco e lascia il corpo;
 *   Rumble      la cassa distorta in un riverbero tutto bagnato e mono, poi saturata e chiusa
 *               sotto i 200 Hz: il rombo che rotola tra un colpo e l'altro, schiacciato dalla
 *               pompa a ogni colpo (il sub del pezzo);
 *   Basso       Neuro senza sub: un ringhio medio-basso a sedicesimi tra i colpi della cassa,
 *               chiuso nell'intro, che si apre con il filtro;
 *   Sequenza    il gancio: Analog a una voce, dente di sega con la sua ottava sotto, un giro a
 *               passi di tre sedicesimi che scivola contro il quattro quarti (ipnosi), nel
 *               delay puntato;
 *   Stab        accordi minori con la nona bemolle, corti, nella coda lunga: il colore del
 *               break e del secondo drop;
 *   Bordone     due seghe scordate su Sol# e Re#, lente, sotto le atmosfere;
 *   Piatti, Ride, Clap, Percussioni  sedicesimi con lo swing leggero, la ride metallica dei
 *               drop, il clap con la coda scura, tom intonati in Sol# a gruppi di tre;
 *   Atmosfere, Voci, FX  il bordone campionato in Sol#, il coro del break, i sussurri e
 *               "darkness", le salite e gli impatti.
 *
 * Intro e groove (32 battute per chi mixa), tensione, drop, pausa, salita, secondo drop, dopo,
 * outro e fine (16 battute di sola batteria). La pompa del sidechain è fatta con le modulazioni
 * di volume; filtri e salite con le modulazioni delle clip. Il master: EQ, colla, Clipper,
 * bassi mono, Limiter con i picchi tra i campioni. Il montaggio è in live-builder.ts; i file, in
 * scripts/build-sottosuolo-live.ts. */
import type { Beats } from '../core/music-time';
import { DETECTOR } from '../devices/effects/compressor/compressor';
import { SHAPE } from '../devices/effects/drive/drive';
import { bandParam } from '../devices/effects/eq/eq';
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
  buildLive, clip, clipper, compressor, delay, drive, eq, instrumentParam, limiter, reverb, stereo, VOLUME,
  type ClipSpec, type EffectSpec, type LiveSpec, type ModSpec, type PadSound, type SceneSpec, type TrackSpec,
} from './live-builder';
import { acid, BAR, curve, duck, repeat, roll, steps, STEP, swing } from './patterns';

export const SOTTOSUOLO_LIVE_BPM = 133;

/** I suoni che il live usa, per ruolo (chi costruisce il progetto dà il file di ognuno). */
export const SOTTOSUOLO_LIVE_SOUNDS = [
  'kickBody', 'kickGrit', 'kickRumble',
  'clap', 'snare', 'ghost',
  'hatClosed', 'hatSoft', 'hatOpen', 'ride', 'tamb',
  'tom', 'tom2', 'tick', 'tick2', 'metal', 'wood', 'hitMetal',
  'drone', 'choir', 'darkAtmos', 'airAtmos',
  'darkness', 'whisper', 'whisper2', 'devil',
  'riser', 'reverseNoise', 'impact', 'downlifter', 'crash', 'fall',
] as const;

export type SottosuoloLiveSound = (typeof SOTTOSUOLO_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'rumble' | 'bass' | 'seq' | 'stab' | 'pad' | 'hats' | 'ride' | 'clap' | 'perc' | 'atmos' | 'vox' | 'fx';

/** Lo swing dei sedicesimi in levare: leggero, la techno resta dritta ma respira. */
const SWING = 0.09;

const SPB = 60 / SOTTOSUOLO_LIVE_BPM;
/** Battiti di un suono lungo `seconds` (per far finire una salita sul drop). */
const beatsOf = (seconds: number): Beats => seconds / SPB;

// ------------------------------------------------------------------ i kit

const KITS = {
  // il corpo pieno e intonato, poi la grana: la cassa industriale solo sopra i 230 Hz, corta
  kick: [
    { sound: 'kickBody', decay: 0.28, level: 0 },
    { sound: 'kickGrit', decay: 0.08, tone: 72, snap: 25, level: -9 },
  ],
  // la sorgente del rumble: la cassa distorta, intera (il riverbero ne fa la coda)
  rumble: [
    { sound: 'kickRumble', decay: 0.4, level: 0 },
  ],
  clap: [
    { sound: 'clap', decay: 0.32, level: 0 },
    { sound: 'snare', decay: 0.16, tone: 60, level: -10 },
    { sound: 'ghost', decay: 0.09, tone: 62, level: -12, pan: -10 },
  ],
  hats: [
    { sound: 'hatClosed', decay: 0.06, tone: 62, choke: 1, pan: 6 },
    { sound: 'hatSoft', decay: 0.045, tone: 70, choke: 1, level: -3, pan: -6 },
    { sound: 'hatOpen', decay: 0.2, tone: 64, choke: 1, level: -4, pan: 4 },
    { sound: 'tamb', decay: 0.08, tone: 60, level: -9, pan: -22 },
  ],
  ride: [
    { sound: 'ride', decay: 0.9, tone: 58, level: 0, pan: -8 },
  ],
  // i tom portati in Sol# (frt tom è un Fa, frt tom2 un La#), i tic secchi e i metalli
  perc: [
    { sound: 'tom', tune: 3, decay: 0.28, level: -2, pan: -18 },
    { sound: 'tom2', tune: -2, decay: 0.22, level: -4, pan: 20 },
    { sound: 'tick', level: -4, pan: 14 },
    { sound: 'tick2', level: -3, pan: -12 },
    { sound: 'metal', decay: 0.3, tone: 62, level: -10, pan: 28 },
    { sound: 'wood', tune: -1, decay: 0.18, tone: 58, level: -8, pan: -26 },
    { sound: 'hitMetal', decay: 0.12, tone: 66, level: -12, pan: 32 },
  ],
  // il bordone in Sol#: ogni colpo prende un altro pezzo del file (non si ripete mai uguale)
  atmos: [
    { sound: 'drone', decay: 8, start: 0, level: -2 },
    { sound: 'drone', decay: 8, start: 18, level: -2 },
    { sound: 'drone', decay: 8, start: 36, level: -2 },
    { sound: 'drone', decay: 8, start: 54, level: -2 },
    { sound: 'choir', decay: 11, level: -14 },
    { sound: 'choir', decay: 10, at: 10, level: -14 },
    { sound: 'darkAtmos', decay: 10, level: -10 },
    { sound: 'airAtmos', decay: 5.4, level: -9 },
  ],
  vox: [
    { sound: 'darkness', level: 0 },
    { sound: 'whisper', level: -2 },
    { sound: 'whisper2', level: -2 },
    { sound: 'devil', decay: 6, level: -6 },
    // "darkness" giù di una quinta: il demone
    { sound: 'darkness', tune: -7, level: 1 },
  ],
  fx: [
    { sound: 'riser', level: -6 },
    { sound: 'reverseNoise', level: -6 },
    { sound: 'impact', level: -3 },
    { sound: 'downlifter', level: -8 },
    { sound: 'crash', decay: 1.0, tone: 60, level: -8 },
    { sound: 'fall', decay: 6, level: -12 },
  ],
} satisfies Record<string, readonly PadSound<SottosuoloLiveSound>[]>;

const CL = { clap: 0, snare: 1, ghost: 2 } as const;
const HAT = { closed: 0, soft: 1, open: 2, tamb: 3 } as const;
const PERC = { tom: 0, tom2: 1, tick: 2, tick2: 3, metal: 4, wood: 5, hitMetal: 6 } as const;
const ATM = { drone: 0, choir: 4, choirB: 5, dark: 6, air: 7 } as const;
const VOX = { darkness: 0, whisper: 1, whisper2: 2, devil: 3, demon: 4 } as const;
const FX = { riser: 0, reverse: 1, impact: 2, down: 3, crash: 4, fall: 5 } as const;

// ------------------------------------------------------------------ i suoni dei synth

/** Il basso: Neuro senza sub (il sub è del rumble), due seghe una sull'altra un'ottava sotto,
 *  LP 24 chiuso con la sua saturazione; l'inviluppo di ogni nota apre il filtro (il "tok") e
 *  sposta un poco la vocale: ogni sedicesimo parla. */
const BASS: ParamValues = {
  unison: 1, oscA: 0, oscB: 1, oscBSemi: -12, oscBFine: 0, mix: 40,
  fm: 6, fmRatio: 1, fold: 8,
  filterType: 0, cutoff: 520, resonance: 30, drive: 55, keyTrack: 30,
  formant: 25, vowel: 30, formantShift: 0,
  dist: 30, sub: 0, crossover: 90,
  voiceMode: NEURO_MODE.mono, glide: 0, velocity: 35,
  attack: 0.003, decay: 0.18, sustain: 30, release: 0.04,
  mAttack: 0.003, mDecay: 0.09, mSustain: 0, mRelease: 0.05,
  envDest: MOD_DEST.cutoff, envAmount: 42, envDest2: MOD_DEST.vowel, envAmount2: 18,
  lfo1Shape: LFO_SHAPE.smoothRandom, lfo1Rate: TEMPO_RATE['1/16'], lfo1Retrig: 1,
  lfo1Dest: MOD_DEST.cutoff, lfo1Amount: 8, lfo1Dest2: MOD_DEST.fold, lfo1Amount2: 10,
  lfo2Shape: LFO_SHAPE.sine, lfo2Rate: TEMPO_RATE['2 battute'], lfo2Retrig: 1,
  lfo2Dest: MOD_DEST.vowel, lfo2Amount: 20,
  volume: 0,
};

/** Il gancio: una voce, sega con l'ottava sotto, filtro risonante che l'inviluppo apre a ogni
 *  nota (un pluck scuro), accento sulle note forti. */
const SEQ: ParamValues = {
  oscA: 0, oscB: 0, oscBSemi: -12, oscBFine: 6, mix: 45, unison: 3, detune: 14, spread: 60,
  voiceMode: VOICE_MODE.mono, glide: 0, accent: 45,
  filterType: 0, cutoff: 700, resonance: 50, filterEnv: 38, keyTrack: 40,
  fAttack: 0.003, fDecay: 0.2, fSustain: 12, fRelease: 0.1,
  attack: 0.003, decay: 0.3, sustain: 32, release: 0.08,
  lfoWave: 0, lfoRate: 0.11, lfoPitch: 0, lfoCutoff: 6, velocity: 40, volume: -2,
};

/** Gli stab: accordi corti di sette copie scordate, il filtro che si chiude in fretta. */
const STAB: ParamValues = {
  oscA: 0, oscB: 1, oscBSemi: 0, oscBFine: 9, mix: 35, unison: 5, detune: 22, spread: 90,
  voiceMode: VOICE_MODE.poly, filterType: 0, cutoff: 1300, resonance: 25, filterEnv: 40, keyTrack: 20,
  fAttack: 0.001, fDecay: 0.25, fSustain: 10, fRelease: 0.3,
  attack: 0.002, decay: 0.35, sustain: 0, release: 0.3,
  lfoWave: 0, lfoRate: 0.2, lfoPitch: 0, lfoCutoff: 0, velocity: 30, volume: -12,
};

/** Il bordone: seghe scordate lente, chiuso, con un'onda d'intonazione appena percepibile. */
const PAD: ParamValues = {
  oscA: 0, oscB: 0, oscBSemi: 0, oscBFine: 11, mix: 50, unison: 5, detune: 28, spread: 100,
  voiceMode: VOICE_MODE.poly, cutoff: 820, resonance: 18, filterEnv: 12, keyTrack: 0,
  fAttack: 4, fDecay: 4, fSustain: 60, fRelease: 4,
  attack: 3, decay: 2, sustain: 100, release: 5,
  lfoWave: 0, lfoRate: 0.09, lfoPitch: 6, lfoCutoff: 14, velocity: 0, volume: -8,
};

// ------------------------------------------------------------------ le parti

const len = (bars: number): Beats => bars * BAR;

/** Battute di un pad, una stringa per battuta. */
const phrase = (pad: number, barsOf: readonly string[], from: Beats = 0): Note[] =>
  barsOf.flatMap((b, k) => steps(pad, b, from + k * BAR));

/** Un colpo solo di un pad. */
const hit = (pad: number, at: Beats, velocity = 110): Note => ({ pitch: padNote(pad), start: at, duration: STEP, velocity });

/** Un accordo tenuto. */
const chord = (pitches: readonly number[], from: Beats, length: Beats, velocity = 90): Note[] =>
  pitches.map(pitch => ({ pitch, start: from, duration: length, velocity }));

// --- la cassa (le stringhe sono battute a sedicesimi: X accento, x colpo, o leggero)
const K = {
  four: 'X... X... X... X...',
  push: 'X... X... X... X..x',
  skip: 'X... X... X... ....',
  roll: 'X... X... X.x. X.x.',
  half: 'X... .... X... ....',
  one: 'X... .... .... ....',
  rest: '.... .... .... ....',
};
/** Sedici battute di cassa: la spinta in levare a fine frase, il buco prima del giro nuovo. */
const KICK16 = [K.four, K.four, K.four, K.push, K.four, K.four, K.four, K.skip, K.four, K.four, K.four, K.push, K.four, K.four, K.four, K.roll];
const kickBars = (count: number, last: string = K.roll): string[] =>
  Array.from({ length: count }, (_, k) => (k === count - 1 ? last : KICK16[k % 16]));

const KICK = {
  intro: phrase(0, kickBars(16, K.push)),
  groove: phrase(0, kickBars(16)),
  // le ultime due battute senza cassa: il vuoto prima del drop
  tension: phrase(0, [...kickBars(14, K.four), K.rest, K.rest]),
  drop: phrase(0, kickBars(32, K.skip)),
  climb: phrase(0, [K.half, K.half, K.half, K.half, K.four, K.four, K.roll, K.rest]),
  drop2: phrase(0, kickBars(32)),
  after: phrase(0, kickBars(16)),
  outro: phrase(0, kickBars(16)),
  end: phrase(0, [...kickBars(15, K.four), K.one]),
};

/** La clip della cassa: ogni colpo suona il corpo (pad 1) e la grana (pad 2) insieme. */
const kickClip = (name: string, notes: readonly Note[], length: Beats): ClipSpec =>
  clip(name, [...notes, ...notes.map(n => ({ ...n, pitch: padNote(1) }))], length);

/** Dove colpisce la cassa (i colpi pieni). */
const kickHits = (kick: readonly Note[]): Beats[] => kick.filter(n => n.velocity >= 100).map(n => n.start);

// --- la pompa: il volume giù sulla cassa e su prima della prossima
const pump = (kick: readonly Note[], depth: number, release: Beats, level = 1): ModSpec =>
  ({ target: VOLUME, points: duck(kickHits(kick), depth, release).map(p => ({ ...p, value: p.value * level })) });

/** La pompa del rumble: zero sul colpo (la cassa è sola), pieno sul levare dell'ottavo, poi
 *  respira prima del colpo dopo: "boom – rrr – (fiato)". */
const rumblePump = (kick: readonly Note[], level = 1): ModSpec => ({
  target: VOLUME,
  points: kickHits(kick).sort((a, b) => a - b).flatMap(h => [
    { beat: h, value: 0 }, { beat: h + 0.14, value: 0.2 * level },
    { beat: h + 0.42, value: level }, { beat: h + 0.6, value: level }, { beat: h + 0.97, value: 0.45 * level },
  ]),
});

/** Il rumble suona dove suona la cassa: è la sua coda. */
const rumbleClip = (name: string, kick: readonly Note[], length: Beats, level = 1, extra: ModSpec[] = []): ClipSpec =>
  clip(name, kick.filter(n => n.velocity >= 100), length, [rumblePump(kick, level), ...extra]);

const mod = (param: string, points: EnvelopePoint[]): ModSpec => ({ target: instrumentParam(param), points });

// --- clap e rullante: il due e il quattro, con il rullante sotto e i fantasmi
const BACK = '.... X... .... X...';
const GHOSTS = ['.... .... .... ..o.', '.... ...o .... ....', '.... .... ..o. ...o', '.... ...o .... .o..'];
function claps(count: number, opts: { snare?: boolean; ghosts?: boolean; fills?: Readonly<Record<number, string>>; from?: number } = {}): Note[] {
  return Array.from({ length: count }, (_, k) => {
    if (k < (opts.from ?? 0)) return [];
    const bar = opts.fills?.[k] ?? BACK;
    return [
      ...steps(CL.clap, bar, k * BAR),
      ...(opts.snare ? steps(CL.snare, bar, k * BAR) : []),
      ...(opts.ghosts ? swing(steps(CL.ghost, GHOSTS[k % 4], k * BAR), SWING) : []),
    ];
  }).flat();
}

// --- i piatti: chiusi a sedicesimi (il levare dell'ottavo è dell'aperto), il tamburello sparso
const HATS = {
  offbeat: '..x. ..x. ..x. ..x.',
  closed: 'xo.o xo.o xo.o xo.o',
  closedFill: 'xo.o xo.o xoxo XoXo',
  open: '..X. ..X. ..X. ..X.',
  tamb: '.o.. ...o .o.. .o.o',
};
type HatOpts = { closed?: boolean; open?: boolean; tamb?: boolean; offbeat?: boolean };
function hats(count: number, opts: HatOpts): Note[] {
  const bars = (pattern: string, fill?: string) => Array.from({ length: count }, (_, k) => (fill && k % 8 === 7 ? fill : pattern));
  return swing([
    ...(opts.offbeat ? phrase(HAT.soft, bars(HATS.offbeat)) : []),
    ...(opts.closed ? phrase(HAT.closed, bars(HATS.closed, HATS.closedFill)) : []),
    ...(opts.open ? phrase(HAT.open, bars(HATS.open)) : []),
    ...(opts.tamb ? phrase(HAT.tamb, bars(HATS.tamb)) : []),
  ], SWING);
}

/** La ride: ottavi con il levare più leggero, o solo quarti. */
const rides = (count: number, eighths = true): Note[] =>
  swing(phrase(0, Array(count).fill(eighths ? 'x.o. x.o. x.o. x.o.' : 'x... x... x... x...')), SWING);

// --- le percussioni: i tom a gruppi di tre sedicesimi su due battute (contro il quattro), tic
// sincopati, metalli a fine frase
const TOMS = 'X..x ..x. .x.. X..x ..x. .x.. x..x ....';
const PERC_LOOP = [
  ...steps(PERC.tom, TOMS),
  ...steps(PERC.tom2, '.... .... .... ..o. .... .... .... .o..'),
  ...steps(PERC.tick, '..x. ...x ..x. .x.. ..x. ...x .x.. ..x.'),
  ...steps(PERC.tick2, '.o.. .... ...o .... .o.. ..o. ...o ....'),
  ...steps(PERC.metal, '.... .... .... .... .... ..x. .... ....'),
];
function perc(count: number, opts: { light?: boolean; full?: boolean } = {}): Note[] {
  const base = opts.light ? PERC_LOOP.filter(n => n.pitch === padNote(PERC.tick) || n.pitch === padNote(PERC.tick2)) : PERC_LOOP;
  return swing([
    ...repeat(base, len(2), count / 2),
    ...(opts.full ? [
      ...repeat(steps(PERC.wood, '...o .... ..o. ...o'), BAR, count),
      ...repeat(steps(PERC.hitMetal, '.... .... .... ...x', len(3)), len(4), count / 4),
    ] : []),
  ], SWING);
}

// --- il basso: sedicesimi tra i colpi della cassa (mai sul battere)
const BASS_A = acid([
  '. g#1 G#1 . | . g#1 . G#1 | . g#1 G#1 . | . a1 g#1 .',
  '. g#1 G#1 . | . g#1 . D#2 | . g#1 G#1 . | . b1 . g#1',
].join(' '));
const BASS_B = acid([
  '. g#1 G#1 g#1 | . g#1 A1 . | . g#1 G#1 . | . g#2 g#1 .',
  '. g#1 G#1 . | . g#1 . D#2 | . e2 D#2 . | . b1 A1 g#1',
].join(' '));

// --- la sequenza: passi di tre sedicesimi, due battute
const SEQ_A = acid([
  'G#2 - . g#2 - . A2 - . g#2 - . D#3 . g#2 -',
  'G#2 - . g#2 - . B2 - . g#2 - . A2 . g#2 G#3',
].join(' '));
/** Nel secondo drop sale: le note forti un'ottava su, la risposta che cade sul La. */
const SEQ_B = acid([
  'G#3 - . g#2 - . A3 - . g#2 - . D#3 . g#3 -',
  'G#2 - . g#3 - . B3 - . g#2 - . A3 . A2 G#3',
].join(' '));

// --- gli stab: Sol# minore con il La sopra (la nona bemolle), in levare
const G3 = 56, B3 = 59, DS4 = 63, A4 = 69, GS2 = 44, DS3 = 51, A3 = 57, E3 = 52;
const STAB_CHORD = [G3, B3, DS4, A4];
const STAB_LOW = [E3, G3, B3, DS4];
/** Quattro battute di stab: in levare, l'ultimo sull'accordo di Mi (il sesto grado). */
const stabPhrase = (from: Beats): Note[] => [
  ...chord(STAB_CHORD, from + 1.5, 0.25, 100),
  ...chord(STAB_CHORD, from + len(1) + 2.75, 0.25, 85),
  ...chord(STAB_CHORD, from + len(2) + 1.5, 0.25, 100),
  ...chord(STAB_LOW, from + len(3) + 0.75, 0.5, 95),
];
const stabs = (count: number): Note[] => Array.from({ length: count / 4 }, (_, k) => stabPhrase(k * len(4))).flat();

// ------------------------------------------------------------------ gli effetti

/** I tipi di banda dell'EQ che servono qui (valori del parametro "type"). */
const BELL = 2, HIGH_SHELF = 4;

/** Un EQ: un passa-alto (24 dB) a `low` Hz e, se c'è, un passa-basso a `high`; poi le bande
 *  date (campane, o il tipo indicato). */
function eqOf(name: string, low: number, high: number | null, bands: readonly (readonly [freq: number, gain: number, q: number, type?: number])[] = []): EffectSpec {
  const p: Record<string, number> = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: low, [bandParam(0, 'slope')]: 1 };
  // le bande 2..7 del preset Init sono accese ma piatte: le uso per le campane
  bands.forEach(([freq, gain, q, type = BELL], i) => Object.assign(p, {
    [bandParam(i + 1, 'type')]: type, [bandParam(i + 1, 'freq')]: freq, [bandParam(i + 1, 'gain')]: gain, [bandParam(i + 1, 'q')]: q,
  }));
  if (high !== null) Object.assign(p, { [bandParam(7, 'on')]: 1, [bandParam(7, 'type')]: 5, [bandParam(7, 'freq')]: high, [bandParam(7, 'slope')]: 1 });
  return eq(name, p);
}

// ------------------------------------------------------------------ le tracce

const TRACKS: readonly TrackSpec<SottosuoloLiveSound, TrackKey>[] = [
  {
    key: 'kick', name: 'Cassa', volumeDb: -6, kit: KITS.kick,
    effects: [
      // il seno a 52 Hz giù, il colpo a 90 Hz su: il basso della cassa si allarga
      eqOf('Cassa', 28, null, [[52, -6, 1.4], [90, 4, 1.1], [250, -3, 1.2], [4500, 2, 0.8]]),
      clipper('Cassa', { drive: 4, ceiling: -3, knee: 20 }),
      stereo('Mono', { width: 0 }),
    ],
  },
  {
    key: 'rumble', name: 'Rumble', volumeDb: -8, kit: KITS.rumble,
    effects: [
      reverb('Rombo', { size: 75, decay: 2.4, predelay: 0, diffusion: 90, damping: 2500, lowCut: 30, width: 0, mix: 100 }),
      drive('Rombo', { shape: SHAPE.tube, drive: 20, bias: 15, low: 0, tone: 2500, auto: 1 }),
      eqOf('Sotto i 200', 30, 190, [[40, 3, 1.2], [52, -5, 2], [72, 5, 1]]),
      stereo('Mono', { width: 0 }),
    ],
  },
  {
    key: 'bass', name: 'Basso', volumeDb: -2, neuro: BASS,
    effects: [
      eqOf('Basso', 62, null, [[380, -2.5, 1.4], [900, 2.5, 1.2]]),
      // il primo mezzo periodo della sega, con il filtro appena aperto, fa una punta di 16 dB
      // sopra il corpo: il clipper morbido la toglie e lascia il ringhio
      clipper('Punte', { ceiling: -8, knee: 50, output: 4 }),
      compressor('Basso', { threshold: -16, ratio: 4, knee: 6, attack: 3, release: 60, scHp: 60, auto: 0, makeup: 3 }),
      stereo('Basso mono', { monoFreq: 220 }),
    ],
  },
  {
    key: 'seq', name: 'Sequenza', volumeDb: 0, analog: SEQ,
    effects: [
      drive('Calda', { shape: SHAPE.tube, drive: 10, bias: 20, low: 40, split: 150, tone: 9000 }),
      // gli accenti aprono il filtro risonante: il compressore veloce li tiene nel corpo
      compressor('Accenti', { threshold: -20, ratio: 4, knee: 6, attack: 1, release: 70, auto: 0, makeup: 4 }),
      clipper('Punte', { ceiling: -9, knee: 50, output: 3 }),
      eqOf('Sequenza', 160, 9000, [[260, -2.5, 1.2], [420, -2, 1], [2500, 2, 1]]),
      delay('Puntato', { division: 4, pingPong: 1, feedback: 38, lowCut: 350, highCut: 3500, mix: 24 }),
      reverb('Buio', { size: 60, decay: 1.8, predelay: 15, damping: 4500, lowCut: 300, mix: 16 }),
    ],
  },
  {
    key: 'stab', name: 'Stab', volumeDb: 1, analog: STAB,
    effects: [
      eqOf('Stab', 220, 8000),
      delay('Eco 1/4.', { division: 9, pingPong: 1, feedback: 45, lowCut: 400, highCut: 3000, mix: 28 }),
      reverb('Cattedrale', { size: 95, decay: 6, predelay: 30, damping: 3500, lowCut: 350, mix: 42 }),
    ],
  },
  {
    key: 'pad', name: 'Bordone', volumeDb: -12.5, analog: PAD,
    effects: [eqOf('Bordone', 150, 6000), reverb('Sala', { size: 85, decay: 5, predelay: 20, damping: 4000, lowCut: 250, mix: 35 })],
  },
  {
    key: 'hats', name: 'Piatti', volumeDb: -4.5, kit: KITS.hats,
    effects: [eqOf('Piatti', 380, null, [[5000, 2.5, 0.9], [11000, -5, 0.6]]), reverb('Stanza', { size: 30, decay: 0.6, predelay: 5, damping: 8000, lowCut: 600, mix: 10 })],
  },
  {
    key: 'ride', name: 'Ride', volumeDb: -4, kit: KITS.ride,
    effects: [eqOf('Ride', 450, 12000, [[3200, 2, 1], [10000, -4, 0.7]]), reverb('Stanza', { size: 45, decay: 1.1, predelay: 10, damping: 7000, lowCut: 600, mix: 14 })],
  },
  {
    key: 'clap', name: 'Clap', volumeDb: 1, kit: KITS.clap,
    effects: [
      eqOf('Clap', 190, null, [[1200, 1.5, 1], [3000, 2, 1]]),
      drive('Presenza', { shape: SHAPE.soft, drive: 8, color: 50, low: 80, mix: 45 }),
      compressor('Schiaffo', { threshold: -18, ratio: 4, attack: 6, release: 80, auto: 0, makeup: 2 }),
      reverb('Piatto scuro', { size: 55, decay: 1.4, predelay: 12, damping: 5500, lowCut: 400, mix: 22 }),
    ],
  },
  {
    key: 'perc', name: 'Percussioni', volumeDb: -2, kit: KITS.perc,
    effects: [
      eqOf('Percussioni', 140, null, [[600, -2, 1], [3500, 2, 1]]),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 30, lowCut: 500, highCut: 5000, mix: 14 }),
      reverb('Stanza buia', { size: 50, decay: 1.2, damping: 5000, lowCut: 400, mix: 12 }),
    ],
  },
  {
    key: 'atmos', name: 'Atmosfere', volumeDb: 1, kit: KITS.atmos,
    effects: [eqOf('Atmosfere', 200, 9000), reverb('Sala', { size: 85, decay: 4, predelay: 20, damping: 5000, lowCut: 300, mix: 30 })],
  },
  {
    key: 'vox', name: 'Voci', volumeDb: -6, kit: KITS.vox,
    effects: [
      eqOf('Voce', 220, 10000),
      compressor('Voce', { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms, auto: 0, makeup: 3 }),
      delay('Eco 1/4.', { division: 9, pingPong: 1, feedback: 40, lowCut: 500, highCut: 4000, mix: 22 }),
      reverb('Lancio voce', { size: 95, decay: 5, predelay: 50, damping: 4500, lowCut: 300, mix: 30 }),
    ],
  },
  {
    key: 'fx', name: 'FX', volumeDb: -9, kit: KITS.fx,
    effects: [eqOf('FX', 90, null), reverb('Sala', { size: 85, decay: 3, predelay: 20, lowCut: 200, mix: 20 })],
  },
];

// ------------------------------------------------------------------ le scene

/** Il bordone campionato: un colpo ogni quattro battute, ogni volta da un altro punto del file
 *  (il cambio cade sulla cassa, sotto la pompa). */
const drone = (count: number, from = 0): Note[] =>
  Array.from({ length: count / 4 }, (_, k) => hit(ATM.drone + ((k + from) % 4), len(4 * k), 100));

/** Una salita che finisce esattamente su `end` (battiti), lunga `seconds`. */
const riserTo = (pad: number, end: Beats, seconds: number): Note => hit(pad, Math.max(0, end - beatsOf(seconds)), 110);

const RISER_S = 10.971, REVERSE_S = 5.486;

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.intro, len(16)),
      rumble: rumbleClip('Rombo', KICK.intro, len(16), 0.75),
      hats: clip('Levare', hats(16, { offbeat: true }), len(16)),
      perc: clip('Tic', perc(16, { light: true }).filter(n => n.start >= len(8)), len(16)),
      atmos: clip('Bordone', drone(16), len(16), [pump(KICK.intro, 0.45, 0.6), { target: VOLUME, points: curve([0, 0.4], [len(16), 0.8]) }]),
      fx: clip('Impatto', [hit(FX.down, 0, 90), hit(FX.reverse, len(16) - beatsOf(REVERSE_S), 90)], len(16)),
    },
  },
  {
    name: 'Groove', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.groove, len(16)),
      rumble: rumbleClip('Rombo', KICK.groove, len(16)),
      clap: clip('Clap', claps(16, { from: 8 }), len(16)),
      hats: clip('Piatti', hats(16, { closed: true, offbeat: true }), len(16)),
      perc: clip('Perc', perc(16), len(16)),
      // il basso entra chiuso e si apre in sedici battute
      bass: clip('Rotola', repeat(BASS_A, len(2), 8), len(16), [
        pump(KICK.groove, 0.35, 0.35),
        mod('cutoff', curve([0, -0.28], [len(16), -0.1])),
      ]),
      atmos: clip('Bordone', drone(16, 1), len(16), [pump(KICK.groove, 0.45, 0.6)]),
      vox: clip('Sussurro', [hit(VOX.whisper, len(7) + 2), hit(VOX.whisper2, len(15) + 2)], len(16)),
      fx: clip('Crash', [hit(FX.crash, 0, 90)], len(16)),
    },
  },
  {
    name: 'Tensione', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.tension, len(16)),
      rumble: rumbleClip('Rombo', KICK.tension, len(16)),
      clap: clip('Clap e rullo', [...claps(14, { ghosts: true }), ...roll(CL.clap, len(14), 8, 0.5, [70, 92]), ...roll(CL.clap, len(15), 16, 0.25, [88, 124])], len(16)),
      hats: clip('Piatti', hats(16, { closed: true, open: true }), len(16)),
      ride: clip('Ride', rides(8, false).map(n => ({ ...n, start: n.start + len(8) })), len(16), [{ target: VOLUME, points: curve([len(8), 0.6], [len(16), 0.9]) }]),
      perc: clip('Perc', perc(16), len(16)),
      bass: clip('Rotola', repeat(BASS_A, len(2), 7), len(16), [pump(KICK.tension, 0.35, 0.35), mod('cutoff', curve([0, -0.1], [len(14), 0]))]),
      // il gancio entra chiuso: il filtro si apre lungo la sezione
      seq: clip('Gancio chiuso', repeat(SEQ_A, len(2), 8), len(16), [
        pump(KICK.tension, 0.5, 0.4),
        mod('cutoff', curve([0, -0.3], [len(16), -0.08])),
      ]),
      pad: clip('Quinta', chord([GS2, DS3], 0, len(16) - 0.5, 80), len(16), [pump(KICK.tension, 0.5, 0.7)]),
      atmos: clip('Bordone', drone(16, 2), len(16), [pump(KICK.tension, 0.45, 0.6)]),
      vox: clip('Darkness', [hit(VOX.darkness, len(8)), hit(VOX.whisper, len(15) + 2.5)], len(16)),
      fx: clip('Salita', [riserTo(FX.riser, len(16), RISER_S), hit(FX.reverse, len(16) - beatsOf(REVERSE_S), 100)], len(16)),
    },
  },
  {
    name: 'Drop', bars: 32,
    clips: {
      kick: kickClip('Cassa', KICK.drop, len(32)),
      rumble: rumbleClip('Rombo', KICK.drop, len(32)),
      clap: clip('Clap', claps(32, { snare: true, ghosts: true, fills: { 15: '.... X... .... X.x.', 31: '.... X... .... X...' } }), len(32)),
      hats: clip('Piatti', hats(32, { closed: true, open: true, tamb: true }), len(32)),
      ride: clip('Ride', rides(32), len(32)),
      perc: clip('Perc piene', perc(32, { full: true }), len(32)),
      bass: clip('Rotola', repeat(BASS_A, len(2), 16), len(32), [pump(KICK.drop, 0.35, 0.35)]),
      seq: clip('Gancio', repeat(SEQ_A, len(2), 16), len(32), [
        pump(KICK.drop, 0.5, 0.4),
        mod('cutoff', curve([0, 0], [len(16), 0.08], [len(17), 0], [len(32), 0.12])),
      ]),
      pad: clip('Quinta', chord([GS2, DS3], 0, len(32) - 0.5, 80), len(32), [pump(KICK.drop, 0.5, 0.7)]),
      atmos: clip('Bordone', drone(32, 3), len(32), [pump(KICK.drop, 0.45, 0.6, 0.8)]),
      vox: clip('Stacchi', [hit(VOX.darkness, len(15) + 2), hit(VOX.demon, len(31) + 2)], len(32)),
      fx: clip('Impatto', [hit(FX.impact, 0), hit(FX.crash, 0), hit(FX.crash, len(16), 90)], len(32)),
    },
  },
  {
    name: 'Pausa', bars: 16,
    clips: {
      // niente cassa: restano il tamburello, il coro, gli stab nella cattedrale e il gancio che
      // respira da solo, chiuso
      hats: clip('Tamburello', hats(16, { tamb: true }).filter(n => n.start >= len(8)), len(16)),
      perc: clip('Tic lontani', perc(16, { light: true }).filter(n => n.start >= len(4)), len(16), [{ target: VOLUME, points: curve([0, 0.6], [len(16), 0.9]) }]),
      seq: clip('Gancio solo', repeat(SEQ_A, len(2), 8), len(16), [
        mod('cutoff', curve([0, -0.35], [len(12), -0.15], [len(16), -0.05])),
        { target: VOLUME, points: curve([0, 0.6], [len(16), 0.8]) },
      ]),
      stab: clip('Stab', stabs(16), len(16)),
      pad: clip('Accordo', chord([GS2, DS3, A3], 0, len(16) - 0.5, 85), len(16)),
      atmos: clip('Coro', [hit(ATM.choir, 0), hit(ATM.choirB, len(6)), hit(ATM.dark, len(10)), hit(ATM.air, len(13))], len(16)),
      vox: clip('Demone', [hit(VOX.devil, len(2)), hit(VOX.whisper2, len(9) + 2), hit(VOX.darkness, len(14))], len(16)),
      fx: clip('Caduta', [hit(FX.fall, 0)], len(16)),
    },
  },
  {
    name: 'Salita', bars: 8,
    clips: {
      kick: kickClip('Cassa che torna', KICK.climb, len(8)),
      clap: clip('Clap che corre', [...claps(4), ...roll(CL.clap, len(4), 8, 0.5, [70, 95]), ...roll(CL.clap, len(6), 8, 0.25, [90, 120])], len(8)),
      hats: clip('Piatti', hats(8, { closed: true }), len(8), [{ target: VOLUME, points: curve([0, 0.7], [len(8), 1]) }]),
      perc: clip('Perc', perc(8), len(8)),
      // il basso torna chiuso e si apre tutto in otto battute
      bass: clip('Si apre', repeat(BASS_A, len(2), 4).filter(n => n.start < len(7)), len(8), [
        pump(KICK.climb, 0.35, 0.35),
        mod('cutoff', curve([0, -0.3], [len(7), 0.05])),
      ]),
      seq: clip('Gancio che sale', repeat(SEQ_A, len(2), 4), len(8), [
        mod('cutoff', curve([0, -0.2], [len(8), 0.1])),
      ]),
      stab: clip('Stab', stabs(4), len(8)),
      atmos: clip('Bordone', drone(8), len(8), [{ target: VOLUME, points: curve([0, 0.5], [len(8), 0.9]) }]),
      vox: clip('Darkness', [hit(VOX.darkness, len(7) + 2)], len(8)),
      fx: clip('Salita', [riserTo(FX.riser, len(8), RISER_S), hit(FX.reverse, len(8) - beatsOf(REVERSE_S), 110)], len(8)),
    },
  },
  {
    name: 'Drop 2', bars: 32,
    clips: {
      kick: kickClip('Cassa', KICK.drop2, len(32)),
      rumble: rumbleClip('Rombo', KICK.drop2, len(32)),
      clap: clip('Clap', claps(32, { snare: true, ghosts: true, fills: { 7: '.... X... .... X..x', 15: '.... X... ..x. X.x.', 23: '.... X... .... X..x', 31: '.... X... .... X...' } }), len(32)),
      hats: clip('Piatti', hats(32, { closed: true, open: true, tamb: true }), len(32)),
      ride: clip('Ride', rides(32), len(32)),
      perc: clip('Perc piene', perc(32, { full: true }), len(32)),
      bass: clip('Rotola', repeat([...BASS_A, ...BASS_B.map(n => ({ ...n, start: n.start + len(2) }))], len(4), 8), len(32), [pump(KICK.drop2, 0.35, 0.35)]),
      seq: clip('Gancio su', repeat(SEQ_B, len(2), 16), len(32), [
        pump(KICK.drop2, 0.5, 0.4),
        mod('cutoff', curve([0, 0.05], [len(16), 0.12], [len(17), 0.04], [len(32), 0.15])),
      ]),
      stab: clip('Stab', stabs(32), len(32), [pump(KICK.drop2, 0.4, 0.5)]),
      pad: clip('Accordo', chord([GS2, DS3, A3], 0, len(32) - 0.5, 80), len(32), [pump(KICK.drop2, 0.5, 0.7)]),
      atmos: clip('Bordone', drone(32), len(32), [pump(KICK.drop2, 0.45, 0.6, 0.8)]),
      vox: clip('Stacchi', [hit(VOX.whisper, len(7) + 2), hit(VOX.darkness, len(15) + 2), hit(VOX.whisper2, len(23) + 2), hit(VOX.demon, len(31) + 2)], len(32)),
      fx: clip('Impatto', [hit(FX.impact, 0), hit(FX.crash, 0), hit(FX.crash, len(16), 90)], len(32)),
    },
  },
  {
    name: 'Dopo', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.after, len(16)),
      rumble: rumbleClip('Rombo', KICK.after, len(16)),
      clap: clip('Clap', claps(16, { ghosts: true }), len(16)),
      hats: clip('Piatti', hats(16, { closed: true, open: true }), len(16)),
      ride: clip('Ride', rides(16, false), len(16), [{ target: VOLUME, points: curve([0, 0.9], [len(16), 0.5]) }]),
      perc: clip('Perc piene', perc(16, { full: true }), len(16)),
      bass: clip('Rotola', repeat(BASS_B, len(2), 8), len(16), [pump(KICK.after, 0.35, 0.35), mod('cutoff', curve([0, 0], [len(16), -0.15]))]),
      // il gancio si richiude e se ne va
      seq: clip('Gancio che si chiude', repeat(SEQ_A, len(2), 8), len(16), [
        pump(KICK.after, 0.5, 0.4),
        mod('cutoff', curve([0, 0], [len(16), -0.35])),
        { target: VOLUME, points: curve([0, 1], [len(12), 0.8], [len(16), 0.3]) },
      ]),
      atmos: clip('Bordone', drone(16, 2), len(16), [pump(KICK.after, 0.45, 0.6)]),
      fx: clip('Crash', [hit(FX.crash, 0, 90), hit(FX.down, len(14))], len(16)),
    },
  },
  {
    name: 'Outro', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.outro, len(16)),
      rumble: rumbleClip('Rombo', KICK.outro, len(16), 0.9),
      clap: clip('Clap', claps(8), len(16)),
      hats: clip('Piatti', hats(16, { closed: true, offbeat: true }), len(16)),
      perc: clip('Perc', perc(16), len(16)),
      bass: clip('Si chiude', repeat(BASS_A, len(2), 4), len(16), [pump(KICK.outro, 0.35, 0.35), mod('cutoff', curve([0, -0.15], [len(8), -0.35]))]),
      atmos: clip('Bordone', drone(16, 3), len(16), [pump(KICK.outro, 0.45, 0.6), { target: VOLUME, points: curve([0, 0.8], [len(16), 0.3]) }]),
      vox: clip('Sussurro', [hit(VOX.whisper2, len(7) + 2)], len(16)),
    },
  },
  {
    name: 'Fine', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.end, len(16)),
      rumble: rumbleClip('Rombo', KICK.end, len(16), 0.7),
      hats: clip('Levare', hats(16, { offbeat: true }).filter(n => n.start < len(15)), len(16)),
      perc: clip('Tic', perc(16, { light: true }).filter(n => n.start < len(15)), len(16)),
      fx: clip('Coda', [hit(FX.impact, len(15), 70)], len(16)),
    },
  },
];

export const SOTTOSUOLO_LIVE: LiveSpec<SottosuoloLiveSound, TrackKey> = {
  name: 'Sottosuolo',
  bpm: SOTTOSUOLO_LIVE_BPM,
  master: {
    volumeDb: 0,
    effects: [
      eqOf('Master', 22, null, [[50, -2.5, 1.8], [10000, -4, 0.7, HIGH_SHELF]]),
      compressor('Colla', { threshold: -12, ratio: 2, knee: 8, attack: 30, release: 120, scHp: 90, auto: 0, makeup: 0 }),
      clipper('Master', { drive: 2.5, ceiling: -1, knee: 25 }),
      stereo('Bassi mono', { monoFreq: 110 }),
      limiter('Master', { gain: 7, ceiling: -0.8, release: 60, lookahead: 2 }),
    ],
  },
  tracks: TRACKS,
  scenes: SCENES,
  arrangement: SCENES.map((_, i) => i),
};

/** Le clip di una scena, per chi le vuole controllare. */
export const sottosuoloScene = (name: string): Partial<Record<TrackKey, ClipSpec>> | undefined => SCENES.find(s => s.name === name)?.clips;

/** Costruisce il live nel progetto (vuoto) dello store. */
export function buildSottosuoloLive(store: ProjectStore, sounds: Readonly<Record<SottosuoloLiveSound, SampleRef>>): void {
  buildLive(store, SOTTOSUOLO_LIVE, sounds);
}
