import type { AudioGraph, AudioNodeLike, GainNodeLike } from '../audio-graph';
import { ActiveNodes } from './track-player';

/** Uno strumento: suona note a orari precisi del contesto audio. Gli strumenti veri
 *  (sintetizzatori in AudioWorklet, campionatori…) implementeranno la stessa interfaccia. */
export interface Instrument {
  readonly output: AudioNodeLike;
  /** `velocity` 1..127, tempi in secondi del contesto audio. */
  play(pitch: number, velocity: number, when: number, duration: number): void;
  stopAll(): void;
  dispose(): void;
}

export type InstrumentFactory = (graph: AudioGraph) => Instrument;

export const midiToHz = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

/** Synth provvisorio (oscillatore triangolare con inviluppo), solo per sentire le clip MIDI
 *  finché non arrivano gli strumenti veri. */
export class SimpleSynth implements Instrument {
  readonly output: GainNodeLike;
  private readonly active = new ActiveNodes();

  constructor(private readonly graph: AudioGraph) {
    this.output = graph.createGain();
    this.output.gain.value = 0.25;
  }

  play(pitch: number, velocity: number, when: number, duration: number): void {
    const { graph } = this;
    const osc = graph.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(pitch);
    const env = graph.createGain();
    const peak = velocity / 127, release = 0.08, attack = 0.005;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + attack);
    env.gain.setTargetAtTime(peak * 0.6, when + attack, 0.1);
    env.gain.setTargetAtTime(0, when + duration, release / 3);
    osc.connect(env);
    env.connect(this.output);
    osc.start(when);
    osc.stop(when + duration + release);
    this.active.add(osc, () => {
      osc.disconnect();
      env.disconnect();
    });
  }

  stopAll(): void {
    this.active.stopAll();
  }

  dispose(): void {
    this.stopAll();
    this.output.disconnect();
  }
}
