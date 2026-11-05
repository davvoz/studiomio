/* La barretta delle forme pronte, in alto a destra nella corsia: un pulsante per forma (l'icona è
 * la forma vera), quanto dura un ciclo, quanto è ampia, e al contrario. Un pulsante mette la
 * forma; gli altri comandi rifanno quella appena messa, per provare a orecchio. */
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
  private readonly cycle = el<HTMLSelectElement>('select', { title: 'Ciclo: quanto dura una ripetizione della forma (Tutto: una sola su tutto il tratto)' });
  private readonly depth = el<HTMLSelectElement>('select', { title: 'Ampiezza: 100% usa tutta la scala' });
  private readonly invertButton = el<HTMLButtonElement>('button', {
    textContent: '⇅', title: 'Al contrario: capovolge la forma', onclick: () => this.toggleInvert(),
  });
  private shape: ShapeId = 'sine';
  private invert = false;
  private seed = 1;

  /** `put`: un pulsante premuto, la forma va messa. `tweak`: è cambiato uno degli altri comandi. */
  constructor(private readonly put: (c: ShapeChoice) => void, private readonly tweak: (c: ShapeChoice) => void) {
    this.cycle.append(
      el('option', { value: String(WHOLE), textContent: 'Tutto' }),
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

  /** Ripremere una forma casuale tira fuori altri valori. */
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
