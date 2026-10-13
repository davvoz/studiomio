import type { TrackId } from '../core/id';
import { EFFECT_TYPES, instrumentType } from '../devices/registry';
import type { MidiTrack, Track } from '../model/track';
import { addEffect, addTrack, removeTrack, renameTrack, setMixer } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { SEPARATOR, showContextMenu, type MenuItem } from './context-menu';
import type { UiState } from './ui-state';
import { el } from './dom';

export interface HeaderActions {
  /** Apre la catena dei dispositivi (strumento ed effetti) della traccia. */
  openDevices(track: TrackId): void;
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

/** Colonna a sinistra della timeline: nome, mute/solo, volume di ogni traccia, allineata
 *  allo scorrimento verticale delle corsie. */
export class TrackHeaders {
  readonly element = el('div', { className: 'headers' });
  private readonly list = el('div', { className: 'header-list' });

  constructor(private readonly store: ProjectStore, private readonly ui: UiState, private readonly actions: HeaderActions) {
    const add = el('div', { className: 'header-add' },
      el('button', { textContent: '+ Audio', title: 'Nuova traccia audio', onclick: () => store.apply(addTrack('audio')) }),
      el('button', { textContent: '+ MIDI', title: 'Nuova traccia MIDI', onclick: () => store.apply(addTrack('midi')) }));
    const scroll = el('div', { className: 'header-scroll' }, this.list);
    // tasto destro sotto le tracce: solo le tracce nuove
    scroll.oncontextmenu = e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, this.newTrackItems());
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
    this.list.replaceChildren(...this.store.project.tracks.map(t => this.row(t, h)));
    this.position();
  }

  private row(t: Track, height: number): HTMLElement {
    const { store } = this;
    const mixer = (patch: Parameters<typeof setMixer>[1], merge?: string) => store.apply(setMixer(t.id, patch), merge ? { mergeKey: merge } : {});
    const name = el('span', { className: 'track-name', textContent: t.name, title: 'Doppio clic per rinominare' });
    name.ondblclick = () => this.rename(t.id, name);
    const toggle = (label: string, on: boolean, title: string, patch: () => Parameters<typeof setMixer>[1]) =>
      el('button', { className: on ? 'on' : '', textContent: label, title, onclick: () => mixer(patch()) });
    const vol = el<HTMLInputElement>('input', { type: 'range', min: '-40', max: '6', step: '0.5', value: String(t.mixer.volumeDb), title: `${t.mixer.volumeDb.toFixed(1)} dB` });
    vol.oninput = () => mixer({ volumeDb: Number(vol.value) }, `vol-${t.id}`);
    vol.onchange = () => store.endMerge();
    vol.ondblclick = () => mixer({ volumeDb: 0 });
    const del = el('button', { className: 'del', textContent: '×', title: 'Elimina traccia', onclick: () => store.apply(removeTrack(t.id)) });
    const row = el('div', { className: 'header' },
      el('div', { className: 'top' }, name, (BADGES[t.kind] ?? kindBadge(t.kind))(t, this.actions), del),
      el('div', { className: 'controls' },
        toggle('M', t.mixer.mute, 'Mute', () => ({ mute: !t.mixer.mute })),
        toggle('S', t.mixer.solo, 'Solo', () => ({ solo: !t.mixer.solo })),
        vol,
        el('button', {
          className: t.effects.length ? 'fx on' : 'fx', textContent: t.effects.length ? `FX ${t.effects.length}` : 'FX',
          title: 'Effetti della traccia', onclick: () => this.actions.openDevices(t.id),
        })));
    row.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rinomina', shortcut: 'doppio clic', run: () => this.rename(t.id, name) },
        { label: t.kind === 'midi' ? 'Strumento ed effetti' : 'Effetti', run: () => this.actions.openDevices(t.id) },
        ...EFFECT_TYPES.map(type => ({
          label: `Aggiungi ${type.label}`,
          run: () => {
            store.apply(addEffect(t.id, type.type, type.label));
            this.actions.openDevices(t.id);
          },
        })),
        { label: t.mixer.mute ? 'Togli il mute' : 'Mute', run: () => mixer({ mute: !t.mixer.mute }) },
        { label: t.mixer.solo ? 'Togli il solo' : 'Solo', run: () => mixer({ solo: !t.mixer.solo }) },
        SEPARATOR,
        { label: 'Elimina traccia', run: () => store.apply(removeTrack(t.id)) },
        SEPARATOR,
        ...this.newTrackItems(),
      ]);
    };
    row.style.height = `${height}px`;
    row.style.setProperty('--color', t.color);
    return row;
  }

  private newTrackItems(): MenuItem[] {
    return [
      { label: 'Nuova traccia audio', run: () => this.store.apply(addTrack('audio')) },
      { label: 'Nuova traccia MIDI', run: () => this.store.apply(addTrack('midi')) },
    ];
  }

  private rename(id: TrackId, label: HTMLElement): void {
    const input = el<HTMLInputElement>('input', { className: 'rename', value: label.textContent ?? '' });
    let finished = false;
    const done = (save: boolean) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== label.textContent) this.store.apply(renameTrack(id, name));
      else this.render();
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
