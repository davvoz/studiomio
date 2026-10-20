/* Il suono dell'Auto Pan: il volume di ogni canale segue l'LFO (il destro sfasato di "Stereo").
 * Il valore dell'onda va a potenza costante (a metà strada −3 dB, non −6: il suono non si svuota
 * al centro) e il volume scorre morbido, così anche l'onda quadra e i salti del trasporto non
 * fanno click. Gira nell'AudioWorklet; qui niente Web Audio. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { LfoClock, lfoAt, type LfoRate } from '../../dsp/lfo';
import { TEMPO_RATES } from '../../rates';
import { AUTO_PAN_SYNC } from './auto-pan';

/** Quanto ci mette il volume ad assestarsi, in secondi. */
const SMOOTH = 0.002;
const HALF_PI = Math.PI / 2;

export class AutoPanCore implements EffectCore, TransportFollower {
  private readonly clock: LfoClock;
  private readonly smoothK: number;
  private readonly gains = [1, 1];
  private fresh = true;
  private transport: TransportPosition | null = null;
  private bpm = 120;
  private amount = 1;
  private shape = 0;
  private rate: LfoRate = { beats: 2, hz: 1 };
  private stereo = 0.5;
  private phase = 0;

  constructor(sampleRate: number) {
    this.clock = new LfoClock(sampleRate);
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.amount = v('amount', 100) / 100;
    this.shape = v('shape', 0);
    const beats = (TEMPO_RATES[v('division', 4)] ?? TEMPO_RATES[4])[1];
    this.rate = { beats: v('sync', AUTO_PAN_SYNC.tempo) === AUTO_PAN_SYNC.tempo ? beats : null, hz: v('rate', 1) };
    this.stereo = v('stereo', 180) / 360;
    this.phase = v('phase', 0) / 360;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  /** Il volume di un canale adesso, 0..1 (per i test e per disegnarlo). */
  gain(channel: 0 | 1): number {
    return this.gains[channel];
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { clock, gains, smoothK, amount, shape } = this;
    clock.start(this.rate, this.transport, this.bpm);
    let [gL, gR] = gains;
    for (let i = 0; i < n; i++) {
      const c = clock.cycles + this.phase;
      // l'onda (−1..1) diventa 0..1, poi un volume a potenza costante
      const tL = 1 - amount * (1 - Math.sin(((lfoAt(shape, c) + 1) / 2) * HALF_PI));
      const tR = 1 - amount * (1 - Math.sin(((lfoAt(shape, c + this.stereo) + 1) / 2) * HALF_PI));
      if (this.fresh) {
        gL = tL;
        gR = tR;
        this.fresh = false;
      } else {
        gL += (tL - gL) * smoothK;
        gR += (tR - gR) * smoothK;
      }
      outL[i] = inL[i] * gL;
      outR[i] = inR[i] * gR;
      clock.next();
    }
    gains[0] = gL;
    gains[1] = gR;
  }
}
