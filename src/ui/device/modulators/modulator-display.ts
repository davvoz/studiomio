/* The modulators' panel (LFO and Envelope), made with Prisma's pieces: the shape to
 * draw or the envelope with the handles, the knobs, and the targets. The chip at the top
 * ("⊕ Map") chooses any knob of the chain (also of another device, or a
 * rack macro) and the target is born there: with a click it turns on and you click the knobs,
 * scrolling the chain and changing tab calmly, or you drag directly onto the
 * knob, and the chain scrolls by itself at the edges. A row's menu also gives the track's volume and pan.
 * The used targets and one free one are shown. Each row has the amount (a slider, which can be mapped to a macro and moved
 * with the curves, like the knobs) and the × to remove it. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { linkAmount, MOD_LINKS } from '../../../devices/modulators/modulators';
import type { NumberParam, ParamSpec } from '../../../devices/params';
import type { DeviceSettings, EffectSettings, ParamValues } from '../../../model/device';
import { sameTarget, type ModTarget } from '../../../model/envelope';
import { showContextMenu, SEPARATOR, type MenuItem } from '../../context-menu';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext, ModTargetHost } from '../displays';
import { EnvView } from '../prisma/env-view';
import { LfoEditor } from '../prisma/lfo-editor';
import { Slider } from '../prisma/matrix-view';

/** The amount of a just-created target, if its was at zero. */
const NEW_AMOUNT = 50;
/** After how many pixels the chip is being dragged, not clicked. */
const DRAG_START = 4;

export class ModulatorDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'prisma modulator' });
  readonly head: HTMLElement;
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec }>();
  private readonly rows: { readonly element: HTMLElement; readonly name: HTMLElement }[] = [];
  private readonly envView: EnvView | null = null;
  private readonly lfoEditor: LfoEditor | null = null;
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private targets: readonly (ModTarget | null)[] = [];
  private enabled = true;
  private readonly family: 'env' | 'lfo';
  /** The chip is on: the clicks on the chain's knobs are targets. */
  private picking = false;

  constructor(private readonly ctx: DisplayContext) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const set = (values: ParamValues, final: boolean) => ctx.setParams(values, final);
    const envelope = ctx.type.type === 'envelope';
    this.family = envelope ? 'env' : 'lfo';
    let shape: HTMLElement;
    if (envelope) {
      this.envView = new EnvView(() => this.values, set, () => '', true);
      shape = this.card([this.title('Envelope')],
        this.envView.canvas,
        this.row('e1A', 'e1H', 'e1D', 'e1S', 'e1R', 'e1Ac', 'e1Dc', 'e1Rc'),
        this.row(this.menu('trig'), 'division', 'gate', 'vel', 'depth', 'pol'));
    } else {
      this.lfoEditor = new LfoEditor(() => this.values, set);
      shape = this.card([this.title('Shape'), this.menu('l1Shape'), el('span', { className: 'prisma-spacer' }), this.lfoEditor.gridSelect, this.lfoEditor.menuButton],
        this.lfoEditor.canvas,
        this.row('sync', 'division', 'rate', this.menu('trig'), 'phase', 'delay', 'rise', 'depth', 'pol'));
    }
    const list = el('div', { className: 'mod-links' });
    for (let n = 1; n <= MOD_LINKS; n++) list.append(this.linkRow(n));
    this.head = el('div', { className: 'prisma-chips' }, this.chip());
    this.element.append(el('div', { className: 'prisma-page' }, shape, this.card([this.title('Targets')], list)));
    this.update(ctx.settings, true);
    const resized = new ResizeObserver(() => this.paint());
    for (const c of this.element.querySelectorAll('canvas')) resized.observe(c);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.targets = (settings as EffectSettings).targets ?? [];
    this.enabled = enabled;
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.showTargets();
    this.paint();
  }

  /** In an amount's menu: removing its target. */
  menuFor(param: string): MenuItem[] {
    const slot = this.slotOfAmount(param);
    return slot !== null && this.targets[slot] ? [{ label: 'Remove the target', run: () => this.host?.set(slot, null) }] : [];
  }

  private get host(): ModTargetHost | undefined {
    return this.ctx.modTargets;
  }

  private slotOfAmount(param: string): number | null {
    const m = /^a(\d)$/.exec(param);
    return m ? Number(m[1]) - 1 : null;
  }

  private paint(): void {
    this.envView?.paint(this.enabled);
    this.lfoEditor?.paint(this.enabled);
  }

  // ---------------------------------------------------------------- targets

  /** The used targets and the first free one (the other free ones are hidden: they take room). */
  private showTargets(): void {
    const free = this.rows.findIndex((_, i) => !this.targets[i]);
    this.rows.forEach((row, i) => {
      const t = this.targets[i] ?? null;
      row.element.classList.toggle('empty', !t);
      row.element.hidden = !t && i !== free;
      row.name.textContent = t ? this.host?.label(t) ?? '?' : '—';
      row.name.title = t ? row.name.textContent : 'Free: click ⊕ Map and then a knob, or choose from the ▾ menu';
    });
    const used = this.targets.filter(t => t).length;
    const count = this.head.querySelector('.prisma-chip-count');
    if (count) count.textContent = used ? String(used) : '';
    this.head.querySelector('.prisma-chip')?.classList.toggle('used', used > 0);
  }

  private linkRow(n: number): HTMLElement {
    const slot = n - 1;
    const name = el('span', { className: 'mod-link-name' });
    const choose = el<HTMLButtonElement>('button', { className: 'mini', textContent: '▾', title: 'Choose what it moves (volume, pan, macro)' });
    choose.onclick = () => {
      const r = choose.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 2, this.choiceMenu(slot));
    };
    const clear = el<HTMLButtonElement>('button', { className: 'mini', textContent: '×', title: 'Remove the target', onclick: () => this.host?.set(slot, null) });
    const element = el('div', { className: 'prisma-row mod-link' },
      el('span', { className: 'prisma-row-n', textContent: String(n) }), name, this.slider(linkAmount(n)).element, choose, clear);
    this.rows.push({ element, name });
    return element;
  }

  private choiceMenu(slot: number): MenuItem[] {
    const host = this.host;
    if (!host) return [];
    const current = this.targets[slot] ?? null;
    const items: MenuItem[] = host.choices().map(c => ({
      label: c.label, checked: !!current && sameTarget(current, c.target), run: () => this.assign(c.target, slot),
    }));
    return [
      ...items,
      ...(items.length ? [SEPARATOR] : []),
      { label: 'For a parameter: click ⊕ Map, then its knob', disabled: true, run: () => {} },
      { label: 'Remove', disabled: !current, run: () => host.set(slot, null) },
    ];
  }

  /** `target` in a target slot: the given one, the one already moving it, or the first free one. It says
   *  whether it became a new target. */
  private assign(target: ModTarget, slot?: number): boolean {
    const host = this.host;
    if (!host) return false;
    const existing = this.targets.findIndex(t => !!t && sameTarget(t, target));
    if (slot === undefined && existing >= 0) {
      host.say(`${host.label(target)}: target ${existing + 1} already moves it`);
      return false;
    }
    let at = slot ?? -1;
    if (at < 0) for (let i = 0; i < MOD_LINKS && at < 0; i++) if (!this.targets[i]) at = i;
    if (at < 0) {
      host.say('All 8 targets are in use: remove one (×) to add another');
      return false;
    }
    host.set(at, target, this.values[linkAmount(at + 1)] ? undefined : NEW_AMOUNT);
    return true;
  }

  private startPicking(chip: HTMLElement, host: ModTargetHost): void {
    this.picking = true;
    chip.classList.add('active');
    host.startPicking(target => {
      if (this.assign(target)) host.say(`${this.ctx.type.label} → ${host.label(target)}. Click other knobs, Esc to finish.`);
    }, () => {
      this.picking = false;
      chip.classList.remove('active');
    });
  }

  /** "⊕ Map": a click turns on the choice of knobs, a drag takes one. */
  private chip(): HTMLElement {
    const chip = el('div', { className: `prisma-chip src-${this.family}`, textContent: '⊕ Map', title: 'Click, then click the knobs to modulate (also on other devices and other tabs); Esc to finish. Or drag onto a knob' });
    chip.append(el('span', { className: 'prisma-chip-count' }));
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.host) return;
      e.preventDefault();
      chip.setPointerCapture(e.pointerId);
      const host = this.host;
      const wasPicking = this.picking;
      let ghost: HTMLElement | null = null, over: { target: ModTarget; element: HTMLElement } | null = null;
      let x = e.clientX, y = e.clientY, frame = 0;
      const startX = x, startY = y;
      // at every frame: the chain scrolls under the still pointer, the target changes
      const tick = () => {
        host.scrollToward(x);
        hover();
        frame = requestAnimationFrame(tick);
      };
      const move = (m: PointerEvent) => {
        x = m.clientX;
        y = m.clientY;
        if (!ghost) {
          if (Math.hypot(x - startX, y - startY) < DRAG_START) return;
          ghost = el('div', { className: `prisma-ghost src-${this.family}`, textContent: this.ctx.type.label });
          document.body.append(ghost);
          document.body.classList.add('dragging-modulator');
          if (!wasPicking) this.startPicking(chip, host);
          tick();
        }
        ghost.style.left = `${x + 10}px`;
        ghost.style.top = `${y + 10}px`;
      };
      const hover = () => {
        const found = host.at(x, y);
        if (found?.element !== over?.element) {
          over?.element.classList.remove('drop-target');
          found?.element.classList.add('drop-target');
        }
        over = found;
        ghost!.textContent = found ? `${this.ctx.type.label} → ${host.label(found.target)}` : this.ctx.type.label;
      };
      const up = () => {
        cancelAnimationFrame(frame);
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', up);
        chip.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging-modulator');
        over?.element.classList.remove('drop-target');
        ghost?.remove();
        if (over) this.assign(over.target);
        // a drag leaves everything as it was, a click turns on or off
        if (ghost ? !wasPicking : wasPicking) return host.stopPicking();
        if (ghost) return;
        this.startPicking(chip, host);
        host.say('Click the knobs to modulate, also on other devices and other tabs; the wheel scrolls the chain. Esc to finish.');
      };
      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', up);
      chip.addEventListener('pointercancel', up);
    });
    return chip;
  }

  // ---------------------------------------------------------------- building blocks

  private card(head: readonly Node[], ...body: Node[]): HTMLElement {
    return el('div', { className: 'prisma-card' }, el('div', { className: 'prisma-card-head' }, ...head), ...body);
  }

  private title(text: string): HTMLElement {
    return el('span', { className: 'prisma-card-title', textContent: text });
  }

  private row(...items: (string | HTMLElement)[]): HTMLElement {
    return el('div', { className: 'device-controls prisma-knobs' }, ...items.map(i => (typeof i === 'string' ? this.control(i) : i)));
  }

  private control(id: string, options: { readonly menu?: boolean } = {}): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final), options);
    this.controls.set(id, { control, spec });
    return control.element;
  }

  private menu(id: string): HTMLElement {
    return this.control(id, { menu: true });
  }

  private slider(id: string): Slider {
    const spec = paramSpec(this.ctx.type, id) as NumberParam;
    const s = new Slider(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final));
    this.controls.set(id, { control: s, spec });
    return s;
  }
}
