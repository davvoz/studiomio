import type { BrowserItem, LoadTarget } from '../browser/item';
import type { TrackId } from '../core/id';
import { instrumentType } from '../devices/registry';
import { PALETTE } from '../model/colors';
import type { ChainOwner } from '../model/project';
import { GroupTrack, type MidiTrack, type Track } from '../model/track';
import { addTrack, moveTrack, removeTrack, renameTrack, setMixer, type TrackDrop } from '../store/edits';
import { setTrackColor } from '../store/clip-ref';
import type { ProjectStore } from '../store/project-store';
import { acceptBrowserDrops } from './browser/browser-drag';
import { SEPARATOR, showContextMenu, type MenuItem } from './context-menu';
import { groupMenuItems, newTrackHereItems, toggleFold } from './track-groups';
import { clickTrack, type UiState } from './ui-state';
import { el } from './dom';
import { renameInline } from './inline-rename';
import { LevelMeter, type MeterBoard } from './meters/meter-board';
import { canStartTrackDrag, startTrackDrag, type DropSpot } from './track-drag';
import { addEffectItems, fxButton, midiSlot, midiTarget, setFxCount, setVolume, volumeSlider } from './mixer-controls';

export interface HeaderActions {
  /** Apre la catena dei dispositivi (strumento ed effetti) di una traccia o del master. */
  openDevices(owner: ChainOwner): void;
  /** Una voce del browser lasciata su una traccia (o sotto le tracce: `track` null). */
  dropItem?(item: BrowserItem, target: LoadTarget): void;
}

const kindBadge = (text: string) => () => el('span', { className: 'kind', textContent: text });

/** Accanto al nome: il tipo della traccia o, per le tracce MIDI, il loro strumento (un clic lo apre). */
const BADGES: Readonly<Record<string, (t: Track, actions: HeaderActions) => HTMLElement>> = {
  audio: kindBadge('Audio'),
  group: kindBadge('Gruppo'),
  midi: (t, actions) => {
    const { instrument } = t as MidiTrack;
    const label = instrumentType(instrument.type)?.label ?? instrument.type;
    const text = instrument.preset ? `${label} · ${instrument.preset}` : label;
    return el('button', { className: 'kind instrument', textContent: text, title: `${text}: apri lo strumento`, onclick: () => actions.openDevices(t.id) });
  },
};

const badgeFor = (t: Track, actions: HeaderActions) => (BADGES[t.kind] ?? kindBadge(t.kind))(t, actions);

/** Colonna a sinistra della timeline: nome, mute/solo, volume di ogni traccia che si vede (le
 *  tracce di un gruppo chiuso no), allineata allo scorrimento verticale delle corsie; le tracce
 *  di un gruppo rientrano sotto di lui. Ogni riga si aggiorna al suo posto, così un volume
 *  trascinato continua anche se il progetto cambia a ogni passo. */
export class TrackHeaders {
  readonly element = el('div', { className: 'headers' });
  private readonly list = el('div', { className: 'header-list' });
  private rows = new Map<TrackId, HeaderRow>();

  constructor(
    private readonly store: ProjectStore,
    private readonly ui: UiState,
    private readonly actions: HeaderActions,
    private readonly meters: MeterBoard,
  ) {
    const add = el('div', { className: 'header-add' },
      el('button', { textContent: '+ Audio', title: 'Nuova traccia audio', onclick: () => store.apply(addTrack('audio')) }),
      el('button', { textContent: '+ MIDI', title: 'Nuova traccia MIDI', onclick: () => store.apply(addTrack('midi')) }));
    const scroll = el('div', { className: 'header-scroll' }, this.list);
    // tasto destro sotto le tracce: solo le tracce nuove
    scroll.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, newTrackItems(store));
    };
    this.element.append(add, scroll);
    // dal browser: sull'intestazione va nella catena della traccia, sotto le tracce in una nuova
    if (actions.dropItem) acceptBrowserDrops(scroll, (item, e) => {
      const y = e.clientY - scroll.getBoundingClientRect().top;
      const track = store.project.visibleTracks[ui.geometry.trackIndexAt(y)];
      actions.dropItem!(item, track ? { kind: 'chain', owner: track.id } : { kind: 'lane', track: null, beat: 0 });
    });
    // un'intestazione trascinata sposta la traccia (un gruppo con le sue)
    this.list.addEventListener('pointerdown', e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.header');
      const id = row?.dataset.track as TrackId | undefined;
      if (!row || !id || !canStartTrackDrag(e)) return;
      startTrackDrag(e, { source: row, spotAt: m => this.dropSpot(id, m), drop: drop => store.apply(moveTrack(id, drop)) });
    });
    store.onChange(() => this.render());
    ui.onChange(() => {
      this.position();
      this.highlight();
    });
    this.render();
  }

  private position(): void {
    this.list.style.transform = `translateY(${-this.ui.geometry.scrollY}px)`;
  }

  private render(): void {
    const h = this.ui.geometry.trackHeight;
    const project = this.store.project, tracks = project.visibleTracks;
    const rows = new Map<TrackId, HeaderRow>();
    for (const t of tracks) {
      const row = this.rows.get(t.id) ?? new HeaderRow(t.id, this.store, this.ui, this.actions, this.meters);
      const group = t.group ? project.track(t.group) : undefined;
      row.update(t, h, project.groupsOf(t.id).length, group?.color ?? null);
      rows.set(t.id, row);
    }
    for (const [id, row] of this.rows) if (!rows.has(id)) row.dispose();
    this.rows = rows;
    // la lista si rifà solo se tracce aggiunte, tolte o spostate
    const elements = tracks.map(t => rows.get(t.id)!.element);
    const children = this.list.children;
    if (children.length !== elements.length || elements.some((e, i) => children[i] !== e)) this.list.replaceChildren(...elements);
    this.position();
    this.highlight();
  }

  /** Dove andrebbe la traccia `id` lasciata in `e`: nella metà alta di una riga prima di lei,
   *  nella metà bassa dopo (in cima alle tracce, se è un gruppo aperto), sotto tutte in fondo.
   *  La linea rientra come la traccia che ci andrà. */
  private dropSpot(id: TrackId, e: PointerEvent): DropSpot<TrackDrop> | null {
    const p = this.store.project, tracks = p.visibleTracks, { trackHeight: h, scrollY } = this.ui.geometry;
    const box = this.list.parentElement!.getBoundingClientRect();
    const y = Math.max(0, e.clientY - box.top + scrollY);
    const i = Math.floor(y / h);
    const spot = (drop: TrackDrop, row: number, depth: number): DropSpot<TrackDrop> => {
      const indent = 10 + depth * 12;
      return { drop, line: { x: box.left + indent, y: box.top + row * h - scrollY - 1, width: box.width - indent, height: 2 } };
    };
    if (i >= tracks.length) return spot({ end: true }, tracks.length, 0);
    const t = tracks[i];
    if (t.id === id || p.isInGroup(t.id, id)) return null;
    const depth = p.groupsOf(t.id).length;
    if (y - i * h < h / 2) return spot({ before: t.id }, i, depth);
    if (t instanceof GroupTrack && !t.folded) return spot({ first: t.id }, i + 1, depth + 1);
    return spot({ after: t.id }, i + 1, depth);
  }

  private highlight(): void {
    for (const [id, row] of this.rows) row.element.classList.toggle('selected', this.ui.selectedTracks.has(id));
  }
}

/** L'intestazione di una traccia: costruita una volta, poi aggiornata da `update`. */
class HeaderRow {
  readonly element = el('div', { className: 'header' });
  private readonly name = el('span', { className: 'track-name', title: 'Doppio clic per rinominare' });
  /** ▾ / ▸ per aprire e chiudere un gruppo (null per le altre tracce). */
  private readonly fold: HTMLButtonElement | null = null;
  private badge: HTMLElement = el('span');
  private readonly mute: HTMLButtonElement;
  private readonly solo: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly fx: HTMLButtonElement;
  /** La traccia mostrata l'ultima volta (per non rifare ciò che non è cambiato). */
  private shown: Track | null = null;
  private readonly detachMeter: () => void;

  constructor(private readonly id: TrackId, private readonly store: ProjectStore, ui: UiState, private readonly actions: HeaderActions, meters: MeterBoard) {
    const open = () => actions.openDevices(id);
    // un clic ovunque nell'intestazione sceglie la traccia (Maiusc, Ctrl: anche altre)
    this.element.addEventListener('pointerdown', e => clickTrack(ui, id, e, () => store.project.visibleTracks.map(t => t.id)));
    const isGroup = store.project.track(id) instanceof GroupTrack;
    if (isGroup) this.fold = el<HTMLButtonElement>('button', { className: 'fold', onclick: () => toggleFold(store, this.track() as GroupTrack) });
    const toggle = (label: string, title: string, flag: 'mute' | 'solo') => midiTarget(
      el<HTMLButtonElement>('button', { textContent: label, title, onclick: () => this.mixer({ [flag]: !this.track().mixer[flag] }) }),
      { kind: 'mixer', owner: id, control: flag });
    this.mute = toggle('M', 'Mute', 'mute');
    this.solo = toggle('S', 'Solo', 'solo');
    this.volume = volumeSlider(store, 0, `vol-${id}`, (volumeDb, merge) => this.mixer({ volumeDb }, merge));
    this.fx = fxButton(0, 'Effetti della traccia', open);
    this.name.ondblclick = () => this.rename();
    const meter = new LevelMeter('track-meter', () => meters.resetClip(id));
    this.detachMeter = meters.attach(id, meter);
    this.element.classList.toggle('group', isGroup);
    this.element.dataset.track = id;
    this.element.append(
      el('div', { className: 'top' }, ...(this.fold ? [this.fold] : []), this.name, this.badge),
      el('div', { className: 'controls' }, this.mute, this.solo, midiSlot(this.volume, { kind: 'mixer', owner: id, control: 'volume' }), this.fx),
      meter.element);
    this.element.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      const t = this.track();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rinomina', shortcut: 'doppio clic', run: () => this.rename() },
        { colors: PALETTE, current: t.color, required: true, pick: c => c && store.apply(setTrackColor(t.id, c)) },
        { label: t.kind === 'midi' ? 'Strumento ed effetti' : 'Effetti', run: open },
        ...addEffectItems(store, id, open),
        { label: t.mixer.mute ? 'Togli il mute' : 'Mute', run: () => this.mixer({ mute: !t.mixer.mute }) },
        { label: t.mixer.solo ? 'Togli il solo' : 'Solo', run: () => this.mixer({ solo: !t.mixer.solo }) },
        SEPARATOR,
        ...groupMenuItems(store, ui, t),
        SEPARATOR,
        { label: isGroup ? 'Elimina il gruppo e le sue tracce' : 'Elimina traccia', run: () => store.apply(removeTrack(id)) },
        SEPARATOR,
        ...newTrackHereItems(store, t),
      ]);
    };
  }

  /** `depth`: quanti gruppi contengono la traccia; `groupColor`: il colore del suo gruppo. */
  update(t: Track, height: number, depth: number, groupColor: string | null): void {
    this.element.style.height = `${height}px`;
    this.element.style.setProperty('--depth', String(depth));
    this.element.classList.toggle('in-group', groupColor !== null);
    if (groupColor) this.element.style.setProperty('--group-color', groupColor);
    if (t === this.shown) return;
    this.shown = t;
    this.name.textContent = t.name;
    this.element.style.setProperty('--color', t.color);
    const badge = badgeFor(t, this.actions);
    this.badge.replaceWith(badge);
    this.badge = badge;
    this.mute.classList.toggle('on', t.mixer.mute);
    this.solo.classList.toggle('on', t.mixer.solo);
    setVolume(this.volume, t.mixer.volumeDb);
    setFxCount(this.fx, t.effects.length);
    if (this.fold && t instanceof GroupTrack) {
      this.fold.textContent = t.folded ? '▸' : '▾';
      this.fold.title = t.folded ? 'Apri il gruppo: mostra le sue tracce' : 'Chiudi il gruppo: nasconde le sue tracce (suonano lo stesso)';
    }
  }

  dispose(): void {
    this.detachMeter();
  }

  private track(): Track {
    return this.store.project.track(this.id)!;
  }

  private mixer(patch: Parameters<typeof setMixer>[1], mergeKey?: string): void {
    this.store.apply(setMixer(this.id, patch), mergeKey ? { mergeKey } : {});
  }

  private rename(): void {
    renameInline(this.name, name => this.store.apply(renameTrack(this.id, name)));
  }

}

const newTrackItems = (store: ProjectStore): MenuItem[] => [
  { label: 'Nuova traccia audio', run: () => store.apply(addTrack('audio')) },
  { label: 'Nuova traccia MIDI', run: () => store.apply(addTrack('midi')) },
];
