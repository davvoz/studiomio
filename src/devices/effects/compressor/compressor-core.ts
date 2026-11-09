/* The Compressor's sound. Feed-forward, the two channels linked (the same gain to both,
 * so the stereo image doesn't shift):
 *
 *   input ─┬──────────────────────────── × gain ─┬─ mix with the dry → output
 *          └─ high-pass → level (peak or RMS) → dB → curve → smoothed reduction ─┘
 *
 * With the sidechain the detector (the bottom row) listens to the key, another track, instead
 * of the input; without, the key is the input itself and the maths is the same as always.
 *
 * The reduction is smoothed in dB. First the release: it holds the peak between one half-wave and the next,
 * so on a steady sound it reaches the reduction the curve promises, whatever the attack
 * and release. Then the attack: it rises towards that value with its own time; going down it adds
 * nothing, otherwise a slow attack would lengthen the release too.
 * Runs in the AudioWorklet; no Web Audio here, so it's also tested in Node. */
import { dbToGain, type DynamicsMeter, type EffectCore, type KeyedEffect } from '../../dsp/core';
import { DETECTOR } from './compressor';
import { autoMakeup, curveDb, type Curve } from './compressor-math';

/** RMS window. */
const RMS_TIME = 0.01;
/** Time with which output gain and mix follow the knobs. */
const SMOOTH = 0.02;
const LOG_TO_DB = 20 / Math.LN10;

const coef = (seconds: number, sampleRate: number) => Math.exp(-1 / Math.max(1, seconds * sampleRate));

export class CompressorCore implements EffectCore, KeyedEffect, DynamicsMeter {
  private curve: Curve = { threshold: -18, ratio: 4, knee: 6 };
  private attackK = 0;
  private releaseK = 0;
  private rmsK = 0;
  private rms = false;
  private hpK = 0;
  /** State: detector filters, RMS level, current reduction (dB, positive). */
  private hpL = 0;
  private hpR = 0;
  private prevL = 0;
  private prevR = 0;
  private power = 0;
  /** The target reduction, with the release (dB). */
  private held = 0;
  private reduction = 0;
  private makeup = 1;
  private mix = 1;
  private targetMakeup = 1;
  private targetMix = 1;
  private readonly smoothK: number;
  /** Before the first block the values don't glide: they start from the right ones. */
  private fresh = true;
  /** The sound the detector listens to (null: the input). */
  private keyL: Float32Array | null = null;
  private keyR: Float32Array | null = null;
  /** The strongest reduction since the last read (for the meters and the tests). */
  maxReduction = 0;
  /** The loudest level heard by the detector since the last read (dB). */
  private maxLevel = -120;

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

  readDynamics(out: Float32Array): void {
    out[0] = this.maxLevel;
    out[1] = this.maxReduction;
    this.maxLevel = -120;
    this.maxReduction = this.reduction;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { curve, attackK, releaseK, hpK, rmsK, rms, smoothK } = this;
    let { hpL, hpR, prevL, prevR, power, held, reduction, makeup, mix, maxLevel } = this;
    const targetMakeup = this.targetMakeup, targetMix = this.targetMix;
    const keyL = this.keyL ?? inL, keyR = this.keyR ?? inR;
    this.fresh = false;
    let maxReduction = this.maxReduction;
    for (let i = 0; i < n; i++) {
      const l = inL[i], r = inR[i], kl = keyL[i], kr = keyR[i];
      // one-pole high-pass on the detector (not on the sound)
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
      if (x > maxLevel) maxLevel = x;
      held = Math.max(want, releaseK * held + (1 - releaseK) * want);
      reduction = held > reduction ? attackK * reduction + (1 - attackK) * held : held;
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
    this.held = held;
    this.reduction = reduction;
    this.makeup = makeup;
    this.mix = mix;
    this.maxReduction = maxReduction;
    this.maxLevel = maxLevel;
  }
}
