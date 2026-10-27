/* Il suono del Pitch Shifter. L'ingresso (più il feedback) va su un nastro; due testine lo
 * rileggono a un ritardo che scorre dentro la Finestra alla velocità che sposta l'intonazione
 * (più veloci del nastro: sopra, più lente: sotto), sfasate di mezza finestra. Quando una arriva
 * in fondo salta dall'altra parte, e lì il suo volume è zero: le due si passano il suono con una
 * dissolvenza a seno quadro, che somma sempre a uno. Il sinistro e il destro hanno ciascuno le
 * sue testine (Stereo li scorda in versi opposti). A intonazione ferma le testine tornano piano
 * a metà finestra, dove ne suona una sola: niente filtro a pettine. Semitoni scivola col Glide,
 * Finestra e mix scorrono morbidi. Gira nell'AudioWorklet; qui niente Web Audio. */
import type { EffectCore } from '../../dsp/core';
import { TapeBuffer } from '../../dsp/tape-buffer';
import { MAX_WINDOW_MS } from './pitch-shifter';

/** Il ritardo minimo delle testine, in campioni (l'interpolazione legge anche i vicini). */
const OFFSET = 4;
/** La velocità con cui le testine ferme tornano a metà finestra (17 cent: un tuffo che si posa). */
const SETTLE = 0.01;
const SMOOTH = 0.03;

export class PitchShifterCore implements EffectCore {
  private readonly tape: TapeBuffer;
  private readonly tmp = new Float32Array(2);
  private readonly smoothK: number;
  private readonly ms: number;
  /** Dove sono le testine nella finestra (0..1), per canale. */
  private readonly phase = [0.5, 0.5];
  private readonly ratio = [1, 1];
  private lastL = 0;
  private lastR = 0;
  private fresh = true;

  private semitones = 0;
  private targetSemitones = 0;
  private cents = 0;
  private spread = 0;
  private glideK = 1;
  private window: number;
  private targetWindow: number;
  private feedback = 0;
  private mix = 1;
  private targetMix = 1;
  /** Il passo per cui i rapporti sono stati calcolati (NaN: da ricalcolare). */
  private ratioFor = NaN;

  constructor(private readonly sampleRate: number) {
    this.ms = sampleRate / 1000;
    this.tape = new TapeBuffer(Math.ceil(MAX_WINDOW_MS * this.ms) + OFFSET + 8);
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.window = this.targetWindow = 60 * this.ms;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.targetSemitones = v('semitones', 0);
    this.cents = v('fine', 0);
    this.spread = v('spread', 0);
    const glide = v('glide', 20) / 1000;
    this.glideK = glide > 0 ? 1 - Math.exp(-1 / (glide * this.sampleRate)) : 1;
    this.targetWindow = v('window', 60) * this.ms;
    this.feedback = v('feedback', 0) / 100;
    this.targetMix = v('mix', 100) / 100;
    this.ratioFor = NaN;
    if (this.fresh) {
      this.semitones = this.targetSemitones;
      this.window = this.targetWindow;
      this.mix = this.targetMix;
    }
  }

  setTempo(): void {}

  /** Il rapporto di velocità delle testine del canale (per i test e per disegnarlo). */
  ratioOf(channel: 0 | 1): number {
    this.updateRatios();
    return this.ratio[channel];
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { tape, tmp, phase, ratio } = this, fb = this.feedback;
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      tape.write(xL + this.lastL * fb, xR + this.lastR * fb);
      const now = tape.written - 1;
      this.semitones += (this.targetSemitones - this.semitones) * this.glideK;
      this.window += (this.targetWindow - this.window) * this.smoothK;
      this.updateRatios();
      const w = this.window;
      let wL = 0, wR = 0;
      for (let c = 0; c < 2; c++) {
        let ph = phase[c];
        const r = ratio[c];
        if (Math.abs(r - 1) < 1e-7) ph += Math.max(-SETTLE / w, Math.min(SETTLE / w, 0.5 - ph));
        else ph += (1 - r) / w;
        ph -= Math.floor(ph);
        phase[c] = ph;
        const other = ph < 0.5 ? ph + 0.5 : ph - 0.5;
        const g = Math.sin(Math.PI * ph) ** 2;
        tape.read(now - OFFSET - ph * w, tmp);
        let y = tmp[c] * g;
        tape.read(now - OFFSET - other * w, tmp);
        y += tmp[c] * (1 - g);
        if (c === 0) wL = y;
        else wR = y;
      }
      this.lastL = wL;
      this.lastR = wR;
      this.mix += (this.targetMix - this.mix) * this.smoothK;
      const m = this.mix;
      outL[i] = xL + (wL - xL) * m;
      outR[i] = xR + (wR - xR) * m;
    }
  }

  private updateRatios(): void {
    const st = this.semitones;
    if (st === this.ratioFor) return;
    this.ratioFor = st;
    const base = st + this.cents / 100, half = this.spread / 200;
    this.ratio[0] = 2 ** ((base - half) / 12);
    this.ratio[1] = 2 ** ((base + half) / 12);
  }
}
