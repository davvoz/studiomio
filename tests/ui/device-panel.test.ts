import { describe, expect, it } from 'vitest';
import { narrowestWidth } from '../../src/ui/device/device-panel';

describe('tabs of a device wrapping', () => {
  it('in one row: all in a row', () => {
    expect(narrowestWidth([100, 50, 80], 6, 1)).toBe(242);
  });

  it('in two rows: the narrowest width holding them in order', () => {
    // Beat Repeat more or less: When, Grid, Repetitions, Filter, Output
    const widths = [300, 120, 190, 150, 130];
    const w = narrowestWidth(widths, 6, 2);
    // [300 120] | [190 150 130]: the second row is the widest
    expect(w).toBe(482);
    expect(w).toBeLessThan(widths.reduce((a, b) => a + b) + 4 * 6);
  });

  it('it doesn\'t go below the widest tab, even with spare rows', () => {
    expect(narrowestWidth([200, 40, 40], 6, 5)).toBe(200);
    expect(narrowestWidth([200, 40, 40], 6, 2)).toBe(200); // 40 + 6 + 40 is below 200
  });

  it('widths with decimals: it rounds up, so the browser doesn\'t wrap an extra row', () => {
    expect(narrowestWidth([100.4, 100.4], 6, 1)).toBe(207);
  });
});
