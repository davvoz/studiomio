import { Surface } from '../surface';
import { isBlackKey, pitchName, type PitchAxis } from './pitch-axis';
import { notesBottom, ROLL } from './roll-painter';

/** Tastiera verticale a sinistra del piano roll, allineata alle righe delle note. Premere
 *  (e trascinare) suona le note con lo strumento della traccia. */
export class RollKeyboard {
  private readonly surface = new Surface('roll-keys');
  private pressed: number | null = null;
  private axis: PitchAxis | null = null;

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
    const hi = axis.yToPitch(ROLL.ruler), lo = axis.yToPitch(bottom);
    for (let p = lo; p <= hi; p++) {
      const y = axis.pitchToY(p), h = axis.rowHeight, black = isBlackKey(p);
      // la riga di un tasto nero: il tasto a sinistra, il bianco accanto a destra
      g.fillStyle = '#d9dce2';
      g.fillRect(0, y, width, h);
      g.fillStyle = p === this.pressed ? '#ff9d2e' : black ? '#26292f' : '#d9dce2';
      g.fillRect(0, y, black ? width * 0.62 : width, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, Math.round(y + h) - 1, width, 1);
      if (p % 12 === 0 && h >= 9) {
        g.fillStyle = p === this.pressed ? '#141414' : '#555b66';
        g.fillText(pitchName(p), width - 26, y + h - 2.5);
      }
    }
    g.restore();
    g.fillStyle = '#2b2f36';
    g.fillRect(width - 1, 0, 1, height);
  }
}
