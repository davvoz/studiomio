/* The device chain of a track or of the master, in a row as in Live: the instrument (MIDI
 * tracks), then the effects in the order the sound goes through them; a rack gathers its devices
 * behind the macro panel. A click on the name chooses a device (Shift: more than one), Ctrl+G
 * groups them into a rack, Ctrl+Shift+G ungroups it. Every change goes through the store (it can
 * be undone) and is heard right away, even while playing.
 * This file only builds the panels, marks them and wires the events: the chosen devices are in
 * device-selection, the commands in device-commands, the menus in device-menus, the macros'
 * mapping in macro-mapping, names and shape in chain-labels, the folds in chain-folds. */
import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { DeviceId, SampleId, TrackId } from '../../core/id';
import type { SampleData } from '../../devices/dsp/core';
import { effectType, INSTRUMENT_TYPES, instrumentType } from '../../devices/registry';
import { mappingSpec } from '../../devices/rack-params';
import { DEFAULT_INSTRUMENT, sampleAt, type EffectSettings, type ParamValues } from '../../model/device';
import type { ModTarget } from '../../model/envelope';
import { keyLabel, keyOf, sameTarget, type KeyTarget } from '../../model/key-map';
import { encodeMidiTarget } from '../../model/midi-map';
import type { ChainOwner } from '../../model/project';
import {
  chainItems, findRack, macroIndex, macroParam, moveDevice as layoutMove, moveRack as layoutMoveRack, nestRack as layoutNestRack,
  type ChainItem, type DeviceKey, type Rack, type RackList,
} from '../../model/rack';
import type { SampleRef } from '../../model/sample';
import { MidiTrack } from '../../model/track';
import type { Clipboard } from '../../store/clipboard';
import {
  addEffect, loadEffectPreset, loadPreset, removeEffect, setEffectEnabled, setEffectParam, setEffectParams, setEffectSidechain,
  setInstrument, setInstrumentParam, setInstrumentParams, setInstrumentSamples, setModTarget,
} from '../../store/edits';
import type { MacroSprings } from '../../store/macro-springs';
import type { Edit, ProjectStore } from '../../store/project-store';
import { addEffectToRack, mapMacro, moveDevice } from '../../store/rack-edits';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { SEPARATOR, showContextMenu } from '../context-menu';
import { el } from '../dom';
import { addHeightHandle, DEVICE_HEIGHT } from '../editor-height';
import { ownedByField } from '../keymap';
import type { ControlledDevice, UiState } from '../ui-state';
import { ChainFolds } from './chain-folds';
import { chainSource, deviceLabels, modTargetChoices, modTargetLabel, modulatedParams, shapeOf, type ChainSource } from './chain-labels';
import { controlOf, type ParamControl } from './controls';
import { DEVICE_KEYS, DeviceCommands } from './device-commands';
import {
  INSTRUMENT, automationMenu, clipboardMenu, deviceHeadMenu, effectChoices, emptyChainMenu, outerMacroMenu, paramMenu, type DeviceMenuDeps,
} from './device-menus';
import { DevicePanel } from './device-panel';
import { testPitch, withKept } from './device-params';
import { DeviceSelection } from './device-selection';
import { DEVICE_DISPLAYS, NO_DYNAMICS, NO_SPECTRUM, type DeviceDisplay, type DynamicsTap, type ModTargetHost, type SpectrumTap } from './displays';
import { controlClick, deviceMappable, freeParams, keyGoesToMacro, macroMark, mappingInto, paramMark, type ControlMark, type MapMode } from './macro-mapping';
import { RackPanel } from './rack-panel';
import { SidechainPicker } from './sidechain-picker';

export { MASTER_COLOR } from './chain-labels';

export interface DeviceViewDeps {
  readonly store: ProjectStore;
  /** Plays a test note with the track's instrument. */
  readonly audition: (track: TrackId, pitch: number, velocity?: number) => void;
  readonly sampleRate: number;
  /** The spectrum of a playing effect (for the graphic panels). */
  readonly spectrum: (owner: ChainOwner, id: DeviceId) => SpectrumTap;
  /** What a playing dynamics effect is doing (for its panel). */
  readonly dynamics?: (owner: ChainOwner, id: DeviceId) => DynamicsTap;
  /** To follow the notes the track plays: each call of the given function returns
   *  those started since the previous call. */
  readonly playedNotes: (track: TrackId) => () => readonly number[];
  /** Copies an audio file into the project and loads it in the engine (for the instruments' samples). */
  readonly importSample: (file: File) => Promise<SampleRef>;
  /** The samples of a project sample already loaded (for the panels drawing it). */
  readonly sampleAudio?: (id: SampleId) => SampleData | undefined;
  /** Where the voices of the track's instrument read now, if it plays a sample. */
  readonly playheads?: (track: TrackId) => readonly number[];
  /** A message in the status bar (e.g. why a grouping can't be done). */
  readonly say?: (text: string) => void;
  /** The app's clipboard, to copy devices from one chain to another. */
  readonly clipboard?: Clipboard;
  /** Shows a parameter's curve: in the track's clip or, on the master, on the timeline. */
  readonly showAutomation?: (owner: ChainOwner, target: ModTarget) => void;
  /** A browser item dropped on the open chain. */
  readonly dropItem?: (item: BrowserItem, target: LoadTarget) => void;
  /** To map the computer keyboard (KEY on and the chosen target). */
  readonly ui?: UiState;
  /** Where a playing curve takes a parameter now (knob offset, −1 … +1),
   *  or null: the knobs follow it. */
  readonly modulation?: (owner: ChainOwner, target: ModTarget) => number | null;
  /** The spring macros: the mouse says when it holds one and when it lets it go. */
  readonly springs?: MacroSprings;
}

/** How close to the chain's edge a drag makes it scroll, and by how much per frame. */
const EDGE_ZONE = 56;
const EDGE_STEP = 14;

/** The events a control's mapping or key choice takes over (they don't reach the control). */
const CONTROL_EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'keydown'];

const missing = (type: string) =>
  el('div', { className: 'device-empty muted', textContent: `"${type}" isn't available in this version.` });

/** A control's mark: dimmed if a macro moves it, with the macro's number and who moves it. */
function applyMark(e: HTMLElement, mark: ControlMark, appendTitle: boolean): void {
  e.classList.toggle('mapped', mark.mapped);
  if (mark.chosen !== null) e.classList.toggle('chosen', mark.chosen);
  if (mark.macro === null) {
    delete e.dataset.macro;
    return;
  }
  e.dataset.macro = mark.macro;
  e.title = appendTitle ? e.title + mark.title : mark.title!;
}

const stop = (e: Event): void => {
  e.stopPropagation();
  e.preventDefault();
};

export class DeviceView {
  readonly element = el('section', { className: 'device-view', hidden: true, tabIndex: -1 });
  private owner: ChainOwner | null = null;
  private back: (() => void) | null = null;
  /** What the chain was like when the panels were built. */
  private builtFor = '';
  private readonly panels = new Map<string, DevicePanel>();
  /** The graphic panels, by key (for their items in the parameters' menu). */
  private readonly displays = new Map<string, DeviceDisplay>();
  private readonly rackPanels = new Map<DeviceId, RackPanel>();
  private readonly sidechains = new Map<DeviceId, SidechainPicker>();
  private readonly title = el('span', { className: 'device-title' });
  private readonly backButton = el<HTMLButtonElement>('button', { textContent: '◂ Note', title: 'Back to the piano roll' });
  private readonly chain = el('div', { className: 'device-chain' });
  /** The modulator choosing its targets with a click. */
  private picking: { readonly host: ModTargetHost; readonly pick: (target: ModTarget) => void; readonly ended: () => void } | null = null;
  /** The device a controller's knobs move (Live's "blue hand"). */
  private controlled: ControlledDevice | null = null;
  private readonly chosen: DeviceSelection;
  private readonly commands: DeviceCommands;
  private readonly menus: DeviceMenuDeps;
  private readonly folds = new ChainFolds();
  /** Whose the chain built last time was: another chain starts from the beginning. */
  private builtOwner: ChainOwner | null = null;
  /** "Map" on on a rack, with the chosen macro. */
  private mapMode: MapMode | null = null;
  /** The controls the curves can move, with their target (null: to be redone). */
  private curveControls: { readonly control: ParamControl; readonly target: ModTarget }[] | null = null;

  constructor(private readonly deps: DeviceViewDeps) {
    this.chosen = new DeviceSelection(() => deps.store.project, () => this.owner);
    this.commands = new DeviceCommands(deps, this.chosen, () => this.owner, () => this.showSelection());
    this.menus = { store: deps.store, clipboard: deps.clipboard, commands: this.commands, showAutomation: deps.showAutomation };
    this.backButton.onclick = () => this.back?.();
    const add = el<HTMLButtonElement>('button', { textContent: '+ Effect', title: 'Add an effect at the end of the chain' });
    add.onclick = () => {
      const r = add.getBoundingClientRect();
      this.chooseEffect(r.left, r.bottom + 2);
    };
    const foldAll = el<HTMLButtonElement>('button', {
      textContent: '⇤⇥', title: 'Collapse all the devices (or reopen them, if they\'re all collapsed already)', onclick: () => this.foldAll(),
    });
    const close = el<HTMLButtonElement>('button', { className: 'close', textContent: '×', title: 'Close (Esc)', onclick: () => this.close() });
    const head = el('div', { className: 'device-head' }, this.backButton, this.title, foldAll, add, close);
    this.element.append(head, this.chain);
    // dragged down past the minimum height only the header remains; it reopens from the edge
    const view = this.element;
    addHeightHandle(view, DEVICE_HEIGHT, {
      get folded() { return view.classList.contains('folded'); },
      get foldedHeight() { return head.offsetHeight + view.clientTop; },
      fold: () => view.classList.add('folded'),
      unfold: () => view.classList.remove('folded'),
    });
    this.element.addEventListener('keydown', e => this.key(e));
    // the panels' tabs wrap within the chain's height: it's redone when it changes
    new ResizeObserver(() => this.fitPanels()).observe(this.chain);
    // with the wheel the chain scrolls, except where a knob uses it
    this.chain.addEventListener('wheel', e => {
      if (!e.defaultPrevented && e.deltaY && !e.ctrlKey) this.chain.scrollLeft += e.deltaY;
    });
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel']) {
      this.chain.addEventListener(type, e => this.pickEvent(e as MouseEvent), { capture: true, passive: false });
    }
    // in the chain's empty space (also of a chain without effects) you can paste
    this.chain.addEventListener('contextmenu', e => {
      if ((e.target as HTMLElement).closest('.device-panel, .rack-panel')) return;
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, emptyChainMenu(this.menus));
    });
    deps.store.onChange(() => this.sync());
    deps.ui?.onChange(() => this.showKeys());
    const dropItem = deps.dropItem;
    if (dropItem) acceptBrowserDrops(this.element, item => this.owner && dropItem(item, { kind: 'chain', owner: this.owner }), { accept: () => !!this.owner });
    if (deps.modulation) this.followCurves(deps.modulation);
  }

  /** Esc closes, Ctrl+G groups (with Shift ungroups), Ctrl+C/X/V/D on the chosen devices. */
  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      stop(e);
      if (e.shiftKey) this.commands.ungroupSelection();
      else this.commands.groupSelection();
    }
    const command = !ownedByField(e.target as HTMLElement | null, e) && (e.ctrlKey || e.metaKey) && !e.shiftKey ? DEVICE_KEYS[e.key.toLowerCase()] : undefined;
    if (command) {
      stop(e);
      command(this.commands);
    }
  }

  /** At every frame the knobs of the open chain go where the playing curves take them
   *  (of the clip or of the master, also through the macros). */
  private followCurves(at: (owner: ChainOwner, target: ModTarget) => number | null): void {
    const frame = () => {
      requestAnimationFrame(frame);
      const owner = this.owner;
      if (!owner || this.element.classList.contains('folded')) return;
      this.curveControls ??= this.findCurveControls();
      for (const { control, target } of this.curveControls) control.modulate!(at(owner, target) ?? 0);
    };
    requestAnimationFrame(frame);
  }

  /** The controls of the devices and the macros of the racks of the built chain. */
  private findCurveControls(): { control: ParamControl; target: ModTarget }[] {
    const out: { control: ParamControl; target: ModTarget }[] = [];
    const add = (device: string, elements: Iterable<HTMLElement>) => {
      for (const e of elements) {
        const control = controlOf(e);
        if (control?.modulate) out.push({ control, target: { kind: 'device', device: device as DeviceId, param: e.dataset.param! } });
      }
    };
    for (const [key, panel] of this.panels) add(key, panel.element.querySelectorAll<HTMLElement>('[data-param]'));
    for (const [rack, panel] of this.rackPanels) add(rack, panel.element.querySelectorAll<HTMLElement>('.macro[data-param]'));
    return out;
  }

  get isOpen(): boolean {
    return this.owner !== null;
  }

  /** Whose the open chain is (for automated tests). */
  get openOwner(): ChainOwner | null {
    return this.owner;
  }

  /** Opens the devices of a track or of the master; `back` returns to whoever opened it (the piano roll). */
  open(owner: ChainOwner, back: (() => void) | null = null): boolean {
    if (!chainSource(this.deps.store.project, owner)) return false;
    if (owner !== this.owner) {
      this.chosen.clear();
      this.mapMode = null;
    }
    this.owner = owner;
    this.back = back;
    this.builtFor = '';
    this.element.hidden = false;
    this.element.classList.remove('folded');
    this.sync();
    this.element.focus({ preventScroll: true });
    return true;
  }

  close(): void {
    this.stopPicking();
    this.owner = null;
    this.element.hidden = true;
  }

  /** Ctrl+V from the app on the open chain: after the chosen devices. */
  pasteSelection(): void {
    this.commands.pasteSelection();
  }

  /** Marks the device a controller moves (null: none); if it changes, the chain scrolls
   *  until it shows it. */
  markControlled(device: ControlledDevice | null): void {
    const moved = device?.owner !== this.controlled?.owner || device?.device !== this.controlled?.device;
    this.controlled = device;
    this.showControlled();
    if (moved) this.revealControlled();
  }

  private revealControlled(): void {
    const c = this.controlled;
    if (c?.owner !== this.owner) return;
    const panel = this.panels.get(c.device) ?? this.rackPanels.get(c.device as DeviceId);
    if (panel) this.reveal(panel.element);
  }

  /** Scrolls the chain (and only it, not the area containing it) as much as needed to show `element`;
   *  if it's wider than the chain its start is shown. */
  private reveal(element: HTMLElement): void {
    const view = this.chain.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    const pad = 10;
    if (r.right > view.right - pad) this.chain.scrollLeft += Math.min(r.right - view.right + pad, r.left - view.left - pad);
    else if (r.left < view.left + pad) this.chain.scrollLeft += r.left - view.left - pad;
  }

  /** Collapses all the chain's devices, or reopens them if they already are. */
  private foldAll(): void {
    const owner = this.owner;
    if (!owner) return;
    const fold = [...this.panels.values()].some(p => !p.folded);
    for (const [key, panel] of this.panels) {
      panel.setFolded(fold);
      if (fold) this.folds.foldDevice(owner, key);
      else this.folds.unfoldDevice(owner, key);
    }
  }

  /** A panel's options to collapse it, remembering the choice. */
  private foldOptions(owner: ChainOwner, key: string) {
    return {
      folded: this.folds.deviceFolded(owner, key),
      onFold: (folded: boolean) => (folded ? this.folds.foldDevice(owner, key) : this.folds.unfoldDevice(owner, key)),
    };
  }

  private showControlled(): void {
    const c = this.controlled;
    const mine = (key: string) => !!c && c.owner === this.owner && c.device === key;
    for (const [key, panel] of this.panels) panel.element.classList.toggle('controlled', mine(key));
    for (const [key, panel] of this.rackPanels) panel.element.classList.toggle('controlled', mine(key));
  }

  /** The menu of effect types; the chosen one goes at the end of the chain. */
  chooseEffect(x: number, y: number): void {
    const owner = this.owner;
    if (!owner) return;
    showContextMenu(x, y, effectChoices(this.menus, owner).map(t => ({ label: t.label, run: () => this.deps.store.apply(addEffect(owner, t.type, t.label)) })));
  }

  private sync(): void {
    if (!this.owner) return;
    const source = chainSource(this.deps.store.project, this.owner);
    if (!source) return this.close();
    this.title.textContent = source.name;
    this.title.style.setProperty('--color', source.color);
    this.backButton.hidden = !this.back;
    const mapping = this.mapMode ? `${this.mapMode.rack}:${this.mapMode.macro}` : '';
    const shape = shapeOf(this.owner, source, `${this.folds.racksKey}/${mapping}`);
    if (shape !== this.builtFor) this.build(this.owner, source, shape);
    else this.update(source);
    this.showKeys();
    this.markModulated();
  }

  /** New panels when the chain's shape changes (effects added, removed, moved, racks). */
  private build(owner: ChainOwner, source: ChainSource, shape: string): void {
    this.stopPicking();
    const sameOwner = owner === this.builtOwner;
    this.builtOwner = owner;
    const scroll = sameOwner ? this.chain.scrollLeft : 0;
    const known = new Set(this.panels.keys());
    this.builtFor = shape;
    this.curveControls = null;
    this.panels.clear();
    this.displays.clear();
    this.rackPanels.clear();
    this.sidechains.clear();
    const { effects, racks } = source;
    if (this.mapMode && !racks.some(r => r.id === this.mapMode!.rack)) this.mapMode = null;
    this.chosen.keepIn(this.deps.store.project.chainKeys(owner));
    const items = this.chainNodes(owner, source);
    if (!effects.length) items.push(el('div', { className: 'device-empty muted', textContent: 'No effects: "+ Effect" adds one.' }));
    this.chain.replaceChildren(...items);
    this.fitPanels();
    this.chain.scrollLeft = scroll;
    this.showControlled();
    this.showSelection();
    this.showMapped(racks);
    // another chain starts from the beginning, or from the device the controller moves
    if (!sameOwner) this.revealControlled();
    // a just-added effect is shown right away, even at the end of a long chain
    const added = sameOwner && known.size ? effects.findLast(e => !known.has(e.id)) : undefined;
    const panel = added && this.panels.get(added.id);
    if (panel) this.reveal(panel.element);
  }

  /** The chain's panels in the order of the sound, the racks with their elements inside (also other racks). */
  private chainNodes(owner: ChainOwner, { track, effects, racks }: ChainSource): Node[] {
    const project = this.deps.store.project;
    const order = project.chainKeys(owner);
    const labels = deviceLabels(project, owner);
    const changes = (next: { order: readonly DeviceKey[]; racks: RackList }) => next.order !== order || next.racks !== racks;
    const canMove = (key: DeviceKey, dir: -1 | 1) => changes(layoutMove(order, racks, key, dir));
    const panelOf = (key: DeviceKey): Node => {
      const e = effects.find(x => x.id === key);
      let node: Node;
      if (e) node = this.effectPanel(owner, e, dir => canMove(e.id, dir)) ?? missing(e.type);
      else if (track instanceof MidiTrack) node = this.instrumentPanel(track) ?? missing(track.instrument.type);
      else node = missing(key);
      const panel = this.panels.get(key);
      if (panel) this.bindPanel(owner, key, panel);
      return node;
    };
    const itemNode = (item: ChainItem): Node => (item.kind === 'device'
      ? panelOf(item.key)
      : this.rackElement(owner, item.rack, labels, () => chainItems(order, racks, item.rack).map(itemNode), {
        move: dir => changes(layoutMoveRack(order, racks, item.rack.id, dir)),
        nest: dir => changes(layoutNestRack(order, racks, item.rack.id, dir)),
      }));
    return chainItems(order, racks).map(itemNode);
  }

  private fitPanels(): void {
    for (const panel of this.panels.values()) panel.fitRows();
  }

  private update({ track, effects, racks }: ChainSource): void {
    if (track instanceof MidiTrack) this.panels.get(INSTRUMENT)?.update(track.instrument);
    for (const e of effects) this.panels.get(e.id)?.update(e, e.enabled);
    if (this.owner) for (const e of effects) this.sidechains.get(e.id)?.update(this.deps.store.project, this.owner, e);
    for (const r of racks) this.rackPanels.get(r.id)?.update(r);
  }

  // ---------------------------------------------------------------- rack

  /** A rack: the macro panel and, if it isn't closed, its elements (`contents`). */
  private rackElement(owner: ChainOwner, rack: Rack, labels: ReadonlyMap<DeviceKey, string>, contents: () => Node[],
    can: { readonly move: (dir: -1 | 1) => boolean; readonly nest: (dir: -1 | 1) => boolean }): HTMLElement {
    const folded = this.folds.rackFolded(rack.id);
    const mapping = this.mapMode?.rack === rack.id ? this.mapMode.macro : undefined;
    const panel = new RackPanel({
      store: this.deps.store, springs: this.deps.springs, owner, rack, folded, mapping, canMove: can.move, canNest: can.nest,
      deviceLabel: key => labels.get(key) ?? key,
      headMenu: () => clipboardMenu(this.menus, owner, rack.devices, rack.id),
      macroMenu: index => automationMenu(this.menus, owner, { kind: 'device', device: rack.id, param: macroParam(index) }),
      outerMenu: index => outerMacroMenu(this.menus, owner, rack.id, index),
      onMapMode: macro => {
        this.mapMode = macro === undefined ? null : { rack: rack.id, macro };
        this.sync();
      },
      onFold: () => {
        this.folds.toggleRack(rack.id);
        this.sync();
      },
      onAddEffect: (x, y) => showContextMenu(x, y, effectChoices(this.menus, owner).map(t => ({
        label: t.label, run: () => this.deps.store.apply(addEffectToRack(owner, rack.id, t.type, t.label)),
      }))),
      onSelect: extend => this.select(rack.devices, extend, rack.id),
      keyMapping: () => !!this.deps.ui?.keyMapping,
      onKeyTarget: index => this.deps.ui?.chooseKeyTarget({ kind: 'macro', owner, rack: rack.id, index }),
      say: this.deps.say,
    });
    this.rackPanels.set(rack.id, panel);
    this.interceptControls(panel.element, '.macro[data-param]', rack.id, owner, false);
    const element = el('div', { className: `rack${folded ? ' folded' : ''}${mapping !== undefined ? ' mapping' : ''}` }, panel.element);
    if (!folded) element.append(...contents());
    else element.append(el('div', { className: 'rack-folded muted' }, ...rack.devices.map(key => el('div', { textContent: labels.get(key) ?? key }))));
    return element;
  }

  /** On the controls of device (or rack) `key`: with KEY on (`keys`) a click chooses the control for
   *  the computer keyboard; with "Map" on and a macro chosen around it a click maps it there; mapped
   *  to a macro it isn't touched (the macro moves it). */
  private interceptControls(element: HTMLElement, selector: string, key: DeviceKey, owner: ChainOwner, keys: boolean): void {
    const intercept = (e: Event) => {
      const param = (e.target as HTMLElement | null)?.closest<HTMLElement>(selector)?.dataset.param;
      const keyMapping = !!this.deps.ui?.keyMapping;
      if (!param || (keyMapping && !keys)) return;
      const racks = this.deps.store.project.racksOf(owner);
      const action = controlClick(keyMapping, this.mapMode, racks, key, param);
      if (action === 'pass') return;
      stop(e);
      if (e.type !== 'pointerdown') return;
      if (action === 'key') this.chooseKeyParam(owner, key, param);
      const mapping = action === 'map' ? mappingInto(this.mapMode, racks, key) : null;
      if (mapping) this.commands.guard(mapMacro(owner, mapping.rack, mapping.macro, key, param));
    };
    for (const type of CONTROL_EVENTS) element.addEventListener(type, intercept, { capture: true, passive: false });
  }

  /** On a device: the click on the name chooses it, the header's menu copies, groups and
   *  ungroups, a parameter's menu maps it to a macro; its controls' clicks (see interceptControls). */
  private bindPanel(owner: ChainOwner, key: DeviceKey, panel: DevicePanel): void {
    const name = panel.element.querySelector<HTMLElement>('.device-name');
    if (name) {
      name.onclick = e => this.select([key], e.shiftKey);
      name.title = 'Click: choose (Shift: more than one), then Ctrl+G to group into a rack';
    }
    panel.element.querySelector('.device-panel-head')?.addEventListener('contextmenu', e => {
      const ev = e as MouseEvent;
      ev.preventDefault();
      showContextMenu(ev.clientX, ev.clientY, deviceHeadMenu(this.menus, owner, key, this.chosen.keys, panel.presetMenu()));
    });
    this.interceptControls(panel.element, '[data-param]', key, owner, true);
    panel.element.addEventListener('contextmenu', e => {
      const param = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-param]')?.dataset.param;
      if (!param) return;
      stop(e);
      const extra = this.displays.get(key)?.menuFor?.(param) ?? [];
      showContextMenu(e.clientX, e.clientY, [...extra, ...(extra.length ? [SEPARATOR] : []), ...paramMenu(this.menus, owner, key, param)]);
    });
  }

  // ---------------------------------------------------------------- modulators

  /** For the panel of modulator `id`: the targets of `owner`'s chain. */
  private modTargetHost(owner: ChainOwner, id: DeviceId): ModTargetHost {
    const { store } = this.deps;
    const host: ModTargetHost = {
      at: (x, y) => this.modTargetAt(owner, id, x, y),
      label: t => modTargetLabel(store.project, owner, t),
      choices: () => modTargetChoices(store.project, owner),
      set: (slot, target, amount) => store.apply(setModTarget(owner, id, slot, target, amount)),
      startPicking: (pick, ended) => this.startPicking(id, host, pick, ended),
      stopPicking: () => this.stopPicking(),
      scrollToward: x => this.scrollToward(x),
      say: text => this.deps.say?.(text),
    };
    return host;
  }

  /** The control under the point that modulator `id` can move: a rack's macro or another device's parameter. */
  private modTargetAt(owner: ChainOwner, id: DeviceId, x: number, y: number): { target: ModTarget; element: HTMLElement } | null {
    const e = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-param]');
    if (!e || !this.chain.contains(e)) return null;
    const param = e.dataset.param!, project = this.deps.store.project;
    const valid = (device: DeviceKey) => !!mappingSpec(project, owner, { device, param });
    for (const [rack, panel] of this.rackPanels) {
      if (panel.element.contains(e)) return e.classList.contains('macro') && valid(rack) ? { target: { kind: 'device', device: rack, param }, element: e } : null;
    }
    for (const [key, panel] of this.panels) {
      if (key !== id && panel.element.contains(e) && valid(key as DeviceKey)) return { target: { kind: 'device', device: key as DeviceKey, param }, element: e };
    }
    return null;
  }

  private startPicking(id: DeviceId, host: ModTargetHost, pick: (target: ModTarget) => void, ended: () => void): void {
    this.stopPicking();
    this.picking = { host, pick, ended };
    this.element.classList.add('mod-picking');
    this.panels.get(id)?.element.classList.add('mod-source');
    addEventListener('keydown', this.pickingKey, true);
  }

  private stopPicking(): void {
    const picking = this.picking;
    if (!picking) return;
    this.picking = null;
    this.element.classList.remove('mod-picking');
    for (const panel of this.panels.values()) panel.element.classList.remove('mod-source');
    removeEventListener('keydown', this.pickingKey, true);
    picking.ended();
  }

  private readonly pickingKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    stop(e);
    this.stopPicking();
  };

  /** While a modulator is choosing: the clicks on the targets are its own, the wheel scrolls the chain
   *  (it doesn't move the knob under the pointer), the rest works as always. */
  private pickEvent(e: MouseEvent): void {
    const picking = this.picking;
    if (!picking) return;
    if (e.type === 'wheel') {
      stop(e);
      this.chain.scrollLeft += (e as WheelEvent).deltaY || (e as WheelEvent).deltaX;
      return;
    }
    const found = picking.host.at(e.clientX, e.clientY);
    if (!found) return;
    stop(e);
    if (e.type === 'pointerdown' && e.button === 0) picking.pick(found.target);
  }

  private scrollToward(x: number): void {
    const view = this.chain.getBoundingClientRect();
    if (x > view.right - EDGE_ZONE) this.chain.scrollLeft += EDGE_STEP;
    else if (x < view.left + EDGE_ZONE) this.chain.scrollLeft -= EDGE_STEP;
  }

  /** The controls a modulator of the chain moves: a mark, and in the title who moves them. */
  private markModulated(): void {
    const owner = this.owner;
    if (!owner) return;
    const moved = modulatedParams(this.deps.store.project, owner);
    const mark = (device: string, elements: Iterable<HTMLElement>) => {
      for (const e of elements) e.classList.toggle('mod-target', moved.has(`${device}|${e.dataset.param}`));
    };
    for (const [key, panel] of this.panels) mark(key, panel.element.querySelectorAll<HTMLElement>('[data-param]'));
    for (const [rack, panel] of this.rackPanels) mark(rack, panel.element.querySelectorAll<HTMLElement>('.macro[data-param]'));
  }

  /** The mapped parameters: dimmed, with the macro's number; with "Map" on you see those
   *  that can be mapped and those of the chosen macro. */
  private showMapped(racks: RackList): void {
    for (const key of this.panels.keys()) this.markMapped(key as DeviceKey, racks);
    for (const [id, panel] of this.rackPanels) {
      const rack = findRack(racks, id);
      if (rack) this.markRackMapped(rack, panel, racks);
    }
  }

  /** The macros of a rack mapped to a macro of a surrounding rack; with "Map" on on one of
   *  those, you see that they can be mapped. */
  private markRackMapped(rack: Rack, panel: RackPanel, racks: RackList): void {
    const outer = mappingInto(this.mapMode, racks, rack.id);
    panel.element.classList.toggle('mappable', !!outer);
    for (const e of panel.element.querySelectorAll<HTMLElement>('.macro[data-param]')) applyMark(e, macroMark(racks, rack.id, e.dataset.param!, outer), true);
  }

  /** The macro marks on a panel (also when a graphic panel redoes its controls). */
  private markMapped(key: DeviceKey, racks?: RackList): void {
    const panel = this.panels.get(key);
    if (!panel || !this.owner) return;
    racks ??= this.deps.store.project.racksOf(this.owner);
    panel.element.classList.toggle('mappable', deviceMappable(this.mapMode, racks, key));
    for (const e of panel.element.querySelectorAll<HTMLElement>('[data-param]')) applyMark(e, paramMark(racks, key, e.dataset.param!, this.mapMode), false);
  }

  // ---------------------------------------------------------------- computer keyboard

  /** With KEY on: the parameter waits for its key (if a macro moves it, the key goes to the macro). */
  private chooseKeyParam(owner: ChainOwner, device: DeviceKey, param: string): void {
    const blocked = keyGoesToMacro(this.deps.store.project.racksOf(owner), device, param);
    if (blocked) return this.deps.say?.(blocked);
    this.deps.ui?.chooseKeyTarget({ kind: 'param', owner, device, param });
  }

  /** The keys on the controls (macros and parameters) and, with KEY on, the one waiting for the key. */
  private showKeys(): void {
    const owner = this.owner;
    this.element.classList.toggle('key-mapping', !!this.deps.ui?.keyMapping);
    if (!owner) return;
    for (const key of this.panels.keys()) this.markKeys(key as DeviceKey);
    for (const [rack, panel] of this.rackPanels) {
      for (const e of panel.element.querySelectorAll<HTMLElement>('.macro[data-param]')) {
        this.markKey(e, { kind: 'macro', owner, rack, index: macroIndex(e.dataset.param!) });
      }
    }
  }

  private markKeys(device: DeviceKey): void {
    const panel = this.panels.get(device), owner = this.owner;
    if (!panel || !owner) return;
    for (const e of panel.element.querySelectorAll<HTMLElement>('[data-param]')) this.markKey(e, { kind: 'param', owner, device, param: e.dataset.param! });
  }

  /** The control's key and, with MIDI on, the target to choose (see ui/midi-targets). */
  private markKey(e: HTMLElement, target: KeyTarget): void {
    const midi = encodeMidiTarget(target);
    if (e.dataset.midiTarget !== midi) e.dataset.midiTarget = midi;
    const key = keyOf(this.deps.store.project.keyMap, target);
    if (key) e.dataset.key = keyLabel(key);
    else delete e.dataset.key;
    const chosen = this.deps.ui?.keyTarget;
    e.classList.toggle('key-chosen', !!chosen && sameTarget(chosen, target));
  }

  // ---------------------------------------------------------------- selection

  private showSelection(): void {
    for (const [key, panel] of this.panels) panel.element.classList.toggle('selected', this.chosen.includes(key as DeviceKey));
    const racks = this.owner ? this.deps.store.project.racksOf(this.owner) : [];
    for (const [key, panel] of this.rackPanels) panel.element.classList.toggle('selected', this.chosen.rackLit(racks.find(r => r.id === key)));
  }

  /** Click on the name of a device (or of a rack, `rack`: its devices). */
  private select(keys: readonly DeviceKey[], extend: boolean, rack: DeviceId | null = null): void {
    this.chosen.click(keys, extend, rack);
    this.showSelection();
  }

  // ---------------------------------------------------------------- panels

  private instrumentPanel(track: MidiTrack): HTMLElement | null {
    const type = instrumentType(track.instrument.type);
    if (!type) return null;
    const { store, audition } = this.deps;
    const select = el<HTMLSelectElement>('select', { title: 'Instrument' },
      ...INSTRUMENT_TYPES.map(t => el('option', { value: t.type, textContent: t.label })));
    select.value = type.type;
    select.onchange = () => store.apply(setInstrument(track.id, { ...DEFAULT_INSTRUMENT, type: select.value, preset: null }));
    const pitch = () => testPitch(store.project, track.id, type);
    const test = el<HTMLButtonElement>('button', { className: 'mini', textContent: '♪', title: 'Play a test note', onclick: () => audition(track.id, pitch()) });
    const display = DEVICE_DISPLAYS[type.type]?.({
      type, settings: track.instrument, sampleRate: this.deps.sampleRate,
      setParams: (values, final) => this.displayParams(track.id, INSTRUMENT, values, final,
        v => setInstrumentParams(track.id, v), `param-${track.id}`),
      controlsChanged: () => this.controlsChanged(INSTRUMENT),
      openSpectrum: () => NO_SPECTRUM,
      audition: (p, velocity) => audition(track.id, p, velocity),
      playedNotes: this.deps.playedNotes(track.id),
      playheads: () => this.deps.playheads?.(track.id) ?? [],
      samples: {
        list: () => store.project.samples,
        load: async (slot, file, values) => {
          const sample = await this.deps.importSample(file);
          store.apply(setInstrumentSamples(track.id, { [slot]: sample }, values));
        },
        loadAll: async (files, values) => {
          const entries = await Promise.all(Object.entries(files).map(async ([slot, file]) => [slot, await this.deps.importSample(file)] as const));
          store.apply(setInstrumentSamples(track.id, Object.fromEntries(entries), values));
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
    const preset = (p: { name: string; params: ParamValues }) => store.apply(loadPreset(track.id, p.name, withKept(store.project, track.id, type, p.params)));
    const panel = new DevicePanel({
      type, settings: track.instrument, before: [select], after: [test], display, ...this.foldOptions(track.id, INSTRUMENT),
      onParam: (id, v, final) => this.param(setInstrumentParam(track.id, id, v), `param-${track.id}-${id}`, final),
      onPreset: p => {
        preset(p);
        audition(track.id, pitch());
      },
      onPresetSaved: preset,
      say: this.deps.say,
    });
    panel.element.classList.add('instrument-panel');
    this.panels.set(INSTRUMENT, panel);
    return panel.element;
  }

  /** A graphic panel redid its controls: their marks again, and the curves find them again. */
  private controlsChanged(key: DeviceKey): void {
    this.markMapped(key);
    this.markKeys(key);
    this.markModulated();
    this.curveControls = null;
  }

  private effectPanel(owner: ChainOwner, e: EffectSettings, canMove: (dir: -1 | 1) => boolean): HTMLElement | null {
    const type = effectType(e.type);
    if (!type) return null;
    const { store } = this.deps;
    const id = e.id;
    const current = () => (this.owner ? chainSource(store.project, this.owner)?.effects : undefined)?.find(x => x.id === id);
    const button = (text: string, title: string, run: () => void, disabled = false) =>
      el<HTMLButtonElement>('button', { className: 'mini', textContent: text, title, disabled, onclick: run });
    const power = button('⏻', 'On/off', () => store.apply(setEffectEnabled(owner, id, !current()?.enabled)));
    power.classList.add('power');
    const display = DEVICE_DISPLAYS[e.type]?.({
      type, settings: e, sampleRate: this.deps.sampleRate,
      setParams: (values, final) => this.displayParams(owner, id, values, final, v => setEffectParams(owner, id, v), `fx-${id}`),
      controlsChanged: () => this.controlsChanged(id),
      openSpectrum: () => this.deps.spectrum(owner, id),
      openDynamics: () => this.deps.dynamics?.(owner, id) ?? NO_DYNAMICS,
      audition: () => {},
      playedNotes: () => [],
      ...(type.modulator ? { modTargets: this.modTargetHost(owner, id) } : {}),
    });
    const sidechain = type.sidechain ? new SidechainPicker(source => store.apply(setEffectSidechain(owner, id, source))) : null;
    if (sidechain) {
      sidechain.update(store.project, owner, e);
      this.sidechains.set(id, sidechain);
    }
    const panel = new DevicePanel({
      type, settings: e, before: [power], display, extra: sidechain ? [sidechain.element] : [], ...this.foldOptions(owner, id),
      after: [
        button('◂', 'Move earlier (from a rack\'s edge it leaves it, next to a rack it enters it)', () => store.apply(moveDevice(owner, id, -1)), !canMove(-1)),
        button('▸', 'Move later (from a rack\'s edge it leaves it, next to a rack it enters it)', () => store.apply(moveDevice(owner, id, 1)), !canMove(1)),
        button('×', 'Delete the effect', () => store.apply(removeEffect(owner, id))),
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

  /** The parameters from a graphic panel (e.g. a dragged EQ point): those mapped to a
   *  macro aren't touched, like their knobs. */
  private displayParams(owner: ChainOwner, key: DeviceKey, values: ParamValues, final: boolean,
    edit: (values: ParamValues) => Edit, mergeKey: string): void {
    const free = freeParams(this.deps.store.project.racksOf(owner), key, values);
    const ids = Object.keys(free).sort((a, b) => a.localeCompare(b));
    if (ids.length) this.param(edit(free), `${mergeKey}-${ids.join(',')}`, final);
    else if (final) this.deps.store.endMerge();
  }

  /** A dragged knob is a single undo step. */
  private param(edit: Edit, mergeKey: string, final: boolean): void {
    this.deps.store.apply(edit, { mergeKey });
    if (final) this.deps.store.endMerge();
  }
}
