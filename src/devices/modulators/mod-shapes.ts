/* The modulators' shapes, as functions of time: an LFO's value after a certain number of
 * cycles and an envelope's at an instant, knowing when it started and when it was
 * released. No state advancing sample by sample: the engine asks for them wherever it wants (even
 * again, after a reschedule) and always gets the same value. The shapes are
 * Prisma's (shapes.ts). Pure: tested in Node. */
import { bend, drawnValue, isRandomShape, LFO_SHAPE, randomValue, shapeValue, type LfoPoint } from '../instruments/prisma/shapes';

/** The value (0…1) of shape `shape` after `cycles` cycles; `points` is the drawn shape, `seed`
 *  changes the values of the random shapes (the same seed and cycle give the same value). */
export function lfoUnit(shape: number, points: readonly LfoPoint[], cycles: number, seed = 0): number {
  const k = Math.floor(cycles), phase = cycles - k;
  if (isRandomShape(shape)) return randomValue(shape, k + seed * 7919, phase);
  return shape === LFO_SHAPE.drawn ? drawnValue(points, phase) : shapeValue(shape, phase);
}

/** An envelope with hold and curves (like Prisma's): the times in seconds, sustain 0…1. */
export interface EnvTimes {
  readonly attack: number;
  readonly hold: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  readonly attackCurve: number;
  readonly decayCurve: number;
  readonly releaseCurve: number;
}

/** A start of the envelope: from `on` to `off` (seconds) it's held, then it releases. `from` is the
 *  level the attack starts from (the one it had: restarting doesn't jump), `level` what the
 *  maximum is worth (the velocity). A new start takes the place of the previous one. */
export interface EnvTrigger {
  readonly on: number;
  readonly off: number;
  readonly from: number;
  readonly level: number;
  readonly times: EnvTimes;
}

/** The level (0…1, before `level`) of an envelope held for `dt` seconds. */
function heldLevel(e: EnvTimes, from: number, dt: number): number {
  if (dt < e.attack) return from + (1 - from) * bend(dt / e.attack, e.attackCurve);
  dt -= e.attack;
  if (dt < e.hold) return 1;
  dt -= e.hold;
  if (dt < e.decay) return 1 - (1 - e.sustain) * bend(dt / e.decay, e.decayCurve);
  return e.sustain;
}

/** The value (0…1) of start `g` at instant `t` (from `g.on` on). */
export function envValue(g: EnvTrigger, t: number): number {
  const e = g.times;
  if (t < g.off) return g.level * heldLevel(e, g.from, Math.max(0, t - g.on));
  const released = t - g.off;
  if (released >= e.release) return 0;
  return g.level * heldLevel(e, g.from, g.off - g.on) * (1 - bend(released / e.release, e.releaseCurve));
}
