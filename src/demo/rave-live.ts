/* "Rave illegale": hard techno a 145 BPM in Do frigio con il tritono (il motivo Do–Reb–Fa# di
 * brehho23), pensato come uno strumento da suonare per mezz'ora e più, non come una traccia.
 * Otto tracce (una pagina dell'APC40), ognuna un rack con le sue 8 macro sulle manopole Device
 * Control, e scene a "atti" che sono punti di partenza: le clip di ogni colonna si lanciano anche
 * da sole, sopra qualunque scena.
 *
 *   1 Cassa     solo casse: otto corpi diversi (ancora di brehho23, compressa, secca, martello,
 *               distorta, industriale, gabber, boom), uno per clip; le macro aggiungono la grana
 *               industriale e il click, accordano, accorciano, saturano, chiudono il filtro (la
 *               cassa sentita da fuori) e la mandano nel rimbombo (le casse isolate dei break);
 *   2 Colpi     clap, rullanti, rim, colpi metallici e industriali: ogni colpo del rullante
 *               suona tutti gli strati e le macro decidono quali si sentono; Rullata (tasto A) è
 *               un Beat Repeat a pulsante: una rullata sopra qualunque pattern;
 *   3 Piatti    chiusi, aperti, ride, shaker, metalli e un top loop a fette: ogni clip li ha
 *               tutti, le macro ne alzano e abbassano la densità, Apertura allunga gli aperti;
 *   4 Levare    Neuro: il basso in levare, rotolante, galoppo, Goa, trance, dembow, compresso e
 *               in sidechain sulla cassa (pompa con la cassa che c'è davvero); dalla sua tonica
 *               (il Do a 65 Hz, come in brehho23) lascia i 49 Hz alla cassa (accordata in Sol);
 *   5 Acido     Analog come una 303 con il sequencer a passi: le clip "Seq" tengono solo la
 *               tonica (o il giro) e il giro di note lo scrive il sequencer; Pattern ne sceglie
 *               uno (entra all'inizio del giro), Follia porta da un acido minimale a uno
 *               frenetico. Le altre clip sono le linee scritte di brehho23. Due rack: la 303 e
 *               i suoi effetti (distorsione, taglio a passi, phaser, eco, Ripeti);
 *   6 Sampler   32 suoni in quattro banchi di otto tasti: Metallo (C1), Tamburi (G#1, il kit
 *               di brehho23), Macchine (E2), Voci (C3); le macro li accordano, accorciano,
 *               filtrano, li fanno partire più avanti o al contrario;
 *   7 Rottura   l'amen abbassato di tre semitoni (così le fette da un ottavo cadono a 145) e le
 *               fette del break di brehho23 rave, rimontate dalle clip; tre pulsanti: Ripeti,
 *               Al contrario, Frena;
 *   8 Lunghi    bordoni in loop che entrano e escono con dissolvenze lunghe, salite che
 *               finiscono esattamente sul cambio di scena, impatti, discese, sirene, treni:
 *               un Sampler in Classic (la nota tenuta tiene il suono, la fine lo rilascia), in
 *               sidechain sulla cassa e tagliato sotto dal passa-alto.
 *
 * Il master ha "Macchina": tre Ripeti, Al contrario e Stop nastro a pulsante (Q W E R T),
 * Sottrazione (passa-alto, Z) e Muro (passa-basso, X). Il montaggio è in live-builder.ts; i
 * file, in scripts/build-rave-live.ts. */
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

/** I suoni che il live usa, per ruolo (chi costruisce il progetto dà il file di ognuno). */
export const RAVE_LIVE_SOUNDS = [
  // 1 cassa: otto corpi, la grana, il click, il rimbombo
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

// le note: nell'app la 36 (C1) è il Do a 65 Hz, la tonica del basso e dell'acido di brehho23
const DO = 36, REB = 37, MIB = 39, SIB = 34, DO_ALTO = 48;
/** Il modo: Do frigio con il tritono (Do Reb Mib Fa Fa# Sol Lab Sib). */
const MODE_STEPS = [0, 1, 3, 5, 6, 7, 8, 10];
/** La nota del modo più vicina, sotto o uguale. */
const inMode = (pitch: number): number => {
  let p = pitch;
  while (!MODE_STEPS.includes(((p % 12) + 12) % 12)) p--;
  return p;
};

/** Un colpo solo di un pad (o di un tasto del Sampler, che ha le zone dove i pad hanno le note). */
const hit = (pad: number, at: Beats, velocity = 110, duration = STEP): Note => ({ pitch: padNote(pad), start: at, duration, velocity });
/** Battute di un pad, una stringa per battuta, da `from`. */
const phrase = (pad: number, barsOf: readonly string[], from: Beats = 0): Note[] => barsOf.flatMap((b, k) => steps(pad, b, from + k * BAR));
/** Le note scritte come nei progetti: [altezza, inizio, durata, velocity]. */
const written = (list: readonly (readonly [number, number, number, number])[], shift = 0): Note[] =>
  list.map(([pitch, start, duration, velocity]) => ({ pitch: pitch + shift, start, duration, velocity }));

// ------------------------------------------------------------------ effetti che il builder non ha

const autoFilter = effect(AUTO_FILTER);
const beatRepeat = effect(BEAT_REPEAT);
const gate = effect(GATE);
const phaser = effect(PHASER);
const redux = effect(REDUX);
const reverse = effect(REVERSE);
const tapeStop = effect(TAPE_STOP);

const BELL = 2, HIGH_SHELF = 4;

/** Un EQ: un passa-alto a `low` Hz (24 dB) e le bande date (campane, o il tipo indicato). */
function eqOf(name: string, low: number, bands: readonly (readonly [freq: number, gain: number, q: number, type?: number])[] = []): EffectSpec {
  const p: Record<string, number> = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: low, [bandParam(0, 'slope')]: 1 };
  bands.forEach(([freq, gain, q, type = BELL], i) => Object.assign(p, {
    [bandParam(i + 1, 'type')]: type, [bandParam(i + 1, 'freq')]: freq, [bandParam(i + 1, 'gain')]: gain, [bandParam(i + 1, 'q')]: q,
  }));
  return eq(name, p);
}

/** Un filtro tutto bagnato e aperto: lo chiude la sua macro. */
const lowPass = (name: string) => autoFilter(name, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 15, mix: 100 });
const highPass = (name: string) => autoFilter(name, { type: FILTER_TYPE.highPass, slope: 1, freq: 20, resonance: 10, mix: 100 });
/** Il Beat Repeat da suonare a pulsante: spento lascia passare il suono com'è. */
const repeatButton = (name: string, grid: string) =>
  beatRepeat(name, { only: 1, repeat: 0, grid: index(GRIDS, grid), mode: REPEAT_MODE.insert, decay: 8, volume: 0 });
/** Il compressore in sidechain sulla cassa: abbassa sul colpo e risale prima del prossimo. */
const pump = (name: string, threshold: number, ratio: number, release: number) =>
  compressor(name, { threshold, ratio, knee: 6, attack: 1, release, detector: DETECTOR.peak, auto: 0, makeup: 0 });

/** Una macro pulsante (accesa finché si tiene il tasto). */
const button = (name: string, moves: readonly Move[]): MacroSpec => ({ name, mode: 'button', moves });

// ------------------------------------------------------------------ 1 cassa

/** I corpi: ognuno accordato (a semitoni) col corpo tra Sol e Sol# (49–52 Hz, la quinta di Do), con il
 *  decay prima della fine del file (molti sono tagliati a 0,34 s: oltre farebbero click) e il
 *  volume pareggiato sul render (la stessa loudness, ±0.5 LU, a cassa dritta). */
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
  // gli strati che suonano su ogni colpo, spenti finché la macro non li alza: la grana di una
  // cassa industriale solo sopra (Tono a destra: passa-alto) e il click
  { sound: 'ferro', tune: -2, decay: 0.12, tone: 74, level: -36 },
  { sound: 'click', decay: 0.04, tone: 80, level: -36 },
  // le casse isolate dei break: quella col riverbero, "ancora" giù di una quarta e al contrario
  { sound: 'rimbombo', decay: 0.33, level: -3 },
  { sound: 'ancora', tune: -5, decay: 0.6, level: -2 },
  { sound: 'ancora', tune: -1, decay: 0.55, reverse: true, level: -6 },
  // la cassa corta dei rulli
  { sound: 'secca', tune: -1, decay: 0.12, level: -3 },
  // altre due da provare sui pad: "ancora" come in brehho23 rave (due semitoni su) e la gabber corta
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
    // ogni corpo dal suo valore, tre semitoni giù e su (a metà corsa: com'è)
    { name: 'Accordatura', value: 64, moves: BODIES.map((b, i): Move => [0, padParam(i, 'tune'), b.tune - 3, b.tune + 3]) },
    // tutto a destra: com'è; a sinistra: corta, per lasciare spazio al basso
    { name: 'Coda', value: 127, moves: BODIES.map((b, i): Move => [0, padParam(i, 'decay'), b.decay * 0.35, b.decay]) },
    { name: 'Saturazione', value: 30, moves: [[2, 'mix', 0, 100], [2, 'drive', 4, 22]] },
    // la cassa sentita da fuori dal capannone
    { name: 'Filtro', moves: [[3, 'freq', 20000, 180]] },
    { name: 'Rimbombo', moves: [[4, 'mix', 0, 40], [4, 'decay', 1.2, 4]] },
  ],
};

// i ritmi della cassa
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

/** Una clip della cassa: ogni colpo del corpo suona anche la grana e il click (spenti finché
 *  le loro macro non li alzano). */
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
  // una cassa ogni due battute, con la coda; la bassa al contrario la annuncia
  isolata: clip('Isolata', [hit(KICK.rimbombo, 0, 120), hit(KICK.bassa, 0, 110), hit(KICK.reverse, len(2) - beatsOf(0.55), 90), hit(KICK.rimbombo, len(2), 116), hit(KICK.bassa, len(2), 104)], len(4)),
  // otto battute che corrono e una vuota prima del drop: si suona una volta
  rullo: kickClip('Rullo', BODY.Ancora, [K.four, K.four, K.four, K.four, K.eighths, K.eighths, K.rest, K.rest],
    [...steps(KICK.roll, K.sixteenths, len(6))], true),
};

// ------------------------------------------------------------------ 2 colpi

const SN = { clap: 0, fruity: 1, omega: 2, grave: 3, reso: 4, destorto: 5, riverbero: 6, ghost: 7, rim: 8, trik: 9, metal: 10, roll: 11, slash: 12 } as const;
/** Gli strati di ogni colpo del rullante: clap, fruity snare (brehho23), omega, grave, reso,
 *  distorto e quello col riverbero. Le macro dicono quali si sentono. */
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
  // il rim di brehho23: il rimshot sintetico giù di nove semitoni
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
/** Il rullante: tutti gli strati sui colpi di `barsOf`, e i fantasmi se ci sono. */
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
  // il dembow scuro di brehho23: il rullante sul 4 e sul levare del 3, i colpi corti sotto
  dembow: clip('Dembow', [
    ...snare(Array(4).fill('...X ..X. ...X ..X.')),
    ...phrase(SN.ghost, Array(4).fill('.o.. .... .o.. ....')), ...phrase(SN.trik, Array(4).fill('.... ..x. .... ..x.')),
  ], len(4)),
  spezzato: clip('Spezzato', [...snare(['.... X... ..x. X..x', '.... X... .... X...', '.... X... ..x. X..x', '.... X..x .x.. X.x.']), ...phrase(SN.rim, Array(4).fill('x... ..x. ...x ....'))], len(4)),
  industriale: clip('Industriale', [
    ...snare([BACK, BACK, BACK, '.... X... .... X.xx']),
    ...phrase(SN.trik, Array(4).fill('..x. ...x ..x. ....')), ...phrase(SN.metal, Array(4).fill('...x .... .x.. ....')),
  ], len(4)),
  // il 3-3-2 del rim (il groove delle percussioni di brehho23) e il clap sul 4
  rim: clip('Rim 3-3-2', [...phrase(SN.rim, Array(4).fill('x..x ..x. x..x ..x.')), ...phrase(SN.clap, Array(4).fill('.... .... .... X...'))], len(4)),
  rullata: { ...clip('Rullata', [...roll(SN.roll, 0, 16, 0.25, [70, 127]), hit(SN.clap, 3.75, 127)], len(1)), once: true },
  // otto battute: il rullante, poi la rullata che stringe (ottavi, sedicesimi, trentaduesimi)
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
/** Il top loop (2 battute di sedicesimi a 175) in quattro fette da un quarto. */
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
    // gli aperti da un colpo corto a un "tsss" lungo: le aperture improvvise
    { name: 'Apertura', value: 20, moves: [[0, padParam(HT.open, 'decay'), 0.12, 0.7]] },
    { name: 'Brillantezza', value: 127, moves: [[2, 'freq', 2500, 20000]] },
  ],
};

/** I piatti: ogni strato col suo ritmo (una battuta che si ripete), lo swing leggero. */
function hats(bars: number, layers: Partial<Record<'closed' | 'open' | 'ride' | 'tamb' | 'metal' | 'noise' | 'alfa' | 'loop', string>>, crash = false): Note[] {
  const rep = (pad: number, p?: string) => (p ? phrase(pad, Array(bars).fill(p)) : []);
  return swing([
    ...rep(HT.closed, layers.closed), ...rep(HT.open, layers.open), ...rep(HT.ride, layers.ride), ...rep(HT.tamb, layers.tamb),
    ...rep(HT.metal, layers.metal), ...rep(HT.noise, layers.noise), ...rep(HT.alfa, layers.alfa),
    // il top loop: una fetta per quarto, ricomposto in ordine
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
  // i piatti della psytrance: aperto in levare, chiusi a coppie, shaker che corre
  psy: clip('Psy', hats(4, { closed: 'x.xx x.xx x.xx x.xx', open: OPEN, tamb: 'oxox oxox oxox oxox', alfa: '.... ...x .... ...x', loop: 'x' }), len(4)),
  ride: clip('Ride', hats(4, { ride: 'X.x. X.x. X.x. X.x.', open: OPEN, metal: '.... .... ..x. ....' }), len(4)),
  // i piatti del dembow scuro di brehho23
  dembow: clip('Dembow', hats(4, { closed: 'x.o. x.o. x.o. x.o.', tamb: '.o.o .o.o .o.o .o.o', open: '.... .... .... ..x.' }), len(4)),
  rarefatti: clip('Rarefatti', [...phrase(HT.metal, ['.... .... ..x. ....', '.... .... .... ....']), ...phrase(HT.noise, ['.... ...o .... ....', '.... .... .x.. ....']), ...phrase(HT.closed, ['.... .... .... ...o', '.... .... .... ..o.'])], len(2)),
  rullata: { ...clip('Rullata', [...roll(HT.closed, 0, 28, 0.125, [60, 127]), hit(HT.open, 3.5, 127)], len(1)), once: true },
};

// ------------------------------------------------------------------ 4 levare (basso)

/** Il basso: Neuro a una voce, due denti di sega e una quadra appena scordata, il filtro che
 *  morde con l'inviluppo di modulazione, il sub pulito sotto il crossover, la distorsione. Il
 *  sequencer (per le clip "Sequenza") lascia il battere alla cassa. */
const BASS: ParamValues = {
  oscA: 0, oscB: 1, oscBSemi: 0, oscBFine: -7, mix: 35, unison: 1,
  filterType: 0, cutoff: 900, resonance: 25, drive: 30, keyTrack: 40,
  dist: 20, sub: 70, subOctave: 0, crossover: 120,
  voiceMode: 0, glide: 0, attack: 0.002, decay: 0.18, sustain: 40, release: 0.07, velocity: 30,
  mAttack: 0.001, mDecay: 0.1, mSustain: 0, mRelease: 0.05, envDest: 1, envAmount: 45,
  volume: 0,
  seqKick: 1, seqDensity: 70, seqRange: 25, seqScale: SEQ_SCALE['Frigio e tritono'], seqSlide: 0, seqAccent: 25, seqGate: 60, seqPattern: 11,
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

/** Un basso a sedicesimi: `rhythm` (una battuta) con le altezze di ogni battuta, o di ogni
 *  colpo se `pitches` è una funzione. */
function bassBars(rhythm: string, roots: readonly number[], pitchOf?: (root: number, i: number) => number, gateSteps = 0.8): Note[] {
  return roots.flatMap((root, k) => steps(0, rhythm, k * BAR).map((n, i) => ({
    ...n, pitch: pitchOf ? pitchOf(root, i) : root, duration: STEP * gateSteps,
  })));
}
const OFF = '..x. ..x. ..x. ..x.';
/** Il sequencer acceso per tutta la clip (la modulazione sposta l'interruttore su On). */
const seqOn = (bars: number) => ({ target: instrumentParam('seqOn'), points: [{ beat: 0, value: 1 }, { beat: len(bars), value: 1 }] });
const held = (pitch: number, start: Beats, beats: Beats): Note => ({ pitch, start, duration: beats, velocity: 100 });

/** Le clip a note lunghe suonano più delle altre: si abbassano da sole di 6 dB (il volume della
 *  traccia è al quadrato della modulazione). */
const LONG_NOTES = { target: VOLUME, points: [{ beat: 0, value: 0.7 }, { beat: len(4), value: 0.7 }] };

const BASSES = {
  // in levare la nota tiene un ottavo scarso: il colpo pieno tra una cassa e l'altra
  levare: clip('Levare', bassBars(OFF, [DO, DO, DO, DO], undefined, 1.6), len(4)),
  giro: clip('Levare in giro', bassBars(OFF, [DO, DO, REB, SIB], undefined, 1.6), len(4)),
  doppio: clip('Doppio levare', bassBars('..xx ..xx ..xx ..xx', [DO, DO, DO, REB]), len(4)),
  // tre sedicesimi dopo ogni cassa, e la discesa in fondo (il "Martello basso" di brehho23 rave)
  rotolante: clip('Rotolante', bassBars('.xxx .xxx .xxx .xxx', [DO, DO, REB, SIB], (r, i) => (r === SIB && i >= 9 ? [DO_ALTO, 46, 43][(i - 9) % 3] : r)), len(4)),
  // la Goa: l'ottava sul secondo sedicesimo
  goa: clip('Goa', bassBars('.xxx .xxx .xxx .xxx', [DO, DO, DO, REB], (r, i) => (i % 3 === 1 ? r + 12 : r)), len(4)),
  trance: clip('Trance oscura', bassBars('.xxx .xxx .xxx .xxx', [DO, DO, REB, DO], (r, i) => inMode(r + [0, 0, 7, 0, 1, 0, 0, 12, 0, 0, 3, 0][i % 12])), len(4)),
  galoppo: clip('Galoppo', written([[DO, 0.5, 0.2, 112], [DO, 0.75, 0.2, 96]].flatMap(([p, s, d, v]) =>
    Array.from({ length: 16 }, (_, k): [number, number, number, number] => [k === 7 ? REB : k === 14 ? MIB : k === 15 ? REB : p, s + k, d, v]))), len(4)),
  // il dembow di brehho23: tre più tre più due
  dembow: clip('Dembow', written([[36, 0, 0.75, 112], [36, 0.75, 0.75, 96], [36, 1.5, 0.5, 104], [36, 2, 0.75, 112], [36, 2.75, 0.75, 96], [36, 3.5, 0.5, 104], [36, 4, 0.75, 112], [36, 4.75, 0.75, 96], [36, 5.5, 0.5, 104], [36, 6, 0.75, 112], [36, 6.75, 0.75, 96], [36, 7.5, 0.5, 104], [37, 8, 0.75, 112], [37, 8.75, 0.75, 96], [37, 9.5, 0.5, 104], [37, 10, 0.75, 112], [37, 10.75, 0.75, 96], [37, 11.5, 0.5, 104], [36, 12, 0.75, 112], [36, 12.75, 0.75, 96], [36, 13.5, 0.5, 104], [36, 14, 0.75, 112], [30, 14.75, 0.75, 96], [30, 15.5, 0.5, 104]]), len(4), [LONG_NOTES]),
  sub: clip('Sub tenuto', [held(DO, 0, 8), held(REB, 8, 4), held(SIB, 12, 4)], len(4), [LONG_NOTES]),
  sequenza: clip('Sequenza', [held(DO, 0, len(4))], len(4), [seqOn(4)]),
  sequenzaGiro: clip('Sequenza in giro', [held(DO, 0, 8), held(REB, 8, 4), held(SIB, 12, 4)], len(4), [seqOn(4)]),
};

// ------------------------------------------------------------------ 5 acido

/** La 303: l'Analog "Acid" di brehho23 (dente di sega, Legato, glide, accento) con il
 *  sequencer pronto (Frigio e tritono, sedicesimi). */
const ACID: ParamValues = {
  oscA: 0, mix: 0, voiceMode: VOICE_MODE.legato, glide: 60, accent: 70,
  cutoff: 420, resonance: 80, filterEnv: 66, keyTrack: 20,
  fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -9,
  seqScale: SEQ_SCALE['Frigio e tritono'], seqRate: SEQ_RATE['1/16'], seqLength: 16, seqGate: 55,
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
    // il giro del sequencer: uno nuovo entra all'inizio del giro
    { name: 'Pattern', value: 0, moves: [[0, 'seqPattern', 0, 127]] },
    // da un acido minimale (poche note, la tonica) a uno frenetico (pieno, largo, slide, accenti)
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
  // il sequencer: la clip tiene solo la tonica (o il giro)
  seq: clip('Seq Do', [held(DO, 0, len(4))], len(4), [seqOn(4)]),
  seqAlto: clip('Seq Do alto', [held(DO_ALTO, 0, len(4))], len(4), [seqOn(4)]),
  seqGiro: clip('Seq giro', [held(DO, 0, 8), held(REB, 8, 4), held(SIB, 12, 4)], len(4), [seqOn(4)]),
  // la seconda bemolle tenuta: la tensione frigia
  seqReb: clip('Seq Reb', [held(REB, 0, len(4))], len(4), [seqOn(4)]),
  // le linee scritte di brehho23
  motivo: clip('Motivo', written([[36, 0, 0.125, 127], [36, 0.5, 0.125, 92], [36, 1, 0.125, 127], [36, 1.5, 0.125, 92], [37, 2, 0.375, 127], [37, 2.75, 0.375, 92], [30, 3.5, 0.56, 92], [36, 4, 0.125, 127], [36, 4.5, 0.125, 92], [36, 5, 0.125, 127], [36, 5.5, 0.125, 92], [37, 6, 0.375, 127], [39, 6.75, 0.31, 92], [37, 7, 0.125, 92], [30, 7.5, 0.56, 92]]), len(2)),
  martello: clip('Martello', written([[36, 0, 0.125, 127], [36, 0.25, 0.125, 92], [48, 0.5, 0.125, 127], [36, 0.75, 0.125, 92], [36, 1, 0.125, 92], [36, 1.25, 0.125, 127], [48, 1.5, 0.125, 92], [36, 1.75, 0.125, 92], [36, 2, 0.125, 127], [36, 2.25, 0.125, 92], [48, 2.5, 0.125, 127], [36, 2.75, 0.125, 92], [37, 3, 0.31, 127], [36, 3.25, 0.125, 92], [39, 3.5, 0.125, 127], [36, 3.75, 0.125, 92], [36, 4, 0.125, 127], [36, 4.25, 0.125, 92], [48, 4.5, 0.125, 127], [36, 4.75, 0.125, 92], [36, 5, 0.125, 92], [36, 5.25, 0.125, 127], [48, 5.5, 0.125, 92], [36, 5.75, 0.125, 92], [36, 6, 0.125, 127], [36, 6.25, 0.125, 92], [42, 6.5, 0.125, 127], [36, 6.75, 0.125, 92], [43, 7, 0.31, 127], [42, 7.25, 0.125, 92], [36, 7.5, 0.125, 92], [48, 7.75, 0.125, 127]]), len(2)),
  rotola: clip('Rotola', written([[36, 0, 0.125, 127], [36, 0.25, 0.125, 92], [48, 0.5, 0.31, 92], [46, 0.75, 0.125, 92], [36, 1, 0.125, 92], [37, 1.5, 0.125, 127], [36, 1.75, 0.125, 92], [36, 2, 0.125, 92], [48, 2.25, 0.125, 127], [36, 2.75, 0.125, 92], [42, 3, 0.31, 92], [43, 3.25, 0.125, 92], [36, 3.5, 0.125, 92], [34, 3.75, 0.125, 92], [36, 4, 0.125, 127], [36, 4.25, 0.125, 92], [39, 4.5, 0.31, 127], [36, 4.75, 0.125, 92], [48, 5, 0.125, 92], [36, 5.5, 0.125, 92], [49, 5.75, 0.125, 127], [36, 6, 0.125, 92], [48, 6.25, 0.125, 127], [36, 6.5, 0.125, 92], [42, 6.75, 0.125, 92], [43, 7, 0.31, 92], [36, 7.25, 0.125, 92], [39, 7.5, 0.125, 127], [37, 7.75, 0.125, 92]]), len(2)),
  squelch: clip('Squelch', written([[48, 0, 0.31, 127], [49, 0.25, 0.125, 92], [48, 0.5, 0.125, 92], [43, 1, 0.31, 127], [48, 1.25, 0.125, 92], [48, 1.75, 0.125, 127], [51, 2, 0.31, 92], [48, 2.25, 0.125, 92], [46, 2.75, 0.125, 127], [48, 3, 0.125, 92], [42, 3.5, 0.31, 127], [43, 3.75, 0.125, 92], [48, 4, 0.31, 127], [49, 4.25, 0.125, 92], [48, 4.5, 0.125, 92], [43, 5, 0.31, 127], [48, 5.25, 0.125, 92], [48, 5.75, 0.125, 127], [51, 6, 0.31, 92], [48, 6.25, 0.125, 92], [49, 6.75, 0.125, 127], [48, 7, 0.31, 92], [46, 7.25, 0.125, 92], [42, 7.5, 0.31, 127], [43, 7.75, 0.125, 92]]), len(2)),
  respiro: clip('Respiro', written([[36, 0, 1.875, 127], [37, 2, 1.375, 127], [30, 3.5, 0.56, 92], [36, 4, 1.875, 127], [39, 6, 0.875, 92], [37, 7, 0.56, 92], [30, 7.5, 0.375, 92]]), len(2)),
  // le linee di brehho23 rave
  esplosione: clip('Esplosione', written([[36, 0, 0.138, 127], [36, 0.25, 0.138, 92], [48, 0.5, 0.138, 92], [36, 0.75, 0.138, 92], [36, 1, 0.138, 92], [48, 1.25, 0.138, 127], [36, 1.5, 0.138, 92], [39, 1.75, 0.138, 92], [36, 2, 0.138, 127], [36, 2.25, 0.138, 92], [48, 2.5, 0.138, 92], [36, 2.75, 0.138, 92], [49, 3, 0.288, 92], [36, 3.25, 0.138, 92], [43, 3.5, 0.138, 127], [42, 3.75, 0.138, 92], [36, 4, 0.138, 127], [36, 4.25, 0.138, 92], [48, 4.5, 0.138, 92], [36, 4.75, 0.138, 92], [36, 5, 0.138, 92], [48, 5.25, 0.138, 127], [36, 5.5, 0.138, 92], [39, 5.75, 0.138, 92], [36, 6, 0.138, 127], [36, 6.25, 0.138, 92], [48, 6.5, 0.288, 92], [46, 6.75, 0.138, 92], [43, 7, 0.138, 92], [41, 7.25, 0.138, 127], [39, 7.5, 0.138, 92], [37, 7.75, 0.138, 92], [37, 8, 0.138, 127], [37, 8.25, 0.138, 92], [49, 8.5, 0.138, 92], [37, 8.75, 0.138, 92], [37, 9, 0.138, 92], [49, 9.25, 0.138, 127], [37, 9.5, 0.138, 92], [41, 9.75, 0.138, 92], [37, 10, 0.138, 127], [37, 10.25, 0.138, 92], [49, 10.5, 0.138, 92], [37, 10.75, 0.138, 92], [51, 11, 0.288, 92], [37, 11.25, 0.138, 92], [44, 11.5, 0.138, 127], [43, 11.75, 0.138, 92], [34, 12, 0.138, 127], [34, 12.25, 0.138, 92], [46, 12.5, 0.138, 92], [34, 12.75, 0.138, 92], [36, 13, 0.138, 127], [36, 13.25, 0.138, 92], [48, 13.5, 0.138, 92], [36, 13.75, 0.138, 92], [48, 14, 0.138, 127], [36, 14.25, 0.138, 92], [49, 14.5, 0.288, 92], [36, 14.75, 0.138, 92], [43, 15, 0.138, 127], [42, 15.25, 0.138, 92], [39, 15.5, 0.138, 127], [37, 15.75, 0.138, 92]]), len(4)),
  galoppo: clip('Galoppo', written([[36, 0, 0.288, 92], [48, 0.25, 0.138, 92], [39, 1, 0.138, 92], [36, 1.5, 0.138, 127], [37, 2.5, 0.288, 92], [36, 2.75, 0.138, 92], [43, 3.5, 0.138, 127], [36, 4, 0.288, 92], [48, 4.25, 0.138, 92], [41, 5, 0.138, 92], [36, 5.5, 0.138, 127], [43, 6.25, 0.288, 92], [44, 6.5, 0.138, 92], [42, 7, 0.138, 127], [37, 7.5, 0.138, 92], [36, 8, 0.288, 92], [48, 8.25, 0.138, 92], [39, 9, 0.138, 92], [36, 9.5, 0.138, 127], [37, 10.5, 0.288, 92], [36, 10.75, 0.138, 92], [43, 11.5, 0.138, 127], [48, 12, 0.388, 127], [36, 12.75, 0.138, 92], [46, 13, 0.288, 92], [43, 13.25, 0.138, 92], [42, 13.75, 0.138, 92], [36, 14.25, 0.138, 127], [49, 14.75, 0.288, 92], [36, 15, 0.138, 92], [39, 15.5, 0.138, 127]]), len(4)),
  // la scala che sale per quattro battute (la "Salita acido" di brehho23 rave)
  salita: clip('Salita', written([[36, 0, 0.15, 100], [36, 0.25, 0.15, 92], [48, 0.5, 0.15, 92], [36, 0.75, 0.15, 92], [37, 1, 0.15, 100], [37, 1.25, 0.15, 92], [49, 1.5, 0.15, 92], [37, 1.75, 0.15, 92], [39, 2, 0.15, 100], [39, 2.25, 0.15, 92], [51, 2.5, 0.15, 92], [39, 2.75, 0.15, 92], [41, 3, 0.15, 100], [41, 3.25, 0.15, 92], [53, 3.5, 0.15, 92], [41, 3.75, 0.15, 92], [43, 4, 0.15, 100], [43, 4.25, 0.15, 92], [55, 4.5, 0.15, 92], [43, 4.75, 0.15, 92], [44, 5, 0.15, 100], [44, 5.25, 0.15, 92], [56, 5.5, 0.15, 92], [44, 5.75, 0.15, 92], [46, 6, 0.15, 100], [46, 6.25, 0.15, 92], [58, 6.5, 0.15, 92], [46, 6.75, 0.15, 92], [48, 7, 0.15, 100], [48, 7.25, 0.15, 92], [60, 7.5, 0.15, 92], [48, 7.75, 0.15, 92], [49, 8, 0.15, 127], [49, 8.25, 0.15, 92], [61, 8.5, 0.15, 92], [49, 8.75, 0.15, 92], [51, 9, 0.15, 127], [51, 9.25, 0.15, 92], [63, 9.5, 0.15, 92], [51, 9.75, 0.15, 92], [53, 10, 0.15, 127], [53, 10.25, 0.15, 92], [65, 10.5, 0.15, 92], [53, 10.75, 0.15, 92], [55, 11, 0.15, 127], [55, 11.25, 0.15, 92], [67, 11.5, 0.15, 92], [55, 11.75, 0.15, 92], [56, 12, 0.15, 127], [56, 12.25, 0.15, 92], [68, 12.5, 0.15, 92], [56, 12.75, 0.15, 92], [58, 13, 0.15, 127], [58, 13.25, 0.15, 92], [70, 13.5, 0.15, 92], [58, 13.75, 0.15, 92], [60, 14, 0.15, 127], [60, 14.25, 0.15, 92], [72, 14.5, 0.15, 92], [60, 14.75, 0.15, 92], [61, 15, 0.15, 127], [61, 15.25, 0.15, 92], [73, 15.5, 0.15, 92], [61, 15.75, 0.15, 92]]), len(4)),
};

// ------------------------------------------------------------------ 6 sampler percussivo

/** I quattro banchi di otto tasti: ogni zona su un tasto solo, alla sua altezza (nota base =
 *  il tasto). Per crescere: un file trascinato sul nome di una zona la cambia; le zone libere
 *  (fino a 32) si aggiungono trascinando sulla tastiera. */
const PERC_BANKS = {
  Metallo: ['metal1', 'metal2', 'cowbell', 'metallic', 'pling', 'metalDelay', 'sciabola', 'revMetal'],
  Tamburi: ['shot09', 'tom', 'tom2', 'wood', 'top', 'skull', 'skull2', 'shot17'],
  Macchine: ['technoid', 'strangeHit', 'robot', 'growl', 'laser', 'laserRate', 'glitch', 'littleRobot'],
  Voci: ['kill', 'darkness', 'whisper', 'whisperF', 'again', 'medieval', 'devil', 'choirYe'],
} as const satisfies Record<string, readonly RaveLiveSound[]>;
const PERC_ZONES: readonly RaveLiveSound[] = Object.values(PERC_BANKS).flat();
/** Il volume di ogni zona (pareggiati a orecchio sui picchi misurati dei file). */
const PERC_GAIN: Partial<Record<RaveLiveSound, number>> = {
  metal1: 2, metal2: 0, cowbell: 6, metallic: 2, pling: 4, metalDelay: -2, sciabola: 2, revMetal: 4,
  shot09: -4, tom: -4, tom2: -4, wood: -6, top: 6, skull: 0, skull2: 4, shot17: 0,
  technoid: -4, strangeHit: -4, robot: -6, growl: -10, laser: -8, laserRate: -8, glitch: 0, littleRobot: 2,
  kill: 0, darkness: 0, whisper: 2, whisperF: 2, again: -6, medieval: 0, devil: 0, choirYe: -4,
};
const BANK = { Metallo: 0, Tamburi: 8, Macchine: 16, Voci: 24 } as const;

/** Le zone su un tasto ciascuna da C1 (36): lo stesso schema dei pad della Drum Machine. */
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
    // tutte le zone seguono il suono della prima: una macro le muove tutte
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

/** Un ritmo su un tasto del sampler (banco + posto), come i pad. */
const z = (bank: keyof typeof BANK, slot: number) => BANK[bank] + slot;

const PERCS = {
  // il groove delle percussioni di brehho23 (rim e One_Shot) sul banco Tamburi
  tamburi: clip('Tamburi 3-3-2', swing([
    ...phrase(z('Tamburi', 0), Array(4).fill('x.x. .x.. x..x ...o')),
    ...phrase(z('Tamburi', 2), ['.... ..x. .... ....', '.... ..x. .... ....', '.... ..x. .... ....', '.... ..x. .... .xx.']),
    ...phrase(z('Tamburi', 1), Array(4).fill('.... .... .... ..x.')),
    ...phrase(z('Tamburi', 5), Array(4).fill('...o .... .o.. o...')),
    ...phrase(z('Tamburi', 4), Array(4).fill('.... ...x .... ..x.')),
  ], SWING), len(4)),
  // il "Dembow perc" di brehho23
  dembow: clip('Tamburi dembow', [
    ...phrase(z('Tamburi', 0), Array(4).fill('x.x. .x.. x..x ...o')), ...phrase(z('Tamburi', 2), Array(4).fill('.... ..x. .... ....')),
    ...phrase(z('Tamburi', 1), Array(4).fill('.... .... .... ..x.')), ...phrase(z('Tamburi', 5), Array(4).fill('...o .... .o.. o...')),
    ...phrase(z('Tamburi', 6), Array(4).fill('.o.o .o.o .o.o .o.o')),
  ], len(4)),
  // tom in gruppi di tre sedicesimi contro il quattro: il rito
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
  // una voce ogni quattro battute, i sussurri tra l'una e l'altra
  voci: clip('Voci', [hit(z('Voci', 0), 0, 110), hit(z('Voci', 2), len(2) + 2, 100), hit(z('Voci', 1), len(4), 110), hit(z('Voci', 3), len(6) + 2.5, 100)], len(8)),
};

// ------------------------------------------------------------------ 7 rottura

/** L'amen a 175: un ottavo è 0,1714 s. Giù di tre semitoni l'ottavo dura 0,2038 s, quasi
 *  l'ottavo di 145 (0,2069): le fette in fila ricompongono il break, più scuro. */
const AMEN_EIGHTH_S = 30 / 175;
const RAVE_BEAT_S = 60 / 140;
const BREAKS_KIT: readonly PadSound<RaveLiveSound>[] = [
  ...Array.from({ length: 8 }, (_, k): PadSound<RaveLiveSound> => ({ sound: 'amen', at: k * AMEN_EIGHTH_S, tune: -3, decay: AMEN_EIGHTH_S * 1.25, choke: 1 })),
  // quattro battiti del break di brehho23 rave (a 140: su di un semitono)
  ...[0, 3, 6, 13].map((beat): PadSound<RaveLiveSound> => ({ sound: 'raveBreak', at: beat * RAVE_BEAT_S, tune: 1, decay: RAVE_BEAT_S, choke: 1, level: -3 })),
  // il rullante dell'amen al contrario (lo swell) e acuto per i rulli
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
    tapeStop('Frena', { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Subito'), curve: BRAKE_CURVE.smooth, spin: 200 }),
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

/** Una frase di fette a ottavi: un numero è il pad (la fetta) che parte lì, "." lascia suonare. */
function chops(line: string, from: Beats = 0, velocity = 110): Note[] {
  return line.trim().split(/\s+/).flatMap((w, i) => (w === '.' ? [] : [{ pitch: padNote(Number(w)), start: from + i * 0.5, duration: 0.5, velocity }]));
}

const BREAKS = {
  amen: clip('Amen', [...chops('0 1 2 3 4 5 6 7'), ...chops('0 1 2 3 4 5 6 7', 4), ...chops('0 1 2 3 4 5 6 7', 8), ...chops('0 1 2 3 0 1 6 7', 12)], len(4)),
  chop: clip('Amen chop', [...chops('0 1 2 0 1 2 6 7'), ...chops('0 . 2 3 0 1 2 7', 4), ...chops('0 1 2 0 1 2 6 2', 8), ...chops('4 5 2 3 2 2 6 7', 12)], len(4)),
  mezzo: clip('Amen mezzo tempo', [...chops('0 . 1 . 2 . 3 .'), ...chops('4 . 5 . 2 . 7 .', 4)], len(2)),
  // il 3-3-2 di brehho23 con le fette dell'amen
  spezzato: clip('Spezzato', [...chops('0 . . 2 . . 0 .'), ...chops('0 . . 2 . . 6 7', 4), ...chops('0 . . 2 . . 0 .', 8), ...chops('0 2 . 2 . 2 2 2', 12)], len(4)),
  rave: clip('Rottura brehho23', [hit(BR.rave, 0), hit(BR.rave + 1, 1), hit(BR.rave, 2), hit(BR.rave + 2, 3), hit(BR.rave + 3, 4), hit(BR.rave + 1, 5), hit(BR.rave + 2, 6), hit(BR.rave + 3, 7)], len(2)),
  glitch: clip('Glitch', [
    ...chops('0 1 2 3'), ...roll(BR.snareHi, 2, 8, 0.125, [80, 120]), ...chops('0 . 2 .', 3), hit(BR.decimated, 4.5), hit(BR.glitcha, 6), hit(BR.swell, 7.5),
  ], len(2)),
  // otto battute che si stringono: ottavi, sedicesimi, trentaduesimi del rullante
  tensione: {
    ...clip('Tensione', [
      ...chops('0 1 2 3 4 5 6 7'), ...chops('0 1 2 3 4 5 6 7', 4), ...chops('0 1 2 3 0 1 2 3', 8), ...chops('2 . 2 . 2 2 2 2', 12),
      ...roll(BR.snareHi, len(4), 32, 0.25, [70, 110]), ...roll(BR.snareHi, len(6), 32, 0.125, [100, 127]), hit(BR.swell, len(8) - 1, 110),
    ], len(8)),
    once: true,
  },
};

// ------------------------------------------------------------------ 8 lunghi

/** Le zone dei suoni lunghi: il tasto, il file, l'intonazione verso Do (semitoni), il volume e,
 *  per i bordoni, il loop (inizio e fine in percento del file). La prima zona dà il suono alle
 *  altre (le transizioni: niente loop, attacco subito); i bordoni hanno il loro. */
interface LongZone {
  readonly sound: RaveLiveSound;
  readonly key: number;
  readonly tune?: number;
  readonly gain?: number;
  readonly loop?: readonly [start: number, end: number];
}
const LONG_ZONES: readonly LongZone[] = [
  // le transizioni (dalla prima zona: il suono di tutte quelle che non hanno il loro)
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
  // le sirene e i rumori lunghi
  { sound: 'siren', key: 60, gain: -6 },
  { sound: 'sirenLead', key: 61, gain: -10, tune: 5, loop: [10, 90] },
  { sound: 'allarm', key: 62, gain: 2 },
  { sound: 'strongNoise', key: 63, gain: 0 },
  { sound: 'autotreno', key: 64, gain: 2 },
  { sound: 'space', key: 65, gain: -2 },
  { sound: 'hell', key: 66, gain: -4 },
  { sound: 'tension', key: 67, gain: -4 },
  // i bordoni in loop, accordati su Do o sulle note del modo (la quinta, la seconda bemolle)
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

/** Il suono delle transizioni (la prima zona): suona finché la nota è tenuta, poi sfuma. */
const LONG_BASE: ParamValues = {
  mode: MODE.classic, voiceMode: 0, velocity: 30, volume: -6, loop: 0,
  e1A: 0.005, e1D: 10, e1S: 100, e1R: 0.4, fOn: 0,
};
/** Le zone: tasti, nota base (il tasto meno l'intonazione), volumi; i bordoni con il loro suono:
 *  loop sfumato, entrata e uscita lente. */
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
    // a metà: sotto i 120 Hz niente (il posto della cassa e del basso)
    { name: 'Passa-alto', value: 52, moves: [[1, 'freq', 30, 900]] },
    { name: 'Spazio', value: 40, moves: [[5, 'mix', 5, 60], [5, 'decay', 2, 10]] },
    { name: 'Eco', value: 20, moves: [[4, 'mix', 0, 40]] },
    // il feedback dell'eco fin quasi all'autooscillazione (resta sotto il 95 %)
    { name: 'Lancio', moves: [[4, 'feedback', 30, 92]] },
    { name: 'Altezza', value: 64, moves: [[0, 'transpose', -12, 12], ...DRONES.map((i): Move => [0, zoneParam(i, 'transpose'), (LONG_ZONES[i].tune ?? 0) - 12, (LONG_ZONES[i].tune ?? 0) + 12])] },
    { name: 'Dissolvenza', value: 50, moves: DRONES.flatMap((i): Move[] => [[0, zoneParam(i, 'e1A'), 0.3, 8], [0, zoneParam(i, 'e1R'), 0.5, 10]]) },
    { name: 'Larghezza', value: 70, moves: [[6, 'width', 40, 170]] },
  ],
};

/** Una nota tenuta di un suono lungo, da `start` per `beats` battiti. */
const long = (sound: RaveLiveSound, start: Beats, beats: Beats, velocity = 110): Note => ({ pitch: LONG_KEY[sound], start, duration: beats, velocity });
/** Una salita che finisce esattamente su `end`: parte prima di quanto dura. */
const riseTo = (sound: RaveLiveSound, seconds: number, end: Beats): Note => long(sound, Math.max(0, end - beatsOf(seconds)), Math.min(end, beatsOf(seconds)));

/** Una clip di suoni lunghi: nessuna nota va oltre la fine (la clip, o il giro, la taglierebbe
 *  senza rilascio). */
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
  // le salite: finiscono sull'ultimo battito della clip, si suonano una volta
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
    tapeStop('Stop nastro', { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Subito'), curve: BRAKE_CURVE.smooth, spin: 300 }),
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
    // il passa-alto che toglie cassa e basso: le sottrazioni prima di ridare tutto
    { name: 'Sottrazione', moves: [[5, 'freq', 20, 700]] },
    { name: 'Muro', moves: [[6, 'freq', 20000, 350]] },
    { name: 'Lo-fi', moves: [[7, 'mix', 0, 100], [7, 'bits', 16, 6], [7, 'rate', 48000, 6000]] },
  ],
};

// ------------------------------------------------------------------ le tracce

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
  // ATTO I: sottosuolo — la tensione industriale, poi la cassa e il basso
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
  // ATTO III: psiche — acid, Goa, trance oscura, i ritmi che si spezzano
  scene('III · Goa', 64, { kick: KICKS.dritta('Secca'), snare: SNARES.back, hats: HATS.psy, bass: BASSES.goa, acid: ACIDS.seqAlto, perc: PERCS.psiche, long: LONGS.esplosione }),
  scene('Trance oscura', 64, { kick: KICKS.dritta('Secca'), snare: SNARES.ghost, hats: HATS.psy, bass: BASSES.trance, acid: ACIDS.seqReb, perc: PERCS.levare, long: LONGS.sirena }),
  scene('Spirale', 48, { kick: KICKS.spinta, snare: SNARES.spezzato, hats: HATS.trama, bass: BASSES.sequenza, acid: ACIDS.seqGiro, perc: PERCS.macchine }),
  scene('Galoppo', 64, { kick: KICKS.galoppo, snare: SNARES.back, hats: HATS.galoppo, bass: BASSES.galoppo, acid: ACIDS.galoppo, perc: PERCS.tamburi }),
  scene('Respiro', 32, { kick: KICKS.isolata, bass: BASSES.sub, acid: ACIDS.seq, long: LONGS.bordone, perc: PERCS.voci, hats: HATS.rarefatti }),
  scene('Spezzato', 64, { kick: KICKS.spezzata, snare: SNARES.dembow, hats: HATS.dembow, bass: BASSES.dembow, acid: ACIDS.motivo, perc: PERCS.dembow, breaks: BREAKS.spezzato }),
  scene('Esplosione', 64, { kick: KICKS.dritta('Gabber'), snare: SNARES.back, hats: HATS.trama, bass: BASSES.rotolante, acid: ACIDS.esplosione, perc: PERCS.levare, long: LONGS.esplosione }),
  // ATTO IV: rito — il culmine e la fine
  scene('IV · Rito', 64, { kick: KICKS.dritta('Boom'), snare: SNARES.rim, hats: HATS.levare, bass: BASSES.giro, perc: PERCS.rito, long: LONGS.coro }),
  scene('Catena', 64, { kick: KICKS.mezzo, breaks: BREAKS.chop, snare: SNARES.spezzato, hats: HATS.sedicesimi, bass: BASSES.doppio, acid: ACIDS.seqGiro, perc: PERCS.macchine }),
  scene('Culmine', 64, { kick: KICKS.doppia, snare: SNARES.industriale, hats: HATS.trama, bass: BASSES.rotolante, acid: ACIDS.seqAlto, perc: PERCS.levare, long: LONGS.rumore }),
  scene('Caduta', 16, { breaks: BREAKS.glitch, acid: ACIDS.respiro, long: LONGS.discesa, hats: HATS.rarefatti }),
  scene('Ultimo martello', 64, { kick: KICKS.dritta('Martello'), snare: SNARES.back, hats: HATS.sedicesimi, bass: BASSES.levare, acid: ACIDS.martello, perc: PERCS.tamburi, long: LONGS.impatto }),
  scene('Fine', 32, { kick: KICKS.cuore, long: LONGS.fine, perc: PERCS.rado, hats: HATS.rarefatti }),
  // le clip in più, da lanciare sopra le scene: transizioni, fill, varianti
  scene('Transizioni', 8, { kick: KICKS.rullo, snare: SNARES.rullata, hats: HATS.rullata, breaks: BREAKS.tensione, long: LONGS.salita8, acid: ACIDS.salita }),
  scene('Varianti', 16, { kick: KICKS.dritta('Ancora'), snare: SNARES.four, hats: HATS.ride, bass: BASSES.sequenzaGiro, breaks: BREAKS.rave, perc: PERCS.psiche, long: LONGS.eco, acid: ACIDS.motivo }),
  scene('Varianti 2', 16, { kick: KICKS.dritta('Distorta'), breaks: BREAKS.mezzo, bass: BASSES.trance, acid: ACIDS.seqReb, perc: PERCS.voci, long: LONGS.buio }),
];

/** I tasti della tastiera: le macro pulsante e gli interruttori che servono al volo. */
const KEYS: readonly KeySpec<TrackKey>[] = [
  { key: 'KeyQ', owner: 'master', rack: 0, macro: 0 },
  { key: 'KeyW', owner: 'master', rack: 0, macro: 1 },
  { key: 'KeyE', owner: 'master', rack: 0, macro: 2 },
  { key: 'KeyR', owner: 'master', rack: 0, macro: 3 },
  { key: 'KeyT', owner: 'master', rack: 0, macro: 4 },
  // una manopola su un tasto salta da un capo all'altro: la sottrazione e il muro al volo
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

// la "registrazione": gli atti in fila, più di mezz'ora
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

/** Le clip di una scena, per chi le vuole controllare. */
export const raveScene = (name: string): Clips | undefined => SCENES.find(s => s.name === name)?.clips;

/** Costruisce il live nel progetto (vuoto) dello store. */
export function buildRaveLive(store: ProjectStore, sounds: Readonly<Record<RaveLiveSound, SampleRef>>): void {
  buildLive(store, RAVE_LIVE, sounds);
}

/** Per i test: i corpi della cassa, i banchi del sampler, le zone dei suoni lunghi. */
export const RAVE_PARTS = { BODIES, PERC_BANKS, LONG_ZONES, KEYS, KICK_KIT };
