/* Controlli dei parametri: una manopola per i numeri, pulsanti o un menu per le scelte.
 * Nascono dalla descrizione del parametro, così ogni dispositivo ha la sua interfaccia senza
 * scriverla. */
import { clampParam, formatParam, paramFromUnit, paramToUnit, type ChoiceParam, type NumberParam, type ParamSpec } from '../../devices/params';

/** `final` è vero alla fine di un gesto (rilascio, clic): chiude il passo di annullamento. */
export type ParamChange = (value: number, final: boolean) => void;

export interface ParamControl {
  readonly element: HTMLElement;
  set(value: number): void;
  /** Lo spostamento di una curva che suona, in frazioni della corsa (0: nessuno): il controllo
   *  mostra il valore che si sente, la manopola resta dov'è. */
  modulate?(offset: number): void;
}

/** I controlli per elemento, per chi trova i parametri dal loro `data-param` (le curve). */
const CONTROLS = new WeakMap<Element, ParamControl>();

/** Il controllo di un elemento, se ne è uno. */
export const controlOf = (element: Element): ParamControl | undefined => CONTROLS.get(element);

/** Fa trovare il controllo dal suo elemento (vedi controlOf). */
export function registerControl<C extends ParamControl>(control: C): C {
  CONTROLS.set(control.element, control);
  return control;
}

/** Sotto questo spostamento una curva non si mostra. */
const NO_OFFSET = 1e-4;
const offsetOf = (offset: number) => (Math.abs(offset) < NO_OFFSET ? 0 : offset);

const SVG = 'http://www.w3.org/2000/svg';
/** La manopola copre 270°, da −135° (minimo) a +135° (massimo). */
const SWEEP = 270, R = 15;

function arc(fromDeg: number, toDeg: number, r = R): string {
  const pt = (d: number) => {
    const a = ((d - 90) * Math.PI) / 180;
    return `${20 + r * Math.cos(a)} ${20 + r * Math.sin(a)}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${pt(fromDeg)} A ${r} ${r} 0 ${large} 1 ${pt(toDeg)}`;
}

/** Un arco attorno alla manopola fra due posizioni della sua corsa (0…1), a raggio `r` (la
 *  faccia è 40×40): per esempio l'anello di una modulazione. */
export const knobArc = (fromUnit: number, toUnit: number, r: number): string => {
  const deg = (u: number) => -SWEEP / 2 + Math.max(0, Math.min(1, u)) * SWEEP;
  const a = deg(Math.min(fromUnit, toUnit)), b = deg(Math.max(fromUnit, toUnit));
  return arc(a, Math.max(a + 0.01, b), r);
};

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Manopola: trascinare in verticale (Maiusc per la regolazione fine), rotella, doppio clic
 *  per tornare al valore predefinito. Mossa da una curva, l'indice e il numero vanno al valore
 *  che si sente e un arco unisce la manopola a lì. */
class Knob implements ParamControl {
  readonly element = Object.assign(document.createElement('div'), { className: 'knob', tabIndex: 0 });
  private readonly valueArc = svg('path', { class: 'knob-value' });
  private readonly autoArc = svg('path', { class: 'knob-auto' });
  private readonly pointer = svg('line', { class: 'knob-pointer', x1: '20', y1: '20', x2: '20', y2: '7' });
  private readonly readout = Object.assign(document.createElement('div'), { className: 'knob-readout' });
  private value: number;
  private offset = 0;

  constructor(private readonly spec: NumberParam, value: number, private readonly onChange: ParamChange) {
    this.value = value;
    const face = svg('svg', { viewBox: '0 0 40 40', class: 'knob-face' });
    face.append(svg('path', { class: 'knob-track', d: arc(-SWEEP / 2, SWEEP / 2) }), this.valueArc, this.autoArc, this.pointer);
    this.element.append(face, this.readout, Object.assign(document.createElement('div'), { className: 'knob-label', textContent: spec.label }));
    this.element.title = `${spec.label}: doppio clic per il valore predefinito`;
    this.bind();
    this.render();
  }

  set(value: number): void {
    if (value === this.value) return;
    this.value = value;
    this.render();
  }

  modulate(offset: number): void {
    offset = offsetOf(offset);
    if (offset === this.offset) return;
    this.offset = offset;
    this.render();
  }

  private change(unit: number, final: boolean): void {
    const v = paramFromUnit(this.spec, unit);
    if (v !== this.value || final) {
      this.value = v;
      this.render();
      this.onChange(v, final);
    }
  }

  private bind(): void {
    const el = this.element;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      let lastY = e.clientY, unit = paramToUnit(this.spec, this.value), moved = false;
      const move = (m: PointerEvent) => {
        moved = true;
        unit = Math.max(0, Math.min(1, unit + ((lastY - m.clientY) / 180) * (m.shiftKey ? 0.1 : 1)));
        lastY = m.clientY;
        this.change(unit, false);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.classList.remove('active');
        if (moved) this.onChange(this.value, true);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
      el.addEventListener('pointercancel', up, { once: true });
    });
    el.addEventListener('dblclick', () => this.change(paramToUnit(this.spec, this.spec.default), true));
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const unit = paramToUnit(this.spec, this.value) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02);
      this.change(unit, true);
    }, { passive: false });
  }

  private render(): void {
    const unit = paramToUnit(this.spec, this.value), heard = Math.max(0, Math.min(1, unit + this.offset));
    const deg = -SWEEP / 2 + unit * SWEEP;
    // con un minimo negativo (es. inviluppo −100..100) l'arco parte dallo zero
    const zero = this.spec.min < 0 && this.spec.max > 0 ? -SWEEP / 2 + paramToUnit(this.spec, 0) * SWEEP : -SWEEP / 2;
    this.valueArc.setAttribute('d', deg >= zero ? arc(zero, Math.max(zero + 0.01, deg)) : arc(deg, zero));
    const moved = heard !== unit;
    this.element.classList.toggle('automated', moved);
    this.autoArc.setAttribute('d', moved ? knobArc(unit, heard, R) : '');
    this.pointer.setAttribute('transform', `rotate(${-SWEEP / 2 + heard * SWEEP} 20 20)`);
    this.readout.textContent = formatParam(this.spec, moved ? paramFromUnit(this.spec, heard) : this.value);
  }
}

/** Scelta tra poche opzioni: pulsanti affiancati. Mossa da una curva, si segna anche l'opzione
 *  che si sente. */
class Choice implements ParamControl {
  readonly element = Object.assign(document.createElement('div'), { className: 'choice' });
  private readonly buttons: HTMLButtonElement[];
  private value = 0;
  private offset = 0;

  constructor(private readonly spec: ChoiceParam, value: number, onChange: ParamChange) {
    this.buttons = spec.options.map((o, i) => Object.assign(document.createElement('button'), {
      textContent: o, onclick: () => { this.set(i); onChange(i, true); },
    }));
    const group = Object.assign(document.createElement('div'), { className: 'choice-buttons' });
    group.append(...this.buttons);
    this.element.append(group, Object.assign(document.createElement('div'), { className: 'knob-label', textContent: spec.label }));
    this.set(clampParam(spec, value));
  }

  set(value: number): void {
    this.value = value;
    this.render();
  }

  modulate(offset: number): void {
    offset = offsetOf(offset);
    if (offset === this.offset) return;
    this.offset = offset;
    this.render();
  }

  private render(): void {
    const heard = heardOption(this.spec, this.value, this.offset);
    this.buttons.forEach((b, i) => {
      b.classList.toggle('on', i === this.value);
      b.classList.toggle('heard', i === heard && heard !== this.value);
    });
  }
}

/** L'opzione che si sente con la scelta `value` spostata di `offset` (come la calcola il motore). */
const heardOption = (spec: ChoiceParam, value: number, offset: number) =>
  (offset ? paramFromUnit(spec, paramToUnit(spec, value) + offset) : value);

/** Scelta tra molte opzioni (es. le divisioni del delay): un menu a tendina. Mossa da una curva,
 *  mostra l'opzione che si sente. */
class ChoiceMenu implements ParamControl {
  readonly element = Object.assign(document.createElement('div'), { className: 'choice' });
  private readonly select = document.createElement('select');
  private value = 0;
  private offset = 0;

  constructor(private readonly spec: ChoiceParam, value: number, onChange: ParamChange) {
    this.select.append(...spec.options.map((o, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: o })));
    this.select.onchange = () => onChange(Number(this.select.value), true);
    this.element.append(this.select, Object.assign(document.createElement('div'), { className: 'knob-label', textContent: spec.label }));
    this.set(clampParam(spec, value));
  }

  set(value: number): void {
    this.value = value;
    this.render();
  }

  modulate(offset: number): void {
    offset = offsetOf(offset);
    if (offset === this.offset) return;
    this.offset = offset;
    this.render();
  }

  private render(): void {
    const heard = heardOption(this.spec, this.value, this.offset);
    this.select.value = String(heard);
    this.select.classList.toggle('automated', heard !== this.value);
  }
}

/** Oltre questo numero di opzioni una scelta diventa un menu. */
const MAX_BUTTONS = 4;

/** Il controllo per ogni tipo di parametro: un tipo nuovo è una riga nuova. */
const MAKERS: { readonly [K in ParamSpec['kind']]: (spec: Extract<ParamSpec, { kind: K }>, value: number, onChange: ParamChange) => ParamControl } = {
  number: (s, v, c) => new Knob(s, v, c),
  choice: (s, v, c) => (s.options.length > MAX_BUTTONS ? new ChoiceMenu(s, v, c) : new Choice(s, v, c)),
};

/** Il controllo porta l'id del parametro in `data-param`: da lì la catena lo mappa sulle macro
 *  (anche nei pannelli grafici). Con `menu` una scelta è sempre un menu a tendina (dove i
 *  pulsanti non ci stanno). */
export function controlFor(spec: ParamSpec, value: number, onChange: ParamChange, options: { readonly menu?: boolean } = {}): ParamControl {
  const control = options.menu && spec.kind === 'choice' ? new ChoiceMenu(spec, value, onChange)
    : (MAKERS[spec.kind] as (s: ParamSpec, v: number, c: ParamChange) => ParamControl)(spec, value, onChange);
  control.element.dataset.param = spec.id;
  return registerControl(control);
}

/** Attenua un controllo che con i valori attuali non conta (es. i ms con il delay a tempo). */
export const setActive = (control: ParamControl, active: boolean): void => {
  control.element.classList.toggle('inactive', !active);
};
