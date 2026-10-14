/* Il suono del Phaser. Un LFO (seno) per canale, il destro sfasato di "Stereo" gradi.
 *   Phaser:  ingresso + feedback → N allpass del primo ordine (frequenza dall'LFO, in ottave
 *            attorno al centro) → wet
 *   Flanger: ingresso + feedback → linea di ritardo letta a un ritardo che oscilla tra quasi
 *            zero e il doppio di "Ritardo" → wet
 * e poi dry e wet mescolati. Il feedback passa da una tanh: anche al massimo non esplode.
 * Gira nell'AudioWorklet; qui niente Web Audio, così si prova anche in Node. */
import type { EffectCore } from '../../dsp/core';
import { TEMPO_RATES } from '../../rates';
import { MAX_FLANGER_MS, PHASER_MODE, PHASER_STAGES, PHASER_SYNC } from './phaser';

/** Ogni quanti campioni si ricalcolano i coefficienti degli allpass. */
const CONTROL_RATE = 16;
/** Di quante ottave si sposta il phaser, sopra e sotto il centro, con Profondità 100. */
const PHASER_OCTAVES = 2.5;
const SMOOTH = 0.02;

const flush = (x: number) => (Math.abs(x) < 1e-20 ? 0 : x);

/** Un canale del phaser: gli allpass in fila e il feedback. */
class PhaserChannel {
  private readonly state = new Float64Array(Math.max(...PHASER_STAGES));
  private last = 0;

  process(x: number, a: number, stages: number, feedback: number): number {
    let y = x + Math.tanh(this.last * feedback);
    const s = this.state;
    for (let i = 0; i < stages; i++) {
      // allpass del primo ordine: y = a·x + s; s = x − a·y
      const out = a * y + s[i];
      s[i] = flush(y - a * out);
      y = out;
    }
    this.last = y;
    return y;
  }
}

/** Un canale del flanger: la linea di ritardo con lettura interpolata (Hermite). */
class FlangerChannel {
  private readonly buffer: Float32Array;
  private write = 0;
  private last = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  process(x: number, delay: number, feedback: number): number {
    const b = this.buffer, size = b.length;
    b[this.write] = flush(x + Math.tanh(this.last * feedback));
    const pos = this.write - delay + size, i = Math.floor(pos), t = pos - i;
    const y0 = b[(i - 1 + size) % size], y1 = b[i % size], y2 = b[(i + 1) % size], y3 = b[(i + 2) % size];
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    const y = ((c3 * t + c2) * t + c1) * t + y1;
    this.write = (this.write + 1) % size;
    this.last = y;
    return y;
  }
}

export class PhaserCore implements EffectCore {
  private readonly phasers = [new PhaserChannel(), new PhaserChannel()];
  private readonly flangers: FlangerChannel[];
  private mode = 0;
  private stages = 6;
  private center = 900;
  private delayMs = 2.5;
  private hz = 0.5;
  private sync = true;
  private beats = 4;
  private bpm = 120;
  private depth = 0.7;
  private offset = 0.25;
  private feedback = 0.4;
  private mix = 0.5;
  private targetMix = 0.5;
  private phase = 0;
  private countdown = 0;
  private readonly coef = [0, 0];
  private readonly smoothK: number;
  private fresh = true;

  constructor(private readonly sampleRate: number) {
    const size = Math.ceil((2 * MAX_FLANGER_MS * sampleRate) / 1000) + 8;
    this.flangers = [new FlangerChannel(size), new FlangerChannel(size)];
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.mode = v('mode', 0);
    this.stages = PHASER_STAGES[v('stages', 2)] ?? 6;
    this.center = v('center', 900);
    this.delayMs = v('delay', 2.5);
    this.sync = v('sync', 0) === PHASER_SYNC.tempo;
    this.beats = (TEMPO_RATES[v('division', 3)] ?? TEMPO_RATES[3])[1];
    this.hz = v('rate', 0.3);
    this.depth = v('depth', 70) / 100;
    this.offset = v('stereo', 90) / 360;
    this.feedback = (v('feedback', 40) / 100) * 0.95;
    this.targetMix = v('mix', 50) / 100;
    if (this.fresh) this.mix = this.targetMix;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  /** L'LFO di un canale, da −1 a 1. */
  private lfo(channel: number): number {
    return Math.sin(2 * Math.PI * (this.phase + channel * this.offset));
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const rate = this.sync ? this.bpm / 60 / this.beats : this.hz;
    const step = rate / this.sampleRate;
    const flanger = this.mode === PHASER_MODE.flanger;
    const base = (this.delayMs * this.sampleRate) / 1000;
    const [pl, pr] = this.phasers, [fl, fr] = this.flangers;
    for (let i = 0; i < n; i++) {
      this.mix += (this.targetMix - this.mix) * this.smoothK;
      let wl: number, wr: number;
      if (flanger) {
        // il ritardo va da quasi zero (a profondità piena) al doppio del valore
        const dl = Math.max(2, base * (1 + this.depth * this.lfo(0)));
        const dr = Math.max(2, base * (1 + this.depth * this.lfo(1)));
        wl = fl.process(inL[i], dl, this.feedback);
        wr = fr.process(inR[i], dr, this.feedback);
      } else {
        if (--this.countdown <= 0) {
          this.countdown = CONTROL_RATE;
          for (let c = 0; c < 2; c++) {
            const f = Math.min(this.sampleRate * 0.45, this.center * Math.pow(2, PHASER_OCTAVES * this.depth * this.lfo(c)));
            const t = Math.tan((Math.PI * f) / this.sampleRate);
            this.coef[c] = (t - 1) / (t + 1);
          }
        }
        wl = pl.process(inL[i], this.coef[0], this.stages, this.feedback);
        wr = pr.process(inR[i], this.coef[1], this.stages, this.feedback);
      }
      const m = this.mix;
      outL[i] = inL[i] + (wl - inL[i]) * m;
      outR[i] = inR[i] + (wr - inR[i]) * m;
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
    }
  }
}
