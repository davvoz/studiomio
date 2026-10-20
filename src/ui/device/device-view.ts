import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { DeviceId, SampleId, TrackId } from '../../core/id';
import type { SampleData } from '../../devices/dsp/core';
import type { SampleRef } from '../../model/sample';
import { paramSpec, resolveParams } from '../../devices/device-type';
import { deviceTypeAt } from '../../devices/rack-params';
import { EFFECT_TYPES, effectType, INSTRUMENT_TYPES, instrumentType } from '../../devices/registry';
import { DEFAULT_INSTRUMENT, sampleAt, type EffectSettings, type ParamValues } from '../../model/device';
import type { EffectList } from '../../model/effect-list';
import { MASTER, type ChainOwner, type Project } from '../../model/project';
import {
  chainItems, macroName, macroOf, moveDevice as layoutMove, moveRack as layoutMoveRack, rackOf, type DeviceKey, type Rack,
  type RackList,
} from '../../model/rack';
import { MidiTrack, type Track } from '../../model/track';
import type { ControlledDevice } from '../ui-state';
import {
  addEffect, loadEffectPreset, loadPreset, removeEffect, setEffectEnabled, setEffectParam,
  setEffectParams, setEffectSidechain, setInstrument, setInstrumentParam, setInstrumentParams, setInstrumentSamples,
} from '../../store/edits';
import type { Edit, ProjectStore } from '../../store/project-store';
import { addEffectToRack, groupDevices, mapMacro, moveDevice, ungroupRack, unmapParam } from '../../store/rack-edits';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { showContextMenu, SEPARATOR, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { DevicePanel } from './device-panel';
import { DEVICE_DISPLAYS, NO_SPECTRUM, type DeviceDisplay, type SpectrumTap } from './displays';
import { RackPanel } from './rack-panel';
import { SidechainPicker } from './sidechain-picker';

export interface DeviceViewDeps {
  readonly store: ProjectStore;
  /** Suona una nota di prova con lo strumento della traccia. */
  readonly audition: (track: TrackId, pitch: number, velocity?: number) => void;
  readonly sampleRate: number;
  /** Lo spettro di un effetto che suona (per i pannelli grafici). */
  readonly spectrum: (owner: ChainOwner, id: DeviceId) => SpectrumTap;
  /** Per seguire le note che la traccia suona: ogni chiamata della funzione data restituisce
   *  quelle partite dalla chiamata prima. */
  readonly playedNotes: (track: TrackId) => () => readonly number[];
  /** Copia un file audio nel progetto e lo carica nel motore (per i sample degli strumenti). */
  readonly importSample: (file: File) => Promise<SampleRef>;
  /** I campioni di un sample del progetto già caricato (per i pannelli che lo disegnano). */
  readonly sampleAudio?: (id: SampleId) => SampleData | undefined;
  /** Dove leggono adesso le voci dello strumento della traccia, se suona un sample. */
  readonly playheads?: (track: TrackId) => readonly number[];
  /** Un messaggio nella barra di stato (es. perché un raggruppamento non si può fare). */
  readonly say?: (text: string) => void;
  /** Una voce del browser lasciata sulla catena aperta. */
  readonly dropItem?: (item: BrowserItem, target: LoadTarget) => void;
}

/** La chiave del pannello dello strumento (gli effetti usano il loro id). */
const INSTRUMENT = 'instrument';

/** Colore del master nel titolo. */
export const MASTER_COLOR = 'var(--text)';

/** Ciò che la vista mostra di chi possiede la catena: una traccia o il master. */
interface ChainSource {
  readonly name: string;
  readonly color: string;
  /** La traccia, se la catena è di una traccia (per lo strumento delle tracce MIDI). */
  readonly track: Track | null;
  readonly effects: EffectList;
  readonly racks: RackList;
}

/** La catena dei dispositivi di una traccia o del master, in fila come in Live: lo strumento
 *  (tracce MIDI), poi gli effetti nell'ordine in cui il suono li attraversa; un rack raccoglie i
 *  suoi dispositivi dietro il pannello delle macro. Un clic sul nome sceglie un dispositivo
 *  (Maiusc: più di uno), Ctrl+G li raggruppa in un rack, Ctrl+Maiusc+G lo separa. Ogni modifica
 *  passa dallo store (si annulla) e si sente subito, anche mentre suona. */
export class DeviceView {
  readonly element = el('section', { className: 'device-view', hidden: true, tabIndex: -1 });
  private owner: ChainOwner | null = null;
  private back: (() => void) | null = null;
  /** Com'era fatta la catena quando i pannelli sono stati costruiti. */
  private builtFor = '';
  private readonly panels = new Map<string, DevicePanel>();
  /** I pannelli grafici, per chiave (per le loro voci nel menu dei parametri). */
  private readonly displays = new Map<string, DeviceDisplay>();
  private readonly rackPanels = new Map<DeviceId, RackPanel>();
  private readonly sidechains = new Map<DeviceId, SidechainPicker>();
  private readonly title = el('span', { className: 'device-title' });
  private readonly backButton = el<HTMLButtonElement>('button', { textContent: '◂ Note', title: 'Torna al piano roll' });
  private readonly chain = el('div', { className: 'device-chain' });
  /** Il dispositivo che le manopole di un controller muovono (la "mano blu" di Live). */
  private controlled: ControlledDevice | null = null;
  /** I dispositivi scelti (per raggrupparli), e da dove si estende la scelta. */
  private selection: DeviceKey[] = [];
  private anchor: DeviceKey | null = null;
  /** I rack con i dispositivi nascosti. */
  private readonly folded = new Set<DeviceId>();
  /** I dispositivi compressi, per catena ("proprietario/chiave"). */
  private readonly foldedDevices = new Set<string>();
  /** Di chi era la catena costruita l'ultima volta: un'altra catena parte dall'inizio. */
  private builtOwner: ChainOwner | null = null;
  /** "Map" acceso su un rack, con la macro scelta (null: nessuna). */
  private mapMode: { readonly rack: DeviceId; readonly macro: number | null } | null = null;

  constructor(private readonly deps: DeviceViewDeps) {
    this.backButton.onclick = () => this.back?.();
    const add = el<HTMLButtonElement>('button', { textContent: '+ Effetto', title: 'Aggiungi un effetto in fondo alla catena' });
    add.onclick = () => {
      const r = add.getBoundingClientRect();
      this.chooseEffect(r.left, r.bottom + 2);
    };
    const foldAll = el<HTMLButtonElement>('button', {
      textContent: '⇤⇥', title: 'Comprimi tutti i dispositivi (o riaprili, se sono già tutti compressi)', onclick: () => this.foldAll(),
    });
    const close = el<HTMLButtonElement>('button', { className: 'close', textContent: '×', title: 'Chiudi (Esc)', onclick: () => this.close() });
    this.element.append(el('div', { className: 'device-head' }, this.backButton, this.title, foldAll, add, close), this.chain);
    this.element.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.ungroupSelection();
        else this.groupSelection();
      }
    });
    deps.store.onChange(() => this.sync());
    const dropItem = deps.dropItem;
    if (dropItem) acceptBrowserDrops(this.element, item => this.owner && dropItem(item, { kind: 'chain', owner: this.owner }), { accept: () => !!this.owner });
  }

  get isOpen(): boolean {
    return this.owner !== null;
  }

  /** Di chi è la catena aperta (per i test automatici). */
  get openOwner(): ChainOwner | null {
    return this.owner;
  }

  /** Apre i dispositivi di una traccia o del master; `back` riporta a chi l'ha aperta (il piano roll). */
  open(owner: ChainOwner, back: (() => void) | null = null): boolean {
    if (!this.sourceOf(owner)) return false;
    if (owner !== this.owner) {
      this.selection = [];
      this.mapMode = null;
    }
    this.owner = owner;
    this.back = back;
    this.builtFor = '';
    this.element.hidden = false;
    this.sync();
    this.element.focus({ preventScroll: true });
    return true;
  }

  close(): void {
    this.owner = null;
    this.element.hidden = true;
  }

  /** Segna il dispositivo che un controller muove (null: nessuno); se cambia, la catena scorre
   *  fino a mostrarlo. */
  markControlled(device: ControlledDevice | null): void {
    const moved = device?.owner !== this.controlled?.owner || device?.device !== this.controlled?.device;
    this.controlled = device;
    this.showControlled();
    if (moved) this.revealControlled();
  }

  private revealControlled(): void {
    const c = this.controlled;
    if (!c || c.owner !== this.owner) return;
    const panel = this.panels.get(c.device) ?? this.rackPanels.get(c.device as DeviceId);
    if (panel) this.reveal(panel.element);
  }

  /** Scorre la catena (e solo lei, non l'area che la contiene) quanto basta a mostrare `element`;
   *  se è più largo della catena se ne vede l'inizio. */
  private reveal(element: HTMLElement): void {
    const view = this.chain.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    const pad = 10;
    if (r.right > view.right - pad) this.chain.scrollLeft += Math.min(r.right - view.right + pad, r.left - view.left - pad);
    else if (r.left < view.left + pad) this.chain.scrollLeft += r.left - view.left - pad;
  }

  /** Comprime tutti i dispositivi della catena, o li riapre se lo sono già. */
  private foldAll(): void {
    const owner = this.owner;
    if (!owner) return;
    const fold = [...this.panels.values()].some(p => !p.folded);
    for (const [key, panel] of this.panels) {
      panel.setFolded(fold);
      this.setDeviceFolded(owner, key, fold);
    }
  }

  private setDeviceFolded(owner: ChainOwner, key: string, folded: boolean): void {
    if (folded) this.foldedDevices.add(`${owner}/${key}`);
    else this.foldedDevices.delete(`${owner}/${key}`);
  }

  /** Le opzioni di un pannello per comprimerlo, ricordando la scelta. */
  private foldOptions(owner: ChainOwner, key: string) {
    return {
      folded: this.foldedDevices.has(`${owner}/${key}`),
      onFold: (folded: boolean) => this.setDeviceFolded(owner, key, folded),
    };
  }

  private showControlled(): void {
    const c = this.controlled;
    const mine = (key: string) => !!c && c.owner === this.owner && c.device === key;
    for (const [key, panel] of this.panels) panel.element.classList.toggle('controlled', mine(key));
    for (const [key, panel] of this.rackPanels) panel.element.classList.toggle('controlled', mine(key));
  }

  /** Il menu dei tipi di effetto; quello scelto va in fondo alla catena. */
  chooseEffect(x: number, y: number): void {
    const owner = this.owner;
    if (!owner) return;
    showContextMenu(x, y, EFFECT_TYPES.map(t => ({ label: t.label, run: () => this.deps.store.apply(addEffect(owner, t.type, t.label)) })));
  }

  private sourceOf(owner: ChainOwner): ChainSource | null {
    const project = this.deps.store.project;
    if (owner === MASTER) return { name: 'Master', color: MASTER_COLOR, track: null, effects: project.masterEffects, racks: project.masterRacks };
    const track = project.track(owner);
    return track ? { name: track.name, color: track.color, track, effects: track.effects, racks: track.racks } : null;
  }

  private effects(): EffectList {
    return (this.owner && this.sourceOf(this.owner)?.effects) || [];
  }

  private sync(): void {
    if (!this.owner) return;
    const source = this.sourceOf(this.owner);
    if (!source) return this.close();
    this.title.textContent = source.name;
    this.title.style.setProperty('--color', source.color);
    this.backButton.hidden = !this.back;
    const view = `${[...this.folded].join(',')}/${this.mapMode ? `${this.mapMode.rack}:${this.mapMode.macro}` : ''}`;
    const shape = shapeOf(this.owner, source, view);
    if (shape !== this.builtFor) this.build(this.owner, source, shape);
    else this.update(source);
  }

  /** Pannelli nuovi quando cambia la forma della catena (effetti aggiunti, tolti, spostati, rack). */
  private build(owner: ChainOwner, { track, effects, racks }: ChainSource, shape: string): void {
    const sameOwner = owner === this.builtOwner;
    this.builtOwner = owner;
    const scroll = sameOwner ? this.chain.scrollLeft : 0;
    const known = new Set(this.panels.keys());
    this.builtFor = shape;
    this.panels.clear();
    this.displays.clear();
    this.rackPanels.clear();
    this.sidechains.clear();
    const project = this.deps.store.project;
    const order = project.chainKeys(owner);
    if (this.mapMode && !racks.some(r => r.id === this.mapMode!.rack)) this.mapMode = null;
    this.selection = this.selection.filter(k => order.includes(k));
    const labels = deviceLabels(project, owner);
    const canMove = (key: DeviceKey, dir: -1 | 1) => {
      const next = layoutMove(order, racks, key, dir);
      return next.order !== order || next.racks !== racks;
    };
    const panelOf = (key: DeviceKey): Node => {
      const e = effects.find(x => x.id === key);
      const node = e
        ? this.effectPanel(owner, e, dir => canMove(e.id, dir)) ?? missing(e.type)
        : track instanceof MidiTrack ? this.instrumentPanel(track) ?? missing(track.instrument.type) : missing(key);
      const panel = this.panels.get(key);
      if (panel) this.bindPanel(owner, key, panel);
      return node;
    };
    const items = chainItems(order, racks).map(item => (item.kind === 'device'
      ? panelOf(item.key)
      : this.rackElement(owner, item.rack, labels, panelOf, dir => layoutMoveRack(order, racks, item.rack.id, dir).order !== order)));
    if (!effects.length) items.push(el('div', { className: 'device-empty muted', textContent: 'Nessun effetto: "+ Effetto" ne aggiunge uno.' }));
    this.chain.replaceChildren(...items);
    this.chain.scrollLeft = scroll;
    this.showControlled();
    this.showSelection();
    this.showMapped(racks);
    // un'altra catena parte dall'inizio, o dal dispositivo che il controller muove
    if (!sameOwner) this.revealControlled();
    // un effetto appena aggiunto si vede subito, anche in fondo a una catena lunga
    const added = sameOwner && known.size ? effects.filter(e => !known.has(e.id)).at(-1) : undefined;
    const panel = added && this.panels.get(added.id);
    if (panel) this.reveal(panel.element);
  }

  private update({ track, effects, racks }: ChainSource): void {
    if (track instanceof MidiTrack) this.panels.get(INSTRUMENT)?.update(track.instrument);
    for (const e of effects) this.panels.get(e.id)?.update(e, e.enabled);
    if (this.owner) for (const e of effects) this.sidechains.get(e.id)?.update(this.deps.store.project, this.owner, e);
    for (const r of racks) this.rackPanels.get(r.id)?.update(r);
  }

  // ---------------------------------------------------------------- rack

  /** Un rack: il pannello delle macro e, se non è chiuso, i suoi dispositivi. */
  private rackElement(owner: ChainOwner, rack: Rack, labels: ReadonlyMap<DeviceKey, string>, panelOf: (key: DeviceKey) => Node,
    canMove: (dir: -1 | 1) => boolean): HTMLElement {
    const folded = this.folded.has(rack.id);
    const mapping = this.mapMode?.rack === rack.id ? this.mapMode.macro : undefined;
    const panel = new RackPanel({
      store: this.deps.store, owner, rack, folded, mapping, canMove,
      deviceLabel: key => labels.get(key) ?? key,
      onMapMode: macro => {
        this.mapMode = macro === undefined ? null : { rack: rack.id, macro };
        this.sync();
      },
      onFold: () => {
        if (folded) this.folded.delete(rack.id); else this.folded.add(rack.id);
        this.sync();
      },
      onAddEffect: (x, y) => showContextMenu(x, y, EFFECT_TYPES.map(t => ({
        label: t.label, run: () => this.deps.store.apply(addEffectToRack(owner, rack.id, t.type, t.label)),
      }))),
      onSelect: extend => this.select(rack.devices, extend),
    });
    this.rackPanels.set(rack.id, panel);
    const element = el('div', { className: `rack${folded ? ' folded' : ''}${mapping !== undefined ? ' mapping' : ''}` }, panel.element);
    if (!folded) element.append(...rack.devices.map(panelOf));
    else element.append(el('div', { className: 'rack-folded muted' }, ...rack.devices.map(key => el('div', { textContent: labels.get(key) ?? key }))));
    return element;
  }

  /** Su un dispositivo: il clic sul nome lo sceglie, il menu dell'intestazione raggruppa e
   *  separa, il menu di un parametro lo mappa su una macro. Un parametro mappato non si tocca
   *  (lo muove la macro); con "Map" acceso e una macro scelta un clic lo mappa lì. */
  private bindPanel(owner: ChainOwner, key: DeviceKey, panel: DevicePanel): void {
    const name = panel.element.querySelector<HTMLElement>('.device-name');
    if (name) {
      name.onclick = e => this.select([key], e.shiftKey);
      name.title = 'Clic: scegli (Maiusc: più di uno), poi Ctrl+G per raggruppare in un rack';
    }
    panel.element.querySelector('.device-panel-head')?.addEventListener('contextmenu', e => {
      const ev = e as MouseEvent;
      ev.preventDefault();
      const keys = this.selection.includes(key) ? this.selection : [key];
      const rack = rackOf(this.deps.store.project.racksOf(owner), key);
      const presets = panel.presetMenu();
      showContextMenu(ev.clientX, ev.clientY, [
        { label: 'Raggruppa in un rack', shortcut: 'Ctrl+G', disabled: !!rack, run: () => this.groupSelection(keys) },
        { label: 'Separa il rack', shortcut: 'Ctrl+Maiusc+G', disabled: !rack, run: () => rack && this.guard(ungroupRack(owner, rack.id)) },
        ...(presets.length ? [SEPARATOR, ...presets] : []),
      ]);
    });
    const paramOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-param]')?.dataset.param;
    const intercept = (e: Event) => {
      const param = paramOf(e.target);
      if (!param) return;
      const racks = this.deps.store.project.racksOf(owner);
      const map = this.mapMode;
      const mapping = map && map.macro !== null && rackOf(racks, key)?.id === map.rack;
      if (!mapping && !macroOf(racks, key, param)) return;
      e.stopPropagation();
      e.preventDefault();
      if (mapping && e.type === 'pointerdown') this.guard(mapMacro(owner, map.rack, map.macro!, key, param));
    };
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'keydown']) {
      panel.element.addEventListener(type, intercept, { capture: true, passive: false });
    }
    panel.element.addEventListener('contextmenu', e => {
      const param = paramOf(e.target);
      if (!param) return;
      e.preventDefault();
      e.stopPropagation();
      const extra = this.displays.get(key)?.menuFor?.(param) ?? [];
      showContextMenu(e.clientX, e.clientY, [...extra, ...(extra.length ? [SEPARATOR] : []), ...this.paramMenu(owner, key, param)]);
    });
  }

  /** Il menu di un parametro: su quale macro del suo rack mapparlo. */
  private paramMenu(owner: ChainOwner, key: DeviceKey, param: string): MenuItem[] {
    const project = this.deps.store.project;
    const racks = project.racksOf(owner);
    const rack = rackOf(racks, key);
    if (!rack) return [{ label: 'Raggruppa in un rack per mapparlo su una macro', shortcut: 'Ctrl+G', run: () => this.groupSelection([key]) }];
    const current = macroOf(racks, key, param);
    const label = (x: { device: DeviceKey; param: string }) => {
      const t = deviceTypeAt(project, owner, x.device);
      return t && paramSpec(t, x.param)?.label;
    };
    return [
      ...rack.macros.map((m, i): MenuItem => {
        const name = macroName(m, i, label);
        return {
          label: `Mappa su ${name}${name === `Macro ${i + 1}` ? '' : ` (macro ${i + 1})`}`,
          checked: current?.index === i,
          run: () => this.guard(mapMacro(owner, rack.id, i, key, param)),
        };
      }),
      SEPARATOR,
      { label: 'Togli dalla macro', disabled: !current, run: () => this.guard(unmapParam(owner, key, param)) },
    ];
  }

  /** I parametri mappati: attenuati, con il numero della macro; con "Map" acceso si vedono quelli
   *  che si possono mappare e quelli della macro scelta. */
  private showMapped(racks: RackList): void {
    for (const key of this.panels.keys()) this.markMapped(key as DeviceKey, racks);
  }

  /** I segni delle macro su un pannello (anche quando un pannello grafico rifà i suoi controlli). */
  private markMapped(key: DeviceKey, racks?: RackList): void {
    const panel = this.panels.get(key);
    if (!panel || !this.owner) return;
    racks ??= this.deps.store.project.racksOf(this.owner);
    const map = this.mapMode;
    const rack = rackOf(racks, key);
    panel.element.classList.toggle('mappable', !!map && map.macro !== null && rack?.id === map.rack);
    for (const e of panel.element.querySelectorAll<HTMLElement>('[data-param]')) {
      const found = macroOf(racks, key, e.dataset.param!);
      e.classList.toggle('mapped', !!found);
      e.classList.toggle('chosen', !!found && !!map && found.rack.id === map.rack && found.index === map.macro);
      if (found) {
        e.dataset.macro = String(found.index + 1);
        e.title = `Lo muove la macro ${found.index + 1} del rack (tasto destro per toglierlo)`;
      } else delete e.dataset.macro;
    }
  }

  // ---------------------------------------------------------------- scelta e gruppi

  private showSelection(): void {
    for (const [key, panel] of this.panels) panel.element.classList.toggle('selected', this.selection.includes(key as DeviceKey));
    for (const [key, panel] of this.rackPanels) {
      const rack = this.owner ? this.deps.store.project.racksOf(this.owner).find(r => r.id === key) : undefined;
      panel.element.classList.toggle('selected', !!rack && rack.devices.every(k => this.selection.includes(k)));
    }
  }

  /** Clic sul nome di un dispositivo (o di un rack: i suoi dispositivi); con Maiusc la scelta va
   *  dal primo scelto fino a qui. Un altro clic sulla stessa scelta la toglie. */
  private select(keys: readonly DeviceKey[], extend: boolean): void {
    const order = this.owner ? this.deps.store.project.chainKeys(this.owner) : [];
    if (extend && this.anchor && order.includes(this.anchor)) {
      const ends = [this.anchor, ...keys].map(k => order.indexOf(k));
      this.selection = order.slice(Math.min(...ends), Math.max(...ends) + 1);
    } else {
      const same = keys.length === this.selection.length && keys.every(k => this.selection.includes(k));
      this.selection = same ? [] : [...keys];
      this.anchor = same ? null : keys[0];
    }
    this.showSelection();
  }

  /** Ctrl+G: i dispositivi scelti in un rack nuovo. */
  private groupSelection(keys: readonly DeviceKey[] = this.selection): void {
    const owner = this.owner;
    if (!owner) return;
    if (!keys.length) return this.deps.say?.('Scegli i dispositivi da raggruppare: clic sul nome, Maiusc+clic per più di uno; poi Ctrl+G.');
    if (this.guard(groupDevices(owner, keys))) this.selection = [];
    this.showSelection();
  }

  /** Ctrl+Maiusc+G: separa il rack dei dispositivi scelti. */
  private ungroupSelection(): void {
    const owner = this.owner;
    const rack = owner && this.selection.length ? rackOf(this.deps.store.project.racksOf(owner), this.selection[0]) : undefined;
    if (!owner || !rack) return this.deps.say?.('Scegli un rack (clic sul suo nome), poi Ctrl+Maiusc+G per separarlo.');
    this.guard(ungroupRack(owner, rack.id));
  }

  /** Una modifica che può non essere permessa: il perché va nella barra di stato. */
  private guard(edit: Edit): boolean {
    try {
      this.deps.store.apply(edit);
      return true;
    } catch (e) {
      this.deps.say?.(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  // ---------------------------------------------------------------- pannelli

  private instrumentPanel(track: MidiTrack): HTMLElement | null {
    const type = instrumentType(track.instrument.type);
    if (!type) return null;
    const { store, audition } = this.deps;
    const select = el<HTMLSelectElement>('select', { title: 'Strumento' },
      ...INSTRUMENT_TYPES.map(t => el('option', { value: t.type, textContent: t.label })));
    select.value = type.type;
    select.onchange = () => store.apply(setInstrument(track.id, { ...DEFAULT_INSTRUMENT, type: select.value, preset: null }));
    // la nota di prova: il Do3, o il primo nome che lo strumento dà alle note (la cassa della drum machine)
    const testPitch = () => {
      const t = store.project.track(track.id);
      const names = t instanceof MidiTrack
        ? type.noteNames?.(resolveParams(type, t.instrument.params), store.project.sampleNames(t.instrument)) : undefined;
      return names?.size ? Math.min(...names.keys()) : 60;
    };
    const test = el<HTMLButtonElement>('button', { className: 'mini', textContent: '♪', title: 'Suona una nota di prova', onclick: () => audition(track.id, testPitch()) });
    const display = DEVICE_DISPLAYS[type.type]?.({
      type, settings: track.instrument, sampleRate: this.deps.sampleRate,
      setParams: (values, final) => this.displayParams(track.id, INSTRUMENT, values, final,
        v => setInstrumentParams(track.id, v), `param-${track.id}`),
      controlsChanged: () => this.markMapped(INSTRUMENT),
      openSpectrum: () => NO_SPECTRUM,
      audition: (pitch, velocity) => audition(track.id, pitch, velocity),
      playedNotes: this.deps.playedNotes(track.id),
      playheads: () => this.deps.playheads?.(track.id) ?? [],
      samples: {
        list: () => store.project.samples,
        load: async (slot, file, values) => {
          const sample = await this.deps.importSample(file);
          store.apply(setInstrumentSamples(track.id, { [slot]: sample }, values));
        },
        assign: (changes, values) => store.apply(setInstrumentSamples(track.id, changes, values)),
        audio: slot => {
          const t = store.project.track(track.id);
          const id = t instanceof MidiTrack ? sampleAt(t.instrument, slot) : null;
          return id ? this.deps.sampleAudio?.(id) : undefined;
        },
      },
    });
    if (display) this.displays.set(INSTRUMENT, display);
    const panel = new DevicePanel({
      type, settings: track.instrument, before: [select], after: [test], display, ...this.foldOptions(track.id, INSTRUMENT),
      onParam: (id, v, final) => this.param(setInstrumentParam(track.id, id, v), `param-${track.id}-${id}`, final),
      onPreset: p => {
        store.apply(loadPreset(track.id, p.name, p.params));
        audition(track.id, testPitch());
      },
      onPresetSaved: p => store.apply(loadPreset(track.id, p.name, p.params)),
      say: this.deps.say,
    });
    panel.element.classList.add('instrument-panel');
    this.panels.set(INSTRUMENT, panel);
    return panel.element;
  }

  private effectPanel(owner: ChainOwner, e: EffectSettings, canMove: (dir: -1 | 1) => boolean): HTMLElement | null {
    const type = effectType(e.type);
    if (!type) return null;
    const { store } = this.deps;
    const id = e.id;
    const current = () => this.effects().find(x => x.id === id);
    const button = (text: string, title: string, run: () => void, disabled = false) =>
      el<HTMLButtonElement>('button', { className: 'mini', textContent: text, title, disabled, onclick: run });
    const power = button('⏻', 'Accendi/spegni', () => store.apply(setEffectEnabled(owner, id, !current()?.enabled)));
    power.classList.add('power');
    const display = DEVICE_DISPLAYS[e.type]?.({
      type, settings: e, sampleRate: this.deps.sampleRate,
      setParams: (values, final) => this.displayParams(owner, id, values, final, v => setEffectParams(owner, id, v), `fx-${id}`),
      controlsChanged: () => this.markMapped(id),
      openSpectrum: () => this.deps.spectrum(owner, id),
      audition: () => {},
      playedNotes: () => [],
    });
    const sidechain = type.sidechain ? new SidechainPicker(source => store.apply(setEffectSidechain(owner, id, source))) : null;
    if (sidechain) {
      sidechain.update(store.project, owner, e);
      this.sidechains.set(id, sidechain);
    }
    const panel = new DevicePanel({
      type, settings: e, before: [power], display, extra: sidechain ? [sidechain.element] : [], ...this.foldOptions(owner, id),
      after: [
        button('◂', 'Sposta prima (dal bordo di un rack ne esce, accanto a un rack ci entra)', () => store.apply(moveDevice(owner, id, -1)), !canMove(-1)),
        button('▸', 'Sposta dopo (dal bordo di un rack ne esce, accanto a un rack ci entra)', () => store.apply(moveDevice(owner, id, 1)), !canMove(1)),
        button('×', 'Elimina l\'effetto', () => store.apply(removeEffect(owner, id))),
      ],
      onParam: (param, v, final) => this.param(setEffectParam(owner, id, param, v), `fx-${id}-${param}`, final),
      onPreset: p => store.apply(loadEffectPreset(owner, id, p.name, p.params)),
      onPresetSaved: p => store.apply(loadEffectPreset(owner, id, p.name, p.params)),
      say: this.deps.say,
    });
    panel.update(e, e.enabled);
    this.panels.set(id, panel);
    if (display) this.displays.set(id, display);
    return panel.element;
  }

  /** I parametri da un pannello grafico (es. un punto dell'EQ trascinato): quelli mappati su una
   *  macro non si toccano, come le loro manopole. */
  private displayParams(owner: ChainOwner, key: DeviceKey, values: ParamValues, final: boolean,
    edit: (values: ParamValues) => Edit, mergeKey: string): void {
    const racks = this.deps.store.project.racksOf(owner);
    const free = Object.fromEntries(Object.entries(values).filter(([param]) => !macroOf(racks, key, param)));
    const ids = Object.keys(free).sort();
    if (ids.length) this.param(edit(free), `${mergeKey}-${ids.join(',')}`, final);
    else if (final) this.deps.store.endMerge();
  }

  /** Una manopola trascinata è un solo passo di annullamento. */
  private param(edit: Edit, mergeKey: string, final: boolean): void {
    this.deps.store.apply(edit, { mergeKey });
    if (final) this.deps.store.endMerge();
  }
}

/** La forma della catena: cambia se cambiano proprietario, strumento, effetti, il loro ordine o
 *  tipo, i rack (dispositivi, nomi, mappature) o come si mostrano (`view`). */
const shapeOf = (owner: ChainOwner, { track, effects, racks }: ChainSource, view: string): string =>
  [owner, track instanceof MidiTrack ? track.instrument.type : '-', ...effects.map(e => `${e.id}:${e.type}`), view,
    JSON.stringify(racks.map(r => [r.id, r.name, r.devices, r.macros.map(m => [m.name, m.mappings.map(x => `${x.device}:${x.param}`)])]))].join('|');

/** I nomi dei dispositivi di una catena: "Delay", "Delay 2"… */
function deviceLabels(p: Project, owner: ChainOwner): Map<DeviceKey, string> {
  const out = new Map<DeviceKey, string>();
  const seen = new Map<string, number>();
  for (const key of p.chainKeys(owner)) {
    const label = deviceTypeAt(p, owner, key)?.label ?? key;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    out.set(key, n > 1 ? `${label} ${n}` : label);
  }
  return out;
}

const missing = (type: string) =>
  el('div', { className: 'device-empty muted', textContent: `"${type}" non è disponibile in questa versione.` });
