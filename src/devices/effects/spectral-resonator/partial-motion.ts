/* The Spectral Resonator's Mod: how the partials move over time. Chorus gives each partial a slow
 * vibrato of its own (they beat against each other, like an ensemble); Wander lets each one drift
 * at random to a new pitch and glide there; Granular opens and closes the partials at random,
 * so the resonance sparkles in grains. Rate is how fast, Amount how much. Deterministic (its own
 * random generator), so the tests and two renders give the same sound. */
import { MOD } from './spectral-resonator';
import { MAX_MOVING, type PartialMoves, type ResonatorSettings } from './partials';

/** The widest vibrato of Chorus and drift of Wander at Amount 100%, in cents. */
const CHORUS_CENTS = 25;
const WANDER_CENTS = 80;
/** At Amount 100% Granular keeps this share of the partials closed. */
const GRANULAR_CLOSED = 0.8;
/** How fast a Granular partial opens or closes, in seconds. */
const GATE_TIME = 0.01;
/** Spreads the Chorus phases evenly (the golden ratio never repeats). */
const GOLDEN = 0.618033988749895;

/** A small fast random generator (mulberry32): the same seed, the same sequence. */
function randomFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PartialMotion implements PartialMoves {
  private readonly random: () => number;
  private readonly drift = new Float64Array(MAX_MOVING);
  private readonly driftTarget = new Float64Array(MAX_MOVING);
  private readonly gates = new Float64Array(MAX_MOVING).fill(1);
  private readonly open = new Uint8Array(MAX_MOVING).fill(1);
  private time = 0;
  private mode: number = MOD.none;
  private amount = 0;
  private rate = 1;

  constructor(seed = 1) {
    this.random = randomFrom(seed);
  }

  /** Moves on by `dt` seconds, for the first `count` partials (the others aren't ringing). */
  advance(s: ResonatorSettings, dt: number, count: number): void {
    this.mode = s.mod;
    this.amount = s.modAmount;
    this.rate = s.modRate;
    this.time += dt;
    const n = Math.min(count, MAX_MOVING);
    if (this.mode === MOD.wander) this.wander(dt, n);
    else if (this.mode === MOD.granular) this.granular(dt, n);
  }

  cents(index: number): number {
    if (this.mode === MOD.chorus) return this.amount * CHORUS_CENTS * Math.sin(2 * Math.PI * (this.rate * this.time + index * GOLDEN));
    if (this.mode === MOD.wander) return this.amount * WANDER_CENTS * this.drift[index];
    return 0;
  }

  gate(index: number): number {
    return this.mode === MOD.granular ? this.gates[index] : 1;
  }

  /** Every partial picks a new place now and then (on average `rate` times a second) and glides there. */
  private wander(dt: number, n: number): void {
    const chance = this.rate * dt, glide = 1 - Math.exp(-dt * this.rate * 2);
    for (let i = 0; i < n; i++) {
      if (this.random() < chance) this.driftTarget[i] = this.random() * 2 - 1;
      this.drift[i] += (this.driftTarget[i] - this.drift[i]) * glide;
    }
  }

  /** Every partial, now and then, opens or closes at random: the more Amount, the more stay closed. */
  private granular(dt: number, n: number): void {
    const chance = this.rate * dt, closed = this.amount * GRANULAR_CLOSED, follow = 1 - Math.exp(-dt / GATE_TIME);
    for (let i = 0; i < n; i++) {
      if (this.random() < chance) this.open[i] = this.random() >= closed ? 1 : 0;
      this.gates[i] += (this.open[i] - this.gates[i]) * follow;
    }
  }
}
