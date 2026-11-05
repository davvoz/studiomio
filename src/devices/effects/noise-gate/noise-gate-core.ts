/* Il suono del Noise Gate. I due canali sono legati (lo stesso guadagno a entrambi):
 *
 *   ingresso ─┬───────────────────────────────────────── × guadagno ─ uscita
 *             └─ filtri → livello → aperto/chiuso → rampa ─┘
 *
 * Il livello è il picco con una discesa breve, così il gate non si chiude a ogni passaggio per lo
 * zero. Si apre appena il livello supera la soglia; per chiudersi aspetta "Tieni". Il guadagno
 * segue una rampa in dB, lunga l'attacco in salita e il rilascio in discesa: niente click, e la
 * coda si spegne come un suono vero. Con il sidechain il rilevatore ascolta la chiave.
 * Gira nell'AudioWorklet; qui niente Web Audio. */
import { dbToGain, type DynamicsMeter, type EffectCore, type KeyedEffect } from '../../dsp/core';

/** Quanto scende il livello tra una semionda e l'altra (secondi). */
const LEVEL_FALL = 0.01;
const LOG_TO_DB = 20 / Math.LN10;
/** Il rientro più basso: lì il gate chiuso è silenzio, non −80 dB. */
const SILENCE_DB = 80;

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
  /** Il rilevatore: i filtri dei due canali e il livello (lineare). */
  private hpL = 0;
  private hpR = 0;
  private prevL = 0;
  private prevR = 0;
  private lpL = 0;
  private lpR = 0;
  private level = 0;
  private open = false;
  private holding = 0;
  /** Quanto è aperto: da 0 (al rientro) a 1 (tutto il suono), in proporzione ai dB. */
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
      const g = position >= 1 ? 1 : position <= 0 && depth >= SILENCE_DB ? 0 : Math.exp(-reduction / LOG_TO_DB);
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
