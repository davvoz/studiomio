/* Mixer controls used both by the track headers and by the master. */
import { chainEffectTypes } from '../devices/registry';
import { MidiTrack } from '../model/track';
import type { TrackId } from '../core/id';
import { encodeMidiTarget, type MidiTarget } from '../model/midi-map';
import type { ChainOwner } from '../model/project';
import { addEffect } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { showContextMenu, type MenuItem } from './context-menu';
import { el } from './dom';
import type { UiState } from './ui-state';

/** Volume in dB: dragged it's a single undo step, double click goes back to 0 dB. */
export function volumeSlider(store: ProjectStore, value: number, mergeKey: string, set: (db: number, mergeKey?: string) => void): HTMLInputElement {
  const vol = el<HTMLInputElement>('input', { type: 'range', min: '-40', max: '6', step: '0.5', value: String(value), title: `${value.toFixed(1)} dB` });
  vol.oninput = () => set(Number(vol.value), mergeKey);
  vol.onchange = () => store.endMerge();
  vol.ondblclick = () => set(0);
  return vol;
}

/** The control can be mapped to MIDI: it carries its target (see midi-targets). */
export function midiTarget<E extends HTMLElement>(e: E, target: MidiTarget): E {
  e.dataset.midiTarget = encodeMidiTarget(target);
  return e;
}

/** A slider doesn't show the name of its MIDI control: a wrapper carries it. */
export const midiSlot = (input: HTMLInputElement, target: MidiTarget): HTMLElement =>
  midiTarget(el('span', { className: 'midi-slot' }, input), target);

/** Arms the MIDI track to play it with the computer keyboard. */
export const keyboardButton = (ui: UiState, track: TrackId): HTMLButtonElement => el<HTMLButtonElement>('button', {
  className: 'keyboard', textContent: '⌨', onclick: () => ui.toggleKeyboardTrack(track),
  title: "Play this track with the computer keyboard: A to L the notes, W E T Y U O P the black keys, Z X the octave, C V the velocity. While it's on, these keys play even if they're mapped: the mapping comes back when it's turned off",
});

/** "FX" with the number of the chain's effects; a click opens it. */
export function fxButton(count: number, title: string, open: () => void): HTMLButtonElement {
  const button = el<HTMLButtonElement>('button', { title, onclick: open });
  setFxCount(button, count);
  return button;
}

export function setFxCount(button: HTMLButtonElement, count: number): void {
  button.className = count ? 'fx on' : 'fx';
  button.textContent = count ? `FX ${count}` : 'FX';
}

/** Updates the volume slider (during a drag the value is already that). */
export function setVolume(vol: HTMLInputElement, db: number): void {
  if (vol.value !== String(db)) vol.value = String(db);
  vol.title = `${db.toFixed(1)} dB`;
}

/** "Show automation" in a mixer control's menu. */
export function automationOnRightClick(element: HTMLElement, show: () => void): void {
  element.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [{ label: 'Show automation', run: show }]);
  });
}

/** "Add <effect>" for each type: adds at the end of the chain and opens it. */
export const addEffectItems = (store: ProjectStore, owner: ChainOwner, open: () => void): MenuItem[] =>
  chainEffectTypes(store.project.track(owner as TrackId) instanceof MidiTrack).map(type => ({
    label: `Add ${type.label}`,
    run: () => {
      store.apply(addEffect(owner, type.type, type.label));
      open();
    },
  }));
