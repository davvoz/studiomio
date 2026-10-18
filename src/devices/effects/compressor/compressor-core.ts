/* Il suono del Compressore. Feed-forward, i due canali legati (lo stesso guadagno a entrambi,
 * così l'immagine stereo non si sposta):
 *
 *   ingresso ─┬──────────────────────────── × guadagno ─┬─ mix con il dry → uscita
 *             └─ passa-alto → livello (picco o RMS) → dB → curva → riduzione levigata ─┘
 *
 * Con il sidechain il rilevatore (la riga di sotto) ascolta la chiave, un'altra traccia, invece
 * dell'ingresso; senza, la chiave è l'ingresso stesso e i conti sono gli stessi di sempre.
 *
 * La riduzione si leviga in dB con attacco e rilascio separati, come i compressori da studio.
 * Gira nell'AudioWorklet; qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, type EffectCore, type KeyedEffect } from '../../dsp/core';
import { DETECTOR } from './compressor';
import { autoMakeup, curveDb, type Curve } from './compressor-math';

/** Finestra dell'RMS. */
const RMS_TIME = 0.01;
/** Tempo con cui guadagno d'uscita e mix seguono le manopole. */
const SMOOTH = 0.02;
const LOG_TO_DB = 20 / Math.LN10;

const coef = (seconds: number, sampleRate: number) => Math.exp(-1 / Math.max(1, seconds * sampleRate));

export class CompressorCore implements EffectCore, KeyedEffect {
  private curve: Curve = { threshold: -18, ratio: 4, knee: 6 };
  private attackK = 0;
  private releaseK = 0;
  private rmsK = 0;
  private rms = false;
  private hpK = 0;
  /** Stato: filtri del rilevatore, livello RMS, riduzione attuale (dB, positiva). */
  private hpL = 0;
  private hpR = 0;
  private prevL = 0;
  private prevR = 0;
  private power = 0;
  private reduction = 0;
  private makeup = 1;
  private mix = 1;
  private targetMakeup = 1;
  private targetMix = 1;
  private readonly smoothK: number;
  /** Prima del primo blocco i valori non scorrono: partono da quelli giusti. */
  private fresh = true;
  /** Il suono che il rilevatore ascolta (null: l'ingresso). */
  private keyL: Float32Array | null = null;
  private keyR: Float32Array | null = null;
  /** La riduzione più forte dall'ultima lettura (per i misuratori e i test). */
  maxReduction = 0;

  constructor(private readonly sampleRate: number) {
    this.smoothK = 1 - coef(SMOOTH, sampleRate);
    this.rmsK = coef(RMS_TIME, sampleRate);
    this.setParams({});
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.curve = { threshold: v('threshold', -18), ratio: Math.max(1, v('ratio', 4)), knee: v('knee', 6) };
    this.attackK = coef(v('attack', 10) / 1000, this.sampleRate);
    this.releaseK = coef(v('release', 120) / 1000, this.sampleRate);
    this.rms = v('detector', DETECTOR.peak) === DETECTOR.rms;
    this.hpK = coef(1 / (2 * Math.PI * v('scHp', 20)), this.sampleRate);
    this.targetMakeup = dbToGain(v('makeup', 0) + (v('auto', 1) ? autoMakeup(this.curve) : 0));
    this.targetMix = v('mix', 100) / 100;
    if (this.fresh) {
      this.makeup = this.targetMakeup;
      this.mix = this.targetMix;
    }
  }

  setTempo(): void {}

  setKey(left: Float32Array | null, right: Float32Array | null): void {
    this.keyL = left;
    this.keyR = right ?? left;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { curve, attackK, releaseK, hpK, rmsK, rms, smoothK } = this;
    let { hpL, hpR, prevL, prevR, power, reduction, makeup, mix } = this;
    const targetMakeup = this.targetMakeup, targetMix = this.targetMix;
    const keyL = this.keyL ?? inL, keyR = this.keyR ?? inR;
    this.fresh = false;
    let maxReduction = this.maxReduction;
    for (let i = 0; i < n; i++) {
      const l = inL[i], r = inR[i], kl = keyL[i], kr = keyR[i];
      // passa-alto a un polo sul rilevatore (non sul suono)
      hpL = hpK * (hpL + kl - prevL);
      hpR = hpK * (hpR + kr - prevR);
      prevL = kl;
      prevR = kr;
      let level: number;
      if (rms) {
        power = rmsK * power + (1 - rmsK) * (hpL * hpL + hpR * hpR) * 0.5;
        level = Math.sqrt(power);
      } else level = Math.max(Math.abs(hpL), Math.abs(hpR));
      const x = level > 1e-6 ? Math.log(level) * LOG_TO_DB : -120;
      const want = x - curveDb(curve, x);
      reduction = want > reduction ? attackK * reduction + (1 - attackK) * want : releaseK * reduction + (1 - releaseK) * want;
      if (reduction > maxReduction) maxReduction = reduction;
      makeup += (targetMakeup - makeup) * smoothK;
      mix += (targetMix - mix) * smoothK;
      const g = Math.exp(-reduction / LOG_TO_DB) * makeup;
      outL[i] = l + (l * g - l) * mix;
      outR[i] = r + (r * g - r) * mix;
    }
    this.hpL = hpL;
    this.hpR = hpR;
    this.prevL = prevL;
    this.prevR = prevR;
    this.power = power < 1e-20 ? 0 : power;
    this.reduction = reduction;
    this.makeup = makeup;
    this.mix = mix;
    this.maxReduction = maxReduction;
  }
}
