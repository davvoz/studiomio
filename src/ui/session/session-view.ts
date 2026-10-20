/* La session view, come in Live: una colonna per traccia con le clip negli slot (una riga per
 * scena), sotto lo stop della traccia e il mixer; dopo le tracce i bus (senza clip, solo il
 * mixer); a destra il master con il lancio delle scene. Un clic su ▶ lancia una clip (al prossimo confine della quantizzazione), ▶ di una
 * scena lancia la riga. Le clip si trascinano da uno slot all'altro (Ctrl copia). */
import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { groupSlotState } from '../../engine/session';
import { LAUNCH_QUANTA } from '../../model/launch';
import type { Clip } from '../../model/clip';
import { PALETTE } from '../../model/colors';
import { MASTER, type ChainOwner, type Scene } from '../../model/project';
import { sceneClips } from '../../model/scene-export';
import { BusTrack, GroupTrack, type Track } from '../../model/track';
import { setClipColor, setTrackColor, slotRef, type ClipRef } from '../../store/clip-ref';
import { copySlotClip, pasteToSlot, type Clipboard } from '../../store/clipboard';
import { addBus, removeTrack, renameTrack, setLaunchQuantization, type TrackKind } from '../../store/edits';
import type { Edit, ProjectStore } from '../../store/project-store';
import {
  captureScene, clearSlot, deleteScene, duplicateScene, duplicateSlotClip, insertScene, moveSlotClip, newSlotMidiClip, renameScene,
  setSceneColor, updateSlotClip, type SlotRef,
} from '../../store/session-edits';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { KEY, SEPARATOR, showContextMenu, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { renameInline } from '../inline-rename';
import { bindKeys, type Binding } from '../keymap';
import type { MeterBoard } from '../meters/meter-board';
import { addEffectItems } from '../mixer-controls';
import { groupMenuItems, newTrackHereItems, toggleFold } from '../track-groups';
import { clickTrack, type UiState } from '../ui-state';
import { MasterStripView, TrackStrip } from './mixer-strip';

export interface SessionViewDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: PlaybackEngine;
  readonly meters: MeterBoard;
  readonly clipboard: Clipboard;
  openClip(ref: ClipRef): void;
  openDevices(owner: ChainOwner): void;
  /** Una voce del browser lasciata su uno slot, sulla testa di una colonna (o del master) o
   *  fuori dalle colonne (`track` null: una traccia nuova). */
  dropItem?(item: BrowserItem, target: LoadTarget): void;
  /** Importa dei file audio negli slot da `slot` in giù (su una traccia nuova se `track` è null o non è audio). */
  importToSlot(files: File[], track: TrackId | null, slot: number): void;
  addTrack(kind: TrackKind): void;
  /** Esporta in WAV l'audio della scena di indice `index`. */
  exportScene(index: number): void;
  /** Copia la scena di indice `index` nell'arrangement, al cursore. */
  sceneToArrangement(index: number): void;
  say(text: string): void;
}

/** Comandi da tastiera della session (sullo slot scelto): hanno la precedenza su quelli generali. */
const SESSION_KEYS: readonly Binding<SessionView>[] = [
  { key: 'enter', run: v => v.launchSelected() },
  { key: 'delete', run: v => v.clearSelected() },
  { key: 'backspace', run: v => v.clearSelected() },
  { key: 'd', ctrl: true, run: v => v.duplicateSelected() },
  { key: 'i', ctrl: true, shift: true, run: v => v.captureAndInsertScene() },
  { key: 'c', ctrl: true, run: v => v.copySelected() },
  { key: 'x', ctrl: true, run: v => v.cutSelected() },
  { key: 'v', ctrl: true, run: v => v.pasteSelected() },
  { key: 'arrowup', run: v => v.moveSelection(0, -1) },
  { key: 'arrowdown', run: v => v.moveSelection(0, 1) },
  { key: 'arrowleft', run: v => v.moveSelection(-1, 0) },
  { key: 'arrowright', run: v => v.moveSelection(1, 0) },
];

/** Righe della griglia: intestazioni, una per scena, stop, spazio, mixer. */
const row = { head: 1, scene: (s: number) => 2 + s, stop: (scenes: number) => 2 + scenes, mixer: (scenes: number) => 4 + scenes };

/** Quanto della clip è passato (0..1), per la barra di avanzamento. */
function clipProgress(clip: Clip, elapsed: Beats): number {
  const content = clip.contentBeatAt(elapsed);
  if (content === null) return 0;
  const start = clip.loop.enabled ? Math.min(clip.region.start, clip.loop.start) : clip.region.start;
  const end = clip.loop.enabled ? clip.loop.end : clip.region.end;
  return Math.max(0, Math.min(1, (content - start) / (end - start)));
}

const place = <T extends HTMLElement>(e: T, gridRow: number, gridColumn: number): T => {
  e.style.gridRow = String(gridRow);
  e.style.gridColumn = String(gridColumn);
  return e;
};

const slotKey = (track: TrackId, slot: number) => `${track}:${slot}`;

/** Le colonne: le tracce, lo spazio che avanza, i bus, il master. La colonna del bus `i`
 *  (con `T` tracce) viene dopo lo spazio, accanto al master. */
const busColumn = (T: number, i: number) => T + 2 + i;

/** Un bus resta fermo accanto al master, come in Live, mentre le tracce scorrono sotto. */
function pinBus(e: HTMLElement, buses: number, i: number): HTMLElement {
  e.classList.add('bus-pinned');
  e.style.setProperty('--bus-right', `calc(var(--session-master) + 2px + ${buses - 1 - i} * (var(--session-col) + 2px))`);
  return e;
}

/** Preferenze dell'interfaccia di chi usa questo browser (se lo spazio locale manca, pazienza). */
const MIXER_PREF = 'studiomio.session.mixer';
const readPref = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePref = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* niente */ }
};

/** Una clip presa con il mouse: diventa un trascinamento dopo qualche pixel. */
interface SlotDrag {
  readonly from: SlotRef;
  readonly x: number;
  readonly y: number;
  ghost: HTMLElement | null;
}

export class SessionView {
  readonly element = el('section', { className: 'session-view', hidden: true, tabIndex: -1 });
  private readonly grid = el('div', { className: 'session-grid' });
  private readonly scroll = el('div', { className: 'session-scroll' }, this.grid);
  /** Il riquadro del controller collegato (il "riquadro rosso" di Live): le clip che la sua griglia suona. */
  private readonly ring = el('div', { className: 'session-ring', hidden: true });
  private ringAt = '';
  private readonly mixerToggle = el<HTMLButtonElement>('button', { textContent: '🎚 Mixer', title: 'Mostra o nascondi il mixer in fondo alle tracce' });
  private readonly quantize = el<HTMLSelectElement>('select', { title: 'Quantizzazione del lancio: le clip partono al prossimo confine' },
    ...LAUNCH_QUANTA.map(q => el('option', { value: q.id, textContent: q.label })));
  private readonly strips = new Map<TrackId, TrackStrip>();
  private readonly master: MasterStripView;
  /** Le celle ricostruite a ogni modifica (le strisce del mixer invece restano). */
  private cells: HTMLElement[] = [];
  private readonly slots = new Map<string, HTMLElement>();
  private readonly stops = new Map<TrackId, HTMLElement>();
  private readonly heads = new Map<TrackId, HTMLElement>();
  private selected: SlotRef | null = null;
  private drag: SlotDrag | null = null;
  /** Il selettore dei file audio da mettere in uno slot (lo slot è `pickFor`). */
  private readonly picker = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
  private pickFor: SlotRef | null = null;

  constructor(private readonly deps: SessionViewDeps) {
    const { store } = deps;
    this.master = new MasterStripView(store, deps, deps.meters);
    this.quantize.onchange = () => store.apply(setLaunchQuantization(this.quantize.value));
    this.mixerToggle.onclick = () => this.showMixer(this.grid.classList.contains('no-mixer'));
    const toolbar = el('div', { className: 'session-toolbar' },
      el('label', {}, 'Lancio ', this.quantize),
      el('button', { textContent: '+ Scena', title: 'Nuova scena in fondo', onclick: () => store.apply(insertScene()) }),
      el('button', { textContent: '+ Audio', title: 'Nuova traccia audio', onclick: () => deps.addTrack('audio') }),
      el('button', { textContent: '+ MIDI', title: 'Nuova traccia MIDI', onclick: () => deps.addTrack('midi') }),
      el('button', { textContent: '+ Bus', title: 'Nuovo bus: le tracce gli mandano il suono con le manopole delle mandate', onclick: () => store.apply(addBus()) }),
      this.mixerToggle,
      el('span', { className: 'muted', textContent: 'Tab: arrangement · doppio clic su uno slot vuoto: clip MIDI nuova o audio da importare · trascina (Ctrl copia)' }));
    this.picker.onchange = () => {
      const files = [...(this.picker.files ?? [])], ref = this.pickFor;
      this.picker.value = '';
      this.pickFor = null;
      if (files.length && ref) this.deps.importToSlot(files, ref.track, ref.slot);
    };
    this.grid.append(this.master.element);
    this.element.append(toolbar, this.scroll, this.picker);
    this.showMixer(readPref(MIXER_PREF) !== 'off');
    // lo slot portato in vista (frecce) non deve finire sotto le intestazioni o sotto il mixer
    new ResizeObserver(() => this.padScroll()).observe(this.master.element);
    this.bindGrid();
    bindKeys(this.element, this, SESSION_KEYS, true);
    store.onChange(() => this.render());
    deps.ui.onChange(() => {
      this.highlightTrack();
      this.placeRing();
    });
    deps.engine.onSessionChange(() => this.refreshState());
    this.render();
    requestAnimationFrame(this.frame);
  }

  /** Il mixer in fondo alle colonne: si nasconde per lasciare spazio alle clip. */
  showMixer(visible: boolean): void {
    this.grid.classList.toggle('no-mixer', !visible);
    this.mixerToggle.classList.toggle('on', visible);
    writePref(MIXER_PREF, visible ? 'on' : 'off');
    this.padScroll();
  }

  private padScroll(): void {
    const mixer = this.grid.classList.contains('no-mixer') ? 0 : this.master.element.offsetHeight;
    this.scroll.style.scrollPaddingBottom = `${mixer}px`;
    this.scroll.style.scrollPaddingTop = `${this.grid.querySelector<HTMLElement>('.session-head')?.offsetHeight ?? 0}px`;
  }

  get isVisible(): boolean {
    return !this.element.hidden;
  }

  show(visible: boolean): void {
    this.element.hidden = !visible;
    if (visible) {
      this.element.focus({ preventScroll: true });
      this.refreshState();
    }
  }

  /** Lo slot scelto (per le prove e per l'app). */
  get selection(): SlotRef | null {
    return this.selected;
  }

  // ---------------------------------------------------------------- comandi sullo slot scelto

  launchSelected(): void {
    if (this.selected) this.deps.engine.launchSlot(this.selected.track, this.selected.slot);
  }

  clearSelected(): void {
    if (this.selectedClip()) this.apply(clearSlot(this.selected!));
  }

  duplicateSelected(): void {
    if (!this.selectedClip()) return;
    this.apply(duplicateSlotClip(this.selected!));
    this.select({ ...this.selected!, slot: this.selected!.slot + 1 });
  }

  /** Cattura e inserisci scena: sotto `index` (la scena dello slot scelto, se no l'ultima) una
   *  scena con le clip che suonano, che continuano a suonare da lì. */
  captureAndInsertScene(index = this.selected?.slot ?? this.deps.store.project.scenes.length - 1): void {
    const playing = this.deps.engine.playingClips();
    if (!this.apply(captureScene(index, playing))) return;
    if (this.selected) this.select({ ...this.selected, slot: index + 1 });
    if (!playing.size) this.deps.say('Nessuna clip suona: inserita una scena vuota.');
  }

  copySelected(): boolean {
    const s = this.selected;
    const copied = s && copySlotClip(this.deps.store.project, s.track, s.slot);
    if (!copied) return false;
    this.deps.clipboard.content = copied;
    this.deps.say('Clip copiata: Ctrl+V la incolla in un altro slot, o nella timeline al cursore.');
    return true;
  }

  cutSelected(): void {
    if (this.copySelected()) this.clearSelected();
  }

  pasteSelected(): void {
    const s = this.selected, content = this.deps.clipboard.clips;
    if (!s) return;
    if (!content) return this.deps.say('Negli appunti non ci sono clip.');
    this.apply(pasteToSlot(content, s.track, s.slot));
  }

  /** Sceglie dei file audio da mettere nello slot `ref` (e in quelli sotto, se sono più d'uno). */
  importAudioTo(ref: SlotRef): void {
    this.pickFor = ref;
    this.picker.click();
  }

  moveSelection(dx: number, dy: number): void {
    const p = this.deps.store.project, s = this.selected, tracks = p.visibleTracks;
    if (!tracks.length) return;
    const col = s ? Math.max(0, tracks.findIndex(t => t.id === s.track)) : 0;
    const c = Math.max(0, Math.min(tracks.length - 1, col + dx));
    const slot = Math.max(0, Math.min(p.scenes.length - 1, (s?.slot ?? 0) + (s ? dy : 0)));
    this.select({ track: tracks[c].id, slot });
  }

  // ---------------------------------------------------------------- disegno

  /** Le colonne sono le tracce che si vedono (un gruppo chiuso nasconde quelle delle sue
   *  tracce); i bus stanno a destra, accanto al master. */
  private render(): void {
    const p = this.deps.store.project, tracks = p.visibleTracks;
    const T = tracks.length, B = p.buses.length, S = p.scenes.length;
    // lo spazio che avanza sta tra le tracce e i bus: bus e master restano sul bordo destro
    const cols = (n: number) => (n ? `repeat(${n}, var(--session-col)) ` : '');
    this.grid.style.gridTemplateColumns = `${cols(T)}minmax(0, 1fr) ${cols(B)}var(--session-master)`;
    this.grid.style.gridTemplateRows = `auto repeat(${S}, var(--session-row)) auto 1fr auto`;
    if (this.quantize.value !== p.launchQuantization) this.quantize.value = p.launchQuantization;
    if (this.selected && !(tracks.some(t => t.id === this.selected!.track) && this.selected.slot < S)) this.selected = null;
    for (const c of this.cells) c.remove();
    this.slots.clear();
    this.stops.clear();
    this.heads.clear();
    const cells: HTMLElement[] = [];
    tracks.forEach((t, i) => {
      const col = i + 1;
      cells.push(place(this.head(t), row.head, col));
      t.slots.forEach((clip, s) => cells.push(place(this.slot(t, s, clip), row.scene(s), col)));
      cells.push(place(this.stopButton(t), row.stop(S), col));
    });
    p.buses.forEach((b, i) => {
      const col = busColumn(T, i);
      cells.push(pinBus(place(this.busHead(b), row.head, col), B, i));
      // niente slot: la colonna resta vuota fino al mixer
      const lane = pinBus(place(el('div', { className: 'bus-lane' }), row.scene(0), col), B, i);
      lane.style.gridRowEnd = String(row.stop(S) + 1);
      lane.style.setProperty('--color', b.color);
      cells.push(lane);
    });
    const masterCol = T + B + 2;
    cells.push(place(el('div', { className: 'session-head master-head', textContent: 'Master' }), row.head, masterCol));
    p.scenes.forEach((scene, s) => cells.push(place(this.sceneCell(scene, s), row.scene(s), masterCol)));
    cells.push(place(el('button', {
      className: 'stop-all', textContent: '■ Ferma tutte', title: 'Ferma tutte le clip al prossimo confine',
      onclick: () => this.deps.engine.stopAllClips(),
    }), row.stop(S), masterCol));
    this.cells = cells;
    this.grid.append(...cells, this.ring);
    this.renderStrips(S);
    this.highlightTrack();
    this.placeRing();
    this.refreshState();
  }

  /** Le tracce scelte: intestazione, slot e striscia del mixer delle loro colonne. */
  private highlightTrack(): void {
    const chosen = this.deps.ui.selectedTracks;
    for (const [t, head] of this.heads) head.classList.toggle('selected', chosen.has(t));
    for (const cell of this.slots.values()) cell.classList.toggle('track-selected', chosen.has(cell.dataset.track as TrackId));
    for (const [t, strip] of this.strips) strip.element.classList.toggle('selected', chosen.has(t));
  }

  /** Il riquadro sopra gli slot che copre; quando si sposta, lo si porta in vista. */
  private placeRing(): void {
    const r = this.deps.ui.sessionRing, p = this.deps.store.project;
    const T = p.visibleTracks.length, S = p.scenes.length;
    this.ring.hidden = !r || r.track >= T || r.scene >= S;
    if (!r || this.ring.hidden) return;
    place(this.ring, row.scene(r.scene), r.track + 1);
    this.ring.style.gridRowEnd = `span ${Math.min(r.height, S - r.scene)}`;
    this.ring.style.gridColumnEnd = `span ${Math.min(r.width, T - r.track)}`;
    const at = `${r.track}:${r.scene}`;
    if (at !== this.ringAt && this.isVisible) this.ring.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.ringAt = at;
  }

  /** Le strisce del mixer restano nella griglia: si aggiungono, si tolgono e si spostano. */
  private renderStrips(S: number): void {
    const p = this.deps.store.project, T = p.visibleTracks.length, B = p.buses.length;
    const tracks = [...p.visibleTracks, ...p.buses];
    const alive = new Set(tracks.map(t => t.id));
    for (const [id, strip] of this.strips) {
      if (alive.has(id)) continue;
      strip.dispose();
      strip.element.remove();
      this.strips.delete(id);
    }
    tracks.forEach((t, i) => {
      let strip = this.strips.get(t.id);
      if (!strip) {
        strip = new TrackStrip(t.id, this.deps.store, this.deps, this.deps.meters);
        const id = t.id;
        strip.element.addEventListener('pointerdown', e => this.clickTrack(id, e));
        this.strips.set(t.id, strip);
        this.grid.append(strip.element);
      }
      strip.update(t, p.buses);
      if (i < T) place(strip.element, row.mixer(S), i + 1);
      else pinBus(place(strip.element, row.mixer(S), busColumn(T, i - T)), B, i - T);
    });
    this.master.update(p);
    place(this.master.element, row.mixer(S), T + B + 2);
  }

  private clickTrack(id: TrackId, e: MouseEvent): void {
    const p = this.deps.store.project;
    clickTrack(this.deps.ui, id, e, () => [...p.visibleTracks, ...p.buses].map(t => t.id));
  }

  /** L'intestazione di un bus: come quella di una traccia, ma un bus non ha clip né gruppi. */
  private busHead(b: BusTrack): HTMLElement {
    const name = el('span', { className: 'session-track-name', textContent: b.name });
    const head = el('div', { className: 'session-head bus', title: `${b.name}: un clic apre gli effetti, doppio clic rinomina` }, name);
    head.style.setProperty('--color', b.color);
    head.dataset.track = b.id;
    head.onpointerdown = e => this.clickTrack(b.id, e);
    head.onclick = e => {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.deps.openDevices(b.id);
    };
    head.ondblclick = e => {
      e.stopPropagation();
      renameInline(name, n => this.apply(renameTrack(b.id, n)));
    };
    head.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Effetti', run: () => this.deps.openDevices(b.id) },
        ...addEffectItems(this.deps.store, b.id, () => this.deps.openDevices(b.id)),
        { label: 'Rinomina', shortcut: 'doppio clic', run: () => renameInline(name, n => this.apply(renameTrack(b.id, n))) },
        { colors: PALETTE, current: b.color, required: true, pick: c => c && this.apply(setTrackColor(b.id, c)) },
        SEPARATOR,
        { label: 'Elimina il bus', run: () => this.apply(removeTrack(b.id)) },
        SEPARATOR,
        { label: 'Nuovo bus', run: () => this.apply(addBus()) },
      ]);
    };
    this.heads.set(b.id, head);
    return head;
  }

  private head(t: Track): HTMLElement {
    const p = this.deps.store.project;
    const name = el('span', { className: 'session-track-name', textContent: t.name });
    const head = el('div', { className: 'session-head', title: `${t.name}: un clic apre strumento ed effetti, doppio clic rinomina` }, name);
    head.style.setProperty('--color', t.color);
    head.dataset.track = t.id;
    if (t instanceof GroupTrack) {
      head.classList.add('group');
      head.prepend(el('button', {
        className: 'fold', textContent: t.folded ? '▸' : '▾', title: t.folded ? 'Apri il gruppo' : 'Chiudi il gruppo: nasconde le colonne delle sue tracce',
        onclick: (e: MouseEvent) => { e.stopPropagation(); toggleFold(this.deps.store, t); },
      }));
    }
    const group = t.group ? p.track(t.group) : undefined;
    if (group) {
      head.classList.add('in-group');
      head.style.setProperty('--group-color', group.color);
    }
    head.onpointerdown = e => this.clickTrack(t.id, e);
    head.onclick = e => {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.deps.openDevices(t.id);
    };
    head.ondblclick = e => {
      e.stopPropagation();
      renameInline(name, n => this.apply(renameTrack(t.id, n)));
    };
    head.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: t.kind === 'midi' ? 'Strumento ed effetti' : 'Effetti', run: () => this.deps.openDevices(t.id) },
        ...addEffectItems(this.deps.store, t.id, () => this.deps.openDevices(t.id)),
        { label: 'Rinomina', shortcut: 'doppio clic', run: () => renameInline(name, n => this.apply(renameTrack(t.id, n))) },
        { colors: PALETTE, current: t.color, required: true, pick: c => c && this.apply(setTrackColor(t.id, c)) },
        SEPARATOR,
        ...groupMenuItems(this.deps.store, this.deps.ui, t),
        SEPARATOR,
        { label: t instanceof GroupTrack ? 'Elimina il gruppo e le sue tracce' : 'Elimina traccia', run: () => this.apply(removeTrack(t.id)) },
        SEPARATOR,
        ...newTrackHereItems(this.deps.store, t),
      ]);
    };
    this.heads.set(t.id, head);
    return head;
  }

  private slot(t: Track, s: number, clip: Clip | null): HTMLElement {
    if (t instanceof GroupTrack) return this.groupSlot(t, s);
    const cell = el('div', { className: clip ? 'slot filled' : 'slot' });
    cell.dataset.track = t.id;
    cell.dataset.slot = String(s);
    if (clip) {
      cell.style.setProperty('--clip', clip.color);
      cell.title = `${clip.name}: ▶ lancia, un clic apre l'editor, trascina per spostare (Ctrl copia)`;
      cell.append(
        el('button', { className: 'launch', textContent: '▶', title: 'Lancia la clip', onclick: () => this.deps.engine.launchSlot(t.id, s) }),
        el('span', { className: 'clip-name', textContent: clip.name }),
        el('div', { className: 'progress' }));
    } else {
      if (t.kind === 'audio') cell.title = 'Doppio clic: importa un file audio in questo slot (o trascinalo qui)';
      cell.append(el('button', { className: 'slot-stop', textContent: '■', title: 'Ferma la traccia', onclick: () => this.deps.engine.stopTrack(t.id) }));
    }
    if (this.selected?.track === t.id && this.selected.slot === s) cell.classList.add('selected');
    this.slots.set(slotKey(t.id, s), cell);
    return cell;
  }

  /** Lo slot di un gruppo, come in Live: se almeno una sua traccia ha una clip nella riga, ▶
   *  lancia la riga delle sue tracce (quelle senza clip lì si fermano); se no ■ le ferma. */
  private groupSlot(t: GroupTrack, s: number): HTMLElement {
    const clips = this.deps.store.project.soundingTracks(t.id).some(m => m.slots[s]);
    const cell = el('div', { className: clips ? 'slot group-slot has-clips' : 'slot group-slot' });
    cell.style.setProperty('--color', t.color);
    cell.dataset.track = t.id;
    cell.dataset.slot = String(s);
    cell.append(clips
      ? el('button', { className: 'launch', textContent: '▶', title: 'Lancia la riga delle tracce del gruppo', onclick: () => this.deps.engine.launchSlot(t.id, s) })
      : el('button', { className: 'slot-stop', textContent: '■', title: 'Ferma le tracce del gruppo', onclick: () => this.deps.engine.stopTrack(t.id) }));
    if (this.selected?.track === t.id && this.selected.slot === s) cell.classList.add('selected');
    this.slots.set(slotKey(t.id, s), cell);
    return cell;
  }

  private stopButton(t: Track): HTMLElement {
    const b = el('button', { className: 'track-stop', textContent: '■', title: 'Ferma la clip della traccia', onclick: () => this.deps.engine.stopTrack(t.id) });
    this.stops.set(t.id, b);
    return b;
  }

  private sceneCell(scene: Scene, index: number): HTMLElement {
    const name = el('span', { className: 'scene-name', textContent: scene.name });
    const cell = el('div', { className: 'scene' },
      el('button', { className: 'launch', textContent: '▶', title: 'Lancia la scena', onclick: () => this.deps.engine.launchScene(index) }), name);
    cell.classList.toggle('colored', !!scene.color);
    if (scene.color) cell.style.setProperty('--scene', scene.color);
    cell.ondblclick = () => renameInline(name, n => this.apply(renameScene(scene.id, n)));
    cell.oncontextmenu = e => {
      e.preventDefault();
      const only = this.deps.store.project.scenes.length < 2;
      const sceneHasClips = sceneClips(this.deps.store.project, index).length > 0;
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Lancia la scena', run: () => this.deps.engine.launchScene(index) },
        { label: 'Rinomina', shortcut: 'doppio clic', run: () => renameInline(name, n => this.apply(renameScene(scene.id, n))) },
        { colors: PALETTE, current: scene.color, pick: c => c !== scene.color && this.apply(setSceneColor(scene.id, c)) },
        { label: 'Duplica', run: () => this.apply(duplicateScene(scene.id)) },
        { label: 'Cattura e inserisci scena', shortcut: 'Ctrl+Maiusc+I', run: () => this.captureAndInsertScene(index) },
        { label: 'Copia nell\'arrangement', disabled: !sceneHasClips, run: () => this.deps.sceneToArrangement(index) },
        { label: 'Esporta audio…', run: () => this.deps.exportScene(index) },
        { label: 'Inserisci una scena sopra', run: () => this.apply(insertScene(index)) },
        { label: 'Inserisci una scena sotto', run: () => this.apply(insertScene(index + 1)) },
        SEPARATOR,
        { label: 'Elimina la scena', disabled: only, run: () => this.apply(deleteScene(scene.id)) },
      ]);
    };
    return cell;
  }

  // ---------------------------------------------------------------- stato della riproduzione

  /** Clip che suonano, in coda e tracce che si fermano: a ogni fotogramma (l'avanzamento
   *  scorre) e subito dopo un lancio. */
  private refreshState(): void {
    if (this.element.hidden) return;
    const { engine, store } = this.deps;
    const p = store.project;
    for (const t of p.visibleTracks) {
      // di un gruppo: le sue tracce insieme, e riga per riga
      const st = engine.sessionState(t);
      const queued = st.queued && typeof st.queued === 'object' ? st.queued.slot : -1;
      const members = t instanceof GroupTrack ? p.soundingTracks(t.id).map(m => [m, engine.sessionState(m)] as const) : null;
      t.slots.forEach((clip, s) => {
        const cell = this.slots.get(slotKey(t.id, s));
        if (!cell) return;
        const group = members && groupSlotState(members, s);
        const playing = group ? group.playing : st.playing?.slot === s;
        cell.classList.toggle('playing', playing);
        cell.classList.toggle('queued', group ? group.queued : queued === s);
        const bar = cell.querySelector<HTMLElement>('.progress');
        if (bar) bar.style.transform = `scaleX(${playing && clip ? clipProgress(clip, st.playing!.elapsed) : 0})`;
      });
      this.stops.get(t.id)?.classList.toggle('queued', st.queued === 'stop');
      this.heads.get(t.id)?.classList.toggle('taken', !st.followsArrangement);
    }
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    if (this.deps.engine.playing) this.refreshState();
  };

  // ---------------------------------------------------------------- mouse

  private slotAt(target: EventTarget | null): SlotRef | null {
    const cell = (target as HTMLElement | null)?.closest?.<HTMLElement>('.slot');
    return cell ? { track: cell.dataset.track as TrackId, slot: Number(cell.dataset.slot) } : null;
  }

  private bindGrid(): void {
    const g = this.grid;
    g.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
      const ref = this.slotAt(e.target);
      if (!ref) return;
      this.select(ref);
      if (this.selectedClip()) this.drag = { from: ref, x: e.clientX, y: e.clientY, ghost: null };
    });
    window.addEventListener('pointermove', e => this.dragMove(e));
    window.addEventListener('pointerup', e => this.dragEnd(e));
    g.addEventListener('dblclick', e => {
      if ((e.target as HTMLElement).closest('button')) return;
      const ref = this.slotAt(e.target);
      const track = ref && this.deps.store.project.track(ref.track);
      if (!ref || !track || track.slots[ref.slot] || track instanceof GroupTrack) return;
      if (track.kind !== 'midi') return this.importAudioTo(ref);
      this.apply(newSlotMidiClip(ref));
      this.openSlot(ref);
    });
    g.addEventListener('contextmenu', e => {
      const ref = this.slotAt(e.target);
      if (!ref) return;
      e.preventDefault();
      this.select(ref);
      showContextMenu(e.clientX, e.clientY, this.slotMenu(ref, e.target as HTMLElement));
    });
    // file audio trascinati da fuori: negli slot (una traccia nuova se non è audio)
    g.addEventListener('dragover', e => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    g.addEventListener('drop', e => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const ref = this.slotAt(e.target);
      this.deps.importToSlot(files, ref?.track ?? null, ref?.slot ?? 0);
    });
    if (this.deps.dropItem) {
      acceptBrowserDrops(g, (item, e) => this.deps.dropItem!(item, this.dropTarget(item, e.target)), {
        // lo slot (o la testa della colonna) dove andrà, evidenziato
        over: e => {
          for (const c of g.querySelectorAll('.drop-target')) c.classList.remove('drop-target');
          const node = (e?.target as HTMLElement | null)?.closest?.('.slot, .session-head');
          node?.classList.add('drop-target');
        },
      });
    }
  }

  /** Dove va una voce del browser lasciata su `target`: lo slot sotto; sulla testa (o sul mixer)
   *  di una colonna la sua traccia (un sample nel primo slot libero); sul master la sua catena. */
  private dropTarget(item: BrowserItem, target: EventTarget | null): LoadTarget {
    const ref = this.slotAt(target);
    if (ref) return { kind: 'slot', ...ref };
    const node = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-track], .master-head');
    const p = this.deps.store.project;
    if (node?.classList.contains('master-head')) return { kind: 'chain', owner: MASTER };
    const track = node?.dataset.track ? p.track(node.dataset.track as TrackId) : undefined;
    const audio = item.payload?.kind === 'sample' || item.payload?.kind === 'file';
    if (!track) return audio ? { kind: 'slot', track: null, slot: 0 } : { kind: 'lane', track: null, beat: 0 };
    if (!audio) return { kind: 'chain', owner: track.id };
    const free = track.slots.findIndex(c => !c);
    return { kind: 'slot', track: track.id, slot: free < 0 ? 0 : free };
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      const source = this.slots.get(slotKey(d.from.track, d.from.slot));
      d.ghost = el('div', { className: 'slot filled slot-ghost', textContent: source?.querySelector('.clip-name')?.textContent ?? '' });
      d.ghost.style.setProperty('--clip', source?.style.getPropertyValue('--clip') ?? '');
      document.body.append(d.ghost);
    }
    d.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
    d.ghost.classList.toggle('copy', e.ctrlKey || e.metaKey);
    for (const c of this.slots.values()) c.classList.remove('drop-target');
    const over = this.slotAt(document.elementFromPoint(e.clientX, e.clientY));
    if (over) this.slots.get(slotKey(over.track, over.slot))?.classList.add('drop-target');
  }

  private dragEnd(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    for (const c of this.slots.values()) c.classList.remove('drop-target');
    if (!d.ghost) return this.openSlot(d.from); // un clic: apre la clip nell'editor
    d.ghost.remove();
    const to = this.slotAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!to || (to.track === d.from.track && to.slot === d.from.slot)) return;
    if (this.apply(moveSlotClip(d.from, to, e.ctrlKey || e.metaKey))) this.select(to);
  }

  private slotMenu(ref: SlotRef, target: HTMLElement): MenuItem[] {
    const p = this.deps.store.project, track = p.track(ref.track)!, clip = track.slots[ref.slot];
    if (track instanceof GroupTrack) {
      return [
        { label: 'Lancia la riga del gruppo', shortcut: 'Invio', run: () => this.deps.engine.launchSlot(track.id, ref.slot) },
        { label: 'Ferma le tracce del gruppo', run: () => this.deps.engine.stopTrack(track.id) },
      ];
    }
    if (!clip) {
      return [
        track.kind === 'midi'
          ? { label: 'Nuova clip MIDI', shortcut: 'doppio clic', run: () => { this.apply(newSlotMidiClip(ref)); this.openSlot(ref); } }
          : { label: 'Importa audio…', shortcut: 'doppio clic', run: () => this.importAudioTo(ref) },
        { label: 'Incolla', shortcut: KEY.paste, disabled: !this.deps.clipboard.clips, run: () => this.pasteSelected() },
        { label: 'Ferma la traccia', run: () => this.deps.engine.stopTrack(ref.track) },
      ];
    }
    const name = target.closest('.slot')?.querySelector<HTMLElement>('.clip-name');
    return [
      { label: 'Lancia', shortcut: 'Invio', run: () => this.launchSelected() },
      { label: 'Apri nell\'editor', shortcut: 'clic', run: () => this.openSlot(ref) },
      SEPARATOR,
      { label: 'Taglia', shortcut: KEY.cut, run: () => this.cutSelected() },
      { label: 'Copia', shortcut: KEY.copy, run: () => this.copySelected() },
      { label: 'Duplica', shortcut: KEY.duplicate, run: () => this.duplicateSelected() },
      { label: 'Rinomina', run: () => name && renameInline(name, n => this.apply(updateSlotClip('Rinomina clip', ref.track, clip.id, c => c.withName(n)))) },
      SEPARATOR,
      { colors: PALETTE, current: clip.color, noneTitle: 'Colore della traccia', pick: c => this.apply(setClipColor([slotRef(ref.track, clip.id)], c)) },
      SEPARATOR,
      { label: 'Elimina', shortcut: KEY.delete, run: () => this.clearSelected() },
    ];
  }

  // ---------------------------------------------------------------- aiuti

  private select(ref: SlotRef): void {
    this.selected = ref;
    this.deps.ui.selectTrack(ref.track);
    for (const c of this.slots.values()) c.classList.remove('selected');
    const cell = this.slots.get(slotKey(ref.track, ref.slot));
    cell?.classList.add('selected');
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.element.focus({ preventScroll: true });
  }

  private selectedClip(): Clip | null {
    const s = this.selected;
    return (s && this.deps.store.project.track(s.track)?.slots[s.slot]) ?? null;
  }

  /** Apre la clip nell'editor in basso; la tastiera resta alla session (Ctrl+C copia la clip). */
  private openSlot(ref: SlotRef): void {
    const clip = this.deps.store.project.track(ref.track)?.slots[ref.slot];
    if (!clip) return;
    this.deps.openClip(slotRef(ref.track, clip.id));
    this.element.focus({ preventScroll: true });
  }

  /** Applica una modifica; un errore (es. una clip audio su una traccia MIDI) va nella barra di stato. */
  private apply(e: Edit): boolean {
    try {
      this.deps.store.apply(e);
      return true;
    } catch (err) {
      this.deps.say(err instanceof TypeError ? 'Le clip vanno su tracce dello stesso tipo: audio con audio, MIDI con MIDI.' : `${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
