/* A toggle or button macro: a key that lights up when it's on. The toggle
 * changes at every click; the button is on while it's held down. A curve making it
 * snap (past halfway) turns it on or off while it lasts. */
import { MACRO_MAX } from '../../model/rack';
import { el } from '../dom';
import type { ParamControl } from './controls';

export class MacroSwitch implements ParamControl {
  readonly element = el('div', { className: 'macro-switch' });
  private readonly key: HTMLButtonElement;
  private on = false;
  private flipped = false;

  constructor(label: string, value: number, mode: 'toggle' | 'button', press: (on: boolean) => void) {
    this.key = el<HTMLButtonElement>('button', {
      className: `macro-key ${mode}`, title: mode === 'toggle' ? 'Click: turn on or off' : 'Hold down: on until you release it',
    });
    this.element.append(this.key, el('div', { className: 'knob-label', textContent: label }));
    if (mode === 'toggle') this.key.onclick = () => press(!this.on);
    else {
      this.key.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        this.key.setPointerCapture(e.pointerId);
        press(true);
      });
      const release = () => { if (this.on) press(false); };
      this.key.addEventListener('pointerup', release);
      this.key.addEventListener('pointercancel', release);
      this.key.addEventListener('lostpointercapture', release);
    }
    this.set(value);
  }

  set(value: number): void {
    this.on = value >= MACRO_MAX / 2;
    this.render();
  }

  /** As in the engine (switchSink): on snaps down at −½, off snaps up at +½. */
  modulate(offset: number): void {
    const flipped = this.on ? offset <= -0.5 : offset >= 0.5;
    if (flipped === this.flipped) return;
    this.flipped = flipped;
    this.render();
  }

  private render(): void {
    this.key.classList.toggle('on', this.on !== this.flipped);
    this.key.classList.toggle('automated', this.flipped);
  }
}
