// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { MacroSwitch } from '../../../src/ui/device/macro-switch';
import { pointer } from '../../helpers/dom';

const keyOf = (s: MacroSwitch) => s.element.querySelector<HTMLButtonElement>('.macro-key')!;
const lit = (s: MacroSwitch) => keyOf(s).classList.contains('on');

describe('macro switch', () => {
  it('a toggle: its label, on past halfway, each click asks the other state', () => {
    const press = vi.fn();
    const s = new MacroSwitch('Drop', 0, 'toggle', press);
    expect(s.element.querySelector('.knob-label')!.textContent).toBe('Drop');
    expect(keyOf(s).className).toContain('toggle');
    expect(lit(s)).toBe(false);
    keyOf(s).click();
    expect(press).toHaveBeenLastCalledWith(true);
    s.set(64);
    expect(lit(s)).toBe(true);
    keyOf(s).click();
    expect(press).toHaveBeenLastCalledWith(false);
    s.set(63);
    expect(lit(s)).toBe(false);
  });

  it('a button: on while held with the left button, off when released, cancelled or the capture is lost', () => {
    const press = vi.fn();
    const s = new MacroSwitch('Hold', 0, 'button', press);
    const key = keyOf(s);
    key.setPointerCapture = vi.fn();
    key.dispatchEvent(pointer('pointerdown', 0, 0, { button: 2 }));
    expect(press).not.toHaveBeenCalled();
    key.dispatchEvent(pointer('pointerdown', 0, 0));
    expect(key.setPointerCapture).toHaveBeenCalledWith(1);
    expect(press).toHaveBeenLastCalledWith(true);
    // released while off (the press didn't reach the value yet): nothing to release
    key.dispatchEvent(pointer('pointerup', 0, 0));
    expect(press).toHaveBeenCalledTimes(1);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      s.set(127);
      press.mockClear();
      key.dispatchEvent(pointer(type, 0, 0));
      expect(press, type).toHaveBeenCalledWith(false);
    }
  });

  it('a modulation snapping it past halfway flips the light while it lasts, as in the engine', () => {
    const s = new MacroSwitch('M', 0, 'toggle', vi.fn());
    const automated = () => keyOf(s).classList.contains('automated');
    s.modulate(0.49);
    expect([lit(s), automated()]).toEqual([false, false]);
    s.modulate(0.5);
    expect([lit(s), automated()]).toEqual([true, true]);
    s.modulate(0.7);
    expect([lit(s), automated()]).toEqual([true, true]);
    s.modulate(0);
    expect([lit(s), automated()]).toEqual([false, false]);
    s.set(127);
    s.modulate(-0.5);
    expect([lit(s), automated()]).toEqual([false, true]);
  });
});
