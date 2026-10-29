import type { MidiClip } from '../../model/midi-clip';
import { el } from '../dom';

export interface RollPanelActions {
  rename(name: string): void;
  toggleDraw(): void;
  toggleFold(): void;
  quantize(): void;
  transpose(semitones: number): void;
  /** Moltiplica la durata della clip (2: il doppio, 0.5: la metà). */
  scaleTime(factor: number): void;
  /** Raddoppia il loop copiandone le note (Ctrl+Maiusc+D). */
  duplicateLoop(): void;
  openInstrument(): void;
  /** La clip prende il suono attuale dello strumento, da dargli quando parte. */
  takeSound(): void;
  clearSound(): void;
  close(): void;
}

/** Pannello a sinistra del piano roll: nome, strumento della traccia, modo disegno e comandi. */
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
    this.instrument = el<HTMLButtonElement>('button', { className: 'instrument', title: 'Apri lo strumento della traccia', onclick: () => actions.openInstrument() });
    this.clearSound = button('×', 'La clip non cambia più il suono dello strumento', () => actions.clearSound());
    this.draw = button('✎ Disegna', 'Modo disegno (B): un clic crea una nota, un clic su una nota la toglie', () => actions.toggleDraw());
    this.fold = button('Fold', 'Fold (F): solo le righe delle note scritte, come in Live', () => actions.toggleFold());
    this.element.append(
      el('div', { className: 'panel-head' }, this.name, el('button', { className: 'close', textContent: '×', title: 'Chiudi (Esc)', onclick: () => actions.close() })),
      this.info,
      el('label', { className: 'row' }, el('span', { textContent: 'Strumento' }), this.instrument),
      el('div', { className: 'row' }, el('span', { textContent: 'Suono' }), this.sound, this.clearSound),
      el('div', { className: 'buttons' },
        button('Usa il suono attuale', 'Quando la clip parte lo strumento prende il suono che ha adesso (preset e manopole)', () => actions.takeSound())),
      el('div', { className: 'buttons' },
        this.draw,
        this.fold,
        button('Quantizza', 'Inizi delle note sulla griglia (Q); senza selezione tutte le note', () => actions.quantize())),
      el('div', { className: 'buttons' },
        button(':2', 'Durata dimezzata: note e clip vanno al doppio della velocità', () => actions.scaleTime(0.5)),
        button('×2', 'Durata doppia: note e clip vanno a metà velocità', () => actions.scaleTime(2)),
        button('Dupl. loop', 'Duplica loop (Ctrl+Maiusc+D): il loop raddoppia e le sue note si ripetono nella seconda metà', () => actions.duplicateLoop())),
      el('div', { className: 'buttons' },
        button('−8va', 'Un\'ottava sotto (Maiusc+↓)', () => actions.transpose(-12)),
        button('−1', 'Un semitono sotto (↓)', () => actions.transpose(-1)),
        button('+1', 'Un semitono sopra (↑)', () => actions.transpose(1)),
        button('+8va', 'Un\'ottava sopra (Maiusc+↑)', () => actions.transpose(12))),
      el('div', { className: 'muted small help' },
        'Doppio clic: nuova nota o elimina · trascina: sposta · bordi: durata · Ctrl: copia · Alt: senza griglia · Ctrl+D duplica'),
    );
  }

  update(clip: MidiClip, instrumentLabel: string, drawMode: boolean, folded: boolean, selected: number, barBeats: number): void {
    if (document.activeElement !== this.name) this.name.value = clip.name;
    const bars = (clip.region.end - clip.region.start) / barBeats;
    this.info.textContent = `${+bars.toFixed(2)} battute · ${clip.notes.length} note${selected ? ` · ${selected} selezionate` : ''}`;
    this.instrument.textContent = `${instrumentLabel} ▸`;
    this.sound.textContent = clip.sound ? clip.sound.preset ?? 'personale' : 'nessuno';
    this.clearSound.hidden = !clip.sound;
    this.draw.classList.toggle('on', drawMode);
    this.fold.classList.toggle('on', folded);
  }
}
