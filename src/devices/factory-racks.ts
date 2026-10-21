/* I rack di fabbrica, nel browser accanto a quelli salvati dall'utente (come i rack di Live).
 * Sono rack come gli altri: dispositivi già regolati e macro mappate, solo scritti qui.
 *
 * "Tornado" è un multieffetto da suonare dal vivo alla Turnado: otto effetti in fila, una
 * macro ciascuno. A 0 l'effetto non c'è (il suono passa com'è); girando entra e si fa più forte.
 * Sulle 8 manopole Device Control dell'APC40, o sulla tastiera, si suona come uno strumento.
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
import { WAVETABLE } from './instruments/wavetable/wavetable';
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

/** I rack di fabbrica, in ordine. */
export const FACTORY_RACKS: readonly RackPreset[] = [TORNADO, ACIDO, NEBBIA, RINGHIO];
