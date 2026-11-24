import { describe, expect, it, vi } from 'vitest';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import { takeWheel, WHEEL_ZOOM, wheelBeats, wheelInput, wheelStep, wheelZoom, type WheelInput } from '../../src/ui/kit/wheel';

const wheel = (over: Partial<WheelEvent>) =>
  ({ deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...over }) as unknown as WheelEvent;
const turn = (over: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, ctrl: false, shift: false, alt: false, ...over });

describe('the wheel', () => {
  it('reads the turn: Ctrl or ⌘, Shift, Alt; taking it stops the page from scrolling', () => {
    expect(wheelInput(wheel({ deltaX: 3, deltaY: 4, metaKey: true, altKey: true }))).toEqual({ deltaX: 3, deltaY: 4, ctrl: true, shift: false, alt: true });
    const e = wheel({ shiftKey: true });
    expect(takeWheel(e).shift).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('zooms by an exponential of the turn: up enlarges, the rows more slowly', () => {
    expect(wheelZoom(40, 0)).toBe(40);
    expect(wheelZoom(40, -100)).toBeCloseTo(40 * Math.exp(0.25), 12);
    expect(wheelZoom(10, 100, WHEEL_ZOOM.rows)).toBeCloseTo(10 * Math.exp(-0.2), 12);
  });

  it('a sideways turn takes priority over the vertical one', () => {
    expect(wheelStep(turn({ deltaX: 40, deltaY: 400 }))).toBe(40);
    expect(wheelStep(turn({ deltaY: 400 }))).toBe(400);
  });

  it('on a beat axis scrolls the time by the turn in beats', () => {
    const out = wheelBeats(new BeatAxis(40, 2), turn({ deltaY: 80 }), 100);
    expect(out.startBeat).toBeCloseTo(4, 9);
    expect(out.pxPerBeat).toBe(40);
    expect(wheelBeats(new BeatAxis(40, 0), turn({ deltaX: 40, deltaY: 400 }), 0).startBeat).toBeCloseTo(1, 9);
  });

  it('with Ctrl zooms around the pointer: the beat under it stays', () => {
    const axis = new BeatAxis(40, 2);
    const up = wheelBeats(axis, turn({ deltaY: -100, ctrl: true }), 200);
    expect(up.pxPerBeat).toBeGreaterThan(40);
    expect(up.xToBeat(200)).toBeCloseTo(axis.xToBeat(200), 9);
    expect(wheelBeats(axis, turn({ deltaY: 100, ctrl: true }), 200).pxPerBeat).toBeLessThan(40);
  });
});
