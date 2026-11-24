// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RollKeyboard } from '../../../src/ui/piano-roll/keyboard';
import { PitchAxis } from '../../../src/ui/piano-roll/pitch-axis';
import { ROLL } from '../../../src/ui/piano-roll/roll-painter';
import { pointer, recordCanvases, texts } from '../../helpers/dom';

let canvases: ReturnType<typeof recordCanvases>;
beforeEach(() => {
  vi.restoreAllMocks();
  canvases = recordCanvases();
});

/** A keyboard 60 px wide, 12 px rows with C3 (60) on the first row under the ruler. */
function keyboard(rowHeight = 12) {
  const audition = vi.fn();
  const k = new RollKeyboard(audition);
  k.element.setPointerCapture = vi.fn();
  k.resize(60, 400);
  k.setAxis(new PitchAxis(rowHeight, (127 - 60) * rowHeight, ROLL.ruler));
  const g = canvases.of(k.element);
  return { k, audition, g };
}

/** The y of a pitch's row, in the middle. */
const yOf = (pitch: number, rowHeight = 12) => ROLL.ruler + (60 - pitch) * rowHeight + rowHeight / 2;

describe('piano roll keyboard', () => {
  it('without an axis draws only the background; the same axis or names again don\'t redraw', () => {
    const audition = vi.fn();
    const k = new RollKeyboard(audition);
    const g = canvases.of(k.element);
    k.resize(60, 400);
    expect(g.drawn.map(d => d.name)).toEqual(['setTransform', 'fillRect']);
    k.element.dispatchEvent(pointer('pointerdown', 10, 100));
    expect(audition).not.toHaveBeenCalled();
    const axis = new PitchAxis(12, 0, ROLL.ruler);
    k.setAxis(axis);
    const count = g.drawn.length;
    k.setAxis(axis);
    k.setNames(null);
    expect(g.drawn).toHaveLength(count);
    expect(k.element.className).toBe('roll-keys');
  });

  it('draws a key per row with its name, the C darker, the black keys short', () => {
    const { g } = keyboard();
    const names = texts(g);
    expect(names.slice(0, 3)).toEqual(['C3', 'B2', 'A#2']);
    const c3 = g.drawn.find(d => d.name === 'fillText' && d.args[0] === 'C3')!;
    const b2 = g.drawn.find(d => d.name === 'fillText' && d.args[0] === 'B2')!;
    const black = g.drawn.find(d => d.name === 'fillText' && d.args[0] === 'A#2')!;
    expect([c3.fill, b2.fill, black.fill]).toEqual(['#3a3f48', '#7d838e', '#9aa0aa']);
    expect(black.args[1]).toBe(3);
    const blackKey = g.drawn.find(d => d.name === 'fillRect' && d.fill === '#26292f')!;
    expect(blackKey.args[2]).toBeCloseTo(60 * 0.62, 9);
  });

  it('rows too short for a name show only the keys', () => {
    const { g } = keyboard(8);
    expect(texts(g)).toEqual([]);
  });

  it('pressing plays the key, dragging plays each new key once, releasing lights it off', () => {
    const { k, audition, g } = keyboard();
    k.element.dispatchEvent(pointer('pointerdown', 10, yOf(60), { button: 2 }));
    expect(audition).not.toHaveBeenCalled();
    k.element.dispatchEvent(pointer('pointermove', 10, yOf(60)));
    expect(audition).not.toHaveBeenCalled();
    k.element.dispatchEvent(pointer('pointerdown', 10, yOf(60)));
    expect(k.element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(audition).toHaveBeenLastCalledWith(60);
    expect(g.drawn.some(d => d.name === 'fillRect' && d.fill === '#ff9d2e')).toBe(true);
    expect(g.drawn.find(d => d.name === 'fillText' && d.args[0] === 'C3' && d.fill === '#141414')).toBeTruthy();
    k.element.dispatchEvent(pointer('pointermove', 10, yOf(60) + 2));
    k.element.dispatchEvent(pointer('pointermove', 10, yOf(59)));
    expect(audition.mock.calls).toEqual([[60], [59]]);
    // on the ruler or the velocity lane: no key
    k.element.dispatchEvent(pointer('pointermove', 10, 5));
    k.element.dispatchEvent(pointer('pointermove', 10, 390));
    expect(audition).toHaveBeenCalledTimes(2);
    for (const type of ['pointerup', 'pointercancel']) {
      g.drawn.length = 0;
      k.element.dispatchEvent(pointer(type, 10, yOf(60)));
      expect(g.drawn.some(d => d.fill === '#ff9d2e')).toBe(false);
      k.element.dispatchEvent(pointer('pointermove', 10, yOf(58)));
      expect(audition).toHaveBeenCalledTimes(2);
    }
  });

  it('with the pads\' names: the name on the left, the note on the named rows and on the C', () => {
    const { k, g } = keyboard();
    g.drawn.length = 0;
    k.setNames(new Map([[59, 'Kick'], [57, 'Snare']]));
    let shown = texts(g);
    // B2 named, A#2 empty, A2 named: the first row (C3) shows its note
    expect(shown.slice(0, 5)).toEqual(['C3', 'Kick', 'B2', 'Snare', 'A2']);
    const kick = g.drawn.findLast(d => d.name === 'fillText' && d.args[0] === 'Kick')!;
    expect(kick.fill).toBe('#e8eaee');
    expect(kick.args[3]).toBe(60 - 34);
    // pressed: dark text on the lit row
    k.element.dispatchEvent(pointer('pointerdown', 10, yOf(59)));
    const pressed = g.drawn.findLast(d => d.name === 'fillText' && d.args[0] === 'Kick')!;
    expect(pressed.fill).toBe('#141414');
    expect(g.drawn.findLast(d => d.name === 'fillText' && d.args[0] === 'B2')!.fill).toBe('#141414');
    // with Fold every row shows its note
    k.setAxis(new PitchAxis(12, 0, ROLL.ruler, [59, 58, 57]));
    shown = texts(g);
    expect(shown.slice(-5)).toEqual(['Kick', 'B2', 'A#2', 'Snare', 'A2']);
    // short rows: no names
    g.drawn.length = 0;
    k.setAxis(new PitchAxis(8, 0, ROLL.ruler, [59, 58, 57]));
    expect(texts(g)).toEqual([]);
  });
});
