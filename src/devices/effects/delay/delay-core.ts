/* Il suono del Delay: due linee di ritardo (sinistra e destra) con lettura interpolata, un
 * passa-alto e un passa-basso a un polo sulle ripetizioni. Il tempo cambia scorrendo
 * dolcemente (come un nastro), senza click. Gira nell'AudioWorklet; qui niente Web Audio. */
import type { EffectCore } from '../../dsp/core';
import { DIVISIONS, MAX_DELAY_SECONDS, SYNC } from './delay';

/** Coefficiente di un filtro a un polo con taglio `hz`. */
const onePole = (hz: number, sampleRate: number) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);

/** Valori minuscoli a zero: le code del feedback non devono finire nei numeri denormali. */
const flush = (x: number) => (Math.abs(x) < 1e-20 ? 0 : x);

/** Una linea di ritardo con i suoi filtri. */
class Line {
  readonly buffer: Float32Array;
  private lp = 0;
  private hpLow = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  /** Legge `delay` campioni prima della posizione `write`, interpolando. */
  read(write: number, delay: number): number {
    const size = this.buffer.length;
    const pos = write - delay + size;
    const i = Math.floor(pos), frac = pos - i;
    const a = this.buffer[i % size], b = this.buffer[(i + 1) % size];
    return a + (b - a) * frac;
  }

  /** Passa-basso (high cut) e passa-alto (low cut) sul segnale ritardato. */
  filter(x: number, lpK: number, hpK: number): number {
    this.lp += lpK * (x - this.lp);
    this.hpLow += hpK * (this.lp - this.hpLow);
    return this.lp - this.hpLow;
  }
}

export class DelayCore implements EffectCore {
  private readonly left: Line;
  private readonly right: Line;
  private write = 0;
  /** Ritardo attuale e voluto, in campioni. */
  private delay = -1;
  private target = 0;
  private readonly glide: number;
  private params: Readonly<Record<string, number>> = {};
  private bpm = 120;
  private feedback = 0;
  private dry = 1;
  private wet = 0;
  private lpK = 1;
  private hpK = 0;
  private pingPong = false;

  constructor(private readonly sampleRate: number) {
    const size = Math.ceil(MAX_DELAY_SECONDS * sampleRate) + 4;
    this.left = new Line(size);
    this.right = new Line(size);
    this.glide = onePole(8, sampleRate); // ~20 ms per assestarsi
  }

  setParams(p: Readonly<Record<string, number>>): void {
    this.params = p;
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.feedback = v('feedback', 35) / 100;
    const mix = v('mix', 30) / 100;
    // fino a metà il dry resta pieno, poi cala: a 100% solo le ripetizioni
    this.dry = Math.min(1, 2 * (1 - mix));
    this.wet = Math.min(1, 2 * mix);
    this.lpK = onePole(v('highCut', 6000), this.sampleRate);
    this.hpK = onePole(v('lowCut', 100), this.sampleRate);
    this.pingPong = v('pingPong', 0) === 1;
    this.updateTarget();
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.updateTarget();
  }

  /** Ritardo in secondi con i parametri e il tempo attuali. */
  get delaySeconds(): number {
    const p = this.params;
    if ((p.sync ?? SYNC.tempo) === SYNC.ms) return (p.time ?? 300) / 1000;
    const beats = DIVISIONS[p.division ?? 7]?.[1] ?? 0.75;
    return Math.min(MAX_DELAY_SECONDS, (beats * 60) / this.bpm);
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { left, right, feedback: fb, dry, wet, lpK, hpK, glide, target } = this;
    const size = left.buffer.length;
    if (this.delay < 0) this.delay = target;
    let d = this.delay, w = this.write;
    for (let i = 0; i < n; i++) {
      d += (target - d) * glide;
      const yL = left.filter(left.read(w, d), lpK, hpK);
      const yR = right.filter(right.read(w, d), lpK, hpK);
      const xL = inL[i], xR = inR[i];
      if (this.pingPong) {
        // l'ingresso entra a sinistra; ogni ripetizione passa dall'altra parte
        left.buffer[w] = flush((xL + xR) * 0.5 + yR * fb);
        right.buffer[w] = flush(yL * fb);
      } else {
        left.buffer[w] = flush(xL + yL * fb);
        right.buffer[w] = flush(xR + yR * fb);
      }
      outL[i] = xL * dry + yL * wet;
      outR[i] = xR * dry + yR * wet;
      w = w + 1 === size ? 0 : w + 1;
    }
    this.delay = d;
    this.write = w;
  }

  private updateTarget(): void {
    this.target = Math.max(1, Math.min(this.left.buffer.length - 4, this.delaySeconds * this.sampleRate));
  }
}
