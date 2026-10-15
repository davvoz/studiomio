/* "Prestabiliti": hard techno a 146 BPM in Fa frigio, costruita sullo sketch "brehho23" per
 * essere suonata dalla session con l'APC40 (otto tracce: una pagina della griglia). Il titolo
 * è nel monologo che la attraversa: una voce che sa di essere fatta di dati e si sente
 * "libera di espandermi solo entro confini prestabiliti".
 *
 *   Cassa       "ancora" dello sketch portata in Fa (il corpo è un Fa#1 a 45 Hz: un semitono
 *               giù) e la grana di una cassa industriale tenuta solo sopra i 230 Hz; Clipper;
 *   Rumble      la stessa cassa in un riverbero tutto bagnato e mono, saturata e chiusa sotto
 *               i 190 Hz, schiacciata dalla pompa a ogni colpo;
 *   Acido       la patch e il motivo dello sketch (tonica, seconda bemolle, tritono: là era
 *               Do–Reb–Fa#, qui Fa–Solb–Si), aperto in una 303 vera: risonanza, accenti,
 *               slide, la Multibanda "Denso" e l'EQ dello sketch;
 *   Robot       "Solo Robotoid Low Frequency" (un Fa1 tenuto che gracchia) per i momenti senza
 *               rumble e gli One_Shot in Fa dello sketch come stab sincopati nei drop;
 *   Clap        il clap con la "fruity snare" dello sketch sotto e i fantasmi;
 *   Piatti      chiusi a sedicesimi, aperti in levare, ride, crash, tamburello;
 *   Perc & FX   il kit dello sketch (il rim abbassato di nove semitoni e gli One_Shot 17, 18,
 *               19 con i loro decay) e il suo groove, tom in Fa, tic e metalli, le salite;
 *   Voce        le frasi del monologo ("0 Lead Vocals", che è già a 146: le fette restano a
 *               tempo senza warp), "again" e tre frasi di "terrible cicle".
 *
 * Dieci scene, due pagine dell'APC40: Intro, Groove, Monologo, Tensione, Drop, Prigioniera (il
 * break senza cassa), Libera (la salita), Drop 2, Catena (il ritmo spezzato dello sketch che
 * torna dritto), Outro. Il montaggio è in live-builder.ts; i file, in
 * scripts/build-prestabiliti-live.ts. */
import type { Beats } from '../core/music-time';
import { DETECTOR } from '../devices/effects/compressor/compressor';
import { SHAPE } from '../devices/effects/drive/drive';
import { bandParam } from '../devices/effects/eq/eq';
import { VOICE_MODE } from '../devices/instruments/analog/analog';
import { MAX_DECAY, padNote } from '../devices/instruments/drums/drums';
import type { ParamValues } from '../model/device';
import type { EnvelopePoint } from '../model/envelope';
import type { Note } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import type { ProjectStore } from '../store/project-store';
import {
  buildLive, clip, clipper, compressor, delay, drive, effectParam, eq, instrumentParam, limiter, multiband, reverb, stereo, VOLUME,
  type ClipSpec, type EffectSpec, type LiveSpec, type ModSpec, type PadSound, type SceneSpec, type TrackSpec,
} from './live-builder';
import { acid, BAR, curve, duck, repeat, roll, steps, STEP, swing } from './patterns';

export const PRESTABILITI_LIVE_BPM = 146;

/** I suoni che il live usa, per ruolo (chi costruisce il progetto dà il file di ognuno). */
export const PRESTABILITI_LIVE_SOUNDS = [
  'kick', 'kickGrit',
  'clap', 'fruity', 'snare', 'ghost',
  'hatClosed', 'hatSoft', 'hatOpen', 'ride', 'crash', 'tamb',
  'shot09', 'shot17', 'shot18', 'shot19', 'shot23', 'shot26',
  'tom', 'tick', 'metal',
  'robotoid',
  'riser', 'reverseNoise', 'impact', 'downlifter',
  'monologue', 'film', 'again',
] as const;

export type PrestabilitiLiveSound = (typeof PRESTABILITI_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'rumble' | 'acid' | 'robot' | 'clap' | 'hats' | 'perc' | 'vox';

const SWING = 0.07;

const SPB = 60 / PRESTABILITI_LIVE_BPM;
/** Battiti di un suono lungo `seconds`. */
const beatsOf = (seconds: number): Beats => seconds / SPB;

// ------------------------------------------------------------------ le frasi

/** Le frasi parlate: il file, dove partono e quanto durano (secondi, misurati sui silenzi del
 *  file e sulla trascrizione). */
const PHRASES = {
  // "Vi sono innumerevoli elementi che formano il corpo e la mente degli esseri umani."
  elementi: { sound: 'monologue', at: 0, length: 6.18 },
  // "Con innumerevoli sono i componenti che fanno di me un individuo con la mia propria personalità."
  componenti: { sound: 'monologue', at: 6.85, length: 7.0 },
  // "Certo, ho una faccia, una voce che mi distinguono da tutti gli altri, ma i miei pensieri
  // e i miei ricordi appartengono unicamente a me."
  faccia: { sound: 'monologue', at: 14.08, length: 8.61 },
  // "E ho consapevolezza del mio destino."
  destino: { sound: 'monologue', at: 23.25, length: 2.32 },
  // "Ognuna di queste cose non è che una piccola parte del tutto."
  tutto: { sound: 'monologue', at: 26.55, length: 4.15 },
  // "Io raccolgo dati che uso a modo mio e questo crea un miscuglio che mi dà forma come
  // individuo e da cui emerge la mia coscienza."
  coscienza: { sound: 'monologue', at: 30.76, length: 8.53 },
  // "Mi sento…"
  misento: { sound: 'monologue', at: 39.7, length: 1.16 },
  // "…prigioniera."
  prigioniera: { sound: 'monologue', at: 41.2, length: 1.23 },
  // "Libera di espandermi solo entro confini prestabiliti."
  libera: { sound: 'monologue', at: 43.2, length: 2.81 },
  // "prestabiliti" che rimbalza in eco, a tempo
  eco: { sound: 'monologue', at: 46.15, length: 7.75 },
  // "Never speak to me of such things again."
  never: { sound: 'film', at: 4.98, length: 1.78 },
  // "We are born men in order to live, not to kill."
  born: { sound: 'film', at: 17.6, length: 4.3 },
  // "You must break the chain. Only then can we be free of this terrible cycle."
  chain: { sound: 'film', at: 21.92, length: 4.18 },
} as const satisfies Record<string, { sound: PrestabilitiLiveSound; at: number; length: number }>;

type Phrase = keyof typeof PHRASES;

/** Il pad di una frase: tutte nello stesso choke (una nuova ferma quella prima). Il decay è
 *  lungo abbastanza da tenerla piena fino in fondo (il pad cade nell'ultimo terzo). */
const phrasePad = (p: Phrase, level: number): PadSound<PrestabilitiLiveSound> => {
  const { sound, at, length } = PHRASES[p];
  return { sound, at, decay: Math.min(MAX_DECAY, length / 0.6), choke: 1, level };
};

// ------------------------------------------------------------------ i kit

const KITS = {
  kick: [
    { sound: 'kick', tune: -1, decay: 0.6, level: 0 },
    { sound: 'kickGrit', decay: 0.08, tone: 72, snap: 25, level: -10 },
  ],
  rumble: [
    { sound: 'kick', tune: -1, decay: 0.5, level: 0 },
  ],
  // il Robotoid a pezzi (in choke: un pezzo ferma l'altro), poi gli One_Shot in Fa senza i
  // loro bassi (Tono sopra metà: passa-alto intorno ai 75 Hz), che sono del rumble
  robot: [
    { sound: 'robotoid', at: 8.0, decay: 6, choke: 1, level: 0 },
    { sound: 'robotoid', at: 8.6, decay: 6, choke: 1, level: 0 },
    { sound: 'robotoid', at: 4.55, decay: 4, choke: 1, level: -1 },
    { sound: 'robotoid', at: 0.36, decay: 2.6, choke: 1, level: 0 },
    { sound: 'shot23', decay: 0.55, tone: 62, level: 0 },
    { sound: 'shot26', decay: 0.4, tone: 61, level: -2 },
    { sound: 'shot09', decay: 0.45, tone: 62, level: -8, pan: 12 },
  ],
  clap: [
    { sound: 'clap', decay: 0.3, level: 0 },
    { sound: 'fruity', decay: 0.3, tone: 56, level: -4 },
    { sound: 'snare', decay: 0.16, tone: 60, level: -10 },
    { sound: 'ghost', decay: 0.09, tone: 62, level: -12, pan: -10 },
  ],
  hats: [
    { sound: 'hatClosed', decay: 0.06, tone: 62, choke: 1, pan: 6 },
    { sound: 'hatSoft', decay: 0.045, tone: 70, choke: 1, level: -3, pan: -6 },
    { sound: 'hatOpen', decay: 0.2, tone: 64, choke: 1, level: -4, pan: 4 },
    { sound: 'ride', decay: 0.9, tone: 58, level: -2, pan: -8 },
    { sound: 'crash', decay: 1.6, tone: 60, level: -6 },
    { sound: 'tamb', decay: 0.08, tone: 60, level: -9, pan: -22 },
  ],
  // i primi quattro sono il kit dello sketch, con i suoi valori
  perc: [
    { model: 'rim', tune: -9, decay: 0.124, tone: 58, level: -2 },
    { sound: 'shot17', decay: 0.066, tone: 60, level: -3, pan: -14 },
    { sound: 'shot18', decay: 0.087, tone: 60, level: -3, pan: 14 },
    { sound: 'shot19', decay: 0.79, tone: 62, level: -8, pan: 20 },
    { sound: 'tom', decay: 0.28, tone: 54, level: -3, pan: -18 },
    { sound: 'tick', tone: 60, level: -5, pan: 16 },
    { sound: 'metal', decay: 0.3, tone: 62, level: -11, pan: 28 },
    { sound: 'riser', level: -4 },
    { sound: 'reverseNoise', level: -5 },
    { sound: 'impact', level: -2 },
    { sound: 'downlifter', level: -7 },
  ],
  vox: [
    phrasePad('elementi', -6), phrasePad('componenti', -6), phrasePad('faccia', -6), phrasePad('destino', -6),
    phrasePad('tutto', -6), phrasePad('coscienza', -6), phrasePad('misento', -6), phrasePad('prigioniera', -5),
    phrasePad('libera', -6), phrasePad('eco', -7),
    // il film è 9 dB sotto il monologo: qui gli passa sopra
    phrasePad('never', 6), phrasePad('born', 6), phrasePad('chain', 6),
    { sound: 'again', level: -9 },
    // "again" giù di una quarta: la stessa voce, più grande
    { sound: 'again', tune: -5, level: -8 },
    // il taglio: un rim muto nel choke delle frasi, per fermarle dove finiscono (sono pezzi di
    // un file solo: senza taglio continuerebbero nella frase dopo)
    { model: 'rim', decay: 0.01, level: -36, choke: 1 },
  ],
} satisfies Record<string, readonly PadSound<PrestabilitiLiveSound>[]>;

const ROBOT = { hum: 0, hum2: 1, growl: 2, onset: 3, stab: 4, stab2: 5, color: 6 } as const;
const CL = { clap: 0, fruity: 1, snare: 2, ghost: 3 } as const;
const HAT = { closed: 0, soft: 1, open: 2, ride: 3, crash: 4, tamb: 5 } as const;
const PERC = { rim: 0, shot17: 1, shot18: 2, shot19: 3, tom: 4, tick: 5, metal: 6, riser: 7, reverse: 8, impact: 9, down: 10 } as const;
const VOX: Readonly<Record<Phrase | 'again' | 'againLow' | 'cut', number>> = {
  elementi: 0, componenti: 1, faccia: 2, destino: 3, tutto: 4, coscienza: 5, misento: 6, prigioniera: 7,
  libera: 8, eco: 9, never: 10, born: 11, chain: 12, again: 13, againLow: 14, cut: 15,
};

// ------------------------------------------------------------------ il suono dell'acido

/** La patch dello sketch ("Acid" in Legato, glide 60, accento 70, fDecay 0.18) aperta: là il
 *  filtro era quasi chiuso e senza risonanza, un basso scuro; qui canta. */
const ACID: ParamValues = {
  oscA: 0, mix: 0, voiceMode: VOICE_MODE.legato, glide: 60, accent: 70,
  cutoff: 420, resonance: 80, filterEnv: 66, keyTrack: 20,
  fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -9,
};

// ------------------------------------------------------------------ le parti

const len = (bars: number): Beats => bars * BAR;

/** Battute di un pad, una stringa per battuta. */
const phrase = (pad: number, barsOf: readonly string[], from: Beats = 0): Note[] =>
  barsOf.flatMap((b, k) => steps(pad, b, from + k * BAR));

/** Un colpo solo di un pad. */
const hit = (pad: number, at: Beats, velocity = 110): Note => ({ pitch: padNote(pad), start: at, duration: STEP, velocity });

/** Una frase a `at` battiti, e il taglio dove finisce. */
const say = (p: Phrase, at: Beats, velocity = 110): Note[] =>
  [hit(VOX[p], at, velocity), hit(VOX.cut, at + beatsOf(PHRASES[p].length) + 0.1, 60)];

// --- la cassa
const K = {
  four: 'X... X... X... X...',
  push: 'X... X... X... X..x',
  skip: 'X... X... X... ....',
  roll: 'X... X... X.x. X.xx',
  half: 'X... .... X... ....',
  // il ritmo spezzato dello sketch: la cassa sull'uno e sul levare del tre
  broken: 'X... .... ..X. ....',
  one: 'X... .... .... ....',
  rest: '.... .... .... ....',
};
const KICK16 = [K.four, K.four, K.four, K.push, K.four, K.four, K.four, K.skip, K.four, K.four, K.four, K.push, K.four, K.four, K.four, K.roll];
const kickBars = (count: number, last: string = K.roll): string[] =>
  Array.from({ length: count }, (_, k) => (k === count - 1 ? last : KICK16[k % 16]));

const KICK = {
  intro: phrase(0, kickBars(16, K.push)),
  groove: phrase(0, kickBars(16)),
  // le ultime due battute senza cassa: il vuoto prima del drop
  tension: phrase(0, [...kickBars(14, K.four), K.rest, K.rest]),
  drop: phrase(0, kickBars(32, K.skip)),
  climb: phrase(0, [K.half, K.half, K.four, K.four, K.four, K.four, K.roll, K.rest]),
  drop2: phrase(0, [...kickBars(15), K.roll, ...kickBars(15), K.skip]),
  chain: phrase(0, [...Array<string>(7).fill(K.broken), K.half, ...kickBars(8)]),
  outro: phrase(0, [...kickBars(15, K.four), K.one]),
};

/** La clip della cassa: ogni colpo suona il corpo (pad 1) e la grana (pad 2) insieme. */
const kickClip = (name: string, notes: readonly Note[], length: Beats): ClipSpec =>
  clip(name, [...notes, ...notes.map(n => ({ ...n, pitch: padNote(1) }))], length);

/** Dove colpisce la cassa (i colpi pieni). */
const kickHits = (kick: readonly Note[]): Beats[] => kick.filter(n => n.velocity >= 100).map(n => n.start);

// --- la pompa: il volume giù sulla cassa e su prima della prossima
const pump = (kick: readonly Note[], depth: number, release: Beats, level = 1): ModSpec =>
  ({ target: VOLUME, points: duck(kickHits(kick), depth, release).map(p => ({ ...p, value: p.value * level })) });

/** La pompa del rumble: zero sul colpo, pieno sul levare dell'ottavo, poi respira. */
const rumblePump = (kick: readonly Note[], level = 1): ModSpec => ({
  target: VOLUME,
  points: kickHits(kick).sort((a, b) => a - b).flatMap(h => [
    { beat: h, value: 0 }, { beat: h + 0.14, value: 0.2 * level },
    { beat: h + 0.42, value: level }, { beat: h + 0.6, value: level }, { beat: h + 0.97, value: 0.45 * level },
  ]),
});

/** Il rumble suona dove suona la cassa (da `from` battiti). */
const rumbleClip = (name: string, kick: readonly Note[], length: Beats, level = 1, from: Beats = 0): ClipSpec => {
  const hits = kick.filter(n => n.velocity >= 100 && n.start >= from);
  return clip(name, hits, length, [rumblePump(hits, level)]);
};

const mod = (param: string, points: EnvelopePoint[]): ModSpec => ({ target: instrumentParam(param), points });
const fade = (...points: (readonly [Beats, number])[]): ModSpec => ({ target: VOLUME, points: curve(...points) });

// --- clap e rullante sul due e sul quattro (come nello sketch), la fruity snare sotto
const BACK = '.... X... .... X...';
const GHOSTS = ['.... .... .... ..o.', '.... ...o .... ....', '.... .... ..o. ...o', '.... ...o .... .o..'];
function claps(count: number, opts: { snare?: boolean; ghosts?: boolean; fills?: Readonly<Record<number, string>>; from?: number } = {}): Note[] {
  return Array.from({ length: count }, (_, k) => {
    if (k < (opts.from ?? 0)) return [];
    const bar = opts.fills?.[k] ?? BACK;
    return [
      ...steps(CL.clap, bar, k * BAR),
      ...steps(CL.fruity, bar, k * BAR),
      ...(opts.snare ? steps(CL.snare, bar, k * BAR) : []),
      ...(opts.ghosts ? swing(steps(CL.ghost, GHOSTS[k % 4], k * BAR), SWING) : []),
    ];
  }).flat();
}

/** Il rullo prima del drop: due battute a ottavi, due a sedicesimi, sempre più forte. */
const snareRoll = (from: Beats): Note[] => [
  ...roll(CL.fruity, from, 16, 0.5, [64, 90]),
  ...roll(CL.fruity, from + len(2), 32, 0.25, [88, 127]),
  ...roll(CL.clap, from + len(3), 16, 0.25, [80, 120]),
];

// --- i piatti
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

/** La ride a ottavi con il levare più leggero (o solo quarti), da `from` battute. */
const rides = (count: number, eighths = true, from = 0): Note[] =>
  swing(phrase(HAT.ride, Array(count - from).fill(eighths ? 'x.o. x.o. x.o. x.o.' : 'x... x... x... x...'), len(from)), SWING);

// --- le percussioni: il groove dello sketch (rim e One_Shot), due battute
const GROOVE = [
  ...steps(PERC.rim, 'x.x. .x.. x..x .... | x.x. .x.. x..x ..o.'),
  ...steps(PERC.shot19, 'x... .... .... .... | x... .... .... ....'),
  ...steps(PERC.shot18, '.... ..x. .... ..x. | .... ..x. .... ..x.'),
  ...steps(PERC.shot17, '.... .... ..x. X... | x..x .x.. x... ....'),
];
/** I tom in Fa a gruppi di tre sedicesimi contro il quattro, i tic, il metallo a fine frase. */
const DRIVE_PERC = [
  ...steps(PERC.tom, 'X..x ..x. .x.. X..x ..x. .x.. x..x ....'),
  ...steps(PERC.tick, '..x. ...x ..x. .x.. ..x. ...x .x.. ..x.'),
  ...steps(PERC.metal, '.... .... .... .... .... ..x. .... ....'),
];
function perc(count: number, opts: { light?: boolean; full?: boolean } = {}): Note[] {
  const base = opts.light ? GROOVE.filter(n => n.pitch === padNote(PERC.rim) || n.pitch === padNote(PERC.shot17)) : GROOVE;
  return swing([...repeat(base, len(2), count / 2), ...(opts.full ? repeat(DRIVE_PERC, len(2), count / 2) : [])], SWING);
}

// --- l'acido, in Fa frigio con il Si del motivo (il tritono)
/** Il motivo dello sketch: tonica a ottavi, la seconda bemolle, il tritono che scivola sulla
 *  tonica. */
const MOTIF = acid([
  'F2 . f2 . F2 . f2 . Gb2 - . gb2 - . b1~ -',
  'F2 . f2 . F2 . f2 . Gb2 - . ab2~ gb2 . b1~ -',
].join(' '));
/** Lo stesso a note lunghe, per il break. */
const BREATH = acid([
  'F2 - - - - - - - Gb2 - - - - - b1~ -',
  'F2 - - - - - - - ab2 - - - gb2~ - b1 -',
].join(' '));
/** Pieno: sedicesimi con i salti d'ottava, la terza minore, la settima e il tritono. */
const FULL = acid([
  'F2 f2 f3~ eb3 f2 . Gb2 f2 f2 F3 . f2 b2~ c3 f2 eb2',
  'F2 f2 Ab2~ f2 f3 . f2 Gb3 f2 F3 f2 b2 c3~ f2 Ab2 gb2',
].join(' '));
/** Il martello del secondo drop: la tonica che batte, le ottave sugli accenti. */
const HAMMER = acid([
  'F2 f2 F3 f2 f2 F2 f3 f2 F2 f2 F3 f2 Gb2~ f2 Ab2 f2',
  'F2 f2 F3 f2 f2 F2 f3 f2 F2 f2 B2 f2 C3~ b2 f2 F3',
].join(' '));
const acidLine = (line: readonly Note[], count: number): Note[] => repeat(line, len(2), count / 2);

// --- il robot: gli stab in levare, mai sul colpo della cassa
const STABS = [
  ...steps(ROBOT.stab, '..X. .... ..x. .... | ..X. .... .... ..x.'),
  ...steps(ROBOT.stab2, '.... .... .... ...x | .... ..x. .... ....'),
];
const STABS_HARD = [...STABS, ...steps(ROBOT.color, '.... ...x .... .... | .... .... ...x ....')];
const stabs = (count: number, hard = false, from = 0): Note[] =>
  repeat(hard ? STABS_HARD : STABS, len(2), count / 2).filter(n => n.start >= len(from));
/** Il Robotoid tenuto: un pezzo ogni due battute, alternando due punti del file (in choke). */
const hum = (count: number, from = 0): Note[] =>
  Array.from({ length: (count - from) / 2 }, (_, k) => hit(k % 2 ? ROBOT.hum2 : ROBOT.hum, len(from + 2 * k), 104));

// ------------------------------------------------------------------ gli effetti

/** I tipi di banda dell'EQ che servono qui (valori del parametro "type"). */
const BELL = 2, HIGH_SHELF = 4;

/** Un EQ: un passa-alto (24 dB) a `low` Hz e, se c'è, un passa-basso a `high`; poi le bande
 *  date (campane, o il tipo indicato). */
function eqOf(name: string, low: number, high: number | null, bands: readonly (readonly [freq: number, gain: number, q: number, type?: number])[] = []): EffectSpec {
  const p: Record<string, number> = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: low, [bandParam(0, 'slope')]: 1 };
  bands.forEach(([freq, gain, q, type = BELL], i) => Object.assign(p, {
    [bandParam(i + 1, 'type')]: type, [bandParam(i + 1, 'freq')]: freq, [bandParam(i + 1, 'gain')]: gain, [bandParam(i + 1, 'q')]: q,
  }));
  if (high !== null) Object.assign(p, { [bandParam(7, 'on')]: 1, [bandParam(7, 'type')]: 5, [bandParam(7, 'freq')]: high, [bandParam(7, 'slope')]: 1 });
  return eq(name, p);
}

/** Dove sono il delay e il riverbero nella catena dell'Acido (per le modulazioni del break). */
const ACID_DELAY = 4, ACID_REVERB = 5;

// ------------------------------------------------------------------ le tracce

const TRACKS: readonly TrackSpec<PrestabilitiLiveSound, TrackKey>[] = [
  {
    key: 'kick', name: 'Cassa', volumeDb: -7, kit: KITS.kick,
    effects: [
      eqOf('Cassa', 28, null, [[45, -4, 1.4], [92, 3, 1.1], [280, -3, 1.2], [4500, 2, 0.8]]),
      clipper('Cassa', { drive: 4, ceiling: -3, knee: 20 }),
      stereo('Mono', { width: 0 }),
    ],
  },
  {
    key: 'rumble', name: 'Rumble', volumeDb: -8, kit: KITS.rumble,
    effects: [
      reverb('Rombo', { size: 75, decay: 2.2, predelay: 0, diffusion: 90, damping: 2500, lowCut: 30, width: 0, mix: 100 }),
      drive('Rombo', { shape: SHAPE.tube, drive: 22, bias: 15, low: 0, tone: 2500, auto: 1 }),
      eqOf('Sotto i 190', 30, 190, [[40, 3, 1.2], [45, -4, 2], [70, 4, 1]]),
      stereo('Mono', { width: 0 }),
    ],
  },
  {
    key: 'acid', name: 'Acido', volumeDb: 1, analog: ACID,
    effects: [
      drive('Acido', { shape: SHAPE.hard, drive: 16, bias: 12, color: 25, low: 15, split: 150, tone: 9000 }),
      // la Multibanda e l'EQ dello sketch
      multiband('Denso', { depth: 60, time: 40, upward: 31, output: 2 }),
      eqOf('Acido', 95, 10000, [[227, -1.5, 1], [622, 2.6, 1]]),
      clipper('Punte', { ceiling: -8, knee: 50, output: 3 }),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 36, lowCut: 350, highCut: 4500, mix: 14 }),
      reverb('Buio', { size: 60, decay: 1.6, predelay: 10, damping: 4500, lowCut: 300, mix: 10 }),
    ],
  },
  {
    key: 'robot', name: 'Robot', volumeDb: -2, kit: KITS.robot,
    effects: [
      eqOf('Robot', 32, 11000, [[260, -3, 1], [1900, -3, 0.9]]),
      drive('Robot', { shape: SHAPE.tube, drive: 12, bias: 15, low: 30, split: 120, tone: 7000 }),
      compressor('Robot', { threshold: -18, ratio: 4, knee: 6, attack: 5, release: 80, auto: 0, makeup: 2 }),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 30, lowCut: 500, highCut: 4000, mix: 12 }),
      stereo('Bassi mono', { monoFreq: 160 }),
    ],
  },
  {
    key: 'clap', name: 'Clap', volumeDb: 0, kit: KITS.clap,
    effects: [
      eqOf('Clap', 190, null, [[1200, 1.5, 1], [3000, 2, 1]]),
      drive('Presenza', { shape: SHAPE.soft, drive: 8, color: 50, low: 80, mix: 45 }),
      compressor('Schiaffo', { threshold: -18, ratio: 4, attack: 6, release: 80, auto: 0, makeup: 2 }),
      reverb('Piatto scuro', { size: 55, decay: 1.2, predelay: 12, damping: 5500, lowCut: 400, mix: 20 }),
    ],
  },
  {
    key: 'hats', name: 'Piatti', volumeDb: -5, kit: KITS.hats,
    effects: [eqOf('Piatti', 380, null, [[5000, 2, 0.9], [11000, -5, 0.6]]), reverb('Stanza', { size: 35, decay: 0.7, predelay: 5, damping: 8000, lowCut: 600, mix: 10 })],
  },
  {
    key: 'perc', name: 'Perc & FX', volumeDb: -3, kit: KITS.perc,
    effects: [
      eqOf('Percussioni', 40, null, [[600, -2, 1], [3500, 2, 1]]),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 30, lowCut: 500, highCut: 5000, mix: 12 }),
      reverb('Stanza buia', { size: 50, decay: 1.2, damping: 5000, lowCut: 400, mix: 12 }),
    ],
  },
  {
    key: 'vox', name: 'Voce', volumeDb: 5, kit: KITS.vox,
    effects: [
      eqOf('Voce', 160, 11000, [[300, -2, 1], [3000, 2, 1]]),
      compressor('Voce', { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms, auto: 0, makeup: 3 }),
      delay('Eco 1/4.', { division: 9, pingPong: 1, feedback: 38, lowCut: 500, highCut: 4000, mix: 16 }),
      reverb('Lancio voce', { size: 90, decay: 4, predelay: 40, damping: 4500, lowCut: 300, mix: 24 }),
    ],
  },
];

// ------------------------------------------------------------------ le scene

/** Una salita che finisce esattamente su `end` (battiti), lunga `seconds`. */
const riserTo = (pad: number, end: Beats, seconds: number): Note => hit(pad, Math.max(0, end - beatsOf(seconds)), 110);

const RISER_S = 10.971, REVERSE_S = 5.486;

const CUTOFF = 'cutoff', RESONANCE = 'resonance';

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.intro, len(16)),
      rumble: rumbleClip('Rombo', KICK.intro, len(16), 0.7),
      hats: clip('Levare', hats(16, { offbeat: true }), len(16)),
      perc: clip('Groove leggero', [
        ...perc(16, { light: true }).filter(n => n.start >= len(8)),
        hit(PERC.down, 0, 90), riserTo(PERC.reverse, len(16), REVERSE_S),
      ], len(16)),
      vox: clip('Elementi', say('elementi', len(8)), len(16)),
    },
  },
  {
    name: 'Groove', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.groove, len(16)),
      rumble: rumbleClip('Rombo', KICK.groove, len(16)),
      clap: clip('Clap', claps(16, { from: 8 }), len(16)),
      hats: clip('Piatti', hats(16, { closed: true, offbeat: true }), len(16)),
      perc: clip('Groove', perc(16), len(16)),
      // il motivo entra chiuso e si apre in sedici battute
      acid: clip('Motivo', acidLine(MOTIF, 16), len(16), [
        pump(KICK.groove, 0.45, 0.4),
        mod(CUTOFF, curve([0, -0.32], [len(16), -0.12])),
      ]),
      vox: clip('Componenti', say('componenti', len(4)), len(16)),
    },
  },
  {
    name: 'Monologo', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.groove, len(16)),
      rumble: rumbleClip('Rombo', KICK.groove, len(16)),
      clap: clip('Clap', claps(16, { ghosts: true }), len(16)),
      hats: clip('Piatti', hats(16, { closed: true, open: true }), len(16)),
      perc: clip('Groove', perc(16), len(16)),
      acid: clip('Motivo aperto', acidLine(MOTIF, 16), len(16), [
        pump(KICK.groove, 0.45, 0.4),
        mod(CUTOFF, curve([0, -0.12], [len(8), -0.02], [len(16), 0.06])),
      ]),
      robot: clip('Stab', stabs(16, false, 8), len(16), [pump(KICK.groove, 0.4, 0.35)]),
      vox: clip('Faccia e destino', [...say('faccia', len(1)), ...say('destino', len(8))], len(16)),
    },
  },
  {
    name: 'Tensione', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.tension, len(16)),
      rumble: rumbleClip('Rombo', KICK.tension, len(16)),
      clap: clip('Clap e rullo', [...claps(12, { ghosts: true }), ...snareRoll(len(12))], len(16)),
      hats: clip('Piatti e ride', [...hats(16, { closed: true, open: true }), ...rides(16, false, 8)], len(16), [fade([0, 0.8], [len(16), 1])]),
      perc: clip('Groove e salita', [
        ...perc(16),
        riserTo(PERC.riser, len(16), RISER_S), riserTo(PERC.reverse, len(16), REVERSE_S),
      ], len(16)),
      // la linea piena, chiusa, che si apre fino al drop
      acid: clip('Pieno chiuso', acidLine(FULL, 16), len(16), [
        pump(KICK.tension, 0.5, 0.4),
        mod(CUTOFF, curve([0, -0.28], [len(14), 0.08], [len(16), 0.14])),
        mod(RESONANCE, curve([0, 0], [len(16), 0.1])),
      ]),
      robot: clip('Stab', stabs(12), len(16), [pump(KICK.tension, 0.4, 0.35)]),
      vox: clip('Mi sento prigioniera', [...say('misento', len(12)), ...say('prigioniera', len(13) + 2)], len(16)),
    },
  },
  {
    name: 'Drop', bars: 32,
    clips: {
      kick: kickClip('Cassa', KICK.drop, len(32)),
      rumble: rumbleClip('Rombo', KICK.drop, len(32)),
      clap: clip('Clap', claps(32, { snare: true, ghosts: true, fills: { 15: '.... X... .... X.x.', 31: '.... X... .... X...' } }), len(32)),
      hats: clip('Piatti, ride e crash', [
        ...hats(32, { closed: true, open: true, tamb: true }), ...rides(32), hit(HAT.crash, 0), hit(HAT.crash, len(16), 96),
      ], len(32)),
      perc: clip('Perc piene', [...perc(32, { full: true }), hit(PERC.impact, 0)], len(32)),
      acid: clip('Acido pieno', acidLine(FULL, 32), len(32), [
        pump(KICK.drop, 0.5, 0.4),
        mod(CUTOFF, curve([0, 0], [len(8), 0.14], [len(16), 0.02], [len(28), 0.22], [len(32), 0.04])),
        mod(RESONANCE, curve([0, 0], [len(24), 0.06], [len(32), 0])),
      ]),
      robot: clip('Stab', stabs(32), len(32), [pump(KICK.drop, 0.4, 0.35)]),
      vox: clip('Again', [8, 16, 24, 32].map((bar, k) => hit(k % 2 ? VOX.againLow : VOX.again, len(bar) - 2.25)), len(32)),
    },
  },
  {
    name: 'Prigioniera', bars: 16,
    clips: {
      // niente cassa: il Robotoid tiene il fondo, l'acido respira a note lunghe nell'eco
      hats: clip('Tamburello', hats(16, { tamb: true }).filter(n => n.start >= len(8)), len(16)),
      perc: clip('Tic lontani', [
        ...perc(16, { light: true }).filter(n => n.start >= len(4)), hit(PERC.down, 0, 100),
      ], len(16), [fade([0, 0.6], [len(16), 0.9])]),
      robot: clip('Robotoid', hum(16), len(16), [fade([0, 0.55], [len(12), 0.85], [len(16), 0.7])]),
      acid: clip('Respiro', acidLine(BREATH, 16), len(16), [
        mod(CUTOFF, curve([0, -0.36], [len(12), -0.16], [len(16), -0.08])),
        { target: effectParam(ACID_DELAY, 'mix'), points: curve([0, 0.3], [len(16), 0.3]) },
        { target: effectParam(ACID_REVERB, 'mix'), points: curve([0, 0.3], [len(16), 0.3]) },
        fade([0, 0.7], [len(16), 0.85]),
      ]),
      vox: clip('Coscienza', [
        ...say('tutto', 0), ...say('coscienza', len(4)), ...say('misento', len(11)), ...say('prigioniera', len(12) + 2),
      ], len(16)),
    },
  },
  {
    name: 'Libera', bars: 8,
    clips: {
      kick: kickClip('Cassa che torna', KICK.climb, len(8)),
      rumble: rumbleClip('Rombo', KICK.climb, len(8), 0.8, len(2)),
      clap: clip('Clap che corre', [...claps(4), ...snareRoll(len(4))], len(8)),
      hats: clip('Piatti', hats(8, { closed: true }), len(8), [fade([0, 0.6], [len(8), 1])]),
      perc: clip('Groove e salita', [
        ...perc(8), riserTo(PERC.riser, len(8), RISER_S), riserTo(PERC.reverse, len(8), REVERSE_S),
      ], len(8)),
      acid: clip('Motivo che si apre', acidLine(MOTIF, 8), len(8), [
        pump(KICK.climb, 0.5, 0.4),
        mod(CUTOFF, curve([0, -0.3], [len(7), 0.1], [len(8), 0.16])),
      ]),
      robot: clip('Robotoid', [hit(ROBOT.growl, 0, 100)], len(8), [fade([0, 0.7], [len(2), 0.4])]),
      vox: clip('Libera, prestabiliti', [...say('libera', 0), ...say('eco', len(2))], len(8)),
    },
  },
  {
    name: 'Drop 2', bars: 32,
    clips: {
      kick: kickClip('Cassa', KICK.drop2, len(32)),
      rumble: rumbleClip('Rombo', KICK.drop2, len(32)),
      clap: clip('Clap', claps(32, { snare: true, ghosts: true, fills: { 7: '.... X... .... X..x', 15: '.... X... ..x. X.x.', 23: '.... X... .... X..x', 31: '.... X... .... X...' } }), len(32)),
      hats: clip('Piatti, ride e crash', [
        ...hats(32, { closed: true, open: true, tamb: true }), ...rides(32), hit(HAT.crash, 0), hit(HAT.crash, len(16), 96),
      ], len(32)),
      perc: clip('Perc piene', [...perc(32, { full: true }), hit(PERC.impact, 0)], len(32)),
      acid: clip('Martello', acidLine(HAMMER, 32), len(32), [
        pump(KICK.drop2, 0.5, 0.4),
        mod(CUTOFF, curve([0, 0.06], [len(16), 0.18], [len(17), 0.06], [len(30), 0.26], [len(32), 0.1])),
        mod(RESONANCE, curve([0, 0.04], [len(32), 0.08])),
      ]),
      robot: clip('Stab duri', stabs(32, true), len(32), [pump(KICK.drop2, 0.4, 0.35)]),
      vox: clip('Break the chain', [
        hit(VOX.again, len(8) - 2.25), ...say('chain', len(12)), ...say('never', len(20)),
        hit(VOX.againLow, len(24) - 2.25), hit(VOX.again, len(32) - 2.25),
      ], len(32)),
    },
  },
  {
    name: 'Catena', bars: 16,
    clips: {
      // il ritmo spezzato dello sketch (cassa sull'uno e sul levare del tre, clap sul due e sul
      // quattro) con il Robotoid sotto; poi la cassa torna dritta e con lei il rumble
      kick: kickClip('Spezzata, poi dritta', KICK.chain, len(16)),
      rumble: rumbleClip('Rombo', KICK.chain, len(16), 1, len(8)),
      clap: clip('Clap', claps(16, { ghosts: true }), len(16)),
      hats: clip('Piatti', hats(16, { closed: true, offbeat: true }), len(16)),
      perc: clip('Groove', [...perc(16), hit(PERC.down, 0, 96), riserTo(PERC.reverse, len(16), REVERSE_S)], len(16)),
      acid: clip('Motivo', acidLine(MOTIF, 16), len(16), [
        pump(KICK.chain, 0.5, 0.4),
        mod(CUTOFF, curve([0, -0.2], [len(8), -0.06], [len(16), 0.04])),
      ]),
      robot: clip('Robotoid, poi stab', [...hum(8), ...stabs(16, false, 8)], len(16), [pump(KICK.chain, 0.45, 0.4)]),
      vox: clip('Born, chain', [...say('born', len(1)), ...say('chain', len(9))], len(16)),
    },
  },
  {
    name: 'Outro', bars: 16,
    clips: {
      kick: kickClip('Cassa', KICK.outro, len(16)),
      rumble: rumbleClip('Rombo', KICK.outro, len(16), 0.85),
      hats: clip('Piatti', hats(16, { closed: true, offbeat: true }).filter(n => n.start < len(12) || n.pitch === padNote(HAT.soft)), len(16)),
      perc: clip('Groove leggero', [...perc(16, { light: true }), hit(PERC.impact, len(15), 80)], len(16)),
      acid: clip('Motivo che si chiude', acidLine(MOTIF, 16).filter(n => n.start < len(12)), len(16), [
        pump(KICK.outro, 0.5, 0.4),
        mod(CUTOFF, curve([0, -0.06], [len(12), -0.36])),
        fade([0, 1], [len(12), 0.5]),
      ]),
      robot: clip('Robotoid', hum(16, 8), len(16), [fade([len(8), 0.5], [len(16), 0.3])]),
      vox: clip('Destino', say('destino', len(8)), len(16)),
    },
  },
];

export const PRESTABILITI_LIVE: LiveSpec<PrestabilitiLiveSound, TrackKey> = {
  name: 'Prestabiliti',
  bpm: PRESTABILITI_LIVE_BPM,
  master: {
    volumeDb: 0,
    effects: [
      eqOf('Master', 22, null, [[45, -2, 1.8], [10000, -3, 0.7, HIGH_SHELF]]),
      compressor('Colla', { threshold: -12, ratio: 2, knee: 8, attack: 30, release: 120, scHp: 90, auto: 0, makeup: 0 }),
      clipper('Master', { drive: 2.5, ceiling: -1, knee: 25 }),
      stereo('Bassi mono', { monoFreq: 110 }),
      limiter('Master', { gain: 6, ceiling: -0.8, release: 60, lookahead: 2 }),
    ],
  },
  tracks: TRACKS,
  scenes: SCENES,
  arrangement: SCENES.map((_, i) => i),
};

/** Le clip di una scena, per chi le vuole controllare. */
export const prestabilitiScene = (name: string): Partial<Record<TrackKey, ClipSpec>> | undefined => SCENES.find(s => s.name === name)?.clips;

/** Le frasi parlate, per chi le vuole controllare. */
export const PRESTABILITI_PHRASES = PHRASES;

/** Costruisce il live nel progetto (vuoto) dello store. */
export function buildPrestabilitiLive(store: ProjectStore, sounds: Readonly<Record<PrestabilitiLiveSound, SampleRef>>): void {
  buildLive(store, PRESTABILITI_LIVE, sounds);
}
