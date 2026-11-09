/* Parameter controls: a knob for numbers, buttons or a menu for choices.
 * They're born from the parameter's description, so each device has its interface without
 * writing it. */
import { clampParam, formatParam, paramFromUnit, paramToUnit, type ChoiceParam, type NumberParam, type ParamSpec } from '../../devices/params';

/** `final` is true at the end of a gesture (release, click): it closes the undo step. */
export type ParamChange = (value: number, final: boolean) => void;

export interface ParamControl {
  readonly element: HTMLElement;
  set(value: number): void;
  /** The offset of a playing curve, in fractions of the travel (0: none): the control
   *  shows the value that's heard, the knob stays where it is. */
  modulate?(offset: number): void;
}

/** The controls by element, for whoever finds the parameters from their `data-param` (the curves). */
const CONTROLS = new WeakMap<Element, ParamControl>();

/** An element's control, if it is one. */
export const controlOf = (element: Element): ParamControl | undefined => CONTROLS.get(element);

/** Makes the control findable from its element (see controlOf). */
export function registerControl<C extends ParamControl>(control: C): C {
  CONTROLS.set(control.element, control);
  return control;
}

/** Below this offset a curve isn't shown. */
const NO_OFFSET = 1e-4;
const offsetOf = (offset: number) => (Math.abs(offset) < NO_OFFSET ? 0 : offset);

const SVG = 'http://www.w3.org/2000/svg';
/** The knob covers 270°, from −135° (minimum) to +135° (maximum). */
const SWEEP = 270, R = 15;

function arc(fromDeg: number, toDeg: number, r = R): string {
  const pt = (d: number) => {
    const a = ((d - 90) * Math.PI) / 180;
    return `${20 + r * Math.cos(a)} ${20 + r * Math.sin(a)}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${pt(fromDeg)} A ${r} ${r} 0 ${large} 1 ${pt(toDeg)}`;
}

/** An arc around the knob between two positions of its travel (0…1), at radius `r` (the
 *  face is 40×40): for example a modulation's ring. */
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

/** Knob: drag vertically (Shift for fine adjustment), wheel, double click
 *  to go back to the default value. Moved by a curve, the pointer and the number go to the value
 *  that's heard and an arc joins the knob to there. */
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
    this.element.title = `${spec.label}: double click for the default value`;
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
    // with a negative minimum (e.g. envelope −100..100) the arc starts from zero
    const zero = this.spec.min < 0 && this.spec.max > 0 ? -SWEEP / 2 + paramToUnit(this.spec, 0) * SWEEP : -SWEEP / 2;
    this.valueArc.setAttribute('d', deg >= zero ? arc(zero, Math.max(zero + 0.01, deg)) : arc(deg, zero));
    const moved = heard !== unit;
    this.element.classList.toggle('automated', moved);
    this.autoArc.setAttribute('d', moved ? knobArc(unit, heard, R) : '');
    this.pointer.setAttribute('transform', `rotate(${-SWEEP / 2 + heard * SWEEP} 20 20)`);
    this.readout.textContent = formatParam(this.spec, moved ? paramFromUnit(this.spec, heard) : this.value);
  }
}

/** Choice among few options: buttons side by side. Moved by a curve, the option
 *  that's heard is also marked. */
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

/** The option heard with choice `value` moved by `offset` (as the engine computes it). */
const heardOption = (spec: ChoiceParam, value: number, offset: number) =>
  (offset ? paramFromUnit(spec, paramToUnit(spec, value) + offset) : value);

/** Choice among many options (e.g. the delay's divisions): a drop-down menu. Moved by a curve,
 *  it shows the option that's heard. */
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

/** Beyond this number of options a choice becomes a menu. */
const MAX_BUTTONS = 4;

/** The control for each parameter type: a new type is a new line. */
const MAKERS: { readonly [K in ParamSpec['kind']]: (spec: Extract<ParamSpec, { kind: K }>, value: number, onChange: ParamChange) => ParamControl } = {
  number: (s, v, c) => new Knob(s, v, c),
  choice: (s, v, c) => (s.options.length > MAX_BUTTONS ? new ChoiceMenu(s, v, c) : new Choice(s, v, c)),
};

/** The control carries the parameter's id in `data-param`: from there the chain maps it to the macros
 *  (also in the graphic panels). With `menu` a choice is always a drop-down menu (where the
 *  buttons don't fit). */
export function controlFor(spec: ParamSpec, value: number, onChange: ParamChange, options: { readonly menu?: boolean } = {}): ParamControl {
  const control = options.menu && spec.kind === 'choice' ? new ChoiceMenu(spec, value, onChange)
    : (MAKERS[spec.kind] as (s: ParamSpec, v: number, c: ParamChange) => ParamControl)(spec, value, onChange);
  control.element.dataset.param = spec.id;
  return registerControl(control);
}

/** Dims a control that doesn't count with the current values (e.g. the ms with the synced delay). */
export const setActive = (control: ParamControl, active: boolean): void => {
  control.element.classList.toggle('inactive', !active);
};
