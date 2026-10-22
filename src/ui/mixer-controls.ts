/* Controlli del mixer usati sia dalle intestazioni delle tracce sia dal master. */
import { EFFECT_TYPES } from '../devices/registry';
import { encodeMidiTarget, type MidiTarget } from '../model/midi-map';
import type { ChainOwner } from '../model/project';
import { addEffect } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { MenuItem } from './context-menu';
import { el } from './dom';

/** Volume in dB: trascinato è un solo passo di annullamento, doppio clic torna a 0 dB. */
export function volumeSlider(store: ProjectStore, value: number, mergeKey: string, set: (db: number, mergeKey?: string) => void): HTMLInputElement {
  const vol = el<HTMLInputElement>('input', { type: 'range', min: '-40', max: '6', step: '0.5', value: String(value), title: `${value.toFixed(1)} dB` });
  vol.oninput = () => set(Number(vol.value), mergeKey);
  vol.onchange = () => store.endMerge();
  vol.ondblclick = () => set(0);
  return vol;
}

/** Il controllo si può mappare sul MIDI: porta il suo bersaglio (vedi midi-targets). */
export function midiTarget<E extends HTMLElement>(e: E, target: MidiTarget): E {
  e.dataset.midiTarget = encodeMidiTarget(target);
  return e;
}

/** Un cursore non mostra il nome del suo controllo MIDI: lo porta un involucro. */
export const midiSlot = (input: HTMLInputElement, target: MidiTarget): HTMLElement =>
  midiTarget(el('span', { className: 'midi-slot' }, input), target);

/** "FX" con il numero degli effetti della catena; un clic la apre. */
export function fxButton(count: number, title: string, open: () => void): HTMLButtonElement {
  const button = el<HTMLButtonElement>('button', { title, onclick: open });
  setFxCount(button, count);
  return button;
}

export function setFxCount(button: HTMLButtonElement, count: number): void {
  button.className = count ? 'fx on' : 'fx';
  button.textContent = count ? `FX ${count}` : 'FX';
}

/** Aggiorna il cursore del volume (durante un trascinamento il valore è già quello). */
export function setVolume(vol: HTMLInputElement, db: number): void {
  if (vol.value !== String(db)) vol.value = String(db);
  vol.title = `${db.toFixed(1)} dB`;
}

/** "Aggiungi <effetto>" per ogni tipo: aggiunge in fondo alla catena e la apre. */
export const addEffectItems = (store: ProjectStore, owner: ChainOwner, open: () => void): MenuItem[] =>
  EFFECT_TYPES.map(type => ({
    label: `Aggiungi ${type.label}`,
    run: () => {
      store.apply(addEffect(owner, type.type, type.label));
      open();
    },
  }));
