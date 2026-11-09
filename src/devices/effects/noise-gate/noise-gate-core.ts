/* The Noise Gate's sound. The two channels are linked (the same gain to both):
 *
 *   input ─┬───────────────────────────────────────── × gain ─ output
 *          └─ filters → level → open/closed → ramp ─┘
 *
 * The level is the peak with a short fall, so the gate doesn't close at every zero
 * crossing. It opens as soon as the level exceeds the threshold; to close it waits for "Hold". The gain
 * follows a ramp in dB, as long as the attack going up and the release going down: no clicks, and the
 * tail dies out like a real sound. With the sidechain the detector listens to the key.
 * Runs in the AudioWorklet; no Web Audio here. */
import { dbToGain, type DynamicsMeter, type EffectCore, type KeyedEffect } from '../../dsp/core';

/** How much the level falls between one half-wave and the next (seconds). */
const LEVEL_FALL = 0.01;
const LOG_TO_DB = 20 / Math.LN10;
/** The lowest range: there the closed gate is silence, not −80 dB. */
const SILENCE_DB = 80;

/** The gate's gain: open, fully shut when the depth reaches silence, otherwise the reduction in dB. */
function gateGain(position: number, depth: number, reduction: number): number {
  if (position >= 1) return 1;
  if (position <= 0 && depth >= SILENCE_DB) return 0;
  return Math.exp(-reduction / LOG_TO_DB);
}

const coef = (seconds: number, sampleRate: number) => Math.exp(-1 / Math.max(1, seconds * sampleRate));

export class NoiseGateCore implements EffectCore, KeyedEffect, DynamicsMeter {
  private openAt = 0;
  private closeAt = 0;
  private floorDb = -SILENCE_DB;
  private flip = false;
  private up = 1;
  private down = 1;
  private holdFrames = 0;
  private hpK = 0;
  private lpK = 1;
  private readonly fallK: number;
  /** The detector: the filters of the two channels and the level (linear). */
  private hpL = 0;
  private hpR = 0;
  private prevL = 0;
  private prevR = 0;
  private lpL = 0;
  private lpR = 0;
  private level = 0;
  private open = false;
  private holding = 0;
  /** How open it is: from 0 (at the range) to 1 (the whole sound), proportionally to the dB. */
  private position = 0;
  private keyL: Float32Array | null = null;
  private keyR: Float32Array | null = null;
  private maxLevel = 0;
  private maxReduction = 0;

  constructor(private readonly sampleRate: number) {
    this.fallK = coef(LEVEL_FALL, sampleRate);
    this.setParams({});
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.openAt = dbToGain(v('threshold', -40));
    this.closeAt = dbToGain(v('threshold', -40) - v('hysteresis', 3));
    this.floorDb = Math.min(0, v('floor', -SILENCE_DB));
    this.flip = v('flip', 0) >= 0.5;
    this.up = 1000 / (Math.max(0.01, v('attack', 0.5)) * this.sampleRate);
    this.down = 1000 / (Math.max(0.1, v('release', 80)) * this.sampleRate);
    this.holdFrames = Math.round((v('hold', 20) / 1000) * this.sampleRate);
    this.hpK = coef(1 / (2 * Math.PI * v('scHp', 20)), this.sampleRate);
    this.lpK = 1 - coef(1 / (2 * Math.PI * v('scLp', 20000)), this.sampleRate);
  }

  setTempo(): void {}

  setKey(left: Float32Array | null, right: Float32Array | null): void {
    this.keyL = left;
    this.keyR = right ?? left;
  }

  readDynamics(out: Float32Array): void {
    out[0] = this.maxLevel > 1e-6 ? Math.log(this.maxLevel) * LOG_TO_DB : -120;
    out[1] = this.maxReduction;
    this.maxLevel = 0;
    this.maxReduction = (1 - this.position) * -this.floorDb;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { openAt, closeAt, up, down, holdFrames, hpK, lpK, fallK, flip } = this;
    let { hpL, hpR, prevL, prevR, lpL, lpR, level, open, holding, position, maxLevel, maxReduction } = this;
    const keyL = this.keyL ?? inL, keyR = this.keyR ?? inR;
    const depth = -this.floorDb;
    for (let i = 0; i < n; i++) {
      const kl = keyL[i], kr = keyR[i];
      hpL = hpK * (hpL + kl - prevL);
      hpR = hpK * (hpR + kr - prevR);
      prevL = kl;
      prevR = kr;
      lpL += (hpL - lpL) * lpK;
      lpR += (hpR - lpR) * lpK;
      level = Math.max(Math.abs(lpL), Math.abs(lpR), level * fallK);
      if (level > maxLevel) maxLevel = level;
      if (level >= openAt) {
        open = true;
        holding = holdFrames;
      } else if (open && level < closeAt) {
        if (holding > 0) holding--;
        else open = false;
      }
      const target = open !== flip ? 1 : 0;
      position = target > position ? Math.min(target, position + up) : Math.max(target, position - down);
      const reduction = (1 - position) * depth;
      if (reduction > maxReduction) maxReduction = reduction;
      const g = gateGain(position, depth, reduction);
      outL[i] = inL[i] * g;
      outR[i] = inR[i] * g;
    }
    this.hpL = hpL;
    this.hpR = hpR;
    this.prevL = prevL;
    this.prevR = prevR;
    this.lpL = lpL;
    this.lpR = lpR;
    this.level = level < 1e-12 ? 0 : level;
    this.open = open;
    this.holding = holding;
    this.position = position;
    this.maxLevel = maxLevel;
    this.maxReduction = maxReduction;
  }
}
