/* Il suono del Gate: il volume segue il pattern. A ogni campione si guarda quale step suona (dal
 * battito del trasporto, con lo swing) e se è nella sua parte aperta; il volume ci va in linea
 * retta, alla velocità dell'attacco quando sale e del rilascio quando scende: niente click,
 * neanche quando il trasporto salta. Da fermo il pattern gira libero al tempo del progetto.
 * Gira nell'AudioWorklet; qui niente Web Audio. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { LfoClock } from '../../dsp/lfo';
import { StepPosition } from '../../dsp/steps';
import { MAX_STEPS, STEP_RATES, stepParam } from './gate';

export class GateCore implements EffectCore, TransportFollower {
  private readonly clock: LfoClock;
  private readonly position = new StepPosition();
  private readonly levels = new Float32Array(MAX_STEPS);
  private transport: TransportPosition | null = null;
  private bpm = 120;
  /** Quanto è aperto adesso (0..1). */
  private env = 1;
  private stepBeats = 0.25;
  private length = 16;
  private swing = 0;
  private gate = 0.75;
  private up = 1;
  private down = 1;
  private depth = 1;

  constructor(private readonly sampleRate: number) {
    this.clock = new LfoClock(sampleRate);
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.stepBeats = (STEP_RATES[v('rate', 3)] ?? STEP_RATES[3])[1];
    this.length = Math.max(1, Math.min(MAX_STEPS, Math.round(v('length', 16))));
    this.swing = v('swing', 0) / 100;
    this.gate = v('gate', 75) / 100;
    this.up = 1000 / (Math.max(0.05, v('attack', 1)) * this.sampleRate);
    this.down = 1000 / (Math.max(0.05, v('release', 20)) * this.sampleRate);
    this.depth = v('depth', 100) / 100;
    for (let i = 0; i < MAX_STEPS; i++) this.levels[i] = v(stepParam(i), 0) / 100;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  /** Quanto è aperto adesso, 0..1 (per i test e per disegnarlo). */
  get level(): number {
    return this.env;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { clock, position, levels, length, swing, gate, up, down, depth } = this;
    // un giro dell'orologio è l'intero pattern: gli step cadono sulla battuta
    clock.start({ beats: this.stepBeats * length, hz: 0 }, this.transport, this.bpm);
    let env = this.env;
    for (let i = 0; i < n; i++) {
      const cycles = clock.cycles;
      position.locate((cycles - Math.floor(cycles)) * length, length, swing);
      const target = position.t < gate ? levels[position.index] : 0;
      env = target > env ? Math.min(target, env + up) : Math.max(target, env - down);
      const g = 1 - depth * (1 - env);
      outL[i] = inL[i] * g;
      outR[i] = inR[i] * g;
      clock.next();
    }
    this.env = env;
  }
}
