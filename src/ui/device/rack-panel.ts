/* Il pannello di un rack, a sinistra dei suoi dispositivi come in Live: intestazione, le 8 macro
 * e, con "Map" acceso, le mappature della macro scelta (minimo, massimo, togli) e il modo di
 * aggiungerne. Ogni modifica passa dallo store. */
import type { DeviceId } from '../../core/id';
import { formatParam, type NumberParam, type ParamSpec } from '../../devices/params';
import { deviceTypeAt, mappingSpec } from '../../devices/rack-params';
import type { ChainOwner, Project } from '../../model/project';
import { MACRO_MAX, MACRO_MODES, macroMode, macroName, macroParam, rackName, type DeviceKey, type MacroMapping, type Rack } from '../../model/rack';
import {
  mapMacro, moveRack, removeRack, renameMacro, renameRack, setMacro, setMacroMode, setMappingRange, ungroupRack, unmapParam,
} from '../../store/rack-edits';
import type { Edit, ProjectStore } from '../../store/project-store';
import { showContextMenu, SEPARATOR } from '../context-menu';
import { el } from '../dom';
import { renameInline } from '../inline-rename';
import { controlFor, type ParamControl } from './controls';

export interface RackPanelOptions {
  readonly store: ProjectStore;
  readonly owner: ChainOwner;
  readonly rack: Rack;
  /** Il nome di un dispositivo della catena, come nei titoli dei pannelli. */
  readonly deviceLabel: (key: DeviceKey) => string;
  readonly canMove: (dir: -1 | 1) => boolean;
  /** La macro scelta con "Map" acceso: undefined spento, null acceso senza macro scelta. */
  readonly mapping: number | null | undefined;
  readonly folded: boolean;
  readonly onMapMode: (macro: number | null | undefined) => void;
  readonly onFold: () => void;
  /** Il menu degli effetti da aggiungere in fondo al rack. */
  readonly onAddEffect: (x: number, y: number) => void;
  /** Clic sul nome: sceglie il rack (Maiusc estende la scelta). */
  readonly onSelect: (extend: boolean) => void;
  /** KEY acceso: un clic su una macro la sceglie per la tastiera del computer (`onKeyTarget`). */
  readonly keyMapping: () => boolean;
  readonly onKeyTarget: (macro: number) => void;
}

/** Il nome e la manopola di un parametro mappato, per le righe delle mappature. */
interface MappingRow {
  readonly mapping: MacroMapping;
  readonly min: ParamControl;
  readonly max: ParamControl;
}

export class RackPanel {
  readonly element = el('div', { className: 'rack-panel' });
  readonly head = el('div', { className: 'device-panel-head' });
  private readonly macros: ParamControl[] = [];
  private readonly rows: MappingRow[] = [];

  constructor(private readonly o: RackPanelOptions) {
    const { rack } = o;
    const project = o.store.project;
    const button = (text: string, title: string, run: (e: MouseEvent) => void, extra: Record<string, unknown> = {}) =>
      el<HTMLButtonElement>('button', { className: 'mini', textContent: text, title, onclick: run, ...extra });
    const name = el('span', { className: 'device-name', textContent: rackName(rack), title: 'Doppio clic per rinominare' });
    name.onclick = e => o.onSelect(e.shiftKey);
    name.ondblclick = () => renameInline(name, n => this.apply(renameRack(o.owner, rack.id, n)));
    const hasInstrument = rack.devices.includes('instrument');
    this.head.append(
      button(o.folded ? '▸' : '▾', o.folded ? 'Mostra i dispositivi del rack' : 'Nascondi i dispositivi del rack', () => o.onFold(), { className: 'mini fold' }),
      name,
      button('Map', 'Mappa le macro sui parametri dei dispositivi del rack', () => o.onMapMode(o.mapping === undefined ? null : undefined),
        { className: `mini map${o.mapping !== undefined ? ' on' : ''}` }),
      button('+', 'Aggiungi un effetto in fondo al rack', e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        o.onAddEffect(r.left, r.bottom + 2);
      }),
      button('◂', 'Sposta il rack prima', () => this.apply(moveRack(o.owner, rack.id, -1)), { disabled: !o.canMove(-1) }),
      button('▸', 'Sposta il rack dopo', () => this.apply(moveRack(o.owner, rack.id, 1)), { disabled: !o.canMove(1) }),
      button('⊟', 'Separa il rack: i dispositivi restano, le macro spariscono (Ctrl+Maiusc+G)', () => this.apply(ungroupRack(o.owner, rack.id))),
      ...(hasInstrument ? [] : [button('×', 'Elimina il rack con i suoi effetti', () => this.apply(removeRack(o.owner, rack.id)))]),
    );
    const grid = el('div', { className: 'rack-macros' }, ...rack.macros.map((_, i) => this.macro(project, i)));
    const body = el('div', { className: 'rack-body' }, grid);
    if (o.mapping !== undefined) body.append(this.mappingList(project));
    this.element.append(this.head, body);
    this.element.classList.toggle('mapping', o.mapping !== undefined);
  }

  /** I valori di macro e mappature dal rack attuale (la forma è la stessa). */
  update(rack: Rack): void {
    rack.macros.forEach((m, i) => this.macros[i]?.set(m.value));
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
    const mode = macroMode(m);
    const control = mode === 'knob'
      ? controlFor(spec, m.value, (v, final) => this.merge(set(v), `macro-${o.rack.id}-${index}`, final))
      : new MacroSwitch(spec.label, m.value, mode,
        // l'interruttore è un passo di annullamento; il pulsante tenuto premuto no (si disfa da solo)
        on => (mode === 'toggle' ? this.apply(set(on ? MACRO_MAX : 0)) : o.store.apply(set(on ? MACRO_MAX : 0), { transient: true })));
    this.macros.push(control);
    const e = control.element;
    e.classList.add('macro');
    e.dataset.param = spec.id;
    e.classList.toggle('used', m.mappings.length > 0);
    e.classList.toggle('chosen', o.mapping === index);
    e.title = m.mappings.length
      ? `${spec.label}: muove ${m.mappings.map(x => `${o.deviceLabel(x.device)} · ${mappingSpec(p, o.owner, x)?.label ?? x.param}`).join(', ')}`
      : `${spec.label}: nessun parametro mappato (accendi Map, scegli la macro e clicca un parametro)`;
    // con KEY acceso un clic sceglie la macro per la tastiera, con Map acceso per mapparla, invece di girarla
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
      showContextMenu(ev.clientX, ev.clientY, [
        { label: 'Rinomina la macro', run: () => label && renameInline(label, n => this.apply(renameMacro(o.owner, o.rack.id, index, n))) },
        { label: 'Nome automatico', disabled: m.name === null, run: () => this.apply(renameMacro(o.owner, o.rack.id, index, null)) },
        SEPARATOR,
        ...MACRO_MODES.map(([value, label]) => ({
          label, checked: mode === value, run: () => this.apply(setMacroMode(o.owner, o.rack.id, index, value)),
        })),
        SEPARATOR,
        { label: 'Mappa…', run: () => o.onMapMode(index) },
      ]);
    });
    return e;
  }

  /** Le mappature della macro scelta, e "+ Parametro". */
  private mappingList(p: Project): HTMLElement {
    const { o } = this;
    const index = o.mapping;
    const list = el('div', { className: 'rack-mappings' });
    if (index === null || index === undefined) {
      list.append(el('div', { className: 'muted', textContent: 'Scegli una macro, poi clicca un parametro di un dispositivo del rack (o "+ Parametro").' }));
      return list;
    }
    const macro = o.rack.macros[index];
    const add = el<HTMLButtonElement>('button', { className: 'mini', textContent: '+ Parametro', title: 'Mappa un parametro su questa macro' });
    add.onclick = () => {
      const r = add.getBoundingClientRect();
      this.chooseParam(p, index, r.left, r.bottom + 2);
    };
    list.append(el('div', { className: 'rack-mappings-head' },
      el('span', { textContent: macroName(macro, index, x => mappingSpec(p, o.owner, x)?.label) }), add));
    if (!macro.mappings.length) list.append(el('div', { className: 'muted', textContent: 'Clicca un parametro di un dispositivo del rack per mapparlo qui.' }));
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
        el<HTMLButtonElement>('button', { className: 'mini', textContent: '×', title: 'Togli dalla macro', onclick: () => this.apply(unmapParam(o.owner, m.device, m.param)) })));
    }
    return list;
  }

  /** Due menu: il dispositivo del rack, poi il suo parametro. */
  private chooseParam(p: Project, index: number, x: number, y: number): void {
    const { o } = this;
    showContextMenu(x, y, o.rack.devices.map(device => {
      const type = deviceTypeAt(p, o.owner, device);
      return {
        label: o.deviceLabel(device),
        disabled: !type,
        run: () => showContextMenu(x, y, (type?.sections ?? []).flatMap(section => section.params.filter(spec => !spec.hidden).map(spec => ({
          label: type!.sections.length > 1 ? `${section.label} · ${spec.label}` : spec.label,
          checked: o.rack.macros[index].mappings.some(m => m.device === device && m.param === spec.id),
          run: () => this.apply(mapMacro(o.owner, o.rack.id as DeviceId, index, device, spec.id)),
        })))),
      };
    }));
  }

  private apply(edit: Edit): void {
    this.o.store.apply(edit);
  }

  /** Una manopola trascinata è un solo passo di annullamento. */
  private merge(edit: Edit, mergeKey: string, final: boolean): void {
    this.o.store.apply(edit, { mergeKey });
    if (final) this.o.store.endMerge();
  }
}

/** Una macro interruttore o pulsante: un tasto che si illumina quando è acceso. L'interruttore
 *  cambia a ogni clic; il pulsante è acceso finché lo si tiene premuto. */
class MacroSwitch implements ParamControl {
  readonly element = el('div', { className: 'macro-switch' });
  private readonly key: HTMLButtonElement;
  private on = false;

  constructor(label: string, value: number, mode: 'toggle' | 'button', press: (on: boolean) => void) {
    this.key = el<HTMLButtonElement>('button', {
      className: `macro-key ${mode}`, title: mode === 'toggle' ? 'Clic: accendi o spegni' : 'Tieni premuto: acceso finché non lo lasci',
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
    this.key.classList.toggle('on', this.on);
  }
}
