/** A voice of a polyphonic synth. */
export interface PolyVoice {
  /** True while it plays (also during the release). */
  readonly active: boolean;
  readonly releasing: boolean;
  start(pitch: number, velocity: number): void;
  release(): void;
  /** Quick shutdown. */
  kill(): void;
  render(left: Float32Array, right: Float32Array, from: number, to: number): void;
}

/** Polyphony for any synth: assigns notes to voices and, when they're all busy,
 *  steals the one releasing the longest, otherwise the oldest. */
export class VoicePool<V extends PolyVoice> {
  private readonly noteOf: (number | null)[];
  private readonly startedAt: number[];
  private clock = 0;

  constructor(readonly voices: readonly V[]) {
    this.noteOf = voices.map(() => null);
    this.startedAt = voices.map(() => 0);
  }

  /** A voice for the note; whoever plays several voices per note (the Sampler's zones) calls it several
   *  times with the same `id` and starts each voice in its own way with `start`. */
  noteOn(id: number, pitch: number, velocity: number, start: (voice: V) => void = v => v.start(pitch, velocity)): void {
    const i = this.pick();
    this.noteOf[i] = id;
    this.startedAt[i] = ++this.clock;
    start(this.voices[i]);
  }

  /** Releases all the note's voices. */
  noteOff(id: number): void {
    for (let i = 0; i < this.voices.length; i++) {
      if (this.noteOf[i] !== id) continue;
      this.noteOf[i] = null;
      this.voices[i].release();
    }
  }

  silence(): void {
    this.noteOf.fill(null);
    for (const v of this.voices) v.kill();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    for (const v of this.voices) if (v.active) v.render(left, right, from, to);
  }

  get activeCount(): number {
    return this.voices.filter(v => v.active).length;
  }

  private pick(): number {
    const free = this.voices.findIndex(v => !v.active);
    if (free >= 0) return free;
    const all = this.voices.map((_, i) => i);
    const released = all.filter(i => this.voices[i].releasing);
    const candidates = released.length ? released : all;
    return candidates.reduce((a, b) => (this.startedAt[b] < this.startedAt[a] ? b : a), candidates[0]);
  }
}
