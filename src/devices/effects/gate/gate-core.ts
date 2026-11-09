/* The Gate's sound: the volume follows the pattern. At each sample it checks which step plays (from the
 * transport's beat, with swing) and whether it's in its open part; the volume goes there in a straight
 * line, at the attack's speed when it rises and the release's when it falls: no clicks,
 * not even when the transport jumps. When stopped the pattern runs free at the project's tempo.
 * Runs in the AudioWorklet; no Web Audio here. */
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
  /** How open it is now (0..1). */
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

  /** How open it is now, 0..1 (for tests and for drawing it). */
  get level(): number {
    return this.env;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { clock, position, levels, length, swing, gate, up, down, depth } = this;
    // one round of the clock is the whole pattern: the steps fall on the bar
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
