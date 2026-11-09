/** A voice that can play monophonically: restart (also with glide from another note) or
 *  slide towards a new note without restarting the envelopes. */
export interface MonoVoice {
  readonly active: boolean;
  readonly releasing: boolean;
  /** The pitch playing now (also halfway through a glide). */
  readonly currentPitch: number;
  /** A note from the start; with `from` the pitch starts there and slides to `pitch`. */
  start(pitch: number, velocity: number, from: number | null): void;
  slide(pitch: number, velocity: number): void;
  release(): void;
  kill(): void;
}

/** How the single voice plays: in Legato overlapping notes slide; the glide in seconds. */
export interface MonoSettings {
  readonly legato: boolean;
  readonly glide: number;
}

interface HeldNote {
  readonly id: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** A single voice, like a monophonic synth: the held notes are on a stack and the last one
 *  plays; when it's released the one below comes back. In Legato a note arriving while
 *  another is held slides without restarting; in Mono it always restarts, with glide from the
 *  previous note. */
export class MonoPlayer {
  private held: HeldNote[] = [];
  /** Whether the voice has already played something (the glide in Mono starts from there). */
  private played = false;

  constructor(private readonly voice: MonoVoice, private readonly s: MonoSettings) {}

  noteOn(id: number, pitch: number, velocity: number): void {
    const tied = this.held.length > 0 && this.voice.active && !this.voice.releasing;
    this.held.push({ id, pitch, velocity });
    this.play(pitch, velocity, tied);
  }

  noteOff(id: number): void {
    const i = this.held.findIndex(n => n.id === id);
    if (i < 0) return;
    const wasPlaying = i === this.held.length - 1;
    this.held.splice(i, 1);
    if (!wasPlaying) return;
    const back = this.held.at(-1);
    if (back) this.play(back.pitch, back.velocity, true);
    else this.voice.release();
  }

  silence(): void {
    this.held = [];
    this.played = false;
    this.voice.kill();
  }

  private play(pitch: number, velocity: number, tied: boolean): void {
    if (tied && this.s.legato) this.voice.slide(pitch, velocity);
    else {
      const glide = this.s.glide > 0 && this.played && (tied || !this.s.legato);
      this.voice.start(pitch, velocity, glide ? this.voice.currentPitch : null);
    }
    this.played = true;
  }
}
