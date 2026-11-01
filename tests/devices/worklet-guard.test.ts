import { describe, expect, it } from 'vitest';
import { cleaned, FaultGate, hasInvalid } from '../../src/devices/worklet/guard';

describe('rete di sicurezza dei processori', () => {
  it('riconosce NaN e infiniti, non i numeri', () => {
    expect(hasInvalid(Float32Array.of(0, -1, 1e30, 1e-40))).toBe(false);
    expect(hasInvalid(Float32Array.of(0, NaN, 0))).toBe(true);
    expect(hasInvalid(Float32Array.of(Infinity))).toBe(true);
    expect(hasInvalid(Float32Array.of(0, -Infinity))).toBe(true);
  });

  it('un ingresso sano passa com\'è; uno guasto si copia con zero al posto dei campioni non finiti', () => {
    const spare = new Float32Array(8);
    const ok = Float32Array.of(0.5, -0.5);
    expect(cleaned(ok, spare)).toBe(ok);
    const bad = Float32Array.of(0.5, NaN, -Infinity, -0.25);
    expect(Array.from(cleaned(bad, spare))).toEqual([0.5, 0, 0, -0.25]);
    expect(Array.from(bad.subarray(0, 2))).toEqual([0.5, NaN]);
  });

  it('riavvia subito la prima volta, poi al massimo una volta per pausa', () => {
    const gate = new FaultGate(1);
    expect(gate.restart(10)).toBe(true);
    expect(gate.restart(10.5)).toBe(false);
    expect(gate.restart(11)).toBe(true);
    expect(gate.restart(30)).toBe(true);
  });
});
