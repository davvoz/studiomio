/* Le forme dei modulatori, come funzioni del tempo: il valore di un LFO dopo un certo numero di
 * giri e quello di un inviluppo a un istante, sapendo quando è partito e quando è stato
 * lasciato. Niente stato che avanza campione per campione: il motore le chiede dove vuole (anche
 * di nuovo, dopo una riprogrammazione) e ottiene sempre lo stesso valore. Le forme sono quelle di
 * Prisma (shapes.ts). Puro: si prova in Node. */
import { bend, drawnValue, isRandomShape, LFO_SHAPE, randomValue, shapeValue, type LfoPoint } from '../instruments/prisma/shapes';

/** Il valore (0…1) della forma `shape` dopo `cycles` giri; `points` è la forma disegnata, `seed`
 *  cambia i valori delle forme casuali (lo stesso seme e giro danno lo stesso valore). */
export function lfoUnit(shape: number, points: readonly LfoPoint[], cycles: number, seed = 0): number {
  const k = Math.floor(cycles), phase = cycles - k;
  if (isRandomShape(shape)) return randomValue(shape, k + seed * 7919, phase);
  return shape === LFO_SHAPE.drawn ? drawnValue(points, phase) : shapeValue(shape, phase);
}

/** Un inviluppo con hold e curve (come quelli di Prisma): i tempi in secondi, sustain 0…1. */
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

/** Una partenza dell'inviluppo: da `on` a `off` (secondi) è tenuto, poi rilascia. `from` è il
 *  livello da cui parte l'attacco (quello che aveva: ripartire non fa salti), `level` quanto vale
 *  il massimo (la velocity). Una partenza nuova prende il posto di quella di prima. */
export interface EnvTrigger {
  readonly on: number;
  readonly off: number;
  readonly from: number;
  readonly level: number;
  readonly times: EnvTimes;
}

/** Il livello (0…1, prima del `level`) di un inviluppo tenuto da `dt` secondi. */
function heldLevel(e: EnvTimes, from: number, dt: number): number {
  if (dt < e.attack) return from + (1 - from) * bend(dt / e.attack, e.attackCurve);
  dt -= e.attack;
  if (dt < e.hold) return 1;
  dt -= e.hold;
  if (dt < e.decay) return 1 - (1 - e.sustain) * bend(dt / e.decay, e.decayCurve);
  return e.sustain;
}

/** Il valore (0…1) della partenza `g` all'istante `t` (da `g.on` in poi). */
export function envValue(g: EnvTrigger, t: number): number {
  const e = g.times;
  if (t < g.off) return g.level * heldLevel(e, g.from, Math.max(0, t - g.on));
  const released = t - g.off;
  if (released >= e.release) return 0;
  return g.level * heldLevel(e, g.from, g.off - g.on) * (1 - bend(released / e.release, e.releaseCurve));
}
