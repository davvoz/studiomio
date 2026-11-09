import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { DeviceId, SampleId, TrackId } from '../../core/id';
import type { SampleData } from '../../devices/dsp/core';
import type { SampleRef } from '../../model/sample';
import { keptOnPreset, resolveParams } from '../../devices/device-type';
import { deviceTypeAt, mappingSpec } from '../../devices/rack-params';
import type { DeviceType } from '../../devices/device-type';
import { chainEffectTypes, effectType, INSTRUMENT_TYPES, instrumentType } from '../../devices/registry';
import { DEFAULT_INSTRUMENT, sampleAt, type EffectSettings, type ParamValues } from '../../model/device';
import type { EffectList } from '../../model/effect-list';
import type { ModTarget } from '../../model/envelope';
import { keyLabel, keyOf, sameTarget, type KeyTarget } from '../../model/key-map';
import { encodeMidiTarget } from '../../model/midi-map';
import { MASTER, type ChainOwner, type Project } from '../../model/project';
import {
  chainItems, findRack, macroIndex, macroName, macroOf, macroParam, moveDevice as layoutMove, moveRack as layoutMoveRack,
  nestRack as layoutNestRack, outerRacks, rackName, rackOf, racksWith, type ChainItem, type DeviceKey, type Rack, type RackList,
} from '../../model/rack';
import { MidiTrack, type Track } from '../../model/track';
import type { ControlledDevice, UiState } from '../ui-state';
import {
  addEffect, loadEffectPreset, loadPreset, removeEffect, setEffectEnabled, setEffectParam,
  setEffectParams, setEffectSidechain, setInstrument, setInstrumentParam, setInstrumentParams, setInstrumentSamples, setModTarget,
} from '../../store/edits';
import type { Clipboard } from '../../store/clipboard';
import { copyDevices, copyRack, pasteDevices, removeDevices, type CopiedDevices } from '../../store/device-clipboard';
import type { Edit, ProjectStore } from '../../store/project-store';
import { addEffectToRack, groupDevices, mapMacro, moveDevice, removeRack, ungroupRack, unmapParam } from '../../store/rack-edits';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { KEY, showContextMenu, SEPARATOR, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { ownedByField } from '../keymap';
import { addHeightHandle, DEVICE_HEIGHT } from '../editor-height';
import { controlOf, type ParamControl } from './controls';
import { DevicePanel } from './device-panel';
import { DEVICE_DISPLAYS, NO_DYNAMICS, NO_SPECTRUM, type DeviceDisplay, type DynamicsTap, type ModTargetHost, type SpectrumTap } from './displays';
import { RackPanel } from './rack-panel';
import type { MacroSprings } from '../../store/macro-springs';
import { SidechainPicker } from './sidechain-picker';

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

/** Ctrl+key on the chosen devices. */
/** How close to the chain's edge a drag makes it scroll, and by how much per frame. */
const EDGE_ZONE = 56;
const EDGE_STEP = 14;

const DEVICE_KEYS: Readonly<Record<string, (v: DeviceView) => void>> = {
  c: v => v.copySelection(),
  x: v => v.cutSelection(),
  v: v => v.pasteSelection(),
  d: v => v.duplicateSelection(),
};

/** The instrument panel's key (the effects use their id). */
const INSTRUMENT = 'instrument';

/** The master's colour in the title. */
export const MASTER_COLOR = 'var(--text)';

/** What the view shows of whoever owns the chain: a track or the master. */
interface ChainSource {
  readonly name: string;
  readonly color: string;
  /** The track, if the chain belongs to a track (for the MIDI tracks' instrument). */
  readonly track: Track | null;
  readonly effects: EffectList;
  readonly racks: RackList;
}

/** The device chain of a track or of the master, in a row as in Live: the instrument
 *  (MIDI tracks), then the effects in the order the sound goes through them; a rack gathers its
 *  devices behind the macro panel. A click on the name chooses a device
 *  (Shift: more than one), Ctrl+G groups them into a rack, Ctrl+Shift+G ungroups it. Every change
 *  goes through the store (it can be undone) and is heard right away, even while playing. */
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
  /** The chosen devices (to group them), and where the selection extends from. */
  private selection: DeviceKey[] = [];
  private anchor: DeviceKey | null = null;
  /** The rack chosen with a click on its name (its devices are the selection). */
  private selectedRack: DeviceId | null = null;
  /** The racks with hidden devices. */
  private readonly folded = new Set<DeviceId>();
  /** The collapsed devices, per chain ("owner/key"). */
  private readonly foldedDevices = new Set<string>();
  /** Whose the chain built last time was: another chain starts from the beginning. */
  private builtOwner: ChainOwner | null = null;
  /** "Map" on on a rack, with the chosen macro (null: none). */
  private mapMode: { readonly rack: DeviceId; readonly macro: number | null } | null = null;
  /** The controls the curves can move, with their target (null: to be redone). */
  private curveControls: { readonly control: ParamControl; readonly target: ModTarget }[] | null = null;

  constructor(private readonly deps: DeviceViewDeps) {
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
    this.element.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.ungroupSelection();
        else this.groupSelection();
      }
      const command = !ownedByField(e.target as HTMLElement | null, e) && (e.ctrlKey || e.metaKey) && !e.shiftKey ? DEVICE_KEYS[e.key.toLowerCase()] : undefined;
      if (command) {
        e.preventDefault();
        e.stopPropagation();
        command(this);
      }
    });
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
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Paste', shortcut: KEY.paste, disabled: !deps.clipboard?.devices, run: () => this.pasteSelection() },
      ]);
    });
    deps.store.onChange(() => this.sync());
    deps.ui?.onChange(() => this.showKeys());
    const dropItem = deps.dropItem;
    if (dropItem) acceptBrowserDrops(this.element, item => this.owner && dropItem(item, { kind: 'chain', owner: this.owner }), { accept: () => !!this.owner });
    if (deps.modulation) this.followCurves(deps.modulation);
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
    if (!this.sourceOf(owner)) return false;
    if (owner !== this.owner) {
      this.selection = [];
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
    if (!c || c.owner !== this.owner) return;
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
      this.setDeviceFolded(owner, key, fold);
    }
  }

  private setDeviceFolded(owner: ChainOwner, key: string, folded: boolean): void {
    if (folded) this.foldedDevices.add(`${owner}/${key}`);
    else this.foldedDevices.delete(`${owner}/${key}`);
  }

  /** A panel's options to collapse it, remembering the choice. */
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

  /** The menu of effect types; the chosen one goes at the end of the chain. */
  chooseEffect(x: number, y: number): void {
    const owner = this.owner;
    if (!owner) return;
    showContextMenu(x, y, this.effectChoices(owner).map(t => ({ label: t.label, run: () => this.deps.store.apply(addEffect(owner, t.type, t.label)) })));
  }

  private effectChoices(owner: ChainOwner): readonly DeviceType[] {
    return chainEffectTypes(this.deps.store.project.track(owner as TrackId) instanceof MidiTrack);
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
    this.showKeys();
    this.markModulated();
  }

  /** New panels when the chain's shape changes (effects added, removed, moved, racks). */
  private build(owner: ChainOwner, { track, effects, racks }: ChainSource, shape: string): void {
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
    const project = this.deps.store.project;
    const order = project.chainKeys(owner);
    if (this.mapMode && !racks.some(r => r.id === this.mapMode!.rack)) this.mapMode = null;
    this.selection = this.selection.filter(k => order.includes(k));
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
    // the racks with their elements inside, also other racks
    const itemNode = (item: ChainItem): Node => (item.kind === 'device'
      ? panelOf(item.key)
      : this.rackElement(owner, item.rack, labels, () => chainItems(order, racks, item.rack).map(itemNode), {
        move: dir => changes(layoutMoveRack(order, racks, item.rack.id, dir)),
        nest: dir => changes(layoutNestRack(order, racks, item.rack.id, dir)),
      }));
    const items = chainItems(order, racks).map(itemNode);
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
    const added = sameOwner && known.size ? effects.filter(e => !known.has(e.id)).at(-1) : undefined;
    const panel = added && this.panels.get(added.id);
    if (panel) this.reveal(panel.element);
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
    const folded = this.folded.has(rack.id);
    const mapping = this.mapMode?.rack === rack.id ? this.mapMode.macro : undefined;
    const panel = new RackPanel({
      store: this.deps.store, springs: this.deps.springs, owner, rack, folded, mapping, canMove: can.move, canNest: can.nest,
      deviceLabel: key => labels.get(key) ?? key,
      headMenu: () => this.clipboardMenu(owner, rack.devices, rack.id),
      macroMenu: index => this.automationMenu(owner, { kind: 'device', device: rack.id, param: macroParam(index) }),
      outerMenu: index => {
        const racks = this.deps.store.project.racksOf(owner);
        const now = findRack(racks, rack.id);
        return now ? this.mapMenu(owner, outerRacks(racks, now).reverse(), rack.id, macroParam(index)) : [];
      },
      onMapMode: macro => {
        this.mapMode = macro === undefined ? null : { rack: rack.id, macro };
        this.sync();
      },
      onFold: () => {
        if (folded) this.folded.delete(rack.id); else this.folded.add(rack.id);
        this.sync();
      },
      onAddEffect: (x, y) => showContextMenu(x, y, this.effectChoices(owner).map(t => ({
        label: t.label, run: () => this.deps.store.apply(addEffectToRack(owner, rack.id, t.type, t.label)),
      }))),
      onSelect: extend => this.select(rack.devices, extend, rack.id),
      keyMapping: () => !!this.deps.ui?.keyMapping,
      onKeyTarget: index => this.deps.ui?.chooseKeyTarget({ kind: 'macro', owner, rack: rack.id, index }),
      say: this.deps.say,
    });
    this.rackPanels.set(rack.id, panel);
    this.bindRackPanel(owner, rack, panel);
    const element = el('div', { className: `rack${folded ? ' folded' : ''}${mapping !== undefined ? ' mapping' : ''}` }, panel.element);
    if (!folded) element.append(...contents());
    else element.append(el('div', { className: 'rack-folded muted' }, ...rack.devices.map(key => el('div', { textContent: labels.get(key) ?? key }))));
    return element;
  }

  /** On the macros of a rack inside another: with "Map" on on a surrounding rack and one of its macros
   *  chosen, a click maps it there; mapped to a surrounding macro it isn't touched (that one moves it). */
  private bindRackPanel(owner: ChainOwner, rack: Rack, panel: RackPanel): void {
    const intercept = (e: Event) => {
      const param = (e.target as HTMLElement | null)?.closest<HTMLElement>('.macro[data-param]')?.dataset.param;
      if (!param || this.deps.ui?.keyMapping) return;
      const racks = this.deps.store.project.racksOf(owner);
      const map = this.mapMode;
      const mapping = map && map.macro !== null && this.mapsInto(racks, map.rack, rack.id);
      if (!mapping && !macroOf(racks, rack.id, param)) return;
      e.stopPropagation();
      e.preventDefault();
      if (mapping && e.type === 'pointerdown') this.guard(mapMacro(owner, map.rack, map.macro!, rack.id, param));
    };
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'keydown']) {
      panel.element.addEventListener(type, intercept, { capture: true, passive: false });
    }
  }

  /** Rack `outer` has device or rack `key` inside (its macros can move it). */
  private mapsInto(racks: RackList, outer: DeviceId, key: DeviceKey): boolean {
    const inner = findRack(racks, key as DeviceId);
    return (inner ? outerRacks(racks, inner) : racksWith(racks, key)).some(r => r.id === outer);
  }

  /** The items to map a parameter (or a macro) to the macros of the racks `racks`, from the nearest:
   *  if there's more than one rack, each under its name. */
  private mapMenu(owner: ChainOwner, racks: readonly Rack[], device: DeviceKey, param: string): MenuItem[] {
    const project = this.deps.store.project;
    const current = macroOf(project.racksOf(owner), device, param);
    const label = (x: { device: DeviceKey; param: string }) => mappingSpec(project, owner, x)?.label;
    const items = racks.flatMap((rack, n): MenuItem[] => [
      ...(racks.length > 1 ? [...(n ? [SEPARATOR] : []), { label: rackName(rack), disabled: true, run: () => {} }] : []),
      ...rack.macros.map((m, i): MenuItem => {
        const name = macroName(m, i, label);
        return {
          label: `Map to ${name}${name === `Macro ${i + 1}` ? '' : ` (macro ${i + 1})`}`,
          checked: current?.rack.id === rack.id && current.index === i,
          run: () => this.guard(mapMacro(owner, rack.id, i, device, param)),
        };
      }),
    ]);
    if (!items.length) return [];
    return [...items, SEPARATOR, { label: 'Remove from the macro', disabled: !current, run: () => this.guard(unmapParam(owner, device, param)) }];
  }

  /** On a device: the click on the name chooses it, the header's menu groups and
   *  ungroups, a parameter's menu maps it to a macro. A mapped parameter isn't touched
   *  (the macro moves it); with "Map" on and a macro chosen a click maps it there; with KEY
   *  on a click chooses it for the computer keyboard. */
  private bindPanel(owner: ChainOwner, key: DeviceKey, panel: DevicePanel): void {
    const name = panel.element.querySelector<HTMLElement>('.device-name');
    if (name) {
      name.onclick = e => this.select([key], e.shiftKey);
      name.title = 'Click: choose (Shift: more than one), then Ctrl+G to group into a rack';
    }
    panel.element.querySelector('.device-panel-head')?.addEventListener('contextmenu', e => {
      const ev = e as MouseEvent;
      ev.preventDefault();
      const keys = this.selection.includes(key) ? this.selection : [key];
      const rack = rackOf(this.deps.store.project.racksOf(owner), key);
      const presets = panel.presetMenu();
      showContextMenu(ev.clientX, ev.clientY, [
        ...this.clipboardMenu(owner, keys),
        SEPARATOR,
        { label: 'Group into a rack', shortcut: 'Ctrl+G', run: () => this.groupSelection(keys) },
        { label: 'Ungroup the rack', shortcut: 'Ctrl+Shift+G', disabled: !rack, run: () => rack && this.guard(ungroupRack(owner, rack.id)) },
        ...(presets.length ? [SEPARATOR, ...presets] : []),
      ]);
    });
    const paramOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-param]')?.dataset.param;
    const intercept = (e: Event) => {
      const param = paramOf(e.target);
      if (!param) return;
      const racks = this.deps.store.project.racksOf(owner);
      if (this.deps.ui?.keyMapping) {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === 'pointerdown') this.chooseKeyParam(owner, key, param);
        return;
      }
      const map = this.mapMode;
      const mapping = map && map.macro !== null && this.mapsInto(racks, map.rack, key);
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

  /** A parameter's menu: which macro of its racks to map it to (first the rack it's in,
   *  then the surrounding ones). */
  private paramMenu(owner: ChainOwner, key: DeviceKey, param: string): MenuItem[] {
    const mods = [...this.automationMenu(owner, { kind: 'device', device: key, param }), ...this.modulationMenu(owner, { kind: 'device', device: key, param })];
    const racks = racksWith(this.deps.store.project.racksOf(owner), key).reverse();
    if (!racks.length) return [...mods, { label: 'Group into a rack to map it to a macro', shortcut: 'Ctrl+G', run: () => this.groupSelection([key]) }];
    return [...mods, ...this.mapMenu(owner, racks, key, param)];
  }

  /** "Show automation", if the app knows how to show it. */
  private automationMenu(owner: ChainOwner, target: ModTarget): MenuItem[] {
    const show = this.deps.showAutomation;
    return show ? [{ label: 'Show automation', run: () => show(owner, target) }, SEPARATOR] : [];
  }

  // ---------------------------------------------------------------- clipboard

  /** The copy and paste items of a device (or of rack `rack`). */
  private clipboardMenu(owner: ChainOwner, keys: readonly DeviceKey[], rack: DeviceId | null = null): MenuItem[] {
    const onlyInstrument = !rack && keys.every(k => k === INSTRUMENT);
    const content = () => (rack ? copyRack(this.deps.store.project, owner, rack) : copyDevices(this.deps.store.project, owner, keys));
    return [
      { label: 'Cut', shortcut: KEY.cut, disabled: onlyInstrument, run: () => this.cut(owner, keys, rack, content()) },
      { label: 'Copy', shortcut: KEY.copy, run: () => this.copy(content()) },
      { label: 'Duplicate', shortcut: KEY.duplicate, disabled: onlyInstrument, run: () => this.paste(content(), owner, this.lastKey(owner, keys)) },
      { label: 'Paste after', shortcut: KEY.paste, disabled: !this.deps.clipboard?.devices, run: () => this.paste(this.deps.clipboard?.devices ?? null, owner, this.lastKey(owner, keys)) },
    ];
  }

  /** The chosen device coming last in the sound. */
  private lastKey(owner: ChainOwner, keys: readonly DeviceKey[]): DeviceKey | null {
    const order = this.deps.store.project.chainKeys(owner);
    return keys.length ? order[Math.max(...keys.map(k => order.indexOf(k)))] : null;
  }

  /** What's chosen now, ready for the clipboard. */
  private chosenContent(): CopiedDevices | null {
    const owner = this.owner, rack = this.chosenRack(), p = this.deps.store.project;
    if (!owner) return null;
    return rack ? copyRack(p, owner, rack.id) : copyDevices(p, owner, this.selection);
  }

  private copy(content: CopiedDevices | null): boolean {
    if (!content || !this.deps.clipboard) return false;
    this.deps.clipboard.content = content;
    const n = (content.instrument ? 1 : 0) + content.effects.length;
    let copied = n > 1 ? `${n} devices copied` : 'Device copied';
    if (content.rack) copied = `Rack «${content.rack.name}» copied`;
    this.deps.say?.(`${copied}: choose a track and press Ctrl+V to paste it there.`);
    return true;
  }

  private cut(owner: ChainOwner, keys: readonly DeviceKey[], rack: DeviceId | null, content: CopiedDevices | null): void {
    if (this.copy(content)) this.guard(rack ? removeRack(owner, rack) : removeDevices(owner, keys));
  }

  private paste(content: CopiedDevices | null, owner: ChainOwner, after: DeviceKey | null): void {
    if (content) this.guard(pasteDevices(content, owner, after));
  }

  /** Ctrl+C: the devices chosen with a click on the name. */
  copySelection(): void {
    if (!this.copy(this.chosenContent())) this.deps.say?.('Choose a device with a click on the name, then Ctrl+C.');
  }

  cutSelection(): void {
    const owner = this.owner, rack = this.chosenRack();
    if (owner && this.selection.length) this.cut(owner, this.selection, rack?.id ?? null, this.chosenContent());
  }

  pasteSelection(): void {
    if (!this.owner) return;
    const content = this.deps.clipboard?.devices ?? null;
    if (!content) return this.deps.say?.('The clipboard has no devices.');
    this.paste(content, this.owner, this.lastKey(this.owner, this.selection));
  }

  duplicateSelection(): void {
    if (this.owner && this.selection.length) this.paste(this.chosenContent(), this.owner, this.lastKey(this.owner, this.selection));
  }

  // ---------------------------------------------------------------- modulators

  /** The targets of the chain's modulators moving `target`, to remove. */
  private modulationMenu(owner: ChainOwner, target: ModTarget): MenuItem[] {
    const project = this.deps.store.project, labels = deviceLabels(project, owner);
    const items = project.effectsOf(owner).flatMap(e => (e.targets ?? []).flatMap((t, slot): MenuItem[] => (t && sameModTarget(t, target)
      ? [{ label: `Remove the modulation of ${labels.get(e.id) ?? e.type} (target ${slot + 1})`, run: () => this.deps.store.apply(setModTarget(owner, e.id, slot, null)) }]
      : [])));
    return items.length ? [...items, SEPARATOR] : [];
  }

  /** For the panel of modulator `id`: the targets of `owner`'s chain. */
  private modTargetHost(owner: ChainOwner, id: DeviceId): ModTargetHost {
    const { store } = this.deps;
    const host: ModTargetHost = {
      at: (x, y) => {
        const e = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-param]');
        if (!e || !this.chain.contains(e)) return null;
        const param = e.dataset.param!, project = store.project;
        const valid = (device: DeviceKey) => !!mappingSpec(project, owner, { device, param });
        for (const [rack, panel] of this.rackPanels) {
          if (panel.element.contains(e)) return e.classList.contains('macro') && valid(rack) ? { target: { kind: 'device', device: rack, param }, element: e } : null;
        }
        for (const [key, panel] of this.panels) {
          if (key !== id && panel.element.contains(e) && valid(key as DeviceKey)) return { target: { kind: 'device', device: key as DeviceKey, param }, element: e };
        }
        return null;
      },
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
    e.preventDefault();
    e.stopPropagation();
    this.stopPicking();
  };

  /** While a modulator is choosing: the clicks on the targets are its own, the wheel scrolls the chain
   *  (it doesn't move the knob under the pointer), the rest works as always. */
  private pickEvent(e: MouseEvent): void {
    const picking = this.picking;
    if (!picking) return;
    if (e.type === 'wheel') {
      e.preventDefault();
      e.stopPropagation();
      this.chain.scrollLeft += (e as WheelEvent).deltaY || (e as WheelEvent).deltaX;
      return;
    }
    const found = picking.host.at(e.clientX, e.clientY);
    if (!found) return;
    e.preventDefault();
    e.stopPropagation();
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
    const project = this.deps.store.project;
    const moved = new Set<string>();
    for (const e of project.effectsOf(owner)) for (const t of e.targets ?? []) if (t?.kind === 'device') moved.add(`${t.device}|${t.param}`);
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
    const map = this.mapMode;
    const outer = map && map.macro !== null && this.mapsInto(racks, map.rack, rack.id);
    panel.element.classList.toggle('mappable', !!outer);
    for (const e of panel.element.querySelectorAll<HTMLElement>('.macro[data-param]')) {
      const found = macroOf(racks, rack.id, e.dataset.param!);
      e.classList.toggle('mapped', !!found);
      if (outer) e.classList.toggle('chosen', !!found && found.rack.id === map.rack && found.index === map.macro);
      if (found) {
        e.dataset.macro = String(found.index + 1);
        e.title += `\nMoved by macro ${found.index + 1} of ${rackName(found.rack)} (right click to remove it).`;
      } else delete e.dataset.macro;
    }
  }

  /** The macro marks on a panel (also when a graphic panel redoes its controls). */
  private markMapped(key: DeviceKey, racks?: RackList): void {
    const panel = this.panels.get(key);
    if (!panel || !this.owner) return;
    racks ??= this.deps.store.project.racksOf(this.owner);
    const map = this.mapMode;
    panel.element.classList.toggle('mappable', !!map && map.macro !== null && this.mapsInto(racks, map.rack, key));
    for (const e of panel.element.querySelectorAll<HTMLElement>('[data-param]')) {
      const found = macroOf(racks, key, e.dataset.param!);
      e.classList.toggle('mapped', !!found);
      e.classList.toggle('chosen', !!found && !!map && found.rack.id === map.rack && found.index === map.macro);
      if (found) {
        e.dataset.macro = String(found.index + 1);
        e.title = `Moved by macro ${found.index + 1} of ${rackName(found.rack)} (right click to remove it)`;
      } else delete e.dataset.macro;
    }
  }

  // ---------------------------------------------------------------- computer keyboard

  /** With KEY on: the parameter waits for its key (if a macro moves it, the key goes to the macro). */
  private chooseKeyParam(owner: ChainOwner, device: DeviceKey, param: string): void {
    const found = macroOf(this.deps.store.project.racksOf(owner), device, param);
    if (found) return this.deps.say?.(`Macro ${found.index + 1} of ${rackName(found.rack)} moves it: give the key to the macro.`);
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

  // ---------------------------------------------------------------- selection and groups

  private showSelection(): void {
    for (const [key, panel] of this.panels) panel.element.classList.toggle('selected', this.selection.includes(key as DeviceKey));
    const chosen = this.chosenRack();
    for (const [key, panel] of this.rackPanels) {
      const rack = this.owner ? this.deps.store.project.racksOf(this.owner).find(r => r.id === key) : undefined;
      // of a rack chosen with a click on the name it lights up itself, not also those it has inside
      const all = !!rack && rack.devices.every(k => this.selection.includes(k));
      panel.element.classList.toggle('selected', all && (!chosen || chosen.id === key));
    }
  }

  /** The rack chosen with a click on its name, if the selection is still its devices. */
  private chosenRack(): Rack | undefined {
    const rack = this.owner && this.selectedRack ? findRack(this.deps.store.project.racksOf(this.owner), this.selectedRack) : undefined;
    return rack && rack.devices.length === this.selection.length && rack.devices.every(k => this.selection.includes(k)) ? rack : undefined;
  }

  /** Click on the name of a device (or of a rack, `rack`: its devices); with Shift the
   *  selection goes from the first chosen up to here. Another click on the same selection removes it. */
  private select(keys: readonly DeviceKey[], extend: boolean, rack: DeviceId | null = null): void {
    const order = this.owner ? this.deps.store.project.chainKeys(this.owner) : [];
    if (extend && this.anchor && order.includes(this.anchor)) {
      const ends = [this.anchor, ...keys].map(k => order.indexOf(k));
      this.selection = order.slice(Math.min(...ends), Math.max(...ends) + 1);
      this.selectedRack = null;
    } else {
      const same = keys.length === this.selection.length && keys.every(k => this.selection.includes(k)) && rack === this.selectedRack;
      this.selection = same ? [] : [...keys];
      this.anchor = same ? null : keys[0];
      this.selectedRack = same ? null : rack;
    }
    this.showSelection();
  }

  /** Ctrl+G: the chosen devices into a new rack. */
  private groupSelection(keys: readonly DeviceKey[] = this.selection): void {
    const owner = this.owner;
    if (!owner) return;
    if (!keys.length) return this.deps.say?.('Choose the devices to group: click on the name, Shift+click for more than one; then Ctrl+G.');
    if (this.guard(groupDevices(owner, keys))) this.selection = [];
    this.showSelection();
  }

  /** Ctrl+Shift+G: ungroups the rack of the chosen devices. */
  private ungroupSelection(): void {
    const owner = this.owner;
    const rack = owner && this.selection.length ? this.chosenRack() ?? rackOf(this.deps.store.project.racksOf(owner), this.selection[0]) : undefined;
    if (!owner || !rack) return this.deps.say?.('Choose a rack (click on its name), then Ctrl+Shift+G to ungroup it.');
    this.guard(ungroupRack(owner, rack.id));
  }

  /** A change that may not be allowed: the reason goes in the status bar. */
  private guard(edit: Edit): boolean {
    try {
      this.deps.store.apply(edit);
      return true;
    } catch (e) {
      this.deps.say?.(e instanceof Error ? e.message : String(e));
      return false;
    }
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
    // the test note: C3, or the first name the instrument gives the notes (the drum machine's kick)
    const testPitch = () => {
      const t = store.project.track(track.id);
      const names = t instanceof MidiTrack
        ? type.noteNames?.(resolveParams(type, t.instrument.params), store.project.sampleNames(t.instrument)) : undefined;
      return names?.size ? Math.min(...names.keys()) : 60;
    };
    // what a preset doesn't change (the Sampler's zone map) stays as it is
    const withKept = (params: ParamValues): ParamValues => {
      const t = store.project.track(track.id);
      return t instanceof MidiTrack ? { ...params, ...keptOnPreset(type, t.instrument.params) } : params;
    };
    const test = el<HTMLButtonElement>('button', { className: 'mini', textContent: '♪', title: 'Play a test note', onclick: () => audition(track.id, testPitch()) });
    const display = DEVICE_DISPLAYS[type.type]?.({
      type, settings: track.instrument, sampleRate: this.deps.sampleRate,
      setParams: (values, final) => this.displayParams(track.id, INSTRUMENT, values, final,
        v => setInstrumentParams(track.id, v), `param-${track.id}`),
      controlsChanged: () => { this.markMapped(INSTRUMENT); this.markKeys(INSTRUMENT); this.markModulated(); this.curveControls = null; },
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
    const panel = new DevicePanel({
      type, settings: track.instrument, before: [select], after: [test], display, ...this.foldOptions(track.id, INSTRUMENT),
      onParam: (id, v, final) => this.param(setInstrumentParam(track.id, id, v), `param-${track.id}-${id}`, final),
      onPreset: p => {
        store.apply(loadPreset(track.id, p.name, withKept(p.params)));
        audition(track.id, testPitch());
      },
      onPresetSaved: p => store.apply(loadPreset(track.id, p.name, withKept(p.params))),
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
    const power = button('⏻', 'On/off', () => store.apply(setEffectEnabled(owner, id, !current()?.enabled)));
    power.classList.add('power');
    const display = DEVICE_DISPLAYS[e.type]?.({
      type, settings: e, sampleRate: this.deps.sampleRate,
      setParams: (values, final) => this.displayParams(owner, id, values, final, v => setEffectParams(owner, id, v), `fx-${id}`),
      controlsChanged: () => { this.markMapped(id); this.markKeys(id); this.markModulated(); this.curveControls = null; },
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
    const racks = this.deps.store.project.racksOf(owner);
    const free = Object.fromEntries(Object.entries(values).filter(([param]) => !macroOf(racks, key, param)));
    const ids = Object.keys(free).sort();
    if (ids.length) this.param(edit(free), `${mergeKey}-${ids.join(',')}`, final);
    else if (final) this.deps.store.endMerge();
  }

  /** A dragged knob is a single undo step. */
  private param(edit: Edit, mergeKey: string, final: boolean): void {
    this.deps.store.apply(edit, { mergeKey });
    if (final) this.deps.store.endMerge();
  }
}

/** The chain's shape: it changes if owner, instrument, effects, their order or
 *  type, the racks (devices, names, macro kinds, mappings) or how they're shown (`view`) change. */
const shapeOf = (owner: ChainOwner, { track, effects, racks }: ChainSource, view: string): string =>
  [owner, track instanceof MidiTrack ? track.instrument.type : '-', ...effects.map(e => `${e.id}:${e.type}`), view,
    JSON.stringify(racks.map(r => [r.id, r.name, r.devices, r.macros.map(m => [m.name, m.mode ?? 'knob', m.mappings.map(x => `${x.device}:${x.param}`)])]))].join('|');

/** The names of a chain's devices: "Delay", "Delay 2"…, and of the racks. */
function deviceLabels(p: Project, owner: ChainOwner): Map<DeviceKey, string> {
  const out = new Map<DeviceKey, string>(p.racksOf(owner).map(r => [r.id, rackName(r)]));
  const seen = new Map<string, number>();
  for (const key of p.chainKeys(owner)) {
    const label = deviceTypeAt(p, owner, key)?.label ?? key;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    out.set(key, n > 1 ? `${label} ${n}` : label);
  }
  return out;
}

const sameModTarget = (a: ModTarget, b: ModTarget): boolean =>
  a.kind === b.kind && a.param === b.param && (a.kind !== 'device' || (b.kind === 'device' && a.device === b.device));

/** A modulator target's name: "Prisma · Cutoff", "Rack · Macro 2", "Volume". */
function modTargetLabel(p: Project, owner: ChainOwner, t: ModTarget): string {
  if (t.kind === 'mixer') return t.param === 'volume' ? 'Track volume' : 'Track pan';
  if (t.kind === 'clip') return 'Transpose';
  const device = deviceLabels(p, owner).get(t.device);
  if (!device) return `(removed) · ${t.param}`;
  return `${device} · ${mappingSpec(p, owner, { device: t.device, param: t.param })?.label ?? t.param}`;
}

/** The modulators' targets from a menu: the track's volume and pan, the racks' macros. */
function modTargetChoices(p: Project, owner: ChainOwner): { target: ModTarget; label: string }[] {
  const mixer: ModTarget[] = owner === MASTER ? [] : [{ kind: 'mixer', param: 'volume' }, { kind: 'mixer', param: 'pan' }];
  const macros = p.racksOf(owner).flatMap(r => r.macros.map((_, i): ModTarget => ({ kind: 'device', device: r.id, param: macroParam(i) })));
  return [...mixer, ...macros].map(target => ({ target, label: modTargetLabel(p, owner, target) }));
}

const missing = (type: string) =>
  el('div', { className: 'device-empty muted', textContent: `"${type}" isn't available in this version.` });
