import type { MidiClip } from '../../model/midi-clip';
import { el } from '../dom';

export interface RollPanelActions {
  rename(name: string): void;
  toggleDraw(): void;
  toggleFold(): void;
  quantize(): void;
  transpose(semitones: number): void;
  /** Multiplies the clip's length (2: double, 0.5: half). */
  scaleTime(factor: number): void;
  /** Doubles the loop copying its notes (Ctrl+Shift+D). */
  duplicateLoop(): void;
  openInstrument(): void;
  /** The clip takes the instrument's current sound, to give it when it starts. */
  takeSound(): void;
  clearSound(): void;
  close(): void;
}

/** Panel on the left of the piano roll: name, track instrument, draw mode and commands. */
export class RollPanel {
  readonly element = el('div', { className: 'clip-panel' });
  private readonly name = el<HTMLInputElement>('input', { className: 'clip-name' });
  private readonly info = el('div', { className: 'muted small' });
  private readonly instrument: HTMLButtonElement;
  private readonly sound = el('span', { className: 'sound-name' });
  private readonly clearSound: HTMLButtonElement;
  private readonly draw: HTMLButtonElement;
  private readonly fold: HTMLButtonElement;

  constructor(actions: RollPanelActions) {
    const button = (text: string, title: string, onclick: () => void) => el<HTMLButtonElement>('button', { textContent: text, title, onclick });
    this.name.onchange = () => { if (this.name.value.trim()) actions.rename(this.name.value.trim()); };
    this.name.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') this.name.blur(); };
    this.instrument = el<HTMLButtonElement>('button', { className: 'instrument', title: 'Open the track\'s instrument', onclick: () => actions.openInstrument() });
    this.clearSound = button('×', 'The clip no longer changes the instrument\'s sound', () => actions.clearSound());
    this.draw = button('✎ Draw', 'Draw mode (B): a click creates a note, a click on a note removes it', () => actions.toggleDraw());
    this.fold = button('Fold', 'Fold (F): only the rows of the written notes, as in Live', () => actions.toggleFold());
    this.element.append(
      el('div', { className: 'panel-head' }, this.name, el('button', { className: 'close', textContent: '×', title: 'Close (Esc)', onclick: () => actions.close() })),
      this.info,
      el('label', { className: 'row' }, el('span', { textContent: 'Instrument' }), this.instrument),
      el('div', { className: 'row' }, el('span', { textContent: 'Sound' }), this.sound, this.clearSound),
      el('div', { className: 'buttons' },
        button('Use the current sound', 'When the clip starts the instrument takes the sound it has now (preset and knobs)', () => actions.takeSound())),
      el('div', { className: 'buttons' },
        this.draw,
        this.fold,
        button('Quantize', 'Note starts on the grid (Q); without selection all the notes', () => actions.quantize())),
      el('div', { className: 'buttons' },
        button(':2', 'Half length: notes and clip go at double speed', () => actions.scaleTime(0.5)),
        button('×2', 'Double length: notes and clip go at half speed', () => actions.scaleTime(2)),
        button('Dupl. loop', 'Duplicate loop (Ctrl+Shift+D): the loop doubles and its notes repeat in the second half', () => actions.duplicateLoop())),
      el('div', { className: 'buttons' },
        button('−8va', 'An octave down (Shift+↓)', () => actions.transpose(-12)),
        button('−1', 'A semitone down (↓)', () => actions.transpose(-1)),
        button('+1', 'A semitone up (↑)', () => actions.transpose(1)),
        button('+8va', 'An octave up (Shift+↑)', () => actions.transpose(12))),
      el('div', { className: 'muted small help' },
        'Double click: new note or delete · drag: move · edges: length · Ctrl: copy · Alt: without grid · Ctrl+D duplicates'),
    );
  }

  update(clip: MidiClip, instrumentLabel: string, drawMode: boolean, folded: boolean, selected: number, barBeats: number): void {
    if (document.activeElement !== this.name) this.name.value = clip.name;
    const bars = (clip.region.end - clip.region.start) / barBeats;
    this.info.textContent = `${+bars.toFixed(2)} bars · ${clip.notes.length} notes${selected ? ` · ${selected} selected` : ''}`;
    this.instrument.textContent = `${instrumentLabel} ▸`;
    this.sound.textContent = clip.sound ? clip.sound.preset ?? 'custom' : 'none';
    this.clearSound.hidden = !clip.sound;
    this.draw.classList.toggle('on', drawMode);
    this.fold.classList.toggle('on', folded);
  }
}
