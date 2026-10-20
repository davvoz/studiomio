/* Il suono del Chorus. L'ingresso (più il feedback) va su un nastro corto; ogni voce lo rilegge
 * a un ritardo che ondeggia con l'LFO (seno), sfasata dalle altre: due voci in controfase per il
 * Chorus, tre a un terzo di giro per l'Ensemble, una per il Vibrato. Il canale destro ha l'LFO
 * spostato fino a un quarto di giro (Larghezza). Il mix scorre morbido. Gira nell'AudioWorklet;
 * qui niente Web Audio. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { LFO_SHAPE, LfoClock, lfoAt, type LfoRate } from '../../dsp/lfo';
import { TapeBuffer } from '../../dsp/tape-buffer';
import { TEMPO_RATES } from '../../rates';
import { CHORUS_MODE, CHORUS_SYNC, MAX_DELAY_MS, MAX_DEPTH_MS } from './chorus';

/** Le fasi delle voci di ogni modo, in giri. */
const VOICES: readonly (readonly number[])[] = [[0, 0.5], [0, 1 / 3, 2 / 3], [0]];
/** Di quanto si sposta l'LFO del destro con Larghezza al 100%, in giri. */
const MAX_WIDTH = 0.25;
const SMOOTH = 0.02;

export class ChorusCore implements EffectCore, TransportFollower {
  private readonly tape: TapeBuffer;
  private readonly clock: LfoClock;
  private readonly tmp = new Float32Array(2);
  private readonly smoothK: number;
  private readonly ms: number;
  private transport: TransportPosition | null = null;
  private bpm = 120;
  private lastL = 0;
  private lastR = 0;
  private mix = 0.5;
  private targetMix = 0.5;
  private fresh = true;

  private mode: number = CHORUS_MODE.chorus;
  private delay = 10;
  private feedback = 0;
  private rate: LfoRate = { beats: null, hz: 0.8 };
  private depth = 0.4;
  private width = 1;

  constructor(sampleRate: number) {
    this.ms = sampleRate / 1000;
    // il Vibrato arriva al Ritardo più due volte la Profondità
    this.tape = new TapeBuffer(Math.ceil((MAX_DELAY_MS + 2 * MAX_DEPTH_MS + 2) * this.ms) + 8);
    this.clock = new LfoClock(sampleRate);
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.mode = v('mode', CHORUS_MODE.chorus);
    this.delay = v('delay', 10);
    this.feedback = (v('feedback', 0) / 100) * 0.95;
    const beats = (TEMPO_RATES[v('division', 3)] ?? TEMPO_RATES[3])[1];
    this.rate = { beats: v('sync', CHORUS_SYNC.hz) === CHORUS_SYNC.tempo ? beats : null, hz: v('rate', 0.8) };
    this.depth = v('depth', 40) / 100;
    this.width = v('width', 100) / 100;
    // il Vibrato è solo voce: niente suono diritto
    this.targetMix = this.mode === CHORUS_MODE.vibrato ? 1 : v('mix', 50) / 100;
    if (this.fresh) this.mix = this.targetMix;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  /** Il ritardo della voce `voice` sul canale `channel` adesso, in ms (per i test e per disegnarlo). */
  delayMs(voice: number, channel: 0 | 1): number {
    const phases = VOICES[this.mode] ?? VOICES[0];
    return this.voiceDelay(this.clock.cycles + (phases[voice] ?? 0) + channel * this.width * MAX_WIDTH);
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { tape, clock, tmp, ms } = this;
    const phases = VOICES[this.mode] ?? VOICES[0], count = phases.length;
    const offset = this.width * MAX_WIDTH, fb = this.feedback;
    clock.start(this.rate, this.transport, this.bpm);
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      tape.write(xL + this.lastL * fb, xR + this.lastR * fb);
      const now = tape.written - 1, cycles = clock.cycles;
      let wL = 0, wR = 0;
      for (let k = 0; k < count; k++) {
        tape.read(now - this.voiceDelay(cycles + phases[k]) * ms, tmp);
        wL += tmp[0];
        tape.read(now - this.voiceDelay(cycles + phases[k] + offset) * ms, tmp);
        wR += tmp[1];
      }
      wL /= count;
      wR /= count;
      this.lastL = wL;
      this.lastR = wR;
      this.mix += (this.targetMix - this.mix) * this.smoothK;
      const m = this.mix;
      outL[i] = xL + (wL - xL) * m;
      outR[i] = xR + (wR - xR) * m;
      clock.next();
    }
  }

  /** Il ritardo in ms con l'LFO a `cycles` giri: dal Ritardo sale e scende di Profondità. Il
   *  Vibrato parte sopra lo zero di quanto oscilla, così non legge mai nel futuro. */
  private voiceDelay(cycles: number): number {
    const swing = this.depth * MAX_DEPTH_MS;
    const base = this.mode === CHORUS_MODE.vibrato ? this.delay + swing : this.delay;
    return Math.max(0.05, base + swing * lfoAt(LFO_SHAPE.sine, cycles));
  }
}
