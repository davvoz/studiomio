/** A track's scheduled notes, for the interface (the drum machine pads lighting
 *  up): the player notes them with the instant they'll start, whoever shows them asks for those
 *  started in a time interval of the audio context. */
export class NoteActivity {
  private notes: { readonly pitch: number; readonly at: number }[] = [];

  /** Beyond this number the oldest are forgotten (nobody looks that far back). */
  private static readonly LIMIT = 1024;

  add(pitch: number, at: number): void {
    this.notes.push({ pitch, at });
    if (this.notes.length > NoteActivity.LIMIT) this.notes.splice(0, NoteActivity.LIMIT / 2);
  }

  /** The notes from `at` on won't start any more (cut, clip launched in their place). */
  cutFrom(at: number): void {
    this.notes = this.notes.filter(n => n.at < at);
  }

  clear(): void {
    this.notes = [];
  }

  /** The pitches of the notes started in [from, to); the notes before `from` are forgotten. */
  between(from: number, to: number): number[] {
    this.notes = this.notes.filter(n => n.at >= from);
    return this.notes.filter(n => n.at < to).map(n => n.pitch);
  }
}
