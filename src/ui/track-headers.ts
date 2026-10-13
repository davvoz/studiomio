import type { TrackId } from '../core/id';
import type { Track } from '../model/track';
import { addTrack, removeTrack, renameTrack, setMixer } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { UiState } from './ui-state';

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): T {
  const e = Object.assign(document.createElement(tag), props) as T;
  e.append(...children);
  return e;
}

const KIND_LABEL: Readonly<Record<string, string>> = { audio: 'Audio', midi: 'MIDI' };

/** Colonna a sinistra della timeline: nome, mute/solo, volume di ogni traccia, allineata
 *  allo scorrimento verticale delle corsie. */
export class TrackHeaders {
  readonly element = el('div', { className: 'headers' });
  private readonly list = el('div', { className: 'header-list' });

  constructor(private readonly store: ProjectStore, private readonly ui: UiState) {
    const add = el('div', { className: 'header-add' },
      el('button', { textContent: '+ Audio', title: 'Nuova traccia audio', onclick: () => store.apply(addTrack('audio')) }),
      el('button', { textContent: '+ MIDI', title: 'Nuova traccia MIDI', onclick: () => store.apply(addTrack('midi')) }));
    this.element.append(add, el('div', { className: 'header-scroll' }, this.list));
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
      el('div', { className: 'top' }, name, el('span', { className: 'kind', textContent: KIND_LABEL[t.kind] ?? t.kind }), del),
      el('div', { className: 'controls' },
        toggle('M', t.mixer.mute, 'Mute', () => ({ mute: !t.mixer.mute })),
        toggle('S', t.mixer.solo, 'Solo', () => ({ solo: !t.mixer.solo })),
        vol));
    row.style.height = `${height}px`;
    row.style.setProperty('--color', t.color);
    return row;
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
