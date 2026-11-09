import type { BrowserItem, LoadTarget } from '../browser/item';
import type { TrackId } from '../core/id';
import { instrumentType } from '../devices/registry';
import { PALETTE } from '../model/colors';
import type { ChainOwner } from '../model/project';
import { GroupTrack, MidiTrack, type Track } from '../model/track';
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
import type { ModTarget } from '../model/envelope';
import { addEffectItems, automationOnRightClick, fxButton, keyboardButton, midiSlot, midiTarget, setFxCount, setVolume, volumeSlider } from './mixer-controls';

export interface HeaderActions {
  /** Opens the device chain (instrument and effects) of a track or of the master. */
  openDevices(owner: ChainOwner): void;
  /** A browser item dropped on a track (or below the tracks: `track` null). */
  dropItem?(item: BrowserItem, target: LoadTarget): void;
  /** Shows a parameter's curve in the track's clip. */
  showAutomation?(owner: ChainOwner, target: ModTarget): void;
  /** The menu items to paste devices onto `owner` (none if the clipboard has none). */
  pasteDeviceItems?(owner: ChainOwner): MenuItem[];
}

const kindBadge = (text: string) => () => el('span', { className: 'kind', textContent: text });

/** Next to the name: the track's kind or, for MIDI tracks, their instrument (a click opens it). */
const BADGES: Readonly<Record<string, (t: Track, actions: HeaderActions) => HTMLElement>> = {
  audio: kindBadge('Audio'),
  group: kindBadge('Group'),
  midi: (t, actions) => {
    const { instrument } = t as MidiTrack;
    const label = instrumentType(instrument.type)?.label ?? instrument.type;
    const text = instrument.preset ? `${label} · ${instrument.preset}` : label;
    return el('button', { className: 'kind instrument', textContent: text, title: `${text}: open the instrument`, onclick: () => actions.openDevices(t.id) });
  },
};

const badgeFor = (t: Track, actions: HeaderActions) => (BADGES[t.kind] ?? kindBadge(t.kind))(t, actions);

/** Column on the left of the timeline: name, mute/solo, volume of each visible track (the
 *  tracks of a closed group not), aligned with the lanes' vertical scrolling; the tracks
 *  of a group are indented under it. Each row is updated in place, so a dragged volume
 *  continues even if the project changes at every step. */
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
      el('button', { textContent: '+ Audio', title: 'New audio track', onclick: () => store.apply(addTrack('audio')) }),
      el('button', { textContent: '+ MIDI', title: 'New MIDI track', onclick: () => store.apply(addTrack('midi')) }));
    const scroll = el('div', { className: 'header-scroll' }, this.list);
    // right click below the tracks: only the new tracks
    scroll.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, newTrackItems(store));
    };
    this.element.append(add, scroll);
    // from the browser: on the header it goes into the track's chain, below the tracks into a new one
    if (actions.dropItem) acceptBrowserDrops(scroll, (item, e) => {
      const y = e.clientY - scroll.getBoundingClientRect().top;
      const track = store.project.visibleTracks[ui.geometry.trackIndexAt(y)];
      actions.dropItem!(item, track ? { kind: 'chain', owner: track.id } : { kind: 'lane', track: null, beat: 0 });
    });
    // a dragged header moves the track (a group with its own)
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
    // the list is redone only if tracks were added, removed or moved
    const elements = tracks.map(t => rows.get(t.id)!.element);
    const children = this.list.children;
    if (children.length !== elements.length || elements.some((e, i) => children[i] !== e)) this.list.replaceChildren(...elements);
    this.position();
    this.highlight();
  }

  /** Where track `id` dropped at `e` would go: in the upper half of a row before it,
   *  in the lower half after it (at the top of the tracks, if it's an open group), below all at the end.
   *  The line is indented like the track that will go there. */
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
    for (const [id, row] of this.rows) {
      row.element.classList.toggle('selected', this.ui.selectedTracks.has(id));
      row.showKeyboard(this.ui.keyboardTracks.has(id));
    }
  }
}

/** A track's header: built once, then updated by `update`. */
class HeaderRow {
  readonly element = el('div', { className: 'header' });
  private readonly name = el('span', { className: 'track-name', title: 'Double click to rename' });
  /** ▾ / ▸ to open and close a group (null for the other tracks). */
  private readonly fold: HTMLButtonElement | null = null;
  private badge: HTMLElement = el('span');
  private readonly mute: HTMLButtonElement;
  private readonly solo: HTMLButtonElement;
  /** Only MIDI tracks have an instrument to play with the keyboard. */
  private readonly keyboard: HTMLButtonElement | null = null;
  private readonly volume: HTMLInputElement;
  private readonly fx: HTMLButtonElement;
  /** The track shown last time (so as not to redo what didn't change). */
  private shown: Track | null = null;
  private readonly detachMeter: () => void;

  constructor(private readonly id: TrackId, private readonly store: ProjectStore, ui: UiState, private readonly actions: HeaderActions, meters: MeterBoard) {
    const open = () => actions.openDevices(id);
    // a click anywhere in the header chooses the track (Shift, Ctrl: others too)
    this.element.addEventListener('pointerdown', e => clickTrack(ui, id, e, () => store.project.visibleTracks.map(t => t.id)));
    const isGroup = store.project.track(id) instanceof GroupTrack;
    if (isGroup) this.fold = el<HTMLButtonElement>('button', { className: 'fold', onclick: () => toggleFold(store, this.track() as GroupTrack) });
    const toggle = (label: string, title: string, flag: 'mute' | 'solo') => midiTarget(
      el<HTMLButtonElement>('button', { textContent: label, title, onclick: () => this.mixer({ [flag]: !this.track().mixer[flag] }) }),
      { kind: 'mixer', owner: id, control: flag });
    this.mute = toggle('M', 'Mute', 'mute');
    this.solo = toggle('S', 'Solo', 'solo');
    if (store.project.track(id) instanceof MidiTrack) this.keyboard = keyboardButton(ui, id);
    this.volume = volumeSlider(store, 0, `vol-${id}`, (volumeDb, merge) => this.mixer({ volumeDb }, merge));
    automationOnRightClick(this.volume, () => actions.showAutomation?.(id, { kind: 'mixer', param: 'volume' }));
    this.fx = fxButton(0, 'Track effects', open);
    this.name.ondblclick = () => this.rename();
    const meter = new LevelMeter('track-meter', () => meters.resetClip(id));
    this.detachMeter = meters.attach(id, meter);
    this.element.classList.toggle('group', isGroup);
    this.element.dataset.track = id;
    this.element.append(
      el('div', { className: 'top' }, ...(this.fold ? [this.fold] : []), this.name, this.badge),
      el('div', { className: 'controls' }, this.mute, this.solo, ...(this.keyboard ? [this.keyboard] : []), midiSlot(this.volume, { kind: 'mixer', owner: id, control: 'volume' }), this.fx),
      meter.element);
    this.element.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      const t = this.track();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rename', shortcut: 'double click', run: () => this.rename() },
        { colors: PALETTE, current: t.color, required: true, pick: c => c && store.apply(setTrackColor(t.id, c)) },
        { label: t.kind === 'midi' ? 'Instrument and effects' : 'Effects', run: open },
        ...addEffectItems(store, id, open),
        ...(actions.pasteDeviceItems?.(id) ?? []),
        { label: t.mixer.mute ? 'Unmute' : 'Mute', run: () => this.mixer({ mute: !t.mixer.mute }) },
        { label: t.mixer.solo ? 'Unsolo' : 'Solo', run: () => this.mixer({ solo: !t.mixer.solo }) },
        SEPARATOR,
        ...groupMenuItems(store, ui, t),
        SEPARATOR,
        { label: isGroup ? 'Delete the group and its tracks' : 'Delete track', run: () => store.apply(removeTrack(id)) },
        SEPARATOR,
        ...newTrackHereItems(store, t),
      ]);
    };
  }

  /** `depth`: how many groups contain the track; `groupColor`: the colour of its group. */
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
      this.fold.title = t.folded ? 'Open the group: shows its tracks' : 'Close the group: hides its tracks (they play anyway)';
    }
  }

  showKeyboard(on: boolean): void {
    this.keyboard?.classList.toggle('on', on);
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
  { label: 'New audio track', run: () => store.apply(addTrack('audio')) },
  { label: 'New MIDI track', run: () => store.apply(addTrack('midi')) },
];
