/* The Spectral Resonator's partials: which frequencies ring, how loud on each side and for how
 * long. Each note of the chord, times each unison voice, is a fundamental; each fundamental has
 * its series of partials, pulled apart by Stretch and moved by Shift; Damping makes the high ones
 * quieter and shorter. Pure: no buffers, no audio, tested in Node. */
import { CHORDS, FIRST_NOTE, MAX_PARTIALS, MAX_UNISON, noteHz, RESOLUTIONS } from './spectral-resonator';

/** The knobs as the sound uses them. */
export interface ResonatorSettings {
  /** The note with Fine, in Hz. */
  readonly rootHz: number;
  /** Semitones of the chord's notes above the note. */
  readonly chord: readonly number[];
  readonly partials: number;
  /** −1 … +1: the partials closer together or farther apart than the harmonic series. */
  readonly stretch: number;
  /** Hz added to every partial. */
  readonly shift: number;
  /** 0 … 1. */
  readonly damping: number;
  /** Time to fall by 60 dB, in seconds. */
  readonly decay: number;
  readonly unison: number;
  /** Cents between the outermost unison voices and the middle. */
  readonly detune: number;
  readonly mod: number;
  readonly modRate: number;
  /** 0 … 1. */
  readonly modAmount: number;
  /** Linear gain of the sound entering the resonance. */
  readonly input: number;
  readonly fftSize: number;
  /** 0 … 1. */
  readonly mix: number;
  /** Linear gain. */
  readonly output: number;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);
const clampIndex = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(v)));

export function resonatorSettings(p: Readonly<Record<string, number>>): ResonatorSettings {
  const v = (id: string, fallback: number) => p[id] ?? fallback;
  const pitch = FIRST_NOTE + Math.round(v('note', 45 - FIRST_NOTE));
  return {
    rootHz: noteHz(pitch) * Math.pow(2, v('fine', 0) / 1200),
    chord: CHORDS[clampIndex(v('chord', 0), CHORDS.length)].steps,
    partials: Math.max(1, Math.min(MAX_PARTIALS, Math.round(v('partials', 24)))),
    stretch: v('stretch', 0) / 100,
    shift: v('shift', 0),
    damping: v('damping', 40) / 100,
    decay: v('decay', 1200) / 1000,
    unison: Math.max(1, Math.min(MAX_UNISON, Math.round(v('unison', 1)))),
    detune: v('detune', 15),
    mod: Math.round(v('mod', 0)),
    modRate: v('modRate', 0.5),
    modAmount: v('modAmount', 40) / 100,
    input: dbToGain(v('input', 0)),
    fftSize: RESOLUTIONS[clampIndex(v('resolution', 1), RESOLUTIONS.length)].size,
    mix: v('mix', 50) / 100,
    output: dbToGain(v('output', 0)),
  };
}

/** A fundamental: its frequency and where it sits in stereo (−1 left … +1 right). */
export interface Voice {
  readonly hz: number;
  readonly pan: number;
}

/** How far apart in stereo the outermost unison voices go. */
const UNISON_SPREAD = 0.8;

/** The fundamentals: every note of the chord, times every unison voice. The unison voices are
 *  detuned evenly from −detune to +detune and spread in stereo the same way (the lowest left). */
export function voicesOf(s: ResonatorSettings): Voice[] {
  const out: Voice[] = [];
  for (const step of s.chord) {
    for (let u = 0; u < s.unison; u++) {
      const spread = s.unison > 1 ? (2 * u) / (s.unison - 1) - 1 : 0;
      out.push({ hz: s.rootHz * Math.pow(2, step / 12 + (spread * s.detune) / 1200), pan: spread * UNISON_SPREAD });
    }
  }
  return out;
}

/** A partial that rings: frequency, gain on each side, time to fall by 60 dB. */
export interface Partial {
  readonly hz: number;
  readonly left: number;
  readonly right: number;
  readonly decay: number;
}

/** How partial `index` (voice × MAX_PARTIALS + k − 1) moves at this instant (see partial-motion.ts):
 *  `cents` away, `gate` open (1) … closed (0). */
export interface PartialMoves {
  cents(index: number): number;
  gate(index: number): number;
}

export const STILL: PartialMoves = { cents: () => 0, gate: () => 1 };

/** How many partials can move: every voice of the biggest chord in unison, with all its partials. */
export const MAX_MOVING = Math.max(...CHORDS.map(c => c.steps.length)) * MAX_UNISON * MAX_PARTIALS;

/** Over this frequency Damping at 100% takes 52 dB off the gain and shortens the decay by e³. */
const DAMPING_HZ = 10000;
/** The decay of a partial closed by the Granular mod, in seconds: it stops quickly, without a click. */
const CLOSED_DECAY = 0.03;
const MIN_HZ = 20;

/** The k-th partial (from 1) of a fundamental: k^(1 + stretch/2) times the fundamental, plus Shift. */
export const partialHz = (fundamental: number, k: number, s: ResonatorSettings): number =>
  fundamental * Math.pow(k, 1 + s.stretch / 2) + s.shift;

export type PartialVisitor = (hz: number, left: number, right: number, decay: number) => void;

/** Visits every partial that rings below `maxHz`, without creating objects (it runs at every
 *  step of the sound). */
export function eachPartial(s: ResonatorSettings, voices: readonly Voice[], maxHz: number, moves: PartialMoves, visit: PartialVisitor): void {
  for (let v = 0; v < voices.length; v++) {
    const voice = voices[v];
    // equal-power pan: in the middle both sides at full gain
    const angle = ((voice.pan + 1) * Math.PI) / 4, left = Math.SQRT2 * Math.cos(angle), right = Math.SQRT2 * Math.sin(angle);
    for (let k = 1; k <= s.partials; k++) {
      const index = v * MAX_PARTIALS + k - 1, gate = moves.gate(index);
      const hz = partialHz(voice.hz, k, s) * Math.pow(2, moves.cents(index) / 1200);
      if (hz < MIN_HZ || hz > maxHz) continue;
      const dark = (s.damping * hz) / DAMPING_HZ;
      const gain = Math.exp(-6 * dark) * gate;
      visit(hz, gain * left, gain * right, s.decay * Math.exp(-3 * dark) * gate + CLOSED_DECAY * (1 - gate));
    }
  }
}

/** All the partials, as a list (for the tests and the interface). */
export function partialsOf(s: ResonatorSettings, maxHz: number, moves: PartialMoves = STILL): Partial[] {
  const out: Partial[] = [];
  eachPartial(s, voicesOf(s), maxHz, moves, (hz, left, right, decay) => out.push({ hz, left, right, decay }));
  return out;
}
