/* Il pannello dei modulatori (LFO e Inviluppo), fatto con i pezzi di Prisma: la forma da
 * disegnare o l'inviluppo con le maniglie, le manopole, e le destinazioni. Il pallino in alto
 * ("⊕ Mappa") si trascina su una manopola qualsiasi della catena (anche di un altro dispositivo,
 * o una macro di un rack) e la destinazione nasce lì; il menu di una riga dà anche volume e pan
 * della traccia. Si vedono le destinazioni usate e una libera. Ogni riga ha la quantità (un cursore, che si può mappare su una macro e muovere
 * con le curve, come le manopole) e la × per toglierla. */
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

/** La quantità di una destinazione appena creata, se la sua era a zero. */
const NEW_AMOUNT = 50;

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

  constructor(private readonly ctx: DisplayContext) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const set = (values: ParamValues, final: boolean) => ctx.setParams(values, final);
    const envelope = ctx.type.type === 'envelope';
    this.family = envelope ? 'env' : 'lfo';
    let shape: HTMLElement;
    if (envelope) {
      this.envView = new EnvView(() => this.values, set, () => '', true);
      shape = this.card([this.title('Inviluppo')],
        this.envView.canvas,
        this.row('e1A', 'e1H', 'e1D', 'e1S', 'e1R', 'e1Ac', 'e1Dc', 'e1Rc'),
        this.row(this.menu('trig'), 'division', 'gate', 'vel', 'depth', 'pol'));
    } else {
      this.lfoEditor = new LfoEditor(() => this.values, set);
      shape = this.card([this.title('Forma'), this.menu('l1Shape'), el('span', { className: 'prisma-spacer' }), this.lfoEditor.gridSelect, this.lfoEditor.menuButton],
        this.lfoEditor.canvas,
        this.row('sync', 'division', 'rate', this.menu('trig'), 'phase', 'delay', 'rise', 'depth', 'pol'));
    }
    const list = el('div', { className: 'mod-links' });
    for (let n = 1; n <= MOD_LINKS; n++) list.append(this.linkRow(n));
    this.head = el('div', { className: 'prisma-chips' }, this.chip());
    this.element.append(el('div', { className: 'prisma-page' }, shape, this.card([this.title('Destinazioni')], list)));
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

  /** Nel menu di una quantità: togliere la sua destinazione. */
  menuFor(param: string): MenuItem[] {
    const slot = this.slotOfAmount(param);
    return slot !== null && this.targets[slot] ? [{ label: 'Togli la destinazione', run: () => this.host?.set(slot, null) }] : [];
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

  // ---------------------------------------------------------------- destinazioni

  /** Le destinazioni usate e la prima libera (le altre libere si nascondono: occupano posto). */
  private showTargets(): void {
    const free = this.rows.findIndex((_, i) => !this.targets[i]);
    this.rows.forEach((row, i) => {
      const t = this.targets[i] ?? null;
      row.element.classList.toggle('empty', !t);
      row.element.hidden = !t && i !== free;
      row.name.textContent = t ? this.host?.label(t) ?? '?' : '—';
      row.name.title = t ? row.name.textContent : 'Libera: trascina ⊕ Mappa su una manopola, o scegli dal menu ▾';
    });
    const used = this.targets.filter(t => t).length;
    const count = this.head.querySelector('.prisma-chip-count');
    if (count) count.textContent = used ? String(used) : '';
    this.head.querySelector('.prisma-chip')?.classList.toggle('used', used > 0);
  }

  private linkRow(n: number): HTMLElement {
    const slot = n - 1;
    const name = el('span', { className: 'mod-link-name' });
    const choose = el<HTMLButtonElement>('button', { className: 'mini', textContent: '▾', title: 'Scegli cosa muove (volume, pan, macro)' });
    choose.onclick = () => {
      const r = choose.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 2, this.choiceMenu(slot));
    };
    const clear = el<HTMLButtonElement>('button', { className: 'mini', textContent: '×', title: 'Togli la destinazione', onclick: () => this.host?.set(slot, null) });
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
      { label: 'Per un parametro: trascina ⊕ Mappa sulla sua manopola', disabled: true, run: () => {} },
      { label: 'Togli', disabled: !current, run: () => host.set(slot, null) },
    ];
  }

  /** `target` in una destinazione: quella data, quella che lo muove già, o la prima libera. */
  private assign(target: ModTarget, slot?: number): void {
    const host = this.host;
    if (!host) return;
    const existing = this.targets.findIndex(t => !!t && sameTarget(t, target));
    if (slot === undefined && existing >= 0) return host.say(`${host.label(target)}: lo muove già la destinazione ${existing + 1}`);
    let at = slot ?? -1;
    if (at < 0) for (let i = 0; i < MOD_LINKS && at < 0; i++) if (!this.targets[i]) at = i;
    if (at < 0) return host.say('Le 8 destinazioni sono tutte in uso: togline una (×) per aggiungerne un\'altra');
    host.set(at, target, this.values[linkAmount(at + 1)] ? undefined : NEW_AMOUNT);
  }

  /** "⊕ Mappa": si trascina su una manopola della catena. */
  private chip(): HTMLElement {
    const chip = el('div', { className: `prisma-chip src-${this.family}`, textContent: '⊕ Mappa', title: 'Trascina su una manopola della catena (o su una macro) per modularla' });
    chip.append(el('span', { className: 'prisma-chip-count' }));
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.host) return;
      e.preventDefault();
      chip.setPointerCapture(e.pointerId);
      const host = this.host;
      let ghost: HTMLElement | null = null, over: { target: ModTarget; element: HTMLElement } | null = null;
      const move = (m: PointerEvent) => {
        if (!ghost) {
          ghost = el('div', { className: `prisma-ghost src-${this.family}`, textContent: this.ctx.type.label });
          document.body.append(ghost);
          document.body.classList.add('dragging-modulator');
        }
        ghost.style.left = `${m.clientX + 10}px`;
        ghost.style.top = `${m.clientY + 10}px`;
        const found = host.at(m.clientX, m.clientY);
        if (found?.element !== over?.element) {
          over?.element.classList.remove('drop-target');
          found?.element.classList.add('drop-target');
        }
        over = found;
        ghost.textContent = found ? `${this.ctx.type.label} → ${host.label(found.target)}` : this.ctx.type.label;
      };
      const up = () => {
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', up);
        chip.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging-modulator');
        over?.element.classList.remove('drop-target');
        ghost?.remove();
        if (over) this.assign(over.target);
        else if (!ghost) host.say('Trascina ⊕ Mappa su una manopola della catena per modularla');
      };
      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', up);
      chip.addEventListener('pointercancel', up);
    });
    return chip;
  }

  // ---------------------------------------------------------------- mattoni

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
