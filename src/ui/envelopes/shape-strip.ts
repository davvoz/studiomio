/* The little bar of ready-made shapes, at the top right of the lane: a button per shape (the icon is
 * the real shape), how long a cycle lasts, how wide it is, and reversed. A button places the
 * shape; the other commands redo the one just placed, to try by ear. */
import type { Beats } from '../../core/music-time';
import { TEMPO_RATES } from '../../devices/rates';
import { MOD_SCALES } from '../../model/envelope';
import { el } from '../dom';
import { SHAPES, shapePoints, type ShapeChoice, type ShapeId } from './envelope-shapes';

const SVG = 'http://www.w3.org/2000/svg';
const ICON = { w: 24, h: 14, pad: 2 } as const;
const WHOLE: Beats = 0;
const DEPTHS = [100, 75, 50, 25, 10] as const;

function iconOf(shape: (typeof SHAPES)[number]): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ICON.w} ${ICON.h}`);
  const { w, h, pad } = ICON, line = document.createElementNS(SVG, 'polyline');
  const points = shapePoints({ shape: shape.id, cycle: 1 / shape.icon, depth: 1, invert: false, seed: 7 }, 0, 1, MOD_SCALES.param);
  line.setAttribute('points', points.map(p => `${(pad + p.beat * (w - 2 * pad)).toFixed(1)},${(h / 2 - (p.value * (h - 2 * pad)) / 2).toFixed(1)}`).join(' '));
  svg.append(line);
  return svg;
}

export class ShapeStrip {
  readonly element = el('div', { className: 'mod-shapes', hidden: true });
  private readonly buttons = new Map<ShapeId, HTMLButtonElement>();
  private readonly cycle = el<HTMLSelectElement>('select', { title: 'Cycle: how long a repetition of the shape lasts (All: a single one over the whole range)' });
  private readonly depth = el<HTMLSelectElement>('select', { title: 'Amplitude: 100% uses the whole scale' });
  private readonly invertButton = el<HTMLButtonElement>('button', {
    textContent: '⇅', title: 'Reverse: flips the shape', onclick: () => this.toggleInvert(),
  });
  private shape: ShapeId = 'sine';
  private invert = false;
  private seed = 1;

  /** `put`: a button pressed, the shape must be placed. `tweak`: one of the other commands changed. */
  constructor(private readonly put: (c: ShapeChoice) => void, private readonly tweak: (c: ShapeChoice) => void) {
    this.cycle.append(
      el('option', { value: String(WHOLE), textContent: 'All' }),
      ...TEMPO_RATES.map(([label, beats]) => el('option', { value: String(beats), textContent: label })));
    this.depth.append(...DEPTHS.map(d => el('option', { value: String(d), textContent: `${d}%` })));
    this.cycle.onchange = this.depth.onchange = () => this.tweak(this.choice);
    const shapes = el('div', { className: 'mod-shape-buttons' }, ...SHAPES.map(s => {
      const b = el<HTMLButtonElement>('button', { title: s.label, onclick: () => this.press(s.id) });
      b.append(iconOf(s));
      this.buttons.set(s.id, b);
      return b;
    }));
    this.element.append(shapes, this.invertButton, this.cycle, this.depth);
  }

  private get choice(): ShapeChoice {
    return { shape: this.shape, cycle: Number(this.cycle.value), depth: Number(this.depth.value) / 100, invert: this.invert, seed: this.seed };
  }

  /** Pressing a random shape again draws other values. */
  private press(shape: ShapeId): void {
    this.shape = shape;
    this.seed = Math.floor(Math.random() * 2 ** 31);
    for (const [id, b] of this.buttons) b.classList.toggle('on', id === shape);
    this.put(this.choice);
  }

  private toggleInvert(): void {
    this.invert = !this.invert;
    this.invertButton.classList.toggle('on', this.invert);
    this.tweak(this.choice);
  }
}
