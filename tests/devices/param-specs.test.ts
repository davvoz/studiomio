import { describe, expect, it } from 'vitest';
import { paramsOf } from '../../src/devices/device-type';
import { paramFromUnit, paramToUnit } from '../../src/devices/params';
import { EFFECT_TYPES, INSTRUMENT_TYPES } from '../../src/devices/registry';

describe('parameter specs', () => {
  const types = [...INSTRUMENT_TYPES, ...EFFECT_TYPES];

  it('a log knob starts above zero (log of 0: the knob and the macros would get NaN)', () => {
    const bad = types.flatMap(t => paramsOf(t)
      .filter(p => p.kind === 'number' && p.scale === 'log' && !(p.min > 0))
      .map(p => `${t.label} · ${p.label}`));
    expect(bad).toEqual([]);
  });

  it('every number knob maps its whole travel to finite values', () => {
    const bad = types.flatMap(t => paramsOf(t)
      .filter(p => p.kind === 'number')
      .filter(p => ![0, 0.5, 1].every(u => Number.isFinite(paramFromUnit(p, u)) && Number.isFinite(paramToUnit(p, p.default))))
      .map(p => `${t.label} · ${p.label}`));
    expect(bad).toEqual([]);
  });
});
