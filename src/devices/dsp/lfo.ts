/* An LFO that, tempo-synced and with the transport running, locks to the bar: its position is
 * computed from the timeline beat, not from when the device started. So a 1/4
 * cycle always starts on the quarter, even after a jump, at every loop round and in export, and the
 * same point of the piece always gives the same value (also in the random waves). When stopped, or in
 * Hz, it runs free. Pure: no Web Audio, tested in Node. */
import type { TransportPosition } from './core';

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↓', 'Saw ↑', 'Square', 'S&H', 'Smooth S&H'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawDown: 2, sawUp: 3, square: 4, sampleHold: 5, smoothRandom: 6 } as const;

/** A random value in −1..1 for cycle `cycle` (always the same for the same cycle and seed). */
export function cycleRandom(cycle: number, seed = 0): number {
  let h = (Math.floor(cycle) ^ Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h / 0x80000000;
}

/** The waves, from −1 to 1, at phase `p` (0..1) of cycle `k`: sine and triangle start from 0
 *  and rise, the saws and the square from the extremes. */
const WAVES: readonly ((p: number, k: number, seed: number) => number)[] = [
  p => Math.sin(2 * Math.PI * p),
  p => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4),
  p => 1 - 2 * p,
  p => 2 * p - 1,
  p => (p < 0.5 ? 1 : -1),
  (_p, k, s) => cycleRandom(k, s),
  (p, k, s) => {
    const a = cycleRandom(k - 1, s), b = cycleRandom(k, s);
    return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * p));
  },
];

/** The value of wave `shape` after `cycles` cycles (the integer part says which cycle, the
 *  fraction where inside the cycle). */
export function lfoAt(shape: number, cycles: number, seed = 0): number {
  const k = Math.floor(cycles);
  return (WAVES[shape] ?? WAVES[0])(cycles - k, k, seed);
}

/** How an LFO runs in this block: `beats` quarters per cycle (synced) or `hz` cycles per second. */
export interface LfoRate {
  readonly beats: number | null;
  readonly hz: number;
}

/** Where an LFO is, in cycles. At each block `start` realigns it to the bar (if it's
 *  synced and the transport is running) or lets it run; `next` advances by one sample. */
export class LfoClock {
  /** The cycles done: the fraction is the phase. */
  cycles = 0;
  private step = 0;

  constructor(private readonly sampleRate: number) {}

  start(rate: LfoRate, transport: TransportPosition | null, bpm: number): void {
    if (rate.beats !== null && transport) {
      this.cycles = transport.beat / rate.beats;
      this.step = transport.bpm / 60 / rate.beats / this.sampleRate;
      return;
    }
    const hz = rate.beats !== null ? bpm / 60 / rate.beats : rate.hz;
    this.step = hz / this.sampleRate;
  }

  next(): void {
    this.cycles += this.step;
  }
}
