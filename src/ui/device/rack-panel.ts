/* A rack's panel, on the left of its devices as in Live: header, the 8 macros
 * and, with "Map" on, the mappings of the chosen macro (minimum, maximum, remove) and the way to
 * add some, also on the macros of the racks it has inside. Every change goes through the store. With ★
 * the rack is saved for the other projects. */
import type { DeviceId } from '../../core/id';
import { activeSections } from '../../devices/device-type';
import { formatParam, type NumberParam, type ParamSpec } from '../../devices/params';
import { deviceAt, deviceTypeAt, macroSpec, mappingSpec } from '../../devices/rack-params';
import { userRacks } from '../../devices/user-racks';
import type { ChainOwner, Project } from '../../model/project';
import {
  findRack, innerRacks, MACRO_MAX, MACRO_MODES, macroMode, macroName, macroParam, parseSpringTime, rackName, SPRING_TIMES, springOf,
  springTimeLabel, type DeviceKey, type MacroMapping, type MacroSpring, type Rack,
} from '../../model/rack';
import { captureRack } from '../../model/rack-preset';
import {
  mapMacro, moveRack, nestRack, removeRack, renameMacro, renameRack, setMacro, setMacroMode, setMacroSpring, setMappingRange,
  springsAtRest, ungroupRack, unmapParam,
} from '../../store/rack-edits';
import type { MacroSprings } from '../../store/macro-springs';
import type { Edit, ProjectStore } from '../../store/project-store';
import { showContextMenu, SEPARATOR, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { editInline, renameInline } from '../inline-rename';
import { controlFor, registerControl, type ParamControl } from './controls';

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

  constructor(private readonly o: RackPanelOptions) {
    const { rack } = o;
    const project = o.store.project;
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
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        o.onAddEffect(r.left, r.bottom + 2);
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
      const clip = o.headMenu?.() ?? [];
      showContextMenu(e.clientX, e.clientY, [
        ...clip, ...(clip.length ? [SEPARATOR] : []),
        { label: 'Put in the rack before', disabled: !o.canNest(-1), run: () => this.apply(nestRack(o.owner, rack.id, -1)) },
        { label: 'Put in the rack after', disabled: !o.canNest(1), run: () => this.apply(nestRack(o.owner, rack.id, 1)) },
        SEPARATOR,
        ...this.saveMenu(),
      ]);
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
    e.title = m.mappings.length
      ? `${spec.label}: moves ${m.mappings.map(x => `${o.deviceLabel(x.device)} · ${mappingSpec(p, o.owner, x)?.label ?? x.param}`).join(', ')}`
      : `${spec.label}: no mapped parameter (turn on Map, choose the macro and click a parameter)`;
    if (spring) {
      e.title += '\nSpring: released it returns to rest (↺: drag it up and down) within the return time (click to choose it).';
      e.append(this.springRow(index, spring));
      // the mouse on the knob holds it: until it's released it doesn't return
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
    // with KEY on a click chooses the macro for the keyboard, with Map on to map it, instead of turning it
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
    e.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const label = e.querySelector<HTMLElement>('.knob-label');
      const outer = o.outerMenu(index);
      showContextMenu(ev.clientX, ev.clientY, [
        ...(o.macroMenu?.(index) ?? []),
        { label: 'Rename the macro', run: () => label && renameInline(label, n => this.apply(renameMacro(o.owner, o.rack.id, index, n))) },
        { label: 'Automatic name', disabled: m.name === null, run: () => this.apply(renameMacro(o.owner, o.rack.id, index, null)) },
        SEPARATOR,
        ...MACRO_MODES.map(([value, label]) => ({
          label, checked: mode === value, run: () => this.apply(setMacroMode(o.owner, o.rack.id, index, value)),
        })),
        SEPARATOR,
        { label: 'Map…', run: () => o.onMapMode(index) },
        // inside another rack, the macro maps to the macros of the surrounding ones
        ...(outer.length ? [SEPARATOR, ...outer] : []),
      ]);
    });
    return e;
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
        value = Math.max(0, Math.min(MACRO_MAX, value + ((y - m.clientY) * MACRO_MAX / 180) * (m.shiftKey ? 0.1 : 1)));
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
      const items = (sync: boolean): MenuItem[] => SPRING_TIMES.filter(([, x]) => x === sync)
        .map(([t, x, label]) => ({ label, checked: s.time === t && s.sync === x, run: () => pick(t, x) }));
      showContextMenu(ev.clientX, ev.clientY, [
        ...items(true), SEPARATOR, ...items(false), SEPARATOR,
        {
          label: 'More…', run: () => editInline(time, springTimeLabel(s), text => {
            const parsed = parseSpringTime(text);
            if (parsed) pick(parsed.time, parsed.sync);
            else o.say?.(`"${text}" isn't a return time: write for example 300 ms, 1.5 s, 3/16 or 2 bars.`);
          }, 'e.g. 300 ms, 3/16, 2 bars'),
        },
      ]);
    });
    return el('div', { className: 'macro-spring' }, rest, time);
  }

  // ---------------------------------------------------------------- saved racks

  /** The header's menu: saving the rack, updating or deleting the one saved with its
   *  name. */
  private saveMenu(): MenuItem[] {
    const name = rackName(this.o.rack);
    const saved = !!userRacks.find(name);
    return [
      { label: 'Save the rack…', run: () => this.askName() },
      { label: `Update the saved rack «${name}»`, disabled: !saved, run: () => void this.save(name) },
      { label: `Delete the saved rack «${name}»`, disabled: !saved, run: () => void this.remove(name) },
      ...(userRacks.canReveal ? [{ label: 'Open the racks folder', run: () => void userRacks.reveal().catch(e => this.o.say?.(message(e))) }] : []),
    ];
  }

  /** The name is typed in place of the rack's; it starts from the rack's name. */
  private askName(): void {
    if (!this.name.isConnected) return;
    editInline(this.name, rackName(this.o.rack), name => void this.save(name), 'Rack name');
  }

  /** Saves the rack as it is now; the rack takes the name it's saved with, as in Live. */
  private async save(name: string): Promise<void> {
    const { store, owner, rack, say } = this.o;
    const existed = !!userRacks.find(name);
    try {
      await userRacks.save(captureRack(springsAtRest(store.project), owner, rack.id, name));
    } catch (e) {
      say?.(`Couldn't save the rack «${name}»: ${message(e)}`);
      return;
    }
    const now = findRack(store.project.racksOf(owner), rack.id);
    if (now && now.name !== name) this.apply(renameRack(owner, rack.id, name));
    // the samples are project files: only the parameters remain in the saved rack
    const samples = rack.devices.some(k => deviceAt(store.project, owner, k)?.samples);
    const note = samples ? ' The loaded samples aren\'t in the saved rack.' : '';
    say?.(existed ? `Rack «${name}» updated.${note}` : `Rack «${name}» saved: you'll find it in the browser, in all projects.${note}`);
  }

  private async remove(name: string): Promise<void> {
    try {
      await userRacks.remove(name);
    } catch (e) {
      this.o.say?.(`Couldn't delete the rack «${name}»: ${message(e)}`);
      return;
    }
    this.o.say?.(`Saved rack «${name}» deleted (the one in the project stays).`);
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
      const r = add.getBoundingClientRect();
      this.chooseParam(p, index, r.left, r.bottom + 2);
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
    const mapped = (device: DeviceKey, param: string) => o.rack.macros[index].mappings.some(m => m.device === device && m.param === param);
    const racks = innerRacks(p.racksOf(o.owner), o.rack).map(rack => ({
      label: o.deviceLabel(rack.id),
      run: () => showContextMenu(x, y, rack.macros.map((_, i) => {
        const spec = macroSpec(p, o.owner, rack, i);
        return { label: spec.label, checked: mapped(rack.id, spec.id), run: () => this.apply(mapMacro(o.owner, o.rack.id, index, rack.id, spec.id)) };
      })),
    }));
    showContextMenu(x, y, [...o.rack.devices.map(device => {
      const type = deviceTypeAt(p, o.owner, device), settings = deviceAt(p, o.owner, device);
      return {
        label: o.deviceLabel(device),
        disabled: !type,
        run: () => showContextMenu(x, y, (type ? activeSections(type, settings?.params ?? {}) : []).flatMap(section => section.params.filter(spec => !spec.hidden).map(spec => ({
          label: type!.sections.length > 1 ? `${section.label} · ${spec.label}` : spec.label,
          checked: mapped(device, spec.id),
          run: () => this.apply(mapMacro(o.owner, o.rack.id as DeviceId, index, device, spec.id)),
        })))),
      };
    }), ...(racks.length ? [SEPARATOR, ...racks] : [])]);
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

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The rest and the return time of a spring, under its knob. */
function showSpring(chips: { readonly rest: HTMLElement; readonly time: HTMLElement }, s: MacroSpring): void {
  const rest = `↺ ${Math.round(s.rest)}`, time = springTimeLabel(s);
  if (chips.rest.textContent !== rest) chips.rest.textContent = rest;
  if (chips.time.textContent !== time) chips.time.textContent = time;
}

/** A toggle or button macro: a key that lights up when it's on. The toggle
 *  changes at every click; the button is on while it's held down. A curve making it
 *  snap (past halfway) turns it on or off while it lasts. */
class MacroSwitch implements ParamControl {
  readonly element = el('div', { className: 'macro-switch' });
  private readonly key: HTMLButtonElement;
  private on = false;
  private flipped = false;

  constructor(label: string, value: number, mode: 'toggle' | 'button', press: (on: boolean) => void) {
    this.key = el<HTMLButtonElement>('button', {
      className: `macro-key ${mode}`, title: mode === 'toggle' ? 'Click: turn on or off' : 'Hold down: on until you release it',
    });
    this.element.append(this.key, el('div', { className: 'knob-label', textContent: label }));
    if (mode === 'toggle') this.key.onclick = () => press(!this.on);
    else {
      this.key.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        this.key.setPointerCapture(e.pointerId);
        press(true);
      });
      const release = () => { if (this.on) press(false); };
      this.key.addEventListener('pointerup', release);
      this.key.addEventListener('pointercancel', release);
      this.key.addEventListener('lostpointercapture', release);
    }
    this.set(value);
  }

  set(value: number): void {
    this.on = value >= MACRO_MAX / 2;
    this.render();
  }

  /** As in the engine (switchSink): on snaps down at −½, off snaps up at +½. */
  modulate(offset: number): void {
    const flipped = this.on ? offset <= -0.5 : offset >= 0.5;
    if (flipped === this.flipped) return;
    this.flipped = flipped;
    this.render();
  }

  private render(): void {
    this.key.classList.toggle('on', this.on !== this.flipped);
    this.key.classList.toggle('automated', this.flipped);
  }
}
