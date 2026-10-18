/* Il pannello di Prisma, diviso in pagine come Serum: gli oscillatori (con le tabelle disegnate,
 * sub, rumore, filtri e percorsi), i modulatori (inviluppi e LFO da disegnare, macro, voce) e
 * la matrice. In alto, sempre a portata, le fonti delle modulazioni: una fonte trascinata su una
 * manopola crea la modulazione in un posto libero della matrice; un clic la sceglie, e allora
 * Alt+trascina su una manopola ne regola la quantità. Attorno alle manopole modulate un anello
 * mostra dove arrivano (il colore dice da che fonte), e il tasto destro su una manopola le
 * elenca per toglierle. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import {
  destinationOf, isEnvSource, isLfoSource, MOD_SLOTS, OSCS, PRISMA_TABLES, slotParam, SOURCES, SRC, tableSlot, USER_TABLE, type OscKey,
} from '../../../devices/instruments/prisma/prisma';
import { paramToUnit, type NumberParam, type ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import type { MenuItem } from '../../context-menu';
import { el } from '../../dom';
import { controlFor, knobArc, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';
import { EnvView } from './env-view';
import { LfoEditor } from './lfo-editor';
import { MatrixView, Slider } from './matrix-view';
import { builtInFrames, importedFrames, TableView, type Frames } from './table-view';

const PAGES = ['Oscillatori', 'Modulatori', 'Matrice'] as const;
const MATRIX_PAGE = 2;
/** Quanto vale una modulazione appena creata trascinando una fonte. */
const NEW_AMOUNT = 25;
const SVG = 'http://www.w3.org/2000/svg';
/** Il raggio degli anelli delle modulazioni (la faccia della manopola è 40×40). */
const RING = 18.6;

/** Le fonti trascinabili, con un nome corto e la famiglia (per il colore). */
const CHIPS: readonly { readonly src: number; readonly label: string }[] = [
  ...[1, 2, 3, 4].map(n => ({ src: SRC.env1 + n - 1, label: `Env ${n}` })),
  ...[1, 2, 3, 4].map(n => ({ src: SRC.lfo1 + n - 1, label: `LFO ${n}` })),
  { src: SRC.velocity, label: 'Vel' }, { src: SRC.note, label: 'Nota' }, { src: SRC.random, label: 'Cas' }, { src: SRC.gate, label: 'Gate' },
  ...[1, 2, 3, 4].map(n => ({ src: SRC.macro1 + n - 1, label: `M${n}` })),
];

export const sourceFamily = (src: number): string =>
  isEnvSource(src) ? 'env' : isLfoSource(src) ? 'lfo' : src >= SRC.macro1 ? 'macro' : 'key';

/** Cosa si stava guardando (resta fra un pannello e l'altro, anche quando si ricostruisce). */
const view = { page: 0, env: 1, lfo: 1 };

interface Modulation {
  readonly slot: number;
  readonly src: number;
  readonly amount: number;
  readonly bipolar: boolean;
}

export class PrismaDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'prisma' });
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec }>();
  private readonly rings = new Map<string, SVGGElement>();
  private readonly tables: { osc: OscKey; view: TableView }[] = [];
  private readonly pageTabs: HTMLButtonElement[] = [];
  private readonly pages: HTMLElement[] = [];
  private readonly chips = new Map<number, HTMLElement>();
  private readonly envTabs: HTMLButtonElement[] = [];
  private readonly envRows: HTMLElement[] = [];
  private readonly lfoTabs: HTMLButtonElement[] = [];
  private readonly lfoRows: HTMLElement[] = [];
  private readonly envView: EnvView;
  private readonly lfoEditor: LfoEditor;
  private readonly matrix: MatrixView;
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private settings: DeviceSettings;
  private enabled = true;
  /** La fonte scelta con un clic: la sua quantità si regola con Alt+trascina sulle manopole. */
  private active: number | null = null;

  constructor(private readonly ctx: DisplayContext) {
    this.settings = ctx.settings;
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const set = (values: ParamValues, final: boolean) => ctx.setParams(values, final);
    this.envView = new EnvView(() => this.values, set);
    this.lfoEditor = new LfoEditor(() => this.values, set);
    this.matrix = new MatrixView({ values: () => this.values, set, slider: (id, label) => this.slider(id, label) });

    const top = el('div', { className: 'prisma-top' },
      el('div', { className: 'prisma-tabs' }, ...PAGES.map((label, i) => {
        const b = el<HTMLButtonElement>('button', { className: 'mini', textContent: label, onclick: () => this.showPage(i) });
        this.pageTabs.push(b);
        return b;
      })),
      el('div', { className: 'prisma-chips', title: 'Trascina una fonte su una manopola per modularla · clic: sceglila, poi Alt+trascina su una manopola per la quantità' },
        ...CHIPS.map(c => this.chip(c.src, c.label))));
    this.pages.push(this.oscPage(), this.modPage(), el('div', { className: 'prisma-page' }, this.matrix.element));
    this.element.append(top, ...this.pages);
    this.bindAltDrag();
    this.showPage(view.page);
    this.update(ctx.settings, true);
    const resized = new ResizeObserver(() => this.paint());
    for (const c of this.element.querySelectorAll('canvas')) resized.observe(c);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.settings = settings;
    this.enabled = enabled;
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.matrix.update(this.values);
    this.paintRings();
    this.paint();
  }

  /** Nel menu di una manopola: le sue modulazioni, da togliere, e la fonte scelta da aggiungere. */
  menuFor(param: string): MenuItem[] {
    const d = destinationOf(param);
    if (!d) return [];
    const mods = this.modulations().filter(m => this.values[slotParam(m.slot, 'Dst')] === d);
    const items: MenuItem[] = mods.map(m => ({
      label: `Togli ${SOURCES[m.src]} (${m.amount > 0 ? '+' : ''}${m.amount} %${m.bipolar ? ', bi' : ''})`,
      run: () => this.clearSlot(m.slot),
    }));
    const active = this.active;
    if (active !== null && !mods.some(m => m.src === active)) items.unshift({ label: `Modula con ${SOURCES[active]}`, run: () => this.assign(active, param) });
    if (mods.length) items.push({ label: 'Mostra nella matrice', run: () => this.showPage(MATRIX_PAGE) });
    return items;
  }

  // ---------------------------------------------------------------- pagine

  private oscPage(): HTMLElement {
    return el('div', { className: 'prisma-page prisma-osc-page' },
      ...OSCS.map(o => this.oscCard(o)),
      el('div', { className: 'prisma-col' },
        this.card([this.power('subOn'), this.title('Sub'), this.route('subRoute')], this.row(this.menu('subShape'), 'subOct', 'subLevel', 'subPan')),
        this.card([this.power('nOn'), this.title('Rumore'), this.route('nRoute')], this.row(this.menu('nType'), 'nTone', 'nLevel', 'nPan'))),
      el('div', { className: 'prisma-col' }, this.filterCard(1), this.filterCard(2)));
  }

  /** Dove va il suono di una sorgente (un filtro, tutti e due, o diretto), nella sua intestazione. */
  private route(id: string): HTMLElement {
    const e = this.menu(id);
    e.classList.add('prisma-route');
    e.title = "Dove va il suono: in un filtro, in tutti e due, o diretto all'uscita";
    return e;
  }

  private modPage(): HTMLElement {
    const envCard = this.card(
      [el('div', { className: 'prisma-subtabs' }, ...[1, 2, 3, 4].map(n => {
        const b = el<HTMLButtonElement>('button', { className: 'mini', textContent: n === 1 ? 'Env 1 · vol' : `Env ${n}`, onclick: () => this.showEnv(n) });
        this.envTabs.push(b);
        return b;
      }))],
      this.envView.canvas,
      ...[1, 2, 3, 4].map(n => {
        const r = this.row(`e${n}A`, `e${n}H`, `e${n}D`, `e${n}S`, `e${n}R`, `e${n}Ac`, `e${n}Dc`, `e${n}Rc`);
        this.envRows.push(r);
        return r;
      }));
    const lfoCard = this.card(
      [el('div', { className: 'prisma-subtabs' }, ...[1, 2, 3, 4].map(n => {
        const b = el<HTMLButtonElement>('button', { className: 'mini', textContent: `LFO ${n}`, onclick: () => this.showLfo(n) });
        this.lfoTabs.push(b);
        return b;
      })), el('span', { className: 'prisma-spacer' }), this.lfoEditor.gridSelect, this.lfoEditor.menuButton],
      this.lfoEditor.canvas,
      ...[1, 2, 3, 4].map(n => {
        const r = this.row(this.menu(`l${n}Shape`), `l${n}Sync`, `l${n}Div`, `l${n}Rate`, this.menu(`l${n}Trig`), `l${n}Phase`, `l${n}Delay`, `l${n}Rise`, `l${n}Smooth`);
        this.lfoRows.push(r);
        return r;
      }));
    this.showEnv(view.env);
    this.showLfo(view.lfo);
    return el('div', { className: 'prisma-page prisma-mod-page' }, envCard, lfoCard,
      el('div', { className: 'prisma-col' },
        this.card([this.title('Macro')], this.row('macro1', 'macro2', 'macro3', 'macro4')),
        this.card([this.title('Voce')], this.row('voiceMode', 'glide', 'tune', 'volume'))));
  }

  private oscCard(o: OscKey): HTMLElement {
    const table = new TableView(o, () => this.values, (v, final) => this.ctx.setParams(v, final), () => this.framesOf(o), file => this.importTable(o, file));
    this.tables.push({ osc: o, view: table });
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Importa…', title: 'Usa un file WAV come tabella (un periodo ogni 2048 campioni, come i file di Serum)' });
    load.hidden = !this.ctx.samples;
    load.onclick = () => {
      const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*,.wav' });
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) this.importTable(o, file);
      };
      input.click();
    };
    return this.card([this.power(`${o}On`), this.title(`Osc ${o.toUpperCase()}`), this.menu(`${o}Table`), load, el('span', { className: 'prisma-spacer' }), this.route(`${o}Route`)],
      table.canvas,
      this.row(`${o}Pos`, this.menu(`${o}Warp`), `${o}WarpAmt`, `${o}Oct`, `${o}Semi`, `${o}Fine`, `${o}Level`, `${o}Pan`),
      this.row(`${o}Unison`, `${o}Detune`, `${o}Blend`, `${o}Width`, `${o}Spread`, `${o}Phase`, `${o}Rand`));
  }

  private filterCard(f: 1 | 2): HTMLElement {
    const p = `f${f}`;
    // il secondo filtro dice come sta con il primo: dopo (in serie) o accanto (in parallelo)
    const mode = f === 2 ? [el('span', { className: 'prisma-spacer' }), this.menu('fMode')] : [];
    return this.card([this.power(`${p}On`), this.title(`Filtro ${f}`), this.menu(`${p}Type`), ...mode],
      this.row(`${p}Cutoff`, `${p}Res`, `${p}Drive`, `${p}Var`, `${p}Key`, `${p}Mix`));
  }

  private showPage(i: number): void {
    view.page = i;
    this.pages.forEach((p, j) => { p.hidden = j !== i; });
    this.pageTabs.forEach((b, j) => b.classList.toggle('on', j === i));
    this.paint();
  }

  private showEnv(n: number): void {
    view.env = n;
    this.envTabs.forEach((b, i) => b.classList.toggle('on', i + 1 === n));
    this.envRows.forEach((r, i) => { r.hidden = i + 1 !== n; });
    this.envView.show(n);
  }

  private showLfo(n: number): void {
    view.lfo = n;
    this.lfoTabs.forEach((b, i) => b.classList.toggle('on', i + 1 === n));
    this.lfoRows.forEach((r, i) => { r.hidden = i + 1 !== n; });
    this.lfoEditor.show(n);
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

  private register(id: string, control: ParamControl): void {
    this.controls.set(id, { control, spec: paramSpec(this.ctx.type, id)! });
  }

  private control(id: string, options: { readonly menu?: boolean } = {}): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final), options);
    this.register(id, control);
    return control.element;
  }

  private menu(id: string): HTMLElement {
    return this.control(id, { menu: true });
  }

  private slider(id: string, label = ''): Slider {
    const spec = paramSpec(this.ctx.type, id) as NumberParam;
    const s = new Slider(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final), label);
    this.register(id, s);
    return s;
  }

  /** Acceso/spento di una sezione, un pulsante nell'intestazione. */
  private power(id: string): HTMLElement {
    const b = el<HTMLButtonElement>('button', { className: 'mini prisma-power', textContent: '⏻', title: 'Accendi/spegni' });
    b.dataset.param = id;
    b.onclick = () => this.ctx.setParams({ [id]: this.values[id] === 1 ? 0 : 1 }, true);
    this.register(id, { element: b, set: v => b.classList.toggle('on', v === 1) });
    return b;
  }

  // ---------------------------------------------------------------- tabelle

  private framesOf(o: OscKey): Frames {
    const table = this.values[`${o}Table`];
    if (table !== USER_TABLE) return builtInFrames(table);
    const audio = this.ctx.samples?.audio?.(tableSlot(o));
    return audio ? importedFrames(audio) : builtInFrames(0);
  }

  private tableName(o: OscKey): string {
    const table = this.values[`${o}Table`];
    if (table !== USER_TABLE) return PRISMA_TABLES[table] ?? '';
    const id = sampleAt(this.settings, tableSlot(o));
    return (id && this.ctx.samples?.list().find(s => s.id === id)?.name) || PRISMA_TABLES[USER_TABLE];
  }

  private importTable(o: OscKey, file: File): void {
    this.ctx.samples?.load(tableSlot(o), file, { [`${o}Table`]: USER_TABLE }).catch(e => console.error('tabella non importata', e));
  }

  // ---------------------------------------------------------------- modulazioni

  /** I posti della matrice in uso. */
  private modulations(): Modulation[] {
    const v = this.values, out: Modulation[] = [];
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const src = v[slotParam(n, 'Src')], dst = v[slotParam(n, 'Dst')];
      if (src > 0 && dst > 0) out.push({ slot: n, src, amount: v[slotParam(n, 'Amt')], bipolar: v[slotParam(n, 'Pol')] === 1 });
    }
    return out;
  }

  /** Un posto per `src` → `param`: quello che c'è già, o il primo libero (null: matrice piena). */
  private slotFor(src: number, param: string): { slot: number; fresh: boolean } | null {
    const v = this.values, d = destinationOf(param);
    for (let n = 1; n <= MOD_SLOTS; n++) if (v[slotParam(n, 'Src')] === src && v[slotParam(n, 'Dst')] === d) return { slot: n, fresh: false };
    for (let n = 1; n <= MOD_SLOTS; n++) if (!v[slotParam(n, 'Src')] || !v[slotParam(n, 'Dst')]) return { slot: n, fresh: true };
    return null;
  }

  /** I valori di un posto nuovo: gli LFO partono bipolari (girano attorno alla manopola). */
  private slotValues(slot: number, src: number, param: string, amount: number): ParamValues {
    const p = (f: Parameters<typeof slotParam>[1]) => slotParam(slot, f);
    return { [p('Src')]: src, [p('Dst')]: destinationOf(param), [p('Amt')]: amount, [p('Pol')]: isLfoSource(src) ? 1 : 0, [p('Curve')]: 0, [p('Aux')]: 0 };
  }

  private assign(src: number, param: string): void {
    if (!destinationOf(param)) return;
    const at = this.slotFor(src, param);
    if (!at) return this.full();
    if (at.fresh) this.ctx.setParams(this.slotValues(at.slot, src, param, NEW_AMOUNT), true);
    this.setActiveSource(src);
  }

  private clearSlot(n: number): void {
    const p = (f: Parameters<typeof slotParam>[1]) => slotParam(n, f);
    this.ctx.setParams({ [p('Src')]: 0, [p('Dst')]: 0, [p('Amt')]: 0, [p('Pol')]: 0, [p('Curve')]: 0, [p('Aux')]: 0 }, true);
  }

  /** La matrice è piena: la scheda lampeggia. */
  private full(): void {
    const tab = this.pageTabs[MATRIX_PAGE];
    tab.classList.add('full');
    tab.title = 'La matrice è piena: svuota un posto per aggiungere una modulazione';
    setTimeout(() => tab.classList.remove('full'), 1500);
  }

  private setActiveSource(src: number | null): void {
    this.active = src;
    for (const [s, chip] of this.chips) chip.classList.toggle('active', s === src);
    this.element.classList.toggle('has-active', src !== null);
    this.paintRings();
  }

  /** Una fonte da trascinare su una manopola (o da scegliere con un clic). */
  private chip(src: number, label: string): HTMLElement {
    const chip = el('div', { className: `prisma-chip src-${sourceFamily(src)}`, textContent: label });
    chip.append(el('span', { className: 'prisma-chip-count' }));
    this.chips.set(src, chip);
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      chip.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY;
      let ghost: HTMLElement | null = null, target: HTMLElement | null = null;
      const move = (m: PointerEvent) => {
        if (!ghost && Math.hypot(m.clientX - x0, m.clientY - y0) > 4) {
          ghost = el('div', { className: `prisma-ghost src-${sourceFamily(src)}`, textContent: label });
          document.body.append(ghost);
          this.element.classList.add('dragging-source');
        }
        if (!ghost) return;
        ghost.style.left = `${m.clientX + 10}px`;
        ghost.style.top = `${m.clientY + 10}px`;
        const under = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('[data-param]') ?? null;
        const ok = under && this.element.contains(under) && destinationOf(under.dataset.param!) ? under : null;
        if (ok !== target) {
          target?.classList.remove('drop-target');
          ok?.classList.add('drop-target');
          target = ok;
        }
      };
      const up = () => {
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', up);
        chip.removeEventListener('pointercancel', up);
        this.element.classList.remove('dragging-source');
        target?.classList.remove('drop-target');
        if (!ghost) this.setActiveSource(this.active === src ? null : src);
        else {
          ghost.remove();
          if (target) this.assign(src, target.dataset.param!);
        }
      };
      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', up);
      chip.addEventListener('pointercancel', up);
    });
    return chip;
  }

  /** Con una fonte scelta, Alt+trascina su una manopola ne regola la quantità (e se serve crea
   *  il posto): un solo passo di annullamento. */
  private bindAltDrag(): void {
    this.element.addEventListener('pointerdown', e => {
      const src = this.active;
      if (!e.altKey || e.button !== 0 || src === null) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-param]'), param = target?.dataset.param;
      if (!target || !param || !destinationOf(param) || !this.element.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      const at = this.slotFor(src, param);
      if (!at) return this.full();
      const start = at.fresh ? 0 : this.values[slotParam(at.slot, 'Amt')];
      const fields = this.slotValues(at.slot, src, param, start);
      const keep = at.fresh ? fields : { [slotParam(at.slot, 'Src')]: src, [slotParam(at.slot, 'Dst')]: destinationOf(param) };
      target.setPointerCapture(e.pointerId);
      target.classList.add('mod-editing');
      const y0 = e.clientY;
      let amount = start;
      const move = (m: PointerEvent) => {
        amount = Math.round(Math.max(-100, Math.min(100, start + ((y0 - m.clientY) / 150) * 100 * (m.shiftKey ? 0.2 : 1))));
        this.ctx.setParams({ ...keep, [slotParam(at.slot, 'Amt')]: amount }, false);
      };
      const up = () => {
        target.removeEventListener('pointermove', move, true);
        target.removeEventListener('pointerup', up, true);
        target.removeEventListener('pointercancel', up, true);
        target.classList.remove('mod-editing');
        this.ctx.setParams({ ...keep, [slotParam(at.slot, 'Amt')]: amount }, true);
      };
      // in cattura: la manopola sotto non deve muoversi
      target.addEventListener('pointermove', move, true);
      target.addEventListener('pointerup', up, true);
      target.addEventListener('pointercancel', up, true);
    }, { capture: true });
  }

  /** Gli anelli attorno alle manopole modulate, e quante modulazioni ha ogni fonte. */
  private paintRings(): void {
    const mods = this.modulations(), v = this.values;
    const byDest = new Map<number, Modulation[]>();
    const uses = new Map<number, number>();
    for (const m of mods) {
      const d = v[slotParam(m.slot, 'Dst')];
      byDest.set(d, [...(byDest.get(d) ?? []), m]);
      if (m.amount) uses.set(m.src, (uses.get(m.src) ?? 0) + 1);
    }
    for (const [src, chip] of this.chips) {
      const n = uses.get(src) ?? 0;
      chip.classList.toggle('used', n > 0);
      chip.querySelector('.prisma-chip-count')!.textContent = n ? String(n) : '';
    }
    const used = mods.length;
    this.pageTabs[MATRIX_PAGE].textContent = used ? `Matrice · ${used}` : 'Matrice';
    for (const [id, { control, spec }] of this.controls) {
      const d = destinationOf(id);
      if (!d || spec.kind !== 'number') continue;
      const face = control.element.querySelector('svg.knob-face');
      if (!face) continue;
      let g = this.rings.get(id);
      if (!g) {
        g = document.createElementNS(SVG, 'g') as SVGGElement;
        g.setAttribute('class', 'knob-mods');
        face.append(g);
        this.rings.set(id, g);
      }
      const list = (byDest.get(d) ?? []).filter(m => m.amount);
      const u = paramToUnit(spec, v[id]);
      g.replaceChildren(...list.map(m => {
        const a = m.amount / 100, path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', m.bipolar ? knobArc(u - Math.abs(a), u + Math.abs(a), RING) : knobArc(u, u + a, RING));
        path.setAttribute('class', `knob-mod src-${sourceFamily(m.src)}${m.src === this.active ? ' hot' : ''}`);
        return path;
      }));
      control.element.classList.toggle('modulated', list.length > 0);
      control.element.classList.toggle('modulated-active', list.some(m => m.src === this.active));
    }
  }

  private paint(): void {
    const page = view.page;
    if (page === 0) for (const { osc, view: t } of this.tables) {
      const hint = this.values[`${osc}Table`] === USER_TABLE && !this.ctx.samples?.audio?.(tableSlot(osc)) ? 'Lascia qui un file WAV (o Importa…)' : '';
      t.paint(this.enabled, this.tableName(osc), hint);
    }
    if (page === 1) {
      this.envView.paint(this.enabled);
      this.lfoEditor.paint(this.enabled);
    }
  }
}
