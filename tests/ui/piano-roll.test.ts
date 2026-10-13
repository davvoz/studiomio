import { describe, expect, it } from 'vitest';
import { isBlackKey, PitchAxis, pitchName } from '../../src/ui/piano-roll/pitch-axis';

describe('piano roll: asse delle altezze', () => {
  it('altezza ↔ y, la più acuta in alto', () => {
    const a = new PitchAxis(10, 0, 28);
    expect(a.pitchToY(127)).toBe(28);
    expect(a.pitchToY(60)).toBe(28 + 67 * 10);
    expect(a.yToPitch(a.pitchToY(60) + 5)).toBe(60);
    expect(a.yToPitch(-1000)).toBe(127);
    expect(a.yToPitch(1e6)).toBe(0);
  });

  it('scorrimento limitato, zoom attorno al puntatore, centratura', () => {
    const a = new PitchAxis(10, 0, 28);
    expect(a.scrolled(-50, 200).scrollY).toBe(0);
    expect(a.scrolled(1e6, 200).scrollY).toBe(1280 - 200);
    const y = 150, before = a.scrolled(400, 200);
    const z = before.zoomed(20, y, 200);
    expect(z.yToPitch(y)).toBe(before.yToPitch(y));
    const c = a.centeredOn(48, 60, 200);
    expect(c.yToPitch(28 + 100)).toBe(54);
  });

  it('nomi e tasti neri', () => {
    expect(pitchName(60)).toBe('C3');
    expect(pitchName(69)).toBe('A3');
    expect(pitchName(0)).toBe('C-2');
    expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([false, true, false, true, false, false, true]);
  });
});
