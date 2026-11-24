/* A rack's panel, on the left of its devices as in Live: header, the 8 macros
 * and, with "Map" on, the mappings of the chosen macro (minimum, maximum, remove) and the way to
 * add some, also on the macros of the racks it has inside. Every change goes through the store. With ★
 * the rack is saved for the other projects. This is the DOM: the menus are in rack-menus, the texts
 * in rack-text, the saved racks in `RackLibrary`, the toggle and button macros in `MacroSwitch`. */
import { formatParam, type NumberParam, type ParamSpec } from '../../devices/params';
import { mappingSpec } from '../../devices/rack-params';
import type { ChainOwner, Project } from '../../model/project';
import {
  findRack, MACRO_MAX, macroMode, macroName, macroParam, parseSpringTime, rackName, springOf, springTimeLabel,
  type DeviceKey, type MacroMapping, type MacroSpring, type Rack,
} from '../../model/rack';
import {
  mapMacro, moveRack, nestRack, removeRack, renameMacro, renameRack, setMacro, setMacroMode, setMacroSpring, setMappingRange,
  ungroupRack, unmapParam,
} from '../../store/rack-edits';
import type { MacroSprings } from '../../store/macro-springs';
import type { Edit, ProjectStore } from '../../store/project-store';
import { showContextMenu, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { editInline, renameInline } from '../inline-rename';
import { below } from '../kit/pointer';
import { controlFor, registerControl, type ParamControl } from './controls';
import { MacroSwitch } from './macro-switch';
import { RackLibrary } from './rack-library';
import { macroMenu, paramChoices, rackHeadMenu, springTimeMenu } from './rack-menus';
import { draggedRest, macroTitle, springTexts } from './rack-text';

export interface RackPanelOptions {
  readonly store: ProjectStore;
  /** The spring macros: the mouse says when it holds one and when it lets it go. */
  readonly springs?: MacroSprings;
  readonly owner: ChainOwner;
  readonly rack: Rack;
  /** The name of a device of the chain, as in the panels' titles. */
  readonly deviceLabel: (key: DeviceKey) => string;
  readonly canMove: (dir: -1 | 1) => boolean;
  /** There's a rack next to it (before −1, after +1) to put this one in. */
  readonly canNest: (dir: -1 | 1) => boolean;
  /** The rack's copy and paste items. */
  readonly headMenu?: () => MenuItem[];
  /** The first items of a macro's menu. */
  readonly macroMenu?: (macro: number) => MenuItem[];
  /** The items to map a macro to the macros of the surrounding racks (none if the rack isn't inside another). */
  readonly outerMenu: (macro: number) => MenuItem[];
  /** The macro chosen with "Map" on: undefined off, null on with no macro chosen. */
  readonly mapping: number | null | undefined;
  readonly folded: boolean;
  readonly onMapMode: (macro: number | null | undefined) => void;
  readonly onFold: () => void;
  /** The menu of the effects to add at the end of the rack. */
  readonly onAddEffect: (x: number, y: number) => void;
  /** Click on the name: chooses the rack (Shift extends the selection). */
  readonly onSelect: (extend: boolean) => void;
  /** KEY on: a click on a macro chooses it for the computer keyboard (`onKeyTarget`). */
  readonly keyMapping: () => boolean;
  readonly onKeyTarget: (macro: number) => void;
  /** A message for the status bar (rack saved, error…). */
  readonly say?: (text: string) => void;
}

/** The name and the knob of a mapped parameter, for the mapping rows. */
interface MappingRow {
  readonly mapping: MacroMapping;
  readonly min: ParamControl;
  readonly max: ParamControl;
}

export class RackPanel {
  readonly element = el('div', { className: 'rack-panel' });
  readonly head = el('div', { className: 'device-panel-head' });
  private readonly macros: ParamControl[] = [];
  /** Rest and return under the springs' knobs, per macro. */
  private readonly springChips = new Map<number, { readonly rest: HTMLElement; readonly time: HTMLElement }>();
  private readonly rows: MappingRow[] = [];
  private readonly name: HTMLElement;
  private readonly library: RackLibrary;

  constructor(private readonly o: RackPanelOptions) {
    const { rack } = o;
    const project = o.store.project;
    this.library = new RackLibrary({ store: o.store, owner: o.owner, rack, say: o.say });
    const button = (text: string, title: string, run: (e: MouseEvent) => void, extra: Record<string, unknown> = {}) =>
      el<HTMLButtonElement>('button', { className: 'mini', textContent: text, title, onclick: run, ...extra });
    const name = this.name = el('span', { className: 'device-name', textContent: rackName(rack), title: 'Double click to rename' });
    name.onclick = e => o.onSelect(e.shiftKey);
    name.ondblclick = () => renameInline(name, n => this.apply(renameRack(o.owner, rack.id, n)));
    const hasInstrument = rack.devices.includes('instrument');
    this.head.append(
      button(o.folded ? '▸' : '▾', o.folded ? 'Show the rack\'s devices' : 'Hide the rack\'s devices', () => o.onFold(), { className: 'mini fold' }),
      name,
      button('Map', 'Map the macros to the parameters of the rack\'s devices (and to the macros of the racks it has inside)',
        () => o.onMapMode(o.mapping === undefined ? null : undefined),
        { className: `mini map${o.mapping !== undefined ? ' on' : ''}` }),
      button('+', 'Add an effect at the end of the rack', e => {
        const at = below(e.currentTarget as HTMLElement);
        o.onAddEffect(at.x, at.y);
      }),
      button('◂', 'Move the rack earlier', () => this.apply(moveRack(o.owner, rack.id, -1)), { disabled: !o.canMove(-1) }),
      button('▸', 'Move the rack later', () => this.apply(moveRack(o.owner, rack.id, 1)), { disabled: !o.canMove(1) }),
      button('★', 'Save the rack: you\'ll find it in the browser, in all projects (right click on the header: update, delete)',
        () => this.askName(), { className: 'mini save-preset' }),
      button('⊟', 'Ungroup the rack: the devices stay, the macros disappear (Ctrl+Shift+G)', () => this.apply(ungroupRack(o.owner, rack.id))),
      ...(hasInstrument ? [] : [button('×', 'Delete the rack with its effects', () => this.apply(removeRack(o.owner, rack.id)))]),
    );
    this.head.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, rackHeadMenu(o.headMenu?.() ?? [], o.canNest,
        dir => this.apply(nestRack(o.owner, rack.id, dir)), this.library.menu(() => this.askName())));
    });
    const grid = el('div', { className: 'rack-macros' }, ...rack.macros.map((_, i) => this.macro(project, i)));
    const body = el('div', { className: 'rack-body' }, grid);
    if (o.mapping !== undefined) body.append(this.mappingList(project));
    this.element.append(this.head, body);
    this.element.classList.toggle('mapping', o.mapping !== undefined);
  }

  /** The values of macros and mappings from the current rack (the shape is the same). */
  update(rack: Rack): void {
    rack.macros.forEach((m, i) => {
      this.macros[i]?.set(m.value);
      const s = springOf(m), chips = this.springChips.get(i);
      if (s && chips) showSpring(chips, s);
    });
    const index = this.o.mapping;
    if (index === undefined || index === null) return;
    for (const row of this.rows) {
      const m = rack.macros[index].mappings.find(x => x.device === row.mapping.device && x.param === row.mapping.param);
      if (!m) continue;
      row.min.set(m.min);
      row.max.set(m.max);
    }
  }

  private macro(p: Project, index: number): HTMLElement {
    const { o } = this;
    const m = o.rack.macros[index];
    const spec: NumberParam = {
      kind: 'number', id: macroParam(index), min: 0, max: MACRO_MAX, default: 0, step: 1,
      label: macroName(m, index, x => mappingSpec(p, o.owner, x)?.label),
    };
    const set = (v: number) => setMacro(o.owner, o.rack.id, index, v);
    const mode = macroMode(m), spring = springOf(m);
    const control = mode === 'knob' || mode === 'spring'
      // a spring returns by itself: pulling it isn't an undo step
      ? controlFor(spec, m.value, (v, final) => (spring ? o.store.apply(set(v), { transient: true }) : this.merge(set(v), `macro-${o.rack.id}-${index}`, final)))
      : registerControl(new MacroSwitch(spec.label, m.value, mode,
        // the toggle is an undo step; the held button isn't (it undoes itself)
        on => {
          const edit = set(on ? MACRO_MAX : 0);
          if (mode === 'toggle') this.apply(edit);
          else o.store.apply(edit, { transient: true });
        }));
    this.macros.push(control);
    const e = control.element;
    e.classList.add('macro');
    e.dataset.param = spec.id;
    e.classList.toggle('used', m.mappings.length > 0);
    e.classList.toggle('chosen', o.mapping === index);
    e.title = macroTitle(spec.label, m.mappings.map(x => `${o.deviceLabel(x.device)} · ${mappingSpec(p, o.owner, x)?.label ?? x.param}`), !!spring);
    if (spring) {
      e.append(this.springRow(index, spring));
      this.holdSpring(e, index);
    }
    this.interceptClicks(e, index);
    e.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const label = e.querySelector<HTMLElement>('.knob-label');
      showContextMenu(ev.clientX, ev.clientY, macroMenu({
        first: o.macroMenu?.(index) ?? [], named: m.name !== null, mode, outer: o.outerMenu(index),
        rename: () => label && renameInline(label, n => this.apply(renameMacro(o.owner, o.rack.id, index, n))),
        autoName: () => this.apply(renameMacro(o.owner, o.rack.id, index, null)),
        setMode: value => this.apply(setMacroMode(o.owner, o.rack.id, index, value)),
        map: () => o.onMapMode(index),
      }));
    });
    return e;
  }

  /** The mouse on a spring's knob holds it: until it's released it doesn't return. */
  private holdSpring(e: HTMLElement, index: number): void {
    const { o } = this;
    e.addEventListener('pointerdown', ev => {
      const springs = o.springs;
      if (ev.button !== 0 || !springs) return;
      springs.hold(o.owner, o.rack.id, index, true);
      const up = () => {
        removeEventListener('pointerup', up, true);
        removeEventListener('pointercancel', up, true);
        springs.hold(o.owner, o.rack.id, index, false);
      };
      addEventListener('pointerup', up, true);
      addEventListener('pointercancel', up, true);
    });
  }

  /** With KEY on a click chooses the macro for the keyboard, with Map on to map it, instead of turning it. */
  private interceptClicks(e: HTMLElement, index: number): void {
    const { o } = this;
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) {
      e.addEventListener(type, ev => {
        const keys = o.keyMapping();
        if (!keys && (o.mapping === undefined || type !== 'pointerdown')) return;
        ev.stopPropagation();
        ev.preventDefault();
        if (type !== 'pointerdown') return;
        if (keys) o.onKeyTarget(index);
        else o.onMapMode(index);
      }, { capture: true, passive: false });
    }
  }

  /** Under a spring's knob: the rest (dragged up and down) and the return time (a
   *  click opens the choices). */
  private springRow(index: number, spring: MacroSpring): HTMLElement {
    const { o } = this;
    const rest = el('span', { className: 'spring-rest', title: 'Rest: where the released macro returns (drag up and down, Shift for fine steps)' });
    const time = el('span', { className: 'spring-time', title: 'Return: how quickly it returns to rest (click to choose it)' });
    const chips = { rest, time };
    this.springChips.set(index, chips);
    showSpring(chips, spring);
    const current = (): MacroSpring => {
      const m = findRack(o.store.project.racksOf(o.owner), o.rack.id)?.macros[index];
      return (m && springOf(m)) ?? spring;
    };
    const mergeKey = `spring-${o.rack.id}-${index}`;
    rest.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      if (ev.button !== 0) return;
      ev.preventDefault();
      rest.setPointerCapture(ev.pointerId);
      let y = ev.clientY, value = current().rest;
      const move = (m: PointerEvent) => {
        value = draggedRest(value, y - m.clientY, m.shiftKey);
        y = m.clientY;
        this.merge(setMacroSpring(o.owner, o.rack.id, index, { rest: Math.round(value) }), mergeKey, false);
      };
      const up = () => {
        rest.removeEventListener('pointermove', move);
        rest.removeEventListener('pointerup', up);
        o.store.endMerge();
      };
      rest.addEventListener('pointermove', move);
      rest.addEventListener('pointerup', up);
    });
    for (const chip of [rest, time]) chip.addEventListener('dblclick', ev => ev.stopPropagation());
    time.addEventListener('pointerdown', ev => ev.stopPropagation());
    time.addEventListener('click', ev => {
      ev.stopPropagation();
      const s = current();
      const pick = (t: number, sync: boolean) => this.apply(setMacroSpring(o.owner, o.rack.id, index, { time: t, sync }));
      showContextMenu(ev.clientX, ev.clientY, springTimeMenu(s, pick, () => editInline(time, springTimeLabel(s), text => {
        const parsed = parseSpringTime(text);
        if (parsed) pick(parsed.time, parsed.sync);
        else o.say?.(`"${text}" isn't a return time: write for example 300 ms, 1.5 s, 3/16 or 2 bars.`);
      }, 'e.g. 300 ms, 3/16, 2 bars')));
    });
    return el('div', { className: 'macro-spring' }, rest, time);
  }

  /** The name is typed in place of the rack's; it starts from the rack's name. */
  private askName(): void {
    if (!this.name.isConnected) return;
    editInline(this.name, rackName(this.o.rack), name => void this.library.save(name), 'Rack name');
  }

  // ---------------------------------------------------------------- mappings

  /** The mappings of the chosen macro, and "+ Parameter". */
  private mappingList(p: Project): HTMLElement {
    const { o } = this;
    const index = o.mapping;
    const list = el('div', { className: 'rack-mappings' });
    if (index === null || index === undefined) {
      list.append(el('div', { className: 'muted', textContent: 'Choose a macro, then click a parameter of a device of the rack (or "+ Parameter").' }));
      return list;
    }
    const macro = o.rack.macros[index];
    const add = el<HTMLButtonElement>('button', { className: 'mini', textContent: '+ Parameter', title: 'Map a parameter to this macro' });
    add.onclick = () => {
      const at = below(add);
      this.chooseParam(p, index, at.x, at.y);
    };
    list.append(el('div', { className: 'rack-mappings-head' },
      el('span', { textContent: macroName(macro, index, x => mappingSpec(p, o.owner, x)?.label) }), add));
    if (!macro.mappings.length) list.append(el('div', { className: 'muted', textContent: 'Click a parameter of a device of the rack to map it here.' }));
    for (const m of macro.mappings) {
      const spec = mappingSpec(p, o.owner, m);
      if (!spec) continue;
      const range = (key: 'min' | 'max', label: string) => controlFor({ ...spec, label, when: undefined } as ParamSpec, m[key],
        (v, final) => this.merge(setMappingRange(o.owner, m.device, m.param, { [key]: v }), `range-${m.device}-${m.param}-${key}`, final));
      const row: MappingRow = { mapping: m, min: range('min', 'Min'), max: range('max', 'Max') };
      this.rows.push(row);
      list.append(el('div', { className: 'rack-mapping' },
        el('div', { className: 'rack-mapping-name', textContent: `${o.deviceLabel(m.device)} · ${spec.label}`, title: `${formatParam(spec, m.min)} → ${formatParam(spec, m.max)}` }),
        row.min.element, row.max.element,
        el<HTMLButtonElement>('button', { className: 'mini', textContent: '×', title: 'Remove from the macro', onclick: () => this.apply(unmapParam(o.owner, m.device, m.param)) })));
    }
    return list;
  }

  /** Two menus: the rack's device (or a rack it has inside), then its parameter (or its macro). */
  private chooseParam(p: Project, index: number, x: number, y: number): void {
    const { o } = this;
    showContextMenu(x, y, paramChoices({
      project: p, owner: o.owner, rack: o.rack, deviceLabel: o.deviceLabel,
      mapped: (device, param) => o.rack.macros[index].mappings.some(m => m.device === device && m.param === param),
      map: (device, param) => this.apply(mapMacro(o.owner, o.rack.id, index, device, param)),
      open: items => showContextMenu(x, y, items),
    }));
  }

  private apply(edit: Edit): void {
    this.o.store.apply(edit);
  }

  /** A dragged knob is a single undo step. */
  private merge(edit: Edit, mergeKey: string, final: boolean): void {
    this.o.store.apply(edit, { mergeKey });
    if (final) this.o.store.endMerge();
  }
}

/** The rest and the return time of a spring, under its knob. */
function showSpring(chips: { readonly rest: HTMLElement; readonly time: HTMLElement }, s: MacroSpring): void {
  const { rest, time } = springTexts(s);
  if (chips.rest.textContent !== rest) chips.rest.textContent = rest;
  if (chips.time.textContent !== time) chips.time.textContent = time;
}
