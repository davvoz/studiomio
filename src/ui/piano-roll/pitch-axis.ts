/** Asse verticale del piano roll: una riga per ogni altezza MIDI, la più acuta (127) in alto.
 *  `top` è dove inizia l'area delle note, `scrollY` quanti pixel sono scorsi fuori in alto.
 *  Con `rows` (il Fold di Live) ci sono solo le righe di quelle altezze, dall'alto. */
export class PitchAxis {
  constructor(
    readonly rowHeight = 12, readonly scrollY = 0, readonly top = 0, readonly rows: readonly number[] | null = null,
  ) {}

  get folded(): boolean {
    return this.rows !== null;
  }

  get rowCount(): number {
    return this.rows ? this.rows.length : 128;
  }

  /** Bordo superiore della riga di `pitch`. */
  pitchToY(pitch: number): number {
    return this.top + this.rowOf(pitch) * this.rowHeight - this.scrollY;
  }

  yToPitch(y: number): number {
    return this.pitchAt(Math.floor((y - this.top + this.scrollY) / this.rowHeight));
  }

  /** Le altezze delle righe che toccano la fascia [y0, y1), dall'alto. */
  visible(y0: number, y1: number): number[] {
    const at = (y: number) => Math.floor((y - this.top + this.scrollY) / this.rowHeight);
    const i0 = Math.max(0, at(y0)), i1 = Math.min(this.rowCount - 1, at(y1 - 1));
    const out: number[] = [];
    for (let i = i0; i <= i1; i++) out.push(this.pitchAt(i));
    return out;
  }

  /** Altezza totale delle righe. */
  get contentHeight(): number {
    return this.rowCount * this.rowHeight;
  }

  scrolled(scrollY: number, viewHeight: number): PitchAxis {
    const max = Math.max(0, this.contentHeight - viewHeight);
    return new PitchAxis(this.rowHeight, Math.max(0, Math.min(max, scrollY)), this.top, this.rows);
  }

  /** Lo stesso asse con altre righe (null: tutte), allo stesso scorrimento. */
  withRows(rows: readonly number[] | null, viewHeight: number): PitchAxis {
    return new PitchAxis(this.rowHeight, this.scrollY, this.top, rows).scrolled(this.scrollY, viewHeight);
  }

  /** Righe più alte o più basse, tenendo ferma l'altezza sotto `anchorY`. */
  zoomed(rowHeight: number, anchorY: number, viewHeight: number): PitchAxis {
    const h = Math.max(5, Math.min(32, rowHeight));
    const rows = (anchorY - this.top + this.scrollY) / this.rowHeight;
    return new PitchAxis(h, 0, this.top, this.rows).scrolled(rows * h - (anchorY - this.top), viewHeight);
  }

  /** Asse centrato tra le altezze `lo` e `hi`. */
  centeredOn(lo: number, hi: number, viewHeight: number): PitchAxis {
    const mid = ((this.rowOf(hi) + this.rowOf(lo)) / 2 + 0.5) * this.rowHeight;
    return this.scrolled(mid - viewHeight / 2, viewHeight);
  }

  /** Indice della riga di `pitch` dall'alto. Con il Fold un'altezza senza riga (una nota
   *  trascinata lì) sta a metà tra le righe vicine. */
  private rowOf(pitch: number): number {
    if (!this.rows) return 127 - pitch;
    const i = this.rows.findIndex(p => p <= pitch);
    if (i < 0) return this.rows.length - 0.5;
    return this.rows[i] === pitch ? i : i - 0.5;
  }

  private pitchAt(index: number): number {
    const i = Math.max(0, Math.min(this.rowCount - 1, index));
    return this.rows ? this.rows[i] : 127 - i;
  }
}

/** Le righe del Fold: le altezze delle note, dalla più acuta; null se non ci sono note. */
export function foldRows(pitches: Iterable<number>): number[] | null {
  const rows = [...new Set(pitches)].sort((a, b) => b - a);
  return rows.length ? rows : null;
}

export const sameRows = (a: readonly number[] | null, b: readonly number[] | null): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p === b[i]));

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Nome della nota, con il Do centrale (60) = C3 come in Ableton. */
export const pitchName = (p: number): string => `${NAMES[p % 12]}${Math.floor(p / 12) - 2}`;

export const isBlackKey = (p: number): boolean => BLACK[p % 12];
