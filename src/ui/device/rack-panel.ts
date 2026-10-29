/* Il pannello di un rack, a sinistra dei suoi dispositivi come in Live: intestazione, le 8 macro
 * e, con "Map" acceso, le mappature della macro scelta (minimo, massimo, togli) e il modo di
 * aggiungerne, anche sulle macro dei rack che ha dentro. Ogni modifica passa dallo store. Con ★
 * il rack si salva per gli altri progetti. */
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
  /** Le macro molla: il mouse dice quando ne tiene una e quando la lascia. */
  readonly springs?: MacroSprings;
  readonly owner: ChainOwner;
  readonly rack: Rack;
  /** Il nome di un dispositivo della catena, come nei titoli dei pannelli. */
  readonly deviceLabel: (key: DeviceKey) => string;
  readonly canMove: (dir: -1 | 1) => boolean;
  /** C'è un rack accanto (prima −1, dopo +1) in cui mettere questo. */
  readonly canNest: (dir: -1 | 1) => boolean;
  /** Le voci per mappare una macro sulle macro dei rack intorno (nessuna se il rack non è dentro un altro). */
  readonly outerMenu: (macro: number) => MenuItem[];
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
  /** Un messaggio per la barra di stato (rack salvato, errore…). */
  readonly say?: (text: string) => void;
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
  /** Riposo e ritorno sotto le manopole delle molle, per macro. */
  private readonly springChips = new Map<number, { readonly rest: HTMLElement; readonly time: HTMLElement }>();
  private readonly rows: MappingRow[] = [];
  private readonly name: HTMLElement;

  constructor(private readonly o: RackPanelOptions) {
    const { rack } = o;
    const project = o.store.project;
    const button = (text: string, title: string, run: (e: MouseEvent) => void, extra: Record<string, unknown> = {}) =>
      el<HTMLButtonElement>('button', { className: 'mini', textContent: text, title, onclick: run, ...extra });
    const name = this.name = el('span', { className: 'device-name', textContent: rackName(rack), title: 'Doppio clic per rinominare' });
    name.onclick = e => o.onSelect(e.shiftKey);
    name.ondblclick = () => renameInline(name, n => this.apply(renameRack(o.owner, rack.id, n)));
    const hasInstrument = rack.devices.includes('instrument');
    this.head.append(
      button(o.folded ? '▸' : '▾', o.folded ? 'Mostra i dispositivi del rack' : 'Nascondi i dispositivi del rack', () => o.onFold(), { className: 'mini fold' }),
      name,
      button('Map', 'Mappa le macro sui parametri dei dispositivi del rack (e sulle macro dei rack che ha dentro)',
        () => o.onMapMode(o.mapping === undefined ? null : undefined),
        { className: `mini map${o.mapping !== undefined ? ' on' : ''}` }),
      button('+', 'Aggiungi un effetto in fondo al rack', e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        o.onAddEffect(r.left, r.bottom + 2);
      }),
      button('◂', 'Sposta il rack prima', () => this.apply(moveRack(o.owner, rack.id, -1)), { disabled: !o.canMove(-1) }),
      button('▸', 'Sposta il rack dopo', () => this.apply(moveRack(o.owner, rack.id, 1)), { disabled: !o.canMove(1) }),
      button('★', 'Salva il rack: lo ritrovi nel browser, in tutti i progetti (clic destro sull\'intestazione: aggiorna, elimina)',
        () => this.askName(), { className: 'mini save-preset' }),
      button('⊟', 'Separa il rack: i dispositivi restano, le macro spariscono (Ctrl+Maiusc+G)', () => this.apply(ungroupRack(o.owner, rack.id))),
      ...(hasInstrument ? [] : [button('×', 'Elimina il rack con i suoi effetti', () => this.apply(removeRack(o.owner, rack.id)))]),
    );
    this.head.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Metti nel rack prima', disabled: !o.canNest(-1), run: () => this.apply(nestRack(o.owner, rack.id, -1)) },
        { label: 'Metti nel rack dopo', disabled: !o.canNest(1), run: () => this.apply(nestRack(o.owner, rack.id, 1)) },
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

  /** I valori di macro e mappature dal rack attuale (la forma è la stessa). */
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
      // una molla torna da sola: tirarla non è un passo di annullamento
      ? controlFor(spec, m.value, (v, final) => (spring ? o.store.apply(set(v), { transient: true }) : this.merge(set(v), `macro-${o.rack.id}-${index}`, final)))
      : registerControl(new MacroSwitch(spec.label, m.value, mode,
        // l'interruttore è un passo di annullamento; il pulsante tenuto premuto no (si disfa da solo)
        on => (mode === 'toggle' ? this.apply(set(on ? MACRO_MAX : 0)) : o.store.apply(set(on ? MACRO_MAX : 0), { transient: true }))));
    this.macros.push(control);
    const e = control.element;
    e.classList.add('macro');
    e.dataset.param = spec.id;
    e.classList.toggle('used', m.mappings.length > 0);
    e.classList.toggle('chosen', o.mapping === index);
    e.title = m.mappings.length
      ? `${spec.label}: muove ${m.mappings.map(x => `${o.deviceLabel(x.device)} · ${mappingSpec(p, o.owner, x)?.label ?? x.param}`).join(', ')}`
      : `${spec.label}: nessun parametro mappato (accendi Map, scegli la macro e clicca un parametro)`;
    if (spring) {
      e.title += '\nMolla: lasciata torna al riposo (↺: trascinalo su e giù) nel tempo di ritorno (clic per sceglierlo).';
      e.append(this.springRow(index, spring));
      // il mouse sulla manopola la tiene: finché non lo si lascia non torna
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
      const outer = o.outerMenu(index);
      showContextMenu(ev.clientX, ev.clientY, [
        { label: 'Rinomina la macro', run: () => label && renameInline(label, n => this.apply(renameMacro(o.owner, o.rack.id, index, n))) },
        { label: 'Nome automatico', disabled: m.name === null, run: () => this.apply(renameMacro(o.owner, o.rack.id, index, null)) },
        SEPARATOR,
        ...MACRO_MODES.map(([value, label]) => ({
          label, checked: mode === value, run: () => this.apply(setMacroMode(o.owner, o.rack.id, index, value)),
        })),
        SEPARATOR,
        { label: 'Mappa…', run: () => o.onMapMode(index) },
        // dentro un altro rack, la macro si mappa sulle macro di quelli intorno
        ...(outer.length ? [SEPARATOR, ...outer] : []),
      ]);
    });
    return e;
  }

  /** Sotto la manopola di una molla: il riposo (si trascina su e giù) e il tempo di ritorno (un
   *  clic apre le scelte). */
  private springRow(index: number, spring: MacroSpring): HTMLElement {
    const { o } = this;
    const rest = el('span', { className: 'spring-rest', title: 'Riposo: dove torna la macro lasciata (trascina su e giù, Maiusc per i passi fini)' });
    const time = el('span', { className: 'spring-time', title: 'Ritorno: in quanto torna al riposo (clic per sceglierlo)' });
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
          label: 'Altro…', run: () => editInline(time, springTimeLabel(s), text => {
            const parsed = parseSpringTime(text);
            if (parsed) pick(parsed.time, parsed.sync);
            else o.say?.(`"${text}" non è un tempo di ritorno: scrivi per esempio 300 ms, 1.5 s, 3/16 o 2 battute.`);
          }, 'es. 300 ms, 3/16, 2 battute'),
        },
      ]);
    });
    return el('div', { className: 'macro-spring' }, rest, time);
  }

  // ---------------------------------------------------------------- rack salvati

  /** Il menu dell'intestazione: salvare il rack, aggiornare o eliminare quello salvato con il
   *  suo nome. */
  private saveMenu(): MenuItem[] {
    const name = rackName(this.o.rack);
    const saved = !!userRacks.find(name);
    return [
      { label: 'Salva il rack…', run: () => this.askName() },
      { label: `Aggiorna il rack salvato «${name}»`, disabled: !saved, run: () => void this.save(name) },
      { label: `Elimina il rack salvato «${name}»`, disabled: !saved, run: () => void this.remove(name) },
      ...(userRacks.canReveal ? [{ label: 'Apri la cartella dei rack', run: () => void userRacks.reveal().catch(e => this.o.say?.(message(e))) }] : []),
    ];
  }

  /** Il nome si scrive al posto di quello del rack; parte dal nome del rack. */
  private askName(): void {
    if (!this.name.isConnected) return;
    editInline(this.name, rackName(this.o.rack), name => void this.save(name), 'Nome del rack');
  }

  /** Salva il rack com'è ora; il rack prende il nome con cui è salvato, come in Live. */
  private async save(name: string): Promise<void> {
    const { store, owner, rack, say } = this.o;
    const existed = !!userRacks.find(name);
    try {
      await userRacks.save(captureRack(springsAtRest(store.project), owner, rack.id, name));
    } catch (e) {
      say?.(`Non è stato possibile salvare il rack «${name}»: ${message(e)}`);
      return;
    }
    const now = findRack(store.project.racksOf(owner), rack.id);
    if (now && now.name !== name) this.apply(renameRack(owner, rack.id, name));
    // i sample sono file del progetto: nel rack salvato restano solo i parametri
    const samples = rack.devices.some(k => deviceAt(store.project, owner, k)?.samples);
    const note = samples ? ' I sample caricati non sono nel rack salvato.' : '';
    say?.(existed ? `Rack «${name}» aggiornato.${note}` : `Rack «${name}» salvato: lo trovi nel browser, in tutti i progetti.${note}`);
  }

  private async remove(name: string): Promise<void> {
    try {
      await userRacks.remove(name);
    } catch (e) {
      this.o.say?.(`Non è stato possibile eliminare il rack «${name}»: ${message(e)}`);
      return;
    }
    this.o.say?.(`Rack salvato «${name}» eliminato (quello nel progetto resta).`);
  }

  // ---------------------------------------------------------------- mappature

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

  /** Due menu: il dispositivo del rack (o un rack che ha dentro), poi il suo parametro (o la sua macro). */
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

  /** Una manopola trascinata è un solo passo di annullamento. */
  private merge(edit: Edit, mergeKey: string, final: boolean): void {
    this.o.store.apply(edit, { mergeKey });
    if (final) this.o.store.endMerge();
  }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Il riposo e il tempo di ritorno di una molla, sotto la sua manopola. */
function showSpring(chips: { readonly rest: HTMLElement; readonly time: HTMLElement }, s: MacroSpring): void {
  const rest = `↺ ${Math.round(s.rest)}`, time = springTimeLabel(s);
  if (chips.rest.textContent !== rest) chips.rest.textContent = rest;
  if (chips.time.textContent !== time) chips.time.textContent = time;
}

/** Una macro interruttore o pulsante: un tasto che si illumina quando è acceso. L'interruttore
 *  cambia a ogni clic; il pulsante è acceso finché lo si tiene premuto. Una curva che lo fa
 *  scattare (oltre metà strada) lo accende o lo spegne finché dura. */
class MacroSwitch implements ParamControl {
  readonly element = el('div', { className: 'macro-switch' });
  private readonly key: HTMLButtonElement;
  private on = false;
  private flipped = false;

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
    this.render();
  }

  /** Come nel motore (switchSink): acceso scatta in giù a −½, spento scatta in su a +½. */
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
