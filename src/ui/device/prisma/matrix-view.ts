/* Prisma's modulation matrix: one slot per row, with the source, the amount (as a
 * fraction of the target knob's travel), the polarity, the curve, the aux source
 * scaling it and the target. The amount is a slider that can be mapped to a rack macro
 * and modulated from the clips, like a knob. */
import {
  DESTINATIONS, MOD_SLOTS, POLARITIES, slotParam, SOURCES,
} from '../../../devices/instruments/prisma/prisma';
import { clampParam, formatParam, paramFromUnit, paramToUnit, type NumberParam } from '../../../devices/params';
import type { ParamValues } from '../../../model/device';
import { el } from '../../dom';
import type { ParamControl } from '../controls';

/** A horizontal slider: drag (Shift: fine), wheel, double click for the default.
 *  If the minimum is negative it fills from zero. */
export class Slider implements ParamControl {
  readonly element = el('div', { className: 'prisma-slider', tabIndex: 0 });
  private readonly fill = el('div', { className: 'prisma-slider-fill' });
  private readonly text = el('div', { className: 'prisma-slider-text' });
  private value: number;

  constructor(private readonly spec: NumberParam, value: number, private readonly onChange: (v: number, final: boolean) => void, private readonly label = '') {
    this.value = value;
    this.element.append(this.fill, this.text);
    this.element.dataset.param = spec.id;
    this.element.title = `${spec.label}: drag horizontally (Shift: fine) · double click: 0`;
    this.element.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.element.setPointerCapture(e.pointerId);
      let lastX = e.clientX, unit = paramToUnit(spec, this.value), moved = false;
      const width = Math.max(40, this.element.clientWidth);
      const move = (m: PointerEvent) => {
        moved = true;
        unit = Math.max(0, Math.min(1, unit + ((m.clientX - lastX) / width) * (m.shiftKey ? 0.2 : 1)));
        lastX = m.clientX;
        this.change(paramFromUnit(spec, unit), false);
      };
      const up = () => {
        this.element.removeEventListener('pointermove', move);
        if (moved) this.onChange(this.value, true);
      };
      this.element.addEventListener('pointermove', move);
      this.element.addEventListener('pointerup', up, { once: true });
      this.element.addEventListener('pointercancel', up, { once: true });
    });
    this.element.addEventListener('dblclick', () => this.change(spec.default, true));
    this.element.addEventListener('wheel', e => {
      e.preventDefault();
      this.change(paramFromUnit(spec, paramToUnit(spec, this.value) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02)), true);
    }, { passive: false });
    this.render();
  }

  set(value: number): void {
    if (value === this.value) return;
    this.value = value;
    this.render();
  }

  private change(v: number, final: boolean): void {
    v = clampParam(this.spec, v);
    if (v === this.value && !final) return;
    this.value = v;
    this.render();
    this.onChange(v, final);
  }

  private render(): void {
    const u = paramToUnit(this.spec, this.value), zero = this.spec.min < 0 ? paramToUnit(this.spec, 0) : 0;
    this.fill.style.left = `${Math.min(u, zero) * 100}%`;
    this.fill.style.width = `${Math.abs(u - zero) * 100}%`;
    this.fill.classList.toggle('negative', u < zero);
    this.text.textContent = `${this.label}${formatParam(this.spec, this.value)}`;
  }
}

/** The targets in the menu, grouped. */
function destinationOptions(): HTMLElement[] {
  const groups = new Map<string, HTMLElement>();
  DESTINATIONS.forEach((d, i) => {
    let g = groups.get(d.group);
    if (!g) groups.set(d.group, (g = el('optgroup', { label: d.group })));
    g.append(el('option', { value: String(i + 1), textContent: d.label }));
  });
  return [el('option', { value: '0', textContent: '—' }), ...groups.values()];
}

const sourceOptions = (none: string) => SOURCES.map((s, i) => el('option', { value: String(i), textContent: i ? s : none }));

export interface MatrixHost {
  values(): Readonly<Record<string, number>>;
  set(values: ParamValues, final: boolean): void;
  /** A slot's amount slider, registered like the other controls. */
  slider(id: string, label?: string): Slider;
}

/** A row of the matrix. */
class Row {
  readonly element: HTMLElement;
  private readonly src = el<HTMLSelectElement>('select', { className: 'prisma-src-select', title: 'Source' }, ...sourceOptions('— source —'));
  private readonly dst = el<HTMLSelectElement>('select', { className: 'prisma-dst-select', title: 'Target' }, ...destinationOptions());
  private readonly aux = el<HTMLSelectElement>('select', { className: 'prisma-aux-select', title: 'Aux: a source scaling the modulation (e.g. the velocity, or a macro as "how much")' }, ...sourceOptions('aux'));
  private readonly pol = el<HTMLButtonElement>('button', { className: 'mini prisma-pol', title: 'Uni: moves in one direction · Bi: around the knob' });
  private readonly curve: Slider;
  private readonly clear = el<HTMLButtonElement>('button', { className: 'mini', textContent: '×', title: 'Clear the slot' });

  constructor(private readonly n: number, host: MatrixHost) {
    const p = (f: Parameters<typeof slotParam>[1]) => slotParam(n, f);
    const choose = (field: 'Src' | 'Dst' | 'Aux', select: HTMLSelectElement) => {
      select.onchange = () => host.set({ [p(field)]: Number(select.value) }, true);
    };
    choose('Src', this.src);
    choose('Dst', this.dst);
    choose('Aux', this.aux);
    this.pol.onclick = () => host.set({ [p('Pol')]: host.values()[p('Pol')] ? 0 : 1 }, true);
    this.clear.onclick = () => host.set({ [p('Src')]: 0, [p('Dst')]: 0, [p('Amt')]: 0, [p('Pol')]: 0, [p('Curve')]: 0, [p('Aux')]: 0 }, true);
    const amount = host.slider(p('Amt'));
    this.curve = host.slider(p('Curve'), '⤴ ');
    this.curve.element.classList.add('prisma-curve');
    this.curve.element.removeAttribute('data-param');
    this.curve.element.title = 'Source curve: positive rises right away, negative late (double click: straight)';
    this.element = el('div', { className: 'prisma-row' },
      el('span', { className: 'prisma-row-n', textContent: String(n) }), this.src, amount.element, this.pol, this.curve.element, this.aux, this.dst, this.clear);
  }

  update(v: Readonly<Record<string, number>>): void {
    const p = (f: Parameters<typeof slotParam>[1]) => slotParam(this.n, f);
    this.src.value = String(v[p('Src')]);
    this.dst.value = String(v[p('Dst')]);
    this.aux.value = String(v[p('Aux')]);
    this.pol.textContent = POLARITIES[v[p('Pol')]] ?? 'Uni';
    this.pol.classList.toggle('on', v[p('Pol')] === 1);
    const used = v[p('Src')] > 0 && v[p('Dst')] > 0;
    this.element.classList.toggle('empty', !used);
  }
}

export class MatrixView {
  readonly element = el('div', { className: 'prisma-matrix' });
  private readonly rows: Row[] = [];

  constructor(host: MatrixHost) {
    const columns = [el('div', { className: 'prisma-matrix-col' }), el('div', { className: 'prisma-matrix-col' })];
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const row = new Row(n, host);
      this.rows.push(row);
      columns[n <= MOD_SLOTS / 2 ? 0 : 1].append(row.element);
    }
    this.element.append(...columns);
  }

  update(v: Readonly<Record<string, number>>): void {
    for (const r of this.rows) r.update(v);
  }
}
