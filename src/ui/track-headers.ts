import type { TrackId } from '../core/id';
import { instrumentType } from '../devices/registry';
import type { ChainOwner } from '../model/project';
import type { MidiTrack, Track } from '../model/track';
import { addTrack, removeTrack, renameTrack, setMixer } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { SEPARATOR, showContextMenu, type MenuItem } from './context-menu';
import type { UiState } from './ui-state';
import { el } from './dom';
import { LevelMeter, type MeterBoard } from './meters/meter-board';
import { addEffectItems, fxButton, setFxCount, setVolume, volumeSlider } from './mixer-controls';

export interface HeaderActions {
  /** Apre la catena dei dispositivi (strumento ed effetti) di una traccia o del master. */
  openDevices(owner: ChainOwner): void;
}

const kindBadge = (text: string) => () => el('span', { className: 'kind', textContent: text });

/** Accanto al nome: il tipo della traccia o, per le tracce MIDI, il loro strumento (un clic lo apre). */
const BADGES: Readonly<Record<string, (t: Track, actions: HeaderActions) => HTMLElement>> = {
  audio: kindBadge('Audio'),
  midi: (t, actions) => {
    const { instrument } = t as MidiTrack;
    const label = instrumentType(instrument.type)?.label ?? instrument.type;
    const text = instrument.preset ? `${label} · ${instrument.preset}` : label;
    return el('button', { className: 'kind instrument', textContent: text, title: `${text}: apri lo strumento`, onclick: () => actions.openDevices(t.id) });
  },
};

const badgeFor = (t: Track, actions: HeaderActions) => (BADGES[t.kind] ?? kindBadge(t.kind))(t, actions);

/** Colonna a sinistra della timeline: nome, mute/solo, volume di ogni traccia, allineata
 *  allo scorrimento verticale delle corsie. Ogni riga si aggiorna al suo posto, così un
 *  volume trascinato continua anche se il progetto cambia a ogni passo. */
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
    store.onChange(() => this.render());
    ui.onChange(() => this.position());
    this.render();
  }

  private position(): void {
    this.list.style.transform = `translateY(${-this.ui.geometry.scrollY}px)`;
  }

  private render(): void {
    const h = this.ui.geometry.trackHeight;
    const tracks = this.store.project.tracks;
    const rows = new Map<TrackId, HeaderRow>();
    for (const t of tracks) {
      const row = this.rows.get(t.id) ?? new HeaderRow(t.id, this.store, this.actions, this.meters);
      row.update(t, h);
      rows.set(t.id, row);
    }
    for (const [id, row] of this.rows) if (!rows.has(id)) row.dispose();
    this.rows = rows;
    // la lista si rifà solo se tracce aggiunte, tolte o spostate
    const elements = tracks.map(t => rows.get(t.id)!.element);
    const children = this.list.children;
    if (children.length !== elements.length || elements.some((e, i) => children[i] !== e)) this.list.replaceChildren(...elements);
    this.position();
  }
}

/** L'intestazione di una traccia: costruita una volta, poi aggiornata da `update`. */
class HeaderRow {
  readonly element = el('div', { className: 'header' });
  private readonly name = el('span', { className: 'track-name', title: 'Doppio clic per rinominare' });
  private badge: HTMLElement = el('span');
  private readonly mute: HTMLButtonElement;
  private readonly solo: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly fx: HTMLButtonElement;
  /** La traccia mostrata l'ultima volta (per non rifare ciò che non è cambiato). */
  private shown: Track | null = null;
  private readonly detachMeter: () => void;

  constructor(private readonly id: TrackId, private readonly store: ProjectStore, private readonly actions: HeaderActions, meters: MeterBoard) {
    const open = () => actions.openDevices(id);
    const toggle = (label: string, title: string, flag: 'mute' | 'solo') =>
      el<HTMLButtonElement>('button', { textContent: label, title, onclick: () => this.mixer({ [flag]: !this.track().mixer[flag] }) });
    this.mute = toggle('M', 'Mute', 'mute');
    this.solo = toggle('S', 'Solo', 'solo');
    this.volume = volumeSlider(store, 0, `vol-${id}`, (volumeDb, merge) => this.mixer({ volumeDb }, merge));
    this.fx = fxButton(0, 'Effetti della traccia', open);
    this.name.ondblclick = () => this.rename();
    const del = el('button', { className: 'del', textContent: '×', title: 'Elimina traccia', onclick: () => store.apply(removeTrack(id)) });
    const meter = new LevelMeter('track-meter', () => meters.resetClip(id));
    this.detachMeter = meters.attach(id, meter);
    this.element.append(
      el('div', { className: 'top' }, this.name, this.badge, del),
      el('div', { className: 'controls' }, this.mute, this.solo, this.volume, this.fx),
      meter.element);
    this.element.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      const t = this.track();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rinomina', shortcut: 'doppio clic', run: () => this.rename() },
        { label: t.kind === 'midi' ? 'Strumento ed effetti' : 'Effetti', run: open },
        ...addEffectItems(store, id, open),
        { label: t.mixer.mute ? 'Togli il mute' : 'Mute', run: () => this.mixer({ mute: !t.mixer.mute }) },
        { label: t.mixer.solo ? 'Togli il solo' : 'Solo', run: () => this.mixer({ solo: !t.mixer.solo }) },
        SEPARATOR,
        { label: 'Elimina traccia', run: () => store.apply(removeTrack(id)) },
        SEPARATOR,
        ...newTrackItems(store),
      ]);
    };
  }

  update(t: Track, height: number): void {
    this.element.style.height = `${height}px`;
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
    const label = this.name;
    const input = el<HTMLInputElement>('input', { className: 'rename', value: label.textContent ?? '' });
    let finished = false;
    const done = (save: boolean) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      input.replaceWith(label);
      if (save && name && name !== label.textContent) this.store.apply(renameTrack(this.id, name));
    };
    input.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(true);
    label.replaceWith(input);
    input.select();
  }
}

const newTrackItems = (store: ProjectStore): MenuItem[] => [
  { label: 'Nuova traccia audio', run: () => store.apply(addTrack('audio')) },
  { label: 'Nuova traccia MIDI', run: () => store.apply(addTrack('midi')) },
];
