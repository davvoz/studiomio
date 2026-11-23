/* Draw mode (B), one for the whole app as in Live: the piano roll draws notes with it,
 * the modulation lanes (clip curves and master automation) draw steps. Turning it on
 * anywhere turns it on everywhere. */
import { Emitter, type Unsubscribe } from '../core/emitter';

export class DrawMode {
  private _on = false;
  private readonly events = new Emitter<{ change: [boolean] }>();

  get on(): boolean {
    return this._on;
  }

  set(on: boolean): void {
    if (on === this._on) return;
    this._on = on;
    this.events.emit('change', on);
  }

  toggle(): void {
    this.set(!this._on);
  }

  onChange(fn: (on: boolean) => void): Unsubscribe {
    return this.events.on('change', fn);
  }
}
