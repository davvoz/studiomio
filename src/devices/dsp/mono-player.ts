/** Una voce che sa suonare a una voce sola: ripartire (anche con il glide da un'altra nota) o
 *  scivolare verso una nota nuova senza far ripartire gli inviluppi. */
export interface MonoVoice {
  readonly active: boolean;
  readonly releasing: boolean;
  /** L'intonazione che suona adesso (anche a metà di un glide). */
  readonly currentPitch: number;
  /** Una nota da capo; con `from` l'intonazione parte da lì e scivola fino a `pitch`. */
  start(pitch: number, velocity: number, from: number | null): void;
  slide(pitch: number, velocity: number): void;
  release(): void;
  kill(): void;
}

/** Come suona la voce sola: in Legato le note sovrapposte scivolano; il glide in secondi. */
export interface MonoSettings {
  readonly legato: boolean;
  readonly glide: number;
}

interface HeldNote {
  readonly id: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** Una voce sola, come un synth monofonico: le note tenute stanno in una pila e suona
 *  l'ultima; quando la si lascia torna quella sotto. In Legato una nota che arriva mentre
 *  un'altra è tenuta scivola senza ripartire; in Mono riparte sempre, con il glide dalla nota
 *  di prima. */
export class MonoPlayer {
  private held: HeldNote[] = [];
  /** Se la voce ha già suonato qualcosa (da lì parte il glide in Mono). */
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
