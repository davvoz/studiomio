/* La matrice delle modulazioni di Prisma: un posto per riga, con la fonte, la quantità (in
 * frazione della corsa della manopola di destinazione), la polarità, la curva, la fonte aux che
 * la scala e la destinazione. La quantità è un cursore che si può mappare su una macro del rack
 * e modulare dalle clip, come una manopola. */
import {
  DESTINATIONS, MOD_SLOTS, POLARITIES, slotParam, SOURCES,
} from '../../../devices/instruments/prisma/prisma';
import { clampParam, formatParam, paramFromUnit, paramToUnit, type NumberParam } from '../../../devices/params';
import type { ParamValues } from '../../../model/device';
import { el } from '../../dom';
import type { ParamControl } from '../controls';

/** Un cursore orizzontale: trascinare (Maiusc: fine), rotella, doppio clic per il predefinito.
 *  Se il minimo è negativo si riempie dallo zero. */
export class Slider implements ParamControl {
  readonly element = el('div', { className: 'prisma-slider', tabIndex: 0 });
  private readonly fill = el('div', { className: 'prisma-slider-fill' });
  private readonly text = el('div', { className: 'prisma-slider-text' });
  private value: number;

  constructor(private readonly spec: NumberParam, value: number, private readonly onChange: (v: number, final: boolean) => void, private readonly label = '') {
    this.value = value;
    this.element.append(this.fill, this.text);
    this.element.dataset.param = spec.id;
    this.element.title = `${spec.label}: trascina in orizzontale (Maiusc: fine) · doppio clic: 0`;
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

/** Le destinazioni nel menu, raggruppate. */
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
  /** Il cursore della quantità di un posto, registrato come gli altri controlli. */
  slider(id: string, label?: string): Slider;
}

/** Una riga della matrice. */
class Row {
  readonly element: HTMLElement;
  private readonly src = el<HTMLSelectElement>('select', { className: 'prisma-src-select', title: 'Fonte' }, ...sourceOptions('— fonte —'));
  private readonly dst = el<HTMLSelectElement>('select', { className: 'prisma-dst-select', title: 'Destinazione' }, ...destinationOptions());
  private readonly aux = el<HTMLSelectElement>('select', { className: 'prisma-aux-select', title: 'Aux: una fonte che scala la modulazione (es. la velocity, o una macro come "quanto")' }, ...sourceOptions('aux'));
  private readonly pol = el<HTMLButtonElement>('button', { className: 'mini prisma-pol', title: 'Uni: sposta da una parte · Bi: attorno alla manopola' });
  private readonly curve: Slider;
  private readonly clear = el<HTMLButtonElement>('button', { className: 'mini', textContent: '×', title: 'Svuota il posto' });

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
    this.curve.element.title = 'Curva della fonte: positiva sale subito, negativa tardi (doppio clic: diritta)';
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
