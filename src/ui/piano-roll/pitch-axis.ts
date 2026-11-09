/** Vertical axis of the piano roll: one row per MIDI pitch, the highest (127) at the top.
 *  `top` is where the note area starts, `scrollY` how many pixels have scrolled out at the top.
 *  With `rows` (Live's Fold) there are only those pitches' rows, from the top. */
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

  /** Top edge of `pitch`'s row. */
  pitchToY(pitch: number): number {
    return this.top + this.rowOf(pitch) * this.rowHeight - this.scrollY;
  }

  yToPitch(y: number): number {
    return this.pitchAt(Math.floor((y - this.top + this.scrollY) / this.rowHeight));
  }

  /** The pitches of the rows touching the band [y0, y1), from the top. */
  visible(y0: number, y1: number): number[] {
    const at = (y: number) => Math.floor((y - this.top + this.scrollY) / this.rowHeight);
    const i0 = Math.max(0, at(y0)), i1 = Math.min(this.rowCount - 1, at(y1 - 1));
    const out: number[] = [];
    for (let i = i0; i <= i1; i++) out.push(this.pitchAt(i));
    return out;
  }

  /** Total height of the rows. */
  get contentHeight(): number {
    return this.rowCount * this.rowHeight;
  }

  scrolled(scrollY: number, viewHeight: number): PitchAxis {
    const max = Math.max(0, this.contentHeight - viewHeight);
    return new PitchAxis(this.rowHeight, Math.max(0, Math.min(max, scrollY)), this.top, this.rows);
  }

  /** The same axis with other rows (null: all), at the same scroll. */
  withRows(rows: readonly number[] | null, viewHeight: number): PitchAxis {
    return new PitchAxis(this.rowHeight, this.scrollY, this.top, rows).scrolled(this.scrollY, viewHeight);
  }

  /** Taller or shorter rows, keeping the pitch under `anchorY` still. */
  zoomed(rowHeight: number, anchorY: number, viewHeight: number): PitchAxis {
    const h = Math.max(5, Math.min(32, rowHeight));
    const rows = (anchorY - this.top + this.scrollY) / this.rowHeight;
    return new PitchAxis(h, 0, this.top, this.rows).scrolled(rows * h - (anchorY - this.top), viewHeight);
  }

  /** Axis centred between pitches `lo` and `hi`. */
  centeredOn(lo: number, hi: number, viewHeight: number): PitchAxis {
    const mid = ((this.rowOf(hi) + this.rowOf(lo)) / 2 + 0.5) * this.rowHeight;
    return this.scrolled(mid - viewHeight / 2, viewHeight);
  }

  /** Index of `pitch`'s row from the top. With Fold a pitch without a row (a note
   *  dragged there) sits halfway between the neighbouring rows. */
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

/** Fold's rows: the notes' pitches, from the highest; null if there are no notes. */
export function foldRows(pitches: Iterable<number>): number[] | null {
  const rows = [...new Set(pitches)].sort((a, b) => b - a);
  return rows.length ? rows : null;
}

export const sameRows = (a: readonly number[] | null, b: readonly number[] | null): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p === b[i]));

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Note name, with middle C (60) = C3 as in Ableton. */
export const pitchName = (p: number): string => `${NAMES[p % 12]}${Math.floor(p / 12) - 2}`;

export const isBlackKey = (p: number): boolean => BLACK[p % 12];
