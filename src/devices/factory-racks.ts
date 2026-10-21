/* I rack di fabbrica, nel browser accanto a quelli salvati dall'utente (come i rack di Live).
 * Sono rack come gli altri: dispositivi già regolati e macro mappate, solo scritti qui.
 *
 * "Tornado" è un multieffetto da suonare dal vivo alla Turnado: otto effetti in fila, una
 * macro ciascuno. A 0 l'effetto non c'è (il suono passa com'è); girando entra e si fa più forte.
 * Sulle 8 manopole Device Control dell'APC40, o sulla tastiera, si suona come uno strumento.
 * Gli altri Audio Effect Rack sono suoni famosi (Fade to Grey come quello di Live, il dub, il
 * filtro della house francese, la cassetta, lo shoegaze): anche loro con le macro a 0 lasciano
 * passare il suono com'è, e partono dove sono già utili.
 *
 * Gli Instrument Rack partono da un preset dello strumento e ci aggiungono effetti; le macro
 * muovono insieme strumento ed effetti, e partono dove il suono è già bello. */
import type { DeviceType } from './device-type';
import type { RackPreset, SavedDevice, SavedEffect, SavedMacro } from '../model/rack-preset';
import { MACRO_COUNT, type MacroMode } from '../model/rack';
import { LFO_SHAPE } from './dsp/lfo';
import { FILTER_TYPE } from './dsp/multimode-filter';
import { AUTO_FILTER, AUTO_FILTER_SYNC } from './effects/auto-filter/auto-filter';
import { AUTO_PAN, AUTO_PAN_SYNC } from './effects/auto-pan/auto-pan';
import { BEAT_REPEAT, GRIDS, INTERVALS, REPEAT_MODE } from './effects/beat-repeat/beat-repeat';
import { CHORUS, CHORUS_MODE, CHORUS_SYNC } from './effects/chorus/chorus';
import { COMPRESSOR } from './effects/compressor/compressor';
import { DELAY, DIVISIONS } from './effects/delay/delay';
import { DRIVE } from './effects/drive/drive';
import { GATE, pattern, STEP_RATES } from './effects/gate/gate';
import { MULTIBAND } from './effects/multiband/multiband';
import { PHASER } from './effects/phaser/phaser';
import { REDUX, REDUX_FILTER } from './effects/redux/redux';
import { REVERB } from './effects/reverb/reverb';
import { REVERSE, REVERSE_LENGTHS } from './effects/reverse/reverse';
import { STEREO } from './effects/stereo/stereo';
import { BRAKE_CURVE, BRAKE_DIVISIONS, STARTS, TAPE_STOP, TAPE_SYNC } from './effects/tape-stop/tape-stop';
import { ANALOG } from './instruments/analog/analog';
import { MOD_DEST as NEURO_DEST, NEURO, LFO_SHAPE as NEURO_LFO } from './instruments/neuro/neuro';
import { LFO_SYNC, MOD_DEST, TABLE, VOICE_MODE, WAVETABLE, LFO_SHAPE as WT_LFO } from './instruments/wavetable/wavetable';
import { TEMPO_RATE } from './rates';

const index = (list: readonly (readonly [string, ...unknown[]])[], label: string) => list.findIndex(([l]) => l === label);

/** Un dispositivo da un preset di fabbrica (null: da Init), con dei parametri cambiati. */
function device(type: DeviceType, preset: string | null, params: Readonly<Record<string, number>> = {}): SavedDevice {
  const base = preset === null ? {} : type.presets.find(p => p.name === preset)?.params;
  if (!base) throw new RangeError(`${type.label}: il preset «${preset}» non c'è`);
  return { type: type.type, preset, params: { ...base, ...params } };
}

const effect = (type: DeviceType, preset: string | null, params?: Readonly<Record<string, number>>): SavedEffect =>
  ({ ...device(type, preset, params), enabled: true });

/** Un parametro mosso da una macro: il dispositivo (per posto nel rack), il parametro, il suo
 *  valore a 0 e a 127. */
type Move = readonly [device: number, param: string, min: number, max: number];

interface MacroSpec {
  readonly name: string;
  readonly mode?: MacroMode;
  /** Dove parte (0 … 127); assente: 0. */
  readonly value?: number;
  readonly moves: readonly Move[];
}

function rack(name: string, instrument: SavedDevice | null, effects: readonly SavedEffect[], macros: readonly MacroSpec[]): RackPreset {
  if (macros.length > MACRO_COUNT) throw new RangeError(`${name}: più di ${MACRO_COUNT} macro`);
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

/** Uno slot del Tornado: un effetto e la sua macro, che muove i parametri dati da [a 0, a 127]. */
interface Slot {
  readonly macro: string;
  readonly mode?: MacroMode;
  readonly effect: SavedEffect;
  readonly moves: Readonly<Record<string, readonly [min: number, max: number]>>;
}

/** Un Audio Effect Rack fatto di slot: l'effetto i è mosso dalla macro i. */
const slots = (name: string, list: readonly Slot[]): RackPreset =>
  rack(name, null, list.map(s => s.effect), list.map((s, i) => ({
    name: s.macro, mode: s.mode,
    moves: Object.entries(s.moves).map(([param, [min, max]]): Move => [i, param, min, max]),
  })));

export const TORNADO: RackPreset = slots('Tornado', [
  {
    // a tempo, sul battere di ogni quarto: sempre più spesso, sempre più fitto
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
    // il passa-basso che si chiude, con un po' di LFO e di risonanza in più
    macro: 'Filtro',
    effect: effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, lfoShape: LFO_SHAPE.triangle, lfoSync: AUTO_FILTER_SYNC.tempo, lfoDivision: TEMPO_RATE['1/2'] }),
    moves: { mix: [0, 100], freq: [20000, 300], resonance: [10, 55], lfoAmount: [0, 25] },
  },
  {
    // il Chorus con ritardo corto e feedback: un flanger
    macro: 'Flanger',
    effect: effect(CHORUS, null, { mode: CHORUS_MODE.chorus, delay: 3, sync: CHORUS_SYNC.tempo, division: TEMPO_RATE['2 battute'] }),
    moves: { mix: [0, 50], feedback: [0, 70], depth: [30, 60] },
  },
  {
    macro: 'Pan',
    effect: effect(AUTO_PAN, null, { shape: LFO_SHAPE.sine, sync: AUTO_PAN_SYNC.tempo, division: TEMPO_RATE['1/8'] }),
    moves: { amount: [0, 100] },
  },
  {
    // un pulsante: tenuto frena, lasciato riparte
    macro: 'Stop', mode: 'button',
    effect: effect(TAPE_STOP, null, { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Subito'), curve: BRAKE_CURVE.smooth, spin: 250 }),
    moves: { stop: [0, 1] },
  },
]);

/** La 303: l'Analog "Acid" con le manopole della scatoletta argentata, poi saturazione ed eco. */
export const ACIDO: RackPreset = (() => {
  const SYNTH = 0, DRIVE_ = 1, ECHO = 2, ROOM = 3;
  return rack('Acido', device(ANALOG, 'Acid'), [
    effect(DRIVE, 'Calda', { mix: 0 }),
    effect(DELAY, 'Ping-pong 1/8.', { highCut: 3500, lowCut: 200 }),
    effect(REVERB, 'Piatto'),
  ], [
    { name: 'Cutoff', value: 45, moves: [[SYNTH, 'cutoff', 120, 3500]] },
    { name: 'Risonanza', value: 80, moves: [[SYNTH, 'resonance', 40, 90]] },
    { name: 'Env Mod', value: 64, moves: [[SYNTH, 'filterEnv', 20, 100]] },
    { name: 'Decay', value: 50, moves: [[SYNTH, 'fDecay', 0.05, 1.2]] },
    { name: 'Accent', value: 90, moves: [[SYNTH, 'accent', 0, 100]] },
    { name: 'Glide', value: 30, moves: [[SYNTH, 'glide', 0, 250]] },
    // la saturazione entra (Dry/Wet) e spinge; il volume lo tiene il Drive (Auto)
    { name: 'Sporco', value: 40, moves: [[DRIVE_, 'mix', 0, 100], [DRIVE_, 'drive', 4, 30], [DRIVE_, 'output', 0, -4]] },
    { name: 'Eco', value: 20, moves: [[ECHO, 'mix', 0, 35], [ECHO, 'feedback', 25, 60], [ROOM, 'mix', 0, 25]] },
  ]);
})();

/** Il pad: il Wavetable "Pad che respira", allargato dal Chorus, tagliato a tempo dal Gate,
 *  allungato da eco e riverbero. */
export const NEBBIA: RackPreset = (() => {
  const SYNTH = 0, WIDE = 1, CHOP = 2, ECHO = 3, ROOM = 4;
  return rack('Nebbia', device(WAVETABLE, 'Pad che respira'), [
    effect(CHORUS, 'Chorus largo'),
    effect(GATE, null, { ...pattern('x.xx .xx. x.xx .x.x'), rate: index(STEP_RATES, '1/16'), gate: 70, release: 40 }),
    effect(DELAY, 'Eco lungo', { pingPong: 1, division: index(DIVISIONS, '1/4.') }),
    effect(REVERB, 'Sala', { decay: 6, mix: 35 }),
  ], [
    { name: 'Apri', value: 75, moves: [[SYNTH, 'cutoff', 250, 16000], [SYNTH, 'resonance', 25, 5]] },
    // sposta le due tabelle in versi opposti: il timbro cambia, il volume resta
    { name: 'Morph', value: 20, moves: [[SYNTH, 'posA', 0, 90], [SYNTH, 'posB', 70, 0]] },
    { name: 'Respiro', value: 80, moves: [[SYNTH, 'lfo1Amount', 0, 90], [SYNTH, 'lfo2Amount', 0, 70]] },
    { name: 'Larghezza', value: 60, moves: [[SYNTH, 'detune', 4, 40], [SYNTH, 'spread', 30, 100], [WIDE, 'mix', 0, 60]] },
    { name: 'Lentezza', value: 70, moves: [[SYNTH, 'attack', 0.005, 4], [SYNTH, 'release', 0.3, 6]] },
    { name: 'Gate', moves: [[CHOP, 'depth', 0, 100]] },
    { name: 'Eco', value: 25, moves: [[ECHO, 'mix', 0, 40], [ECHO, 'feedback', 30, 70]] },
    { name: 'Spazio', value: 50, moves: [[ROOM, 'mix', 10, 70], [ROOM, 'size', 50, 100], [ROOM, 'decay', 2, 14]] },
  ]);
})();

/** Il basso neuro: il Neuro "Neuro ringhio" con un wobble a tempo sul cutoff, poi phaser, OTT
 *  e i bassi in mono. */
export const RINGHIO: RackPreset = (() => {
  const SYNTH = 0, SWIRL = 1, OTT = 2;
  return rack('Ringhio', device(NEURO, 'Neuro ringhio', {
    lfo2Shape: NEURO_LFO.sine, lfo2Dest: NEURO_DEST.cutoff, lfo2Retrig: 0,
  }), [
    effect(PHASER, 'Reese che gira'),
    effect(MULTIBAND, 'OTT'),
    effect(STEREO, 'Basso mono'),
  ], [
    { name: 'Cutoff', value: 80, moves: [[SYNTH, 'cutoff', 200, 9000]] },
    { name: 'Ringhio', value: 55, moves: [[SYNTH, 'fm', 0, 75], [SYNTH, 'fold', 0, 60]] },
    { name: 'Vocale', value: 60, moves: [[SYNTH, 'vowel', 0, 100], [SYNTH, 'formant', 20, 90]] },
    // il wobble: quanto (Profondità) e quanto veloce (da 1/4 a 1/16, a scatti)
    { name: 'Wobble', moves: [[SYNTH, 'lfo2Amount', 0, 80]] },
    { name: 'Velocità', value: 40, moves: [[SYNTH, 'lfo2Rate', TEMPO_RATE['1/4'], TEMPO_RATE['1/16']]] },
    { name: 'Distorsione', value: 50, moves: [[SYNTH, 'dist', 0, 90], [SYNTH, 'drive', 30, 80]] },
    { name: 'Phaser', moves: [[SWIRL, 'mix', 0, 60]] },
    { name: 'OTT', value: 50, moves: [[OTT, 'depth', 0, 100], [SYNTH, 'sub', 90, 50]] },
  ]);
})();

// ---------------------------------------------------------------- Audio Effect Rack

/** La transizione di Live: una manopola (Fade) che porta il suono in una scia grigia. I filtri
 *  si stringono dai due lati, eco e coda crescono, lo stereo si chiude e il volume scende; le
 *  altre macro decidono com'è la scia. Con Fade a 0 il suono passa com'è. */
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
    { name: 'Eco', value: 60, moves: [[ECHO, 'feedback', 25, 85]] },
    // a scatti: da 1/8. a 1/2
    { name: 'Tempo eco', value: 40, moves: [[ECHO, 'division', index(DIVISIONS, '1/8.'), index(DIVISIONS, '1/2')]] },
    { name: 'Coda', value: 60, moves: [[ROOM, 'decay', 2, 18], [ROOM, 'size', 60, 100]] },
    { name: 'Scuro', value: 50, moves: [[ROOM, 'damping', 10000, 2000], [ECHO, 'highCut', 6000, 1200]] },
    { name: 'Risonanza', value: 30, moves: [[LOW, 'resonance', 0, 60], [HIGH, 'resonance', 0, 60]] },
  ]);
})();

/** Il dub di King Tubby: la mandata al delay, il "lancio" del feedback che si autoalimenta,
 *  il filtro che lo spazza, la molla e il nastro. Le macro a 0: il suono passa com'è. */
export const DUB: RackPreset = (() => {
  const SWEEP = 0, ECHO = 1, SPRING = 2, TAPE = 3;
  return rack('Dub', null, [
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.highPass, slope: 0, freq: 20, resonance: 35, mix: 0 }),
    effect(DELAY, 'Dub', { mix: 0 }),
    effect(REVERB, 'Piatto', { size: 40, decay: 2.5, diffusion: 60, mix: 0 }),
    effect(DRIVE, 'Nastro', { mix: 0 }),
  ], [
    { name: 'Mandata', value: 50, moves: [[ECHO, 'mix', 0, 60]] },
    // oltre il 90 % il delay suona da solo: il lancio
    { name: 'Lancio', value: 50, moves: [[ECHO, 'feedback', 40, 94]] },
    { name: 'Tempo', value: 70, moves: [[ECHO, 'division', index(DIVISIONS, '1/8'), index(DIVISIONS, '1/2')]] },
    { name: 'Scuro', value: 50, moves: [[ECHO, 'highCut', 5000, 800]] },
    { name: 'Filtro', moves: [[SWEEP, 'mix', 0, 100], [SWEEP, 'freq', 20, 1800]] },
    { name: 'Molla', value: 40, moves: [[SPRING, 'mix', 0, 45]] },
    { name: 'Nastro', value: 30, moves: [[TAPE, 'mix', 0, 100], [TAPE, 'drive', 6, 22]] },
  ]);
})();

/** Il filtro della house francese: il passa-basso risonante che si apre e si chiude, la pompa
 *  in quarti (come il sidechain della cassa), il phaser, un po' di sporco e la colla. */
export const FRENCH_TOUCH: RackPreset = (() => {
  const SWEEP = 0, PUMP = 1, SWIRL = 2, DIRT = 3, GLUE = 4;
  return rack('French Touch', null, [
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 40, mix: 0 }),
    // un'onda a dente in quarti, senza stereo: il volume che riparte a ogni colpo
    effect(AUTO_PAN, null, { shape: LFO_SHAPE.sawUp, sync: AUTO_PAN_SYNC.tempo, division: TEMPO_RATE['1/4'], stereo: 0, amount: 0 }),
    effect(PHASER, 'Phaser lento', { mix: 0 }),
    effect(DRIVE, 'Calda', { mix: 0 }),
    effect(COMPRESSOR, 'Colla', { mix: 0 }),
  ], [
    { name: 'Filtro', moves: [[SWEEP, 'mix', 0, 100], [SWEEP, 'freq', 20000, 180]] },
    { name: 'Risonanza', value: 50, moves: [[SWEEP, 'resonance', 10, 75]] },
    { name: 'Pompa', moves: [[PUMP, 'amount', 0, 85]] },
    { name: 'Phaser', moves: [[SWIRL, 'mix', 0, 60], [SWIRL, 'feedback', 30, 75]] },
    { name: 'Sporco', moves: [[DIRT, 'mix', 0, 70], [DIRT, 'drive', 6, 20]] },
    { name: 'Colla', value: 60, moves: [[GLUE, 'mix', 0, 100]] },
  ]);
})();

/** La cassetta consumata: il nastro che ondeggia (wow), la saturazione, i bit che mancano, le
 *  alte che se ne vanno, lo stereo che si stringe e la frenata del registratore. */
export const CASSETTA: RackPreset = (() => {
  const WOW = 0, TAPE = 1, BITS = 2, DULL = 3, NARROW = 4, BRAKE = 5;
  return rack('Cassetta', null, [
    // il wow: il Chorus tutto bagnato è un vibrato (in modo Vibrato il mix non c'è), e mono come il nastro
    effect(CHORUS, null, { mode: CHORUS_MODE.chorus, delay: 6, sync: CHORUS_SYNC.hz, rate: 0.7, depth: 20, width: 0, mix: 0 }),
    effect(DRIVE, 'Nastro', { mix: 0 }),
    effect(REDUX, 'Campionatore 12 bit', { mix: 0 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 0, freq: 20000, resonance: 5, mix: 0 }),
    effect(STEREO, null, { bassMono: 0 }),
    effect(TAPE_STOP, 'Frenata breve'),
  ], [
    { name: 'Wow', value: 40, moves: [[WOW, 'mix', 0, 100], [WOW, 'depth', 10, 55]] },
    { name: 'Nastro', value: 50, moves: [[TAPE, 'mix', 0, 100], [TAPE, 'drive', 6, 22]] },
    { name: 'Bit', value: 30, moves: [[BITS, 'mix', 0, 100], [BITS, 'bits', 16, 7], [BITS, 'rate', 48000, 11000]] },
    { name: 'Opaco', value: 50, moves: [[DULL, 'mix', 0, 100], [DULL, 'freq', 20000, 2200]] },
    { name: 'Stretto', value: 30, moves: [[NARROW, 'width', 100, 20]] },
    { name: 'Stop', mode: 'button', moves: [[BRAKE, 'stop', 0, 1]] },
  ]);
})();

/** Il muro di suono dello shoegaze: il fuzz, la leva del vibrato, il riverbero al contrario che
 *  risucchia, l'eco e la coda infinita, tutto largo. */
export const MURO: RackPreset = (() => {
  const FUZZ = 0, BEND = 1, SUCK = 2, ECHO = 3, ROOM = 4, WIDE = 5;
  return rack('Muro', null, [
    effect(DRIVE, 'Fuzz', { mix: 0 }),
    // la leva del vibrato: il Chorus che entra fino a tutto bagnato
    effect(CHORUS, null, { mode: CHORUS_MODE.chorus, delay: 5, sync: CHORUS_SYNC.hz, rate: 0.35, depth: 30, width: 50, mix: 0 }),
    effect(REVERSE, 'Risucchio di 1 battuta', { mix: 0 }),
    effect(DELAY, 'Eco lungo', { mix: 0 }),
    effect(REVERB, 'Coda infinita', { mix: 0 }),
    effect(STEREO, null, { bassMono: 0 }),
  ], [
    { name: 'Fuzz', value: 60, moves: [[FUZZ, 'mix', 0, 100], [FUZZ, 'drive', 14, 32], [FUZZ, 'output', 0, -4]] },
    { name: 'Leva', value: 40, moves: [[BEND, 'mix', 0, 100], [BEND, 'depth', 10, 60]] },
    { name: 'Risucchio', moves: [[SUCK, 'mix', 0, 55]] },
    { name: 'Eco', value: 30, moves: [[ECHO, 'mix', 0, 40], [ECHO, 'feedback', 30, 70]] },
    { name: 'Muro', value: 70, moves: [[ROOM, 'mix', 0, 65], [ROOM, 'decay', 4, 20]] },
    { name: 'Larghezza', value: 50, moves: [[WIDE, 'width', 100, 180]] },
  ]);
})();

// ---------------------------------------------------------------- Instrument Rack

/** Il polysynth della new wave: due dente di sega e un'ottava di quadra, il filtro che morde un
 *  po', il vibrato leggero, poi chorus ensemble, eco ping-pong e sala. */
export const NUOVA_ONDA: RackPreset = (() => {
  const SYNTH = 0, ENSEMBLE = 1, ECHO = 2, ROOM = 3;
  return rack('Nuova onda', device(ANALOG, 'Lead', {
    oscA: 0, oscB: 1, oscBSemi: 12, oscBFine: 6, mix: 40, unison: 2, detune: 14, cutoff: 2200, resonance: 30, filterEnv: 45,
    fDecay: 0.6, fSustain: 30, attack: 0.005, decay: 0.8, sustain: 70, release: 0.5, lfoRate: 5, lfoPitch: 6, volume: -9,
  }), [
    effect(CHORUS, 'Ensemble archi'),
    effect(DELAY, 'Ping-pong 1/8.', { highCut: 4000, mix: 20 }),
    effect(REVERB, 'Sala', { decay: 3.5 }),
  ], [
    { name: 'Cutoff', value: 64, moves: [[SYNTH, 'cutoff', 300, 8000]] },
    { name: 'Risonanza', value: 35, moves: [[SYNTH, 'resonance', 5, 80]] },
    { name: 'Inviluppo', value: 60, moves: [[SYNTH, 'filterEnv', 0, 90]] },
    { name: 'Attacco', moves: [[SYNTH, 'attack', 0.001, 1.5], [SYNTH, 'fAttack', 0.001, 1]] },
    { name: 'Rilascio', value: 30, moves: [[SYNTH, 'release', 0.1, 3]] },
    { name: 'Chorus', value: 60, moves: [[ENSEMBLE, 'mix', 0, 80], [ENSEMBLE, 'depth', 20, 70]] },
    { name: 'Eco', value: 45, moves: [[ECHO, 'mix', 0, 45], [ECHO, 'feedback', 20, 65]] },
    { name: 'Spazio', value: 45, moves: [[ROOM, 'mix', 5, 60], [ROOM, 'decay', 1.5, 8]] },
  ]);
})();

/** Gli archi della string machine di Oxygène: il Wavetable "Archi" più lento, nel phaser che
 *  gira piano, nell'ensemble e in una sala lunga. */
export const OSSIGENO: RackPreset = (() => {
  const SYNTH = 0, SWIRL = 1, ENSEMBLE = 2, ECHO = 3, ROOM = 4;
  return rack('Ossigeno', device(WAVETABLE, 'Archi', { attack: 0.6, release: 1.5, cutoff: 4000, volume: -6 }), [
    effect(PHASER, 'Phaser lento', { mix: 60 }),
    effect(CHORUS, 'Ensemble archi'),
    effect(DELAY, 'Eco lungo', { mix: 15 }),
    effect(REVERB, 'Sala', { decay: 5, mix: 35 }),
  ], [
    { name: 'Phaser', value: 90, moves: [[SWIRL, 'mix', 0, 80], [SWIRL, 'feedback', 20, 75]] },
    // a scatti: da 4 battute a 1/2 per giro
    { name: 'Velocità', value: 40, moves: [[SWIRL, 'division', TEMPO_RATE['4 battute'], TEMPO_RATE['1/2']]] },
    { name: 'Brillantezza', value: 70, moves: [[SYNTH, 'cutoff', 800, 10000]] },
    { name: 'Ensemble', value: 70, moves: [[ENSEMBLE, 'mix', 0, 80]] },
    { name: 'Attacco', value: 40, moves: [[SYNTH, 'attack', 0.01, 3]] },
    { name: 'Rilascio', value: 40, moves: [[SYNTH, 'release', 0.3, 6]] },
    { name: 'Eco', value: 20, moves: [[ECHO, 'mix', 0, 35]] },
    { name: 'Spazio', value: 50, moves: [[ROOM, 'mix', 10, 60], [ROOM, 'decay', 2, 12]] },
  ]);
})();

/** L'hoover dei rave (Mentasm, l'Alpha Juno): PWM e dente di sega un'ottava sotto, sette copie
 *  larghe, il glide e lo "swoop" che sale all'attacco, nel chorus. */
export const HOOVER: RackPreset = (() => {
  const SYNTH = 0, WIDE = 1, GRIT = 2, ROOM = 3;
  return rack('Hoover', device(WAVETABLE, 'Supersaw', {
    tableA: TABLE.PWM, posA: 60, tableB: TABLE.Base, posB: 67, levelB: 60, semiB: -12, unison: 7, detune: 35, spread: 100,
    voiceMode: VOICE_MODE.legato, glide: 120, cutoff: 6000, sustain: 100, release: 0.4,
    mAttack: 0.001, mDecay: 0.3, mSustain: 0, mRelease: 0.2, envDest: MOD_DEST.pitch, envAmount: -25, envDest2: MOD_DEST.none,
    lfo1Shape: WT_LFO.triangle, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 0.6, lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 30,
    volume: -16,
  }), [
    effect(CHORUS, 'Chorus largo', { mix: 60 }),
    effect(DRIVE, 'Calda', { mix: 0 }),
    effect(REVERB, 'Sala', { mix: 20 }),
  ], [
    // lo swoop: quanto sotto parte la nota (fino a 12 semitoni) prima di salire
    { name: 'Swoop', value: 64, moves: [[SYNTH, 'envAmount', 0, -50]] },
    { name: 'Glide', value: 40, moves: [[SYNTH, 'glide', 0, 400]] },
    { name: 'PWM', value: 64, moves: [[SYNTH, 'lfo1Amount', 0, 60]] },
    { name: 'Larghezza', value: 80, moves: [[SYNTH, 'detune', 10, 50], [WIDE, 'mix', 0, 80]] },
    { name: 'Cutoff', value: 80, moves: [[SYNTH, 'cutoff', 500, 14000]] },
    { name: 'Ottava sotto', value: 90, moves: [[SYNTH, 'levelB', 0, 70]] },
    { name: 'Grinta', moves: [[GRIT, 'mix', 0, 100], [GRIT, 'drive', 6, 20]] },
    { name: 'Spazio', value: 35, moves: [[ROOM, 'mix', 5, 50]] },
  ]);
})();

/** Gli ottoni da polysynth degli anni '80 (l'OB-Xa di "Jump"): dente di sega scordati, il
 *  filtro che si apre all'attacco, chorus, compressione e una stanza. */
export const JUMP: RackPreset = (() => {
  const SYNTH = 0, ENSEMBLE = 1, GLUE = 2, ROOM = 3;
  return rack('Jump', device(ANALOG, 'Pad', {
    oscA: 0, oscB: 0, oscBSemi: 0, oscBFine: 10, mix: 50, unison: 3, detune: 20, spread: 80, cutoff: 900, resonance: 10,
    filterEnv: 50, keyTrack: 40, fAttack: 0.02, fDecay: 0.5, fSustain: 45, fRelease: 0.3, attack: 0.01, decay: 0.6, sustain: 85,
    release: 0.25, lfoCutoff: 0, velocity: 40, volume: -8,
  }), [
    effect(CHORUS, 'Chorus largo', { mix: 35 }),
    effect(COMPRESSOR, 'Colla'),
    effect(REVERB, 'Stanza'),
  ], [
    { name: 'Brillantezza', value: 55, moves: [[SYNTH, 'cutoff', 300, 6000]] },
    { name: 'Morso', value: 60, moves: [[SYNTH, 'filterEnv', 0, 90]] },
    // il filtro che si apre piano: gli ottoni che si gonfiano
    { name: 'Gonfia', value: 20, moves: [[SYNTH, 'fAttack', 0.001, 0.4], [SYNTH, 'attack', 0.003, 0.15]] },
    { name: 'Spessore', value: 50, moves: [[SYNTH, 'detune', 5, 40], [SYNTH, 'oscBFine', 3, 20]] },
    { name: 'Rilascio', value: 20, moves: [[SYNTH, 'release', 0.05, 2]] },
    { name: 'Chorus', value: 50, moves: [[ENSEMBLE, 'mix', 0, 70]] },
    { name: 'Colla', value: 50, moves: [[GLUE, 'mix', 0, 100]] },
    { name: 'Spazio', value: 40, moves: [[ROOM, 'mix', 5, 45]] },
  ]);
})();

/** I rack di fabbrica, in ordine. */
export const FACTORY_RACKS: readonly RackPreset[] = [
  TORNADO, FADE_TO_GREY, DUB, FRENCH_TOUCH, CASSETTA, MURO,
  ACIDO, NEBBIA, RINGHIO, NUOVA_ONDA, OSSIGENO, HOOVER, JUMP,
];
