/** Le note programmate di una traccia, per l'interfaccia (i pad della drum machine che si
 *  accendono): il player le annota con l'istante in cui partiranno, chi le mostra chiede quelle
 *  partite in un intervallo di tempo del contesto audio. */
export class NoteActivity {
  private notes: { readonly pitch: number; readonly at: number }[] = [];

  /** Oltre questo numero si dimenticano le più vecchie (nessuno guarda così indietro). */
  private static readonly LIMIT = 1024;

  add(pitch: number, at: number): void {
    this.notes.push({ pitch, at });
    if (this.notes.length > NoteActivity.LIMIT) this.notes.splice(0, NoteActivity.LIMIT / 2);
  }

  /** Le note da `at` in poi non partiranno più (taglio, clip lanciata al loro posto). */
  cutFrom(at: number): void {
    this.notes = this.notes.filter(n => n.at < at);
  }

  clear(): void {
    this.notes = [];
  }

  /** Le altezze delle note partite in [from, to); le note prima di `from` si dimenticano. */
  between(from: number, to: number): number[] {
    this.notes = this.notes.filter(n => n.at >= from);
    return this.notes.filter(n => n.at < to).map(n => n.pitch);
  }
}
