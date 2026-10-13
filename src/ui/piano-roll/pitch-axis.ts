/** Asse verticale del piano roll: una riga per ogni altezza MIDI, la più acuta (127) in alto.
 *  `top` è dove inizia l'area delle note, `scrollY` quanti pixel sono scorsi fuori in alto. */
export class PitchAxis {
  constructor(readonly rowHeight = 12, readonly scrollY = 0, readonly top = 0) {}

  /** Bordo superiore della riga di `pitch`. */
  pitchToY(pitch: number): number {
    return this.top + (127 - pitch) * this.rowHeight - this.scrollY;
  }

  yToPitch(y: number): number {
    return Math.max(0, Math.min(127, 127 - Math.floor((y - this.top + this.scrollY) / this.rowHeight)));
  }

  /** Altezza totale delle 128 righe. */
  get contentHeight(): number {
    return 128 * this.rowHeight;
  }

  scrolled(scrollY: number, viewHeight: number): PitchAxis {
    const max = Math.max(0, this.contentHeight - viewHeight);
    return new PitchAxis(this.rowHeight, Math.max(0, Math.min(max, scrollY)), this.top);
  }

  /** Righe più alte o più basse, tenendo ferma l'altezza sotto `anchorY`. */
  zoomed(rowHeight: number, anchorY: number, viewHeight: number): PitchAxis {
    const h = Math.max(5, Math.min(32, rowHeight));
    const rows = (anchorY - this.top + this.scrollY) / this.rowHeight;
    return new PitchAxis(h, 0, this.top).scrolled(rows * h - (anchorY - this.top), viewHeight);
  }

  /** Asse centrato tra le altezze `lo` e `hi`. */
  centeredOn(lo: number, hi: number, viewHeight: number): PitchAxis {
    const mid = (127 - (lo + hi) / 2 + 0.5) * this.rowHeight;
    return this.scrolled(mid - viewHeight / 2, viewHeight);
  }
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Nome della nota, con il Do centrale (60) = C3 come in Ableton. */
export const pitchName = (p: number): string => `${NAMES[p % 12]}${Math.floor(p / 12) - 2}`;

export const isBlackKey = (p: number): boolean => BLACK[p % 12];
