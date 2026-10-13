import type { TimeSignature } from '../../core/music-time';
import type { AudioGraph, AudioNodeLike } from '../audio-graph';
import type { ScheduledSource, ScheduleWindow } from '../scheduler';
import { ActiveNodes } from './track-player';

/** Clic su ogni battito, più acuto sul primo della battuta. */
export class Metronome implements ScheduledSource {
  enabled = false;
  private readonly active = new ActiveNodes();

  constructor(
    private readonly graph: AudioGraph,
    private readonly output: AudioNodeLike,
    private readonly signature: () => TimeSignature,
  ) {}

  schedule(w: ScheduleWindow): void {
    if (!this.enabled) return;
    const from = Math.max(w.from, w.runStart), to = Math.min(w.to, w.runEnd);
    const unit = 4 / this.signature().denominator, bar = this.signature().beatsPerBar;
    for (let b = Math.ceil(from / unit - 1e-9) * unit; b < to - 1e-9; b += unit) {
      const downbeat = Math.abs(b / bar - Math.round(b / bar)) < 1e-6;
      this.click(w.timeAt(b), downbeat);
    }
  }

  stopAll(): void {
    this.active.stopAll();
  }

  private click(when: number, accent: boolean): void {
    const osc = this.graph.createOscillator();
    const env = this.graph.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1600 : 1000;
    env.gain.setValueAtTime(accent ? 0.5 : 0.3, when);
    env.gain.setTargetAtTime(0, when + 0.002, 0.012);
    osc.connect(env);
    env.connect(this.output);
    osc.start(when);
    osc.stop(when + 0.06);
    this.active.add(osc, () => {
      osc.disconnect();
      env.disconnect();
    });
  }
}
