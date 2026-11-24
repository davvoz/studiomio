// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveParams } from '../../../src/devices/device-type';
import { bandParam, bandsOf, BAND_TYPES, EQ_BANDS, MAX_GAIN } from '../../../src/devices/effects/eq/eq';
import { SHAPES } from '../../../src/devices/effects/drive/drive-math';
import { stepParam } from '../../../src/devices/effects/gate/gate';
import { effectType } from '../../../src/devices/registry';
import { LFO_SHAPE, pointsOf } from '../../../src/devices/instruments/prisma/shapes';
import { EqScale } from '../../../src/ui/device/eq/eq-scale';
import type { DynamicsReading, SpectrumTap } from '../../../src/ui/device/displays';
import { button, choose, drag, menuLabels, mouse, pick, sizeCanvases, wheel } from '../../helpers/browser';
import { openChain, type ChainOptions } from '../../helpers/device-chain';
import { pointer, texts } from '../../helpers/dom';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const W = 400, H = 200;

/** The chain with one effect, its canvases at W × H and drawn. */
function effect(type: string, o: ChainOptions = {}) {
  const c = openChain({ ...o, effects: [type] });
  sizeCanvases(c.view.element, W, H);
  c.resize();
  c.frames.run(2);
  const values = () => resolveParams(effectType(type)!, c.effects()[0].params);
  const canvas = (selector: string) => c.q<HTMLCanvasElement>(selector);
  return { ...c, values, canvas, drawn: (selector: string) => texts(c.canvases.of(canvas(selector))) };
}

/** A spectrum loud at the band `bin`, until `playing` is turned off. */
function spectrum() {
  const tap = { playing: true, disposed: false };
  const source: SpectrumTap = {
    sampleRate: 48000, binCount: 512,
    read: (pre, post) => {
      pre.fill(-90);
      post.fill(-90);
      pre[20] = post[20] = -12;
      return tap.playing;
    },
    dispose: () => { tap.disposed = true; },
  };
  return { tap, source };
}

describe('the EQ', () => {
  const scale = new EqScale(W, H);
  const at = (v: Record<string, number>, i: number) => {
    const b = bandsOf(v)[i];
    return [scale.freqToX(b.freq), BAND_TYPES[b.type].gain ? scale.dbToY(b.gain) : scale.dbToY(0)] as const;
  };
  const bell = (v: Record<string, number>) => bandsOf(v).findIndex(b => b.on && BAND_TYPES[b.type].gain);
  const mainBell = () => {
    const c = effect('eq');
    let i = bell(c.values());
    if (i < 0) {
      c.canvas('.eq-graph').dispatchEvent(mouse('dblclick', W / 2, H / 4));
      i = bell(c.values());
    }
    return { ...c, i };
  };

  it('a band\'s point is dragged: frequency across, gain up and down; one undo step, Shift is finer', () => {
    const { i, ...c } = mainBell();
    const graph = c.canvas('.eq-graph'), before = bandsOf(c.values())[i], [x, y] = at(c.values(), i);
    drag(graph, [[x, y], [x + 20, y - 20], [x + 40, y - 30]]);
    const after = bandsOf(c.values())[i];
    expect(after.freq).toBeGreaterThan(before.freq);
    expect(after.gain).toBeGreaterThan(before.gain);
    c.store.undo();
    expect(bandsOf(c.values())[i]).toMatchObject({ freq: before.freq, gain: before.gain });
    drag(graph, [[x, y], [x + 40, y]], { shiftKey: true });
    expect(bandsOf(c.values())[i].freq).toBeLessThan(after.freq);
    drag(graph, [[W - 2, 2], [10, 10]]); // empty space: nothing
    expect(Math.abs(bandsOf(c.values())[i].gain)).toBeLessThanOrEqual(MAX_GAIN);
  });

  it('a double click on empty space turns on the first free band there, on a point turns it off', () => {
    const c = effect('eq');
    const on = () => bandsOf(c.values()).filter(b => b.on).length;
    const n = on();
    c.canvas('.eq-graph').dispatchEvent(mouse('dblclick', W * 0.6, H * 0.2));
    expect(on()).toBe(n + 1);
    const added = bandsOf(c.values()).findIndex((b, i) => b.on && Math.abs(at(c.values(), i)[0] - W * 0.6) < 2);
    expect(added).toBeGreaterThanOrEqual(0);
    const [x, y] = at(c.values(), added);
    c.canvas('.eq-graph').dispatchEvent(mouse('dblclick', x, y));
    expect(on()).toBe(n);
    for (let k = 0; k < EQ_BANDS + 2; k++) c.canvas('.eq-graph').dispatchEvent(mouse('dblclick', 5 + k * 37, 5));
    expect(on()).toBeLessThanOrEqual(EQ_BANDS);
  });

  it('the wheel changes the Q; the menu the type, the slope, the switch, and puts the band back', () => {
    const { i, ...c } = mainBell();
    const graph = c.canvas('.eq-graph'), [x, y] = at(c.values(), i);
    graph.dispatchEvent(pointer('pointermove', x, y));
    expect(graph.style.cursor).toBe('grab');
    const q = bandsOf(c.values())[i].q;
    graph.dispatchEvent(wheel(x, y, -100));
    expect(bandsOf(c.values())[i].q).toBeGreaterThan(q);
    const menu = () => graph.dispatchEvent(mouse('contextmenu', ...at(c.values(), i)));
    const cut = BAND_TYPES.findIndex(t => t.cut);
    menu();
    choose(BAND_TYPES[cut].label);
    expect(bandsOf(c.values())[i].type).toBe(cut);
    menu();
    const slope = menuLabels().filter(l => l.startsWith('Slope'))[1];
    choose(slope);
    expect(bandsOf(c.values())[i].slope).toBe(1);
    menu();
    choose(`Turn band ${i + 1} off`);
    expect(bandsOf(c.values())[i].on).toBe(false);
    menu();
    choose('Put the band back as it was');
    expect(bandsOf(c.values())[i].type).toBe(resolveParams(effectType('eq')!, {})[bandParam(i, 'type')]);
  });

  it('the band buttons choose which band the knobs change; ⏻ and a double click turn it on and off', () => {
    const c = effect('eq');
    const buttons = c.all<HTMLButtonElement>('.eq-band');
    buttons[2].click();
    expect(c.q('.eq-band-title').textContent).toBe('Band 3');
    const before = bandsOf(c.values())[2];
    c.q(`[data-param="${bandParam(2, 'freq')}"]`).dispatchEvent(wheel(0, 0, -100));
    expect(bandsOf(c.values())[2].freq).toBeGreaterThan(before.freq);
    button(c.q('.eq-band-head'), '⏻').click();
    expect(bandsOf(c.values())[2].on).toBe(!before.on);
    buttons[2].dispatchEvent(mouse('dblclick'));
    expect(bandsOf(c.values())[2].on).toBe(before.on);
  });

  it('the graph says what\'s under the mouse and draws the spectrum while it plays; closed, it lets it go', () => {
    const { tap, source } = spectrum();
    const c = effect('eq', { spectrum: source });
    const graph = c.canvas('.eq-graph');
    graph.dispatchEvent(pointer('pointermove', W * 0.5, 4));
    c.frames.run();
    expect(graph.style.cursor).toBe('crosshair');
    expect(c.drawn('.eq-graph').some(t => t.includes('dB'))).toBe(true);
    const i = Math.max(0, bandsOf(c.values()).findIndex(b => b.on));
    graph.dispatchEvent(pointer('pointermove', ...at(c.values(), i)));
    c.frames.run();
    expect(c.drawn('.eq-graph').some(t => t.startsWith(`${i + 1} · `))).toBe(true);
    graph.dispatchEvent(new PointerEvent('pointerleave'));
    tap.playing = false;
    c.frames.run(2);
    const g = c.canvases.of(graph), n = g.drawn.length;
    c.frames.run(3); // still and silent: it isn't drawn again
    expect(g.drawn).toHaveLength(n);
    c.store.undo(); // the effect goes away
    c.frames.run();
    expect(tap.disposed).toBe(true);
  });
});

describe('the dynamics', () => {
  it.each(['compressor', 'noise-gate'])('%s: the threshold is dragged on the curve, within its range', type => {
    const c = effect(type);
    const graph = c.canvas('.dynamics-graph');
    drag(graph, [[100, 50], [200, 50]], { button: 2 });
    expect(c.effects()[0].params.threshold).toBeUndefined();
    drag(graph, [[100, 50], [200, 50]]);
    const t = c.values().threshold;
    drag(graph, [[100, 50], [300, 50]]);
    expect(c.values().threshold).toBeGreaterThan(t);
    drag(graph, [[100, 50], [9000, 50]]);
    expect(c.effects()[0].params.threshold).toBe(0);
    c.store.undo();
    expect(c.values().threshold).toBeLessThan(0);
  });

  it('the reduction is written while it works, and goes down calmly when it stops', () => {
    let reading: DynamicsReading | null = { input: -6, reduction: 8 };
    const c = effect('compressor', { dynamics: () => reading });
    c.frames.run();
    expect(c.drawn('.dynamics-graph')).toContain('−8.0 dB');
    reading = { input: -60, reduction: 0 };
    c.frames.run();
    const shown = c.drawn('.dynamics-graph').at(-1)!;
    expect(shown).not.toBe('−8.0 dB');
    expect(Number(shown.replace('−', '').replace(' dB', ''))).toBeLessThan(8);
    reading = null;
    const g = c.canvases.of(c.canvas('.dynamics-graph')), n = g.drawn.length;
    c.frames.run(3);
    expect(g.drawn).toHaveLength(n);
  });
});

describe('the Trance Gate', () => {
  const gate = () => {
    const c = effect('gate');
    const steps = () => {
      const v = c.values();
      return Array.from({ length: v.length }, (_, i) => v[stepParam(i)]);
    };
    const canvas = c.canvas('.gate-steps'), n = steps().length;
    return { ...c, steps, canvas, n, x: (i: number) => 4 + ((i + 0.5) / n) * (W - 8) };
  };

  it('a click opens or closes a step, a drag gives its level, also to several', () => {
    const g = gate();
    const before = g.steps();
    drag(g.canvas, [[g.x(1), 100]]);
    expect(g.steps()[1]).toBe(before[1] > 0 ? 0 : 100);
    drag(g.canvas, [[g.x(1), 100]], { button: 2 });
    expect(g.steps()[1]).toBe(before[1] > 0 ? 0 : 100);
    drag(g.canvas, [[g.x(2), 190], [g.x(4), H / 2]]);
    expect(g.steps().slice(2, 5)).toEqual([50, 50, 50]);
    g.store.undo();
    expect(g.steps().slice(2, 5)).toEqual(before.slice(2, 5));
  });

  it('the menu opens, closes, inverts, shuffles and shifts them all', () => {
    const g = gate();
    const menu = (label: string) => {
      g.canvas.dispatchEvent(mouse('contextmenu'));
      choose(label);
      return g.steps();
    };
    expect(menu('All closed').every(v => v === 0)).toBe(true);
    expect(menu('All open').every(v => v === 100)).toBe(true);
    drag(g.canvas, [[g.x(0), 100]]);
    expect(menu('Shift right').indexOf(0)).toBe(1);
    expect(menu('Shift left').indexOf(0)).toBe(0);
    expect(menu('Invert').filter(v => v === 100)).toEqual([100]);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(menu('Random').every(v => v === 100)).toBe(true);
  });

  it('is drawn with a bar per open step', () => {
    const g = gate();
    g.frames.run();
    const drawn = g.canvases.of(g.canvas).drawn;
    expect(drawn.filter(d => d.name === 'strokeRect').length).toBeGreaterThanOrEqual(g.n);
  });
});

describe('the Drive', () => {
  it('a shape is chosen from its button; the curve says the shape and the drive', () => {
    const c = effect('drive');
    const shapes = c.all<HTMLButtonElement>('.drive-shape');
    shapes[2].click();
    expect(c.values().shape).toBe(2);
    expect(shapes[2].classList.contains('on')).toBe(true);
    c.q('[data-param="drive"]').dispatchEvent(wheel(0, 0, -100));
    c.frames.run();
    expect(c.drawn('.drive-curve')).toContain(SHAPES[2].label);
    expect(c.drawn('.drive-curve').at(-1)).toMatch(/dB$/);
  });

  it('the spectrum is drawn while it plays, and otherwise says what it shows', () => {
    const { tap, source } = spectrum();
    tap.playing = false;
    const c = effect('drive', { spectrum: source });
    expect(c.drawn('.drive-spectrum').some(t => t.startsWith('Spectrum:'))).toBe(true);
    tap.playing = true;
    const g = c.canvases.of(c.canvas('.drive-spectrum'));
    g.drawn.length = 0;
    c.frames.run();
    expect(g.drawn.some(d => d.name === 'fill')).toBe(true);
    expect(texts(g).some(t => t.startsWith('Spectrum:'))).toBe(false);
    c.store.undo();
    c.frames.run();
    expect(tap.disposed).toBe(true);
  });
});

describe('the LFO', () => {
  const PAD = 8;
  const lfo = () => {
    const c = effect('lfo');
    const canvas = c.canvas('.prisma-lfo');
    const point = (x: number, y: number) => [PAD + x * (W - 2 * PAD), H - PAD - y * (H - 2 * PAD - 10)] as const;
    const menu = (label: string) => {
      c.q<HTMLButtonElement>('button[title="Shapes and transformations"]').click();
      choose(label);
    };
    return { ...c, canvas, point, menu };
  };

  it('the menu gives the fixed shapes; drawn, flipped, reversed, restarted', () => {
    const c = lfo();
    c.menu('Square');
    expect(c.values().l1Shape).toBe(LFO_SHAPE.square);
    c.menu('Draw from here (in points)');
    expect(c.values().l1Shape).toBe(LFO_SHAPE.drawn);
    const square = JSON.stringify(c.values());
    c.menu('Flip (top ↔ bottom)');
    expect(JSON.stringify(c.values())).not.toBe(square);
    c.menu('Flip (top ↔ bottom)');
    c.menu('Reverse (end ↔ start)');
    c.menu('Reverse (end ↔ start)');
    expect(JSON.stringify(c.values())).toBe(square);
    c.menu('Restart (triangle)');
    c.frames.run();
    expect(c.drawn('.prisma-lfo').at(-1)).toContain('points');
  });

  it('a click adds a point that is dragged without jumping over its neighbours; a double click removes it', () => {
    const c = lfo();
    c.menu('Restart (triangle)');
    const label = () => {
      const g = c.canvases.of(c.canvas);
      c.resize();
      return Number(/(\d+) points/.exec(texts(g).at(-1)!)![1]);
    };
    const n = label();
    drag(c.canvas, [c.point(0.25, 0.1), c.point(0.2, 0.9)], { shiftKey: true });
    expect(label()).toBe(n + 1);
    c.canvas.dispatchEvent(pointer('pointermove', ...c.point(0.2, 0.9)));
    c.canvas.dispatchEvent(mouse('dblclick', ...c.point(0.2, 0.9)));
    expect(label()).toBe(n);
    // the grid pulls: 0.27 goes to a grid line
    pick(c.q<HTMLSelectElement>('.prisma-grid'), '4');
    drag(c.canvas, [c.point(0.27, 0.06), c.point(0.27, 0.06)]);
    expect(label()).toBe(n + 1);
    c.store.undo();
    pick(c.q<HTMLSelectElement>('.prisma-grid'), '0');
  });

  it('the dots between the points curve the segments, a double click straightens them', () => {
    const c = lfo();
    c.menu('Restart (triangle)');
    const straight = JSON.stringify(c.values());
    const dot = c.point(0.25, 0.5);
    c.canvas.dispatchEvent(pointer('pointermove', ...dot));
    drag(c.canvas, [dot, [dot[0], dot[1] - 30]]);
    expect(JSON.stringify(c.values())).not.toBe(straight);
    const curved = Object.entries(c.values()).filter(([k, v]) => JSON.parse(straight)[k] !== v);
    expect(curved).toHaveLength(1);
    c.store.undo();
    drag(c.canvas, [dot, [dot[0], dot[1] - 8]]);
    // reversed, the segment is at the other end and bulges the same way
    const [first] = pointsOf(c.values(), 1);
    c.menu('Reverse (end ↔ start)');
    const reversed = pointsOf(c.values(), 1);
    expect(reversed.at(-2)!.curve).toBeCloseTo(-first.curve);
    expect(reversed[0].curve).toBeCloseTo(0);
    c.store.undo();
    c.canvas.dispatchEvent(mouse('dblclick', dot[0], dot[1] - 8));
    expect(c.values().l1Shape).toBe(LFO_SHAPE.drawn);
  });

  it('the random shapes aren\'t drawn by hand', () => {
    const c = lfo();
    c.menu('S&H');
    const before = JSON.stringify(c.values());
    drag(c.canvas, [c.point(0.5, 0.5), c.point(0.5, 0.9)]);
    expect(JSON.stringify(c.values())).toBe(before);
  });
});

describe('the Envelope', () => {
  const PAD = 8;
  it('its handles are dragged: times across, sustain up and down, the dots curve; a double click straightens', () => {
    const c = effect('envelope');
    const canvas = c.canvas('.prisma-env');
    const v0 = c.values();
    // the drawing fills the width: the handles are found from the cursor they give
    const find = (cursor: string): readonly [number, number] => {
      for (let i = 0; i < (W / 2) * (H / 4); i++) {
        const x = (i % (W / 2)) * 2, y = PAD + Math.floor(i / (W / 2)) * 4;
        canvas.dispatchEvent(pointer('pointermove', x, y));
        if (canvas.style.cursor === cursor) return [x, y];
      }
      throw new Error(`no handle with ${cursor}`);
    };
    const attack = find('ew-resize');
    drag(canvas, [attack, [attack[0] + 60, attack[1]]]);
    const later = c.values();
    expect(Object.keys(later).filter(k => later[k] !== v0[k]).length).toBeGreaterThan(0);
    const decay = find('move');
    drag(canvas, [decay, [decay[0] + 10, decay[1] - 40]]);
    // 40 of the 184 pixels of the drawing
    expect(Math.abs(c.values().e1S - later.e1S - (40 / 184) * 100)).toBeLessThan(6);
    const dot = find('ns-resize');
    const curves = () => [c.values().e1Ac, c.values().e1Dc, c.values().e1Rc];
    const before = curves();
    drag(canvas, [dot, [dot[0], dot[1] + 20]]);
    expect(curves()).not.toEqual(before);
    c.store.undo();
    expect(curves()).toEqual(before);
    canvas.dispatchEvent(mouse('dblclick', ...dot));
    expect(curves()).toContain(0);
    drag(canvas, [[W - 1, 2], [10, 10]]);
  });
});

describe('every effect\'s panel', () => {
  it('opens with its knobs and follows undo and redo', () => {
    for (const type of ['reverb', 'beat-repeat', 'multiband', 'chorus', 'arpeggiator', 'limiter']) {
      if (!effectType(type)) continue;
      const c = effect(type);
      const knob = c.panels()[1].querySelector<HTMLElement>('.knob[data-param]')!, id = knob.dataset.param!;
      const still = c.values()[id], text = () => knob.querySelector('.knob-readout')!.textContent;
      const shown = text();
      knob.dispatchEvent(wheel(0, 0, still > 0 ? 100 : -100));
      knob.dispatchEvent(wheel(0, 0, still > 0 ? 100 : -100));
      c.store.undo();
      c.store.undo();
      expect([c.values()[id], text()]).toEqual([still, shown]);
    }
  });
});
