/** Una voce di un synth polifonico. */
export interface PolyVoice {
  /** Vero finché suona (anche durante il rilascio). */
  readonly active: boolean;
  readonly releasing: boolean;
  start(pitch: number, velocity: number): void;
  release(): void;
  /** Spegnimento rapido. */
  kill(): void;
  render(left: Float32Array, right: Float32Array, from: number, to: number): void;
}

/** Polifonia per qualunque synth: assegna le note alle voci e, quando sono tutte occupate,
 *  ruba quella in rilascio da più tempo, altrimenti la più vecchia. */
export class VoicePool<V extends PolyVoice> {
  private readonly noteOf: (number | null)[];
  private readonly startedAt: number[];
  private clock = 0;

  constructor(readonly voices: readonly V[]) {
    this.noteOf = voices.map(() => null);
    this.startedAt = voices.map(() => 0);
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    const i = this.pick();
    this.noteOf[i] = id;
    this.startedAt[i] = ++this.clock;
    this.voices[i].start(pitch, velocity);
  }

  noteOff(id: number): void {
    const i = this.noteOf.indexOf(id);
    if (i < 0) return;
    this.noteOf[i] = null;
    this.voices[i].release();
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
    return (released.length ? released : all).reduce((a, b) => (this.startedAt[b] < this.startedAt[a] ? b : a));
  }
}
