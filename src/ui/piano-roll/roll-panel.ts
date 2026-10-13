import type { MidiClip } from '../../model/midi-clip';

export interface RollPanelActions {
  rename(name: string): void;
  toggleDraw(): void;
  quantize(): void;
  transpose(semitones: number): void;
  openInstrument(): void;
  close(): void;
}

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): T {
  const e = Object.assign(document.createElement(tag), props) as T;
  e.append(...children);
  return e;
}

/** Pannello a sinistra del piano roll: nome, strumento della traccia, modo disegno e comandi. */
export class RollPanel {
  readonly element = el('div', { className: 'clip-panel' });
  private readonly name = el<HTMLInputElement>('input', { className: 'clip-name' });
  private readonly info = el('div', { className: 'muted small' });
  private readonly instrument: HTMLButtonElement;
  private readonly draw: HTMLButtonElement;

  constructor(actions: RollPanelActions) {
    const button = (text: string, title: string, onclick: () => void) => el<HTMLButtonElement>('button', { textContent: text, title, onclick });
    this.name.onchange = () => { if (this.name.value.trim()) actions.rename(this.name.value.trim()); };
    this.name.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') this.name.blur(); };
    this.instrument = el<HTMLButtonElement>('button', { className: 'instrument', title: 'Apri lo strumento della traccia', onclick: () => actions.openInstrument() });
    this.draw = button('✎ Disegna', 'Modo disegno (B): un clic crea una nota, un clic su una nota la toglie', () => actions.toggleDraw());
    this.element.append(
      el('div', { className: 'panel-head' }, this.name, el('button', { className: 'close', textContent: '×', title: 'Chiudi (Esc)', onclick: () => actions.close() })),
      this.info,
      el('label', { className: 'row' }, el('span', { textContent: 'Strumento' }), this.instrument),
      el('div', { className: 'buttons' },
        this.draw,
        button('Quantizza', 'Inizi delle note sulla griglia (Q); senza selezione tutte le note', () => actions.quantize())),
      el('div', { className: 'buttons' },
        button('−8va', 'Un\'ottava sotto (Maiusc+↓)', () => actions.transpose(-12)),
        button('−1', 'Un semitono sotto (↓)', () => actions.transpose(-1)),
        button('+1', 'Un semitono sopra (↑)', () => actions.transpose(1)),
        button('+8va', 'Un\'ottava sopra (Maiusc+↑)', () => actions.transpose(12))),
      el('div', { className: 'muted small help' },
        'Doppio clic: nuova nota o elimina · trascina: sposta · bordi: durata · Ctrl: copia · Alt: senza griglia · Ctrl+D duplica'),
    );
  }

  update(clip: MidiClip, instrumentLabel: string, drawMode: boolean, selected: number, barBeats: number): void {
    if (document.activeElement !== this.name) this.name.value = clip.name;
    const bars = (clip.region.end - clip.region.start) / barBeats;
    this.info.textContent = `${+bars.toFixed(2)} battute · ${clip.notes.length} note${selected ? ` · ${selected} selezionate` : ''}`;
    this.instrument.textContent = `${instrumentLabel} ▸`;
    this.draw.classList.toggle('on', drawMode);
  }
}
