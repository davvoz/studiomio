import { describe, expect, it } from 'vitest';
import { MOD_SCALES } from '../../src/model/envelope';
import { clearRange, paintStep, placeShape, replaceRange, rescalePoints, sliceRange } from '../../src/ui/envelopes/envelope-lane';
import { shapePoints, type ShapeChoice } from '../../src/ui/envelopes/envelope-shapes';

const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

describe('tratti di una curva di modulazione', () => {
  const ramp = pts([0, 0], [4, 1]);

  it('un tratto si prende con i suoi bordi, relativo al suo inizio', () => {
    expect(sliceRange(ramp, 1, 3, 0)).toEqual(pts([0, 0.25], [2, 0.75]));
    // i punti dentro restano
    expect(sliceRange(pts([0, 0], [2, 1], [4, 0]), 1, 3, 0)).toEqual(pts([0, 0.5], [1, 1], [2, 0.5]));
  });

  it('su uno scalino il tratto prende il valore giusto da ogni parte', () => {
    const step = pts([0, 0], [2, 0], [2, 1], [4, 1], [4, 0]);
    expect(sliceRange(step, 2, 4, 0)).toEqual(pts([0, 1], [2, 1]));
  });

  it('replaceRange tiene la curva fuori dal tratto, saltando ai bordi', () => {
    const out = replaceRange(ramp, 1, 3, pts([1, 1], [3, 1]), 0);
    expect(out).toEqual(pts([0, 0], [1, 0.25], [1, 1], [3, 1], [3, 0.75], [4, 1]));
  });

  it('su una curva vuota ci sono solo i punti incollati', () => {
    expect(replaceRange([], 4, 8, pts([4, 0.1], [6, 0.9], [8, 0.2]), 0)).toEqual(pts([4, 0.1], [6, 0.9], [8, 0.2]));
  });

  it('uno scalino su una curva vuota torna alla linea neutra alla fine', () => {
    expect(paintStep([], 2, 3, 0.5, 0)).toEqual(pts([2, 0.5], [3, 0.5], [3, 0]));
  });

  it('cancellare un tratto lo riporta al neutro; se non resta altro la curva sparisce', () => {
    expect(clearRange(ramp, 1, 3, 0)).toEqual(pts([0, 0], [1, 0.25], [1, 0], [3, 0], [3, 0.75], [4, 1]));
    expect(clearRange(pts([1, 0.5], [3, 0.5]), 0, 4, 0)).toEqual([]);
  });

  it('copiare e incollare in un altro punto ridà la stessa forma', () => {
    const shape = pts([0, 0], [1, 1], [2, 0]);
    const copied = sliceRange(shape, 0, 2, 0).map(p => ({ beat: p.beat + 8, value: p.value }));
    expect(replaceRange(shape, 8, 10, copied, 0)).toEqual([...shape, ...pts([8, 0], [9, 1], [10, 0])]);
  });

  it('su un\'altra scala la linea neutra resta neutra e gli estremi vanno sugli estremi', () => {
    const { param, pan } = MOD_SCALES;
    expect(rescalePoints(pts([0, param.neutral], [1, param.max], [2, param.min]), param, pan))
      .toEqual(pts([0, pan.neutral], [1, pan.max], [2, pan.min]));
    expect(rescalePoints(ramp, param, param)).toEqual(ramp);
  });
});

describe('forme pronte', () => {
  const { param, volume, transpose } = MOD_SCALES;
  const choice = (over: Partial<ShapeChoice> = {}): ShapeChoice => ({ shape: 'rampUp', cycle: 0, depth: 1, invert: false, seed: 1, ...over });
  const values = (p: readonly { value: number }[]) => p.map(q => q.value);

  it('senza ciclo fa una forma sola su tutto il tratto', () => {
    expect(shapePoints(choice(), 4, 8, param)).toEqual(pts([4, -1], [8, 1]));
  });

  it('il ciclo si ripete, con il salto tra un ciclo e l\'altro', () => {
    expect(shapePoints(choice({ cycle: 1 }), 0, 2, param)).toEqual(pts([0, -1], [1, 1], [1, -1], [2, 1]));
  });

  it('un ciclo che non ci sta si taglia alla fine del tratto, sulla sua retta', () => {
    expect(shapePoints(choice({ cycle: 2 }), 0, 3, param)).toEqual(pts([0, -1], [2, 1], [2, -1], [3, 0]));
  });

  it('ampiezza e verso restano attorno alla linea neutra', () => {
    expect(values(shapePoints(choice({ depth: 0.5 }), 0, 1, param))).toEqual([-0.5, 0.5]);
    expect(values(shapePoints(choice({ invert: true }), 0, 1, param))).toEqual([1, -1]);
  });

  it('sul volume usa la parte sotto il neutro, tutta', () => {
    expect(values(shapePoints(choice(), 0, 1, volume))).toEqual([0, 1]);
    expect(values(shapePoints(choice({ depth: 0.25 }), 0, 1, volume))).toEqual([0.75, 1]);
  });

  it('sulla trasposizione resta dentro un\'ottava', () => {
    expect(values(shapePoints(choice(), 0, 1, transpose))).toEqual([-12, 12]);
  });

  it('la sinusoide parte e torna al neutro, senza salti tra i cicli', () => {
    const p = shapePoints(choice({ shape: 'sine', cycle: 1 }), 0, 2, param);
    expect(p[0].value).toBeCloseTo(0);
    expect(p[p.length - 1].value).toBeCloseTo(0);
    expect(Math.max(...values(p))).toBeCloseTo(1);
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].value - p[i - 1].value)).toBeLessThan(0.5);
  });

  it('tante ripetizioni non fanno esplodere i punti', () => {
    expect(shapePoints(choice({ shape: 'sine', cycle: 0.25 }), 0, 256, param).length).toBeLessThan(10000);
  });

  it('le forme casuali dipendono dal seme e restano nella scala', () => {
    const a = shapePoints(choice({ shape: 'steps', cycle: 1, seed: 3 }), 0, 8, param);
    expect(shapePoints(choice({ shape: 'steps', cycle: 1, seed: 3 }), 0, 8, param)).toEqual(a);
    expect(shapePoints(choice({ shape: 'steps', cycle: 1, seed: 4 }), 0, 8, param)).not.toEqual(a);
    expect(values(a).every(v => v >= -1 && v <= 1)).toBe(true);
  });

  it('la casuale morbida non salta tra un ciclo e l\'altro', () => {
    const p = shapePoints(choice({ shape: 'drift', cycle: 1, seed: 3 }), 0, 4, param);
    for (let i = 1; i < p.length; i++) if (p[i].beat === p[i - 1].beat) expect(p[i].value).toBe(p[i - 1].value);
  });

  it('su una curva vuota fuori dal tratto resta il neutro', () => {
    const out = placeShape([], 2, 4, pts([2, -1], [4, 1]), 0);
    expect(out).toEqual(pts([0, 0], [2, 0], [2, -1], [4, 1], [4, 0]));
  });

  it('su una curva che c\'è già sostituisce solo il tratto', () => {
    const out = placeShape(pts([0, 0.5], [8, 0.5]), 2, 4, pts([2, -1], [4, 1]), 0);
    expect(out).toEqual(pts([0, 0.5], [2, 0.5], [2, -1], [4, 1], [4, 0.5], [8, 0.5]));
  });

  it('rimettere una forma nello stesso tratto non lascia tracce della prima', () => {
    const once = placeShape([], 2, 4, pts([2, -1], [4, 1]), 0);
    expect(placeShape(once, 2, 4, pts([2, 1], [3, 1], [3, -1], [4, -1]), 0))
      .toEqual(placeShape([], 2, 4, pts([2, 1], [3, 1], [3, -1], [4, -1]), 0));
  });
});
