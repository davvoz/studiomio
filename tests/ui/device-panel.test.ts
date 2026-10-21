import { describe, expect, it } from 'vitest';
import { narrowestWidth } from '../../src/ui/device/device-panel';

describe('schede di un dispositivo a capo', () => {
  it('in una riga: tutte in fila', () => {
    expect(narrowestWidth([100, 50, 80], 6, 1)).toBe(242);
  });

  it('in due righe: la larghezza più stretta che le tiene in ordine', () => {
    // Beat Repeat più o meno: Quando, Griglia, Ripetizioni, Filtro, Uscita
    const widths = [300, 120, 190, 150, 130];
    const w = narrowestWidth(widths, 6, 2);
    // [300 120] | [190 150 130]: la seconda riga è la più larga
    expect(w).toBe(482);
    expect(w).toBeLessThan(widths.reduce((a, b) => a + b) + 4 * 6);
  });

  it('non va sotto la scheda più larga, anche con righe in avanzo', () => {
    expect(narrowestWidth([200, 40, 40], 6, 5)).toBe(200);
    expect(narrowestWidth([200, 40, 40], 6, 2)).toBe(200); // 40 + 6 + 40 sta sotto i 200
  });

  it('larghezze con i decimali: arrotonda in su, così il browser non manda a capo una riga in più', () => {
    expect(narrowestWidth([100.4, 100.4], 6, 1)).toBe(207);
  });
});
