import { Surface } from '../surface';
import { isBlackKey, pitchName, type PitchAxis } from './pitch-axis';
import { notesBottom, ROLL } from './roll-painter';

/** Vertical keyboard on the left of the piano roll, aligned with the note rows. Pressing
 *  (and dragging) plays the notes with the track's instrument. If the instrument names the
 *  notes (the drum machine's pads) there are the names in place of the keys. */
export class RollKeyboard {
  private readonly surface = new Surface('roll-keys');
  private pressed: number | null = null;
  private axis: PitchAxis | null = null;
  private names: ReadonlyMap<number, string> | null = null;

  constructor(private readonly audition: (pitch: number) => void) {
    const el = this.surface.canvas;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.press(this.pitchAt(e));
    });
    el.addEventListener('pointermove', e => {
      if (this.pressed !== null) this.press(this.pitchAt(e));
    });
    const release = () => {
      this.pressed = null;
      this.paint();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  get element(): HTMLCanvasElement {
    return this.surface.canvas;
  }

  resize(width: number, height: number): void {
    this.surface.resize(width, height);
    this.paint();
  }

  setAxis(axis: PitchAxis): void {
    if (axis === this.axis) return;
    this.axis = axis;
    this.paint();
  }

  setNames(names: ReadonlyMap<number, string> | null): void {
    if (names === this.names) return;
    this.names = names;
    this.paint();
  }

  private pitchAt(e: PointerEvent): number | null {
    const y = e.clientY - this.element.getBoundingClientRect().top;
    if (!this.axis || y < ROLL.ruler || y >= notesBottom(this.surface.height)) return null;
    return this.axis.yToPitch(y);
  }

  private press(pitch: number | null): void {
    if (pitch === null || pitch === this.pressed) return;
    this.pressed = pitch;
    this.audition(pitch);
    this.paint();
  }

  private paint(): void {
    const { g, width, height } = this.surface;
    const axis = this.axis;
    g.fillStyle = '#1b1e23';
    g.fillRect(0, 0, width, height);
    if (!axis) return;
    const bottom = notesBottom(height);
    g.save();
    g.beginPath();
    g.rect(0, ROLL.ruler, width, bottom - ROLL.ruler);
    g.clip();
    g.font = '9.5px system-ui, sans-serif';
    const rows = axis.visible(ROLL.ruler, bottom);
    if (this.names) this.paintNames(this.names, rows);
    else for (const p of rows) {
      const y = axis.pitchToY(p), h = axis.rowHeight, black = isBlackKey(p);
      // a black key's row: the key on the left, the white one next to it on the right
      g.fillStyle = '#d9dce2';
      g.fillRect(0, y, width, h);
      g.fillStyle = p === this.pressed ? '#ff9d2e' : black ? '#26292f' : '#d9dce2';
      g.fillRect(0, y, black ? width * 0.62 : width, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, Math.round(y + h) - 1, width, 1);
      // with Fold the rows aren't in sequence: each has its name
      if ((axis.folded || p % 12 === 0) && h >= 9) {
        g.fillStyle = p === this.pressed ? '#141414' : '#555b66';
        g.fillText(pitchName(p), width - 26, y + h - 2.5);
      }
    }
    g.restore();
    g.fillStyle = '#2b2f36';
    g.fillRect(width - 1, 0, 1, height);
  }

  /** Rows with a name (the pads): the name on the left, the note on the right; the others stay dark. */
  private paintNames(names: ReadonlyMap<number, string>, rows: readonly number[]): void {
    const { g, width } = this.surface;
    const axis = this.axis!;
    const h = axis.rowHeight, text = h >= 9;
    for (const p of rows) {
      const y = axis.pitchToY(p), name = names.get(p);
      g.fillStyle = p === this.pressed ? '#ff9d2e' : name ? '#2a2e35' : '#17191d';
      g.fillRect(0, y, width, h);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, Math.round(y + h) - 1, width, 1);
      if (!text) continue;
      const baseline = y + h / 2 + 3.5;
      if (name) {
        g.fillStyle = p === this.pressed ? '#141414' : '#e8eaee';
        g.fillText(name, 5, baseline, width - 34);
      }
      if (name || axis.folded || p % 12 === 0) {
        g.fillStyle = p === this.pressed ? '#141414' : '#6b717c';
        g.fillText(pitchName(p), width - 26, baseline);
      }
    }
  }
}
