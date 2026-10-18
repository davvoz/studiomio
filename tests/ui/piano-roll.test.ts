import { describe, expect, it } from 'vitest';
import { beatLevel, gridBand } from '../../src/ui/clip-editor/clip-frame';
import { foldRows, isBlackKey, PitchAxis, pitchName, sameRows } from '../../src/ui/piano-roll/pitch-axis';

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

  it('Fold: solo le righe delle note, dalla più acuta', () => {
    const rows = foldRows([36, 42, 36, 38]);
    expect(rows).toEqual([42, 38, 36]);
    expect(foldRows([])).toBeNull();
    expect(sameRows(rows, [42, 38, 36])).toBe(true);
    expect(sameRows(rows, null)).toBe(false);
    const a = new PitchAxis(10, 0, 28, rows);
    expect(a.folded).toBe(true);
    expect(a.contentHeight).toBe(30);
    expect(a.pitchToY(42)).toBe(28);
    expect(a.pitchToY(36)).toBe(48);
    expect(a.yToPitch(28 + 15)).toBe(38);
    expect(a.yToPitch(1e6)).toBe(36);
    // un'altezza senza riga (una nota trascinata) sta a metà tra le vicine
    expect(a.pitchToY(40)).toBe(28 + 5);
    expect(a.visible(28, 200)).toEqual([42, 38, 36]);
    expect(a.visible(38, 48)).toEqual([38]);
    // senza Fold: tutte le righe
    expect(new PitchAxis(10, 0, 28).visible(28, 48)).toEqual([127, 126]);
    expect(a.withRows(null, 200).folded).toBe(false);
  });
});

describe('griglia degli editor', () => {
  it('battuta, battito, mezzo battito, suddivisioni', () => {
    expect([0, 4, 1, 3, 0.5, 2.5, 0.25, 1.75].map(b => beatLevel(b, 4))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(beatLevel(3, 3)).toBe(0);
  });

  it('fasce alternate: il battito, poi la battuta, poi 4 battute', () => {
    expect(gridBand(0.25, 4)).toBe(1);
    expect(gridBand(0.5, 4)).toBe(1);
    expect(gridBand(1, 4)).toBe(4);
    expect(gridBand(4, 4)).toBe(16);
  });
});
