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
 * muovono insieme strumento ed effetti, e partono dove il suono è già bello.
 *
 * Levare, 303, Acido FX e Macchina vengono dal live "Rave illegale" (src/demo/rave-live.ts).
 *
 * I rack di batteria partono da un kit della Drum Machine (o dal Kick, dallo Snare, da Hat e
 * Piatti da soli): le macro muovono anche i parametri degli strumenti dentro i pad, per id con il
 * pad davanti ("p1.kick.decay": la cassa del pad 1). */
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
import { LFO_SYNC, MOD_DEST, TABLE, VOICE_MODE, WAVETABLE, LFO_SHAPE as WT_LFO } from './instruments/wavetable/wavetable';
import { TEMPO_RATE } from './rates';
import { SEQ_RATE, SEQ_SCALE } from './sequencer';

const index = (list: readonly (readonly [string, ...unknown[]])[], label: string) => list.findIndex(([l]) => l === label);

/** Un dispositivo da un preset di fabbrica (null: da Init), con dei parametri cambiati. */
function device(type: DeviceType, preset: string | null, params: Readonly<Record<string, number>> = {}): SavedDevice {
  const base = preset === null ? {} : type.presets.find(p => p.name === preset)?.params;
  if (!base) throw new RangeError(`${type.label}: il preset «${preset}» non c'è`);
  return { type: type.type, preset, params: { ...base, ...params } };
}

const effect = (type: DeviceType, preset: string | null, params?: Readonly<Record<string, number>>): SavedEffect =>
  ({ ...device(type, preset, params), enabled: true });

/** Un EQ: un passa-alto a `low` Hz (24 dB) e delle campane [frequenza, guadagno, Q]. */
function eqOf(low: number, bells: readonly (readonly [freq: number, gain: number, q: number])[]): SavedEffect {
  const params: Record<string, number> = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: low, [bandParam(0, 'slope')]: 1 };
  bells.forEach(([freq, gain, q], i) => Object.assign(params, {
    [bandParam(i + 1, 'type')]: BAND.bell, [bandParam(i + 1, 'freq')]: freq, [bandParam(i + 1, 'gain')]: gain, [bandParam(i + 1, 'q')]: q,
  }));
  return effect(EQ, null, params);
}

/** Il Beat Repeat da suonare a pulsante: spento lascia passare il suono com'è. */
const repeatButton = (grid: string): SavedEffect =>
  effect(BEAT_REPEAT, null, { only: 1, repeat: 0, grid: index(GRIDS, grid), mode: REPEAT_MODE.insert, decay: 8, volume: 0 });

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

/** La 303 del rave: la distorsione dura, il gate a passi che la taglia, phaser, eco puntato e
 *  un buio corto; Ripeti è un pulsante (un Beat Repeat a 1/16 finché lo si tiene). */
export const ACIDO_FX: RackPreset = (() => {
  const DIRT = 0, CHOP = 1, SWIRL = 2, ECHO = 3, ROOM = 4, REPEAT = 5;
  return rack('Acido FX', null, [
    effect(DRIVE, null, { shape: SHAPE.hard, drive: 16, bias: 12, color: 25, low: 15, split: 150, tone: 9000, mix: 0, oversampling: 0 }),
    effect(GATE, null, { ...pattern('x.xx .xx. x.xx .x.x'), rate: index(STEP_RATES, '1/16'), gate: 70, release: 15, depth: 0 }),
    effect(PHASER, null, { mix: 0 }),
    effect(DELAY, null, { division: index(DIVISIONS, '1/8.'), pingPong: 1, feedback: 35, lowCut: 350, highCut: 4000, mix: 0 }),
    effect(REVERB, null, { size: 60, decay: 1.6, predelay: 10, damping: 4500, lowCut: 300, mix: 0 }),
    repeatButton('1/16'),
  ], [
    { name: 'Distorsione', value: 70, moves: [[DIRT, 'mix', 0, 100], [DIRT, 'drive', 4, 26]] },
    { name: 'Taglio', moves: [[CHOP, 'depth', 0, 100]] },
    { name: 'Phaser', moves: [[SWIRL, 'mix', 0, 60]] },
    { name: 'Eco', value: 30, moves: [[ECHO, 'mix', 0, 40], [ECHO, 'feedback', 20, 65]] },
    { name: 'Spazio', value: 15, moves: [[ROOM, 'mix', 0, 40]] },
    { name: 'Ripeti', mode: 'button', moves: [[REPEAT, 'repeat', 0, 1]] },
  ]);
})();

/** La macchina del master del rave: tre Ripeti, Al contrario e Stop nastro a pulsante, la
 *  Sottrazione (il passa-alto che toglie cassa e basso prima di ridare tutto), il Muro
 *  (passa-basso) e il Lo-fi. A 0 il suono passa com'è. */
export const MACCHINA: RackPreset = (() => {
  const R8 = 0, R16 = 1, R32 = 2, BACK = 3, BRAKE = 4, LOW = 5, HIGH = 6, BITS = 7;
  return rack('Macchina', null, [
    repeatButton('1/8'),
    repeatButton('1/16'),
    repeatButton('1/32'),
    effect(REVERSE, null, { reverse: 1, length: index(REVERSE_LENGTHS, '1/4'), mix: 0 }),
    effect(TAPE_STOP, null, { sync: TAPE_SYNC.tempo, division: index(BRAKE_DIVISIONS, '1/2'), start: index(STARTS, 'Subito'), curve: BRAKE_CURVE.smooth, spin: 300 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.highPass, slope: 1, freq: 20, resonance: 10, mix: 0 }),
    effect(AUTO_FILTER, null, { type: FILTER_TYPE.lowPass, slope: 1, freq: 20000, resonance: 15, mix: 0 }),
    effect(REDUX, null, { mix: 0, bits: 16, rate: 48000 }),
  ], [
    { name: 'Ripeti 1/8', mode: 'button', moves: [[R8, 'repeat', 0, 1]] },
    { name: 'Ripeti 1/16', mode: 'button', moves: [[R16, 'repeat', 0, 1]] },
    { name: 'Ripeti 1/32', mode: 'button', moves: [[R32, 'repeat', 0, 1]] },
    { name: 'Al contrario', mode: 'button', moves: [[BACK, 'mix', 0, 100]] },
    { name: 'Stop nastro', mode: 'button', moves: [[BRAKE, 'stop', 0, 1]] },
    { name: 'Sottrazione', moves: [[LOW, 'mix', 0, 100], [LOW, 'freq', 20, 700]] },
    { name: 'Muro', moves: [[HIGH, 'mix', 0, 100], [HIGH, 'freq', 20000, 350]] },
    { name: 'Lo-fi', moves: [[BITS, 'mix', 0, 100], [BITS, 'bits', 16, 6], [BITS, 'rate', 48000, 6000]] },
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

/** Il basso in levare del rave: Neuro a una voce, due denti di sega e una quadra appena
 *  scordata, il filtro che morde con l'inviluppo di modulazione, il sub pulito sotto il
 *  crossover; i bassi in mono. Il sequencer è pronto (spento): acceso lascia il battere alla
 *  cassa. Nel live pompa in sidechain sulla cassa: qui il compressore non c'è (va messo dopo,
 *  con la cassa come sidechain). */
export const LEVARE: RackPreset = (() => {
  const SYNTH = 0, ROOM = 2;
  return rack('Levare', device(NEURO, null, {
    oscA: 0, oscB: 1, oscBSemi: 0, oscBFine: -7, mix: 35, unison: 1,
    filterType: 0, cutoff: 900, resonance: 25, drive: 30, keyTrack: 40,
    dist: 20, sub: 70, subOctave: 0, crossover: 120,
    voiceMode: 0, glide: 0, attack: 0.002, decay: 0.18, sustain: 40, release: 0.07, velocity: 30,
    mAttack: 0.001, mDecay: 0.1, mSustain: 0, mRelease: 0.05, envDest: NEURO_DEST.cutoff, envAmount: 45,
    volume: -6,
    seqKick: 1, seqDensity: 70, seqRange: 25, seqScale: SEQ_SCALE['Frigio e tritono'], seqSlide: 0, seqAccent: 25, seqGate: 60, seqPattern: 11,
  }), [
    eqOf(35, [[250, -2.5, 1], [2500, 1.5, 1]]),
    effect(REVERB, null, { size: 75, decay: 1.2, predelay: 0, diffusion: 90, damping: 2500, lowCut: 30, width: 0, mix: 0 }),
    effect(STEREO, null, { monoFreq: 150 }),
  ], [
    { name: 'Cutoff', value: 60, moves: [[SYNTH, 'cutoff', 150, 8000]] },
    { name: 'Morso', value: 60, moves: [[SYNTH, 'envAmount', 0, 80], [SYNTH, 'mDecay', 0.04, 0.25]] },
    { name: 'Coda', value: 60, moves: [[SYNTH, 'decay', 0.06, 0.6], [SYNTH, 'release', 0.02, 0.3]] },
    { name: 'Sub', value: 87, moves: [[SYNTH, 'sub', 20, 100]] },
    { name: 'Ringhio', moves: [[SYNTH, 'fm', 0, 55], [SYNTH, 'fold', 0, 45]] },
    { name: 'Distorsione', value: 50, moves: [[SYNTH, 'dist', 0, 70], [SYNTH, 'drive', 15, 70]] },
    { name: 'Vocale', moves: [[SYNTH, 'formant', 0, 80], [SYNTH, 'vowel', 0, 100]] },
    // il basso in una stanza piccola e scura, mono: il rimbombo sotto la cassa
    { name: 'Rumble', moves: [[ROOM, 'mix', 0, 40], [ROOM, 'decay', 1.2, 2.5]] },
  ]);
})();

/** La 303 che si scrive da sola: l'Analog in Legato con glide e accento, e il sequencer a passi
 *  pronto (Frigio e tritono, sedicesimi; si accende nella sezione Sequencer, e con il trasporto
 *  che va basta tenere la tonica). Pattern sceglie il giro, Follia lo porta da poche note a una
 *  linea frenetica. Da mettere davanti ad Acido FX. */
export const TRECENTOTRE: RackPreset = (() => {
  const SYNTH = 0;
  return rack('303', device(ANALOG, null, {
    oscA: 0, mix: 0, voiceMode: ANALOG_VOICE.legato, glide: 60, accent: 70,
    cutoff: 420, resonance: 80, filterEnv: 66, keyTrack: 20,
    fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -11,
    seqScale: SEQ_SCALE['Frigio e tritono'], seqRate: SEQ_RATE['1/16'], seqLength: 16, seqGate: 55,
  }), [
    eqOf(95, [[160, -4, 1.2], [622, 2.5, 1]]),
  ], [
    { name: 'Cutoff', value: 55, moves: [[SYNTH, 'cutoff', 90, 3500]] },
    { name: 'Risonanza', value: 90, moves: [[SYNTH, 'resonance', 30, 95]] },
    { name: 'Env Mod', value: 76, moves: [[SYNTH, 'filterEnv', 10, 100]] },
    { name: 'Decay', value: 40, moves: [[SYNTH, 'fDecay', 0.04, 1]] },
    { name: 'Accento', value: 90, moves: [[SYNTH, 'accent', 0, 100]] },
    { name: 'Glide', value: 38, moves: [[SYNTH, 'glide', 0, 200]] },
    // il giro del sequencer: uno nuovo entra all'inizio del giro
    { name: 'Pattern', moves: [[SYNTH, 'seqPattern', 0, 127]] },
    // da un acido minimale (poche note, la tonica) a uno frenetico (pieno, largo, slide, accenti)
    { name: 'Follia', value: 40, moves: [[SYNTH, 'seqDensity', 25, 100], [SYNTH, 'seqRange', 5, 85], [SYNTH, 'seqSlide', 5, 55], [SYNTH, 'seqAccent', 15, 60]] },
  ]);
})();

// ---------------------------------------------------------------- batteria

/** Il kit Rave con la colla: saturazione, compressione e una stanza piccola. Le macro scavano
 *  nella cassa (coda, rumble, nota), nel rullante (la stanza) e negli hi-hat. */
export const BATTERIA_RAVE: RackPreset = (() => {
  const KIT = 0, HEAT = 1, GLUE = 2, ROOM = 3;
  return rack('Batteria rave', device(DRUMS, 'Rave', { volume: -9 }), [
    effect(DRIVE, 'Calda', { mix: 0 }),
    effect(COMPRESSOR, 'Punch batteria'),
    effect(REVERB, 'Stanza', { mix: 0 }),
  ], [
    { name: 'Coda cassa', value: 50, moves: [[KIT, 'p1.kick.decay', 0.12, 0.4], [KIT, 'p1.kick.tailDecay', 0.2, 1.2]] },
    { name: 'Rumble', value: 90, moves: [[KIT, 'p1.kick.rumble', 0, 100], [KIT, 'p1.kick.rumbleTime', 0.6, 2.5]] },
    // la cassa accordata: da C0 a C1, a semitoni
    { name: 'Nota cassa', value: 42, moves: [[KIT, 'p1.kick.note', 0, 12], [KIT, 'p13.kick.note', 0, 12]] },
    { name: 'Stanza rullante', value: 50, moves: [[KIT, 'p3.snare.room', 10, 90], [KIT, 'p3.snare.roomTime', 0.5, 2.5]] },
    { name: 'Hat aperto', value: 35, moves: [[KIT, 'p11.cymbals.openDecay', 0.12, 1.5]] },
    {
      name: 'Brillantezza', value: 70,
      moves: [[KIT, 'p7.cymbals.closedTone', 40, 90], [KIT, 'p9.cymbals.pedalTone', 40, 90], [KIT, 'p11.cymbals.openTone', 40, 90]],
    },
    { name: 'Saturazione', moves: [[HEAT, 'mix', 0, 100], [HEAT, 'drive', 6, 16]] },
    { name: 'Colla', value: 80, moves: [[GLUE, 'mix', 0, 100], [ROOM, 'mix', 0, 15]] },
  ]);
})();

/** Il kit Dub techno nell'eco e nella sala, con il filtro davanti: tutto si allontana. */
export const BATTERIA_DUB: RackPreset = (() => {
  const KIT = 0, FILTER = 1, ECHO = 2, HALL = 3;
  return rack('Batteria dub', device(DRUMS, 'Dub techno'), [
    effect(AUTO_FILTER, null, { freq: 20000, resonance: 25, slope: 1 }),
    effect(DELAY, 'Dub', { mix: 0 }),
    effect(REVERB, 'Sala', { mix: 0 }),
  ], [
    { name: 'Filtro', moves: [[FILTER, 'freq', 20000, 250]] },
    { name: 'Eco', value: 45, moves: [[ECHO, 'mix', 0, 45]] },
    { name: 'Ritorni', value: 60, moves: [[ECHO, 'feedback', 20, 85]] },
    { name: 'Sala', value: 40, moves: [[HALL, 'mix', 0, 45], [HALL, 'decay', 2, 8]] },
    { name: 'Stanza rim', value: 50, moves: [[KIT, 'p2.snare.room', 10, 90], [KIT, 'p2.snare.roomTime', 0.8, 3]] },
    { name: 'Rumble', value: 45, moves: [[KIT, 'p1.kick.rumble', 0, 80], [KIT, 'p1.kick.tailDecay', 0.5, 2]] },
    { name: 'Hat aperto', value: 60, moves: [[KIT, 'p11.cymbals.openDecay', 0.3, 2.5]] },
    { name: 'Larghezza hat', value: 80, moves: [[KIT, 'p7.cymbals.width', 20, 100], [KIT, 'p11.cymbals.width', 20, 100]] },
  ]);
})();

/** Il kit Lo-fi nel campionatore vecchio: bit e frequenza che calano, il rullante che si sgrana,
 *  lo stutter a pulsante. */
export const BATTERIA_ROTTA: RackPreset = (() => {
  const KIT = 0, BITS = 1, STUTTER = 2, GLUE = 3;
  return rack('Batteria rotta', device(DRUMS, 'Lo-fi', { volume: -6 }), [
    effect(REDUX, 'Campionatore 12 bit', { mix: 0 }),
    repeatButton('1/16'),
    effect(COMPRESSOR, 'Schiaccia', { mix: 0 }),
  ], [
    { name: 'Bit', value: 40, moves: [[BITS, 'mix', 0, 100], [BITS, 'bits', 16, 5], [BITS, 'rate', 30000, 5000]] },
    { name: 'Grana', value: 60, moves: [[KIT, 'p3.snare.grain', 0, 100], [KIT, 'p5.snare.grain', 30, 100]] },
    { name: 'Stutter', mode: 'button', moves: [[STUTTER, 'repeat', 0, 1]] },
    { name: 'Schiaccia', value: 50, moves: [[GLUE, 'mix', 0, 80]] },
    { name: 'Cassa', value: 64, moves: [[KIT, 'p1.kick.drive', 0, 80], [KIT, 'p1.kick.decay', 0.06, 0.3]] },
    { name: 'Metallo', value: 64, moves: [[KIT, 'p7.cymbals.variation', 10, 100], [KIT, 'p11.cymbals.variation', 10, 100]] },
    { name: 'Hat aperto', value: 40, moves: [[KIT, 'p11.cymbals.openDecay', 0.15, 1.5]] },
    { name: 'Stanza', value: 30, moves: [[KIT, 'p5.snare.room', 0, 80], [KIT, 'p5.snare.roomTime', 0.3, 2]] },
  ]);
})();

/** Il kit Industriale ancora più duro: distorsione, OTT, una sala di cemento. */
export const BATTERIA_INDUSTRIALE: RackPreset = (() => {
  const KIT = 0, BREAK = 1, OTT = 2, HALL = 3;
  return rack('Batteria industriale', device(DRUMS, 'Industriale', { volume: -10 }), [
    effect(DRIVE, 'Rotto', { mix: 0 }),
    effect(MULTIBAND, 'OTT', { mix: 0, output: 0 }),
    effect(REVERB, 'Sala', { mix: 0, damping: 3000 }),
  ], [
    { name: 'Distruzione', moves: [[BREAK, 'mix', 0, 50], [BREAK, 'output', 0, -6]] },
    { name: 'OTT', value: 40, moves: [[OTT, 'mix', 0, 60]] },
    { name: 'Cemento', value: 30, moves: [[HALL, 'mix', 0, 40], [HALL, 'decay', 1.5, 6]] },
    { name: 'Rumble', value: 64, moves: [[KIT, 'p13.kick.rumble', 0, 100], [KIT, 'p13.kick.rumbleDrive', 40, 100]] },
    { name: 'Stanza rullante', value: 40, moves: [[KIT, 'p3.snare.room', 0, 90], [KIT, 'p3.snare.roomTime', 0.5, 3]] },
    { name: 'Rullante sporco', value: 50, moves: [[KIT, 'p3.snare.drive', 20, 100], [KIT, 'p3.snare.grain', 0, 80]] },
    { name: 'Piatti lunghi', value: 40, moves: [[KIT, 'p14.cymbals.crashDecay', 1, 8], [KIT, 'p16.cymbals.rideDecay', 1, 8]] },
    { name: 'Hat aperto', value: 40, moves: [[KIT, 'p11.cymbals.openDecay', 0.2, 2]] },
  ]);
})();

/** Una cassa da costruire a manopole: il Kick "Techno", un EQ e il clipper. */
export const CASSA: RackPreset = (() => {
  const KICK_ = 0, CLIP = 2;
  return rack('Cassa', device(KICK, 'Techno', { rumbleOn: 1, rumble: 0 }), [
    eqOf(25, [[60, 2, 1], [300, -3, 1.2], [4000, 1.5, 1]]),
    effect(CLIPPER, 'Cassa', { drive: 0 }),
  ], [
    { name: 'Nota', value: 53, moves: [[KICK_, 'note', 0, 12]] },
    { name: 'Punch', value: 60, moves: [[KICK_, 'snapLevel', 10, 90], [KICK_, 'pitch', 15, 45]] },
    { name: 'Caduta', value: 40, moves: [[KICK_, 'pitchTime', 15, 90]] },
    { name: 'Corpo', value: 50, moves: [[KICK_, 'decay', 0.1, 0.5], [KICK_, 'hold', 5, 60]] },
    { name: 'Coda', value: 45, moves: [[KICK_, 'tailLevel', 0, 80], [KICK_, 'tailDecay', 0.2, 2]] },
    { name: 'Rumble', moves: [[KICK_, 'rumble', 0, 100], [KICK_, 'rumbleDrive', 30, 90]] },
    { name: 'Saturazione', value: 30, moves: [[KICK_, 'drive', 0, 70]] },
    { name: 'Clip', value: 40, moves: [[CLIP, 'drive', 0, 10]] },
  ]);
})();

/** Un rullante da costruire a manopole, con la sala da lanciare. */
export const RULLANTE: RackPreset = (() => {
  const SNARE_ = 0, GLUE = 1, THROW = 2;
  return rack('Rullante', device(SNARE, 'Techno', { volume: -12 }), [
    effect(COMPRESSOR, 'Punch batteria', { mix: 0 }),
    effect(REVERB, 'Lancio voce', { mix: 0 }),
  ], [
    { name: 'Nota', value: 40, moves: [[SNARE_, 'note', 0, 24]] },
    { name: 'Bacchetta', value: 50, moves: [[SNARE_, 'snapLevel', 10, 90]] },
    { name: 'Pelle', value: 55, moves: [[SNARE_, 'bodyLevel', 20, 90], [SNARE_, 'decay', 0.06, 0.3]] },
    { name: 'Cordiera', value: 64, moves: [[SNARE_, 'wiresLevel', 20, 100], [SNARE_, 'wiresDecay', 0.1, 0.6]] },
    { name: 'Grana', moves: [[SNARE_, 'grain', 0, 100]] },
    { name: 'Stanza', value: 45, moves: [[SNARE_, 'room', 0, 90], [SNARE_, 'roomTime', 0.3, 2.5]] },
    { name: 'Punch', value: 50, moves: [[GLUE, 'mix', 0, 100]] },
    { name: 'Lancio', moves: [[THROW, 'mix', 0, 60]] },
  ]);
})();

/** Gli hi-hat che si muovono: pan a tempo, eco ping-pong e il flanger metallico. */
export const HAT_IN_MOVIMENTO: RackPreset = (() => {
  const HATS = 0, PAN = 1, ECHO = 2, JET = 3;
  return rack('Hat in movimento', device(CYMBALS, 'Techno secca'), [
    effect(AUTO_PAN, 'Pan in ottavi', { amount: 0 }),
    effect(DELAY, 'Ping-pong 1/8.', { mix: 0 }),
    effect(PHASER, 'Hat metallici', { mix: 0 }),
  ], [
    { name: 'Chiuso', value: 40, moves: [[HATS, 'closedDecay', 0.02, 0.15]] },
    { name: 'Aperto', value: 40, moves: [[HATS, 'openDecay', 0.15, 1.5]] },
    { name: 'Brillantezza', value: 70, moves: [[HATS, 'closedTone', 30, 95], [HATS, 'pedalTone', 30, 95], [HATS, 'openTone', 30, 95]] },
    { name: 'Variazione', value: 30, moves: [[HATS, 'variation', 0, 100]] },
    { name: 'Rumore', value: 50, moves: [[HATS, 'closedNoise', 10, 90], [HATS, 'openNoise', 10, 90]] },
    { name: 'Pan', value: 50, moves: [[PAN, 'amount', 0, 100]] },
    { name: 'Eco', value: 30, moves: [[ECHO, 'mix', 0, 40]] },
    { name: 'Jet', moves: [[JET, 'mix', 0, 60]] },
  ]);
})();

/** I rack di fabbrica, in ordine. */
export const FACTORY_RACKS: readonly RackPreset[] = [
  TORNADO, FADE_TO_GREY, DUB, FRENCH_TOUCH, CASSETTA, MURO, ACIDO_FX, MACCHINA,
  ACIDO, NEBBIA, RINGHIO, NUOVA_ONDA, OSSIGENO, HOOVER, JUMP, LEVARE, TRECENTOTRE,
  BATTERIA_RAVE, BATTERIA_DUB, BATTERIA_ROTTA, BATTERIA_INDUSTRIALE, CASSA, RULLANTE, HAT_IN_MOVIMENTO,
];
