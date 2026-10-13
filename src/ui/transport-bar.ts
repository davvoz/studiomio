import type { PlaybackEngine } from '../engine/playback-engine';
import { setTempo } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { Commands } from './keymap';
import type { UiState } from './ui-state';

export interface FileCommands {
  newProject(): void;
  open(): void;
  save(): void;
  saveAs(): void;
  importFiles(files: File[]): void;
  exportMix(): void;
  loadDemo(): void;
}

const button = (text: string, title: string, onclick: () => void, className = '') =>
  Object.assign(document.createElement('button'), { textContent: text, title, onclick, className });

/** Barra in alto: file, trasporto, tempo, loop, metronomo, griglia, annulla. */
export class TransportBar {
  readonly element = Object.assign(document.createElement('header'), { className: 'transport' });
  private readonly play: HTMLButtonElement;
  private readonly pos = Object.assign(document.createElement('span'), { className: 'pos' });
  private readonly bpm: HTMLInputElement;
  private readonly loop: HTMLButtonElement;
  private readonly metro: HTMLButtonElement;
  private readonly snap: HTMLButtonElement;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly title = Object.assign(document.createElement('span'), { className: 'title' });

  constructor(
    private readonly store: ProjectStore, private readonly ui: UiState, private readonly engine: PlaybackEngine,
    commands: Commands, files: FileCommands, private readonly projectName: () => string,
  ) {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
    picker.onchange = () => { files.importFiles([...(picker.files ?? [])]); picker.value = ''; };
    this.play = button('▶', 'Play / Stop (Spazio)', () => commands.togglePlay(), 'play');
    this.bpm = Object.assign(document.createElement('input'), { type: 'number', min: '20', max: '999', step: '0.01', title: 'Tempo (BPM)' });
    this.bpm.onchange = () => {
      const v = Number(this.bpm.value);
      if (v >= 20 && v <= 999) store.apply(setTempo(Math.round(v * 100) / 100));
      else this.render();
    };
    this.bpm.onkeydown = e => { if (e.key === 'Enter') this.bpm.blur(); };
    this.loop = button('⟲ Loop', 'Loop (Ctrl+L)', () => commands.toggleLoop());
    this.metro = button('♩ Metro', 'Metronomo (Ctrl+Maiusc+M)', () => commands.toggleMetronome());
    this.snap = button('# Griglia', 'Aggancio alla griglia (Ctrl+4); Alt durante il trascinamento lo sospende', () => commands.toggleSnap());
    this.undo = button('↶', '', () => commands.undo());
    this.redo = button('↷', '', () => commands.redo());
    const group = (...nodes: Node[]) => {
      const d = Object.assign(document.createElement('div'), { className: 'group' });
      d.append(...nodes);
      return d;
    };
    this.element.append(
      group(
        button('Nuovo', 'Nuovo progetto', () => files.newProject()),
        button('Apri…', 'Apri la cartella di un progetto (Ctrl+O)', () => files.open()),
        button('Salva', 'Salva (Ctrl+S)', () => files.save()),
        button('Salva come…', 'Salva in un\'altra cartella', () => files.saveAs()),
        button('Importa audio…', 'Importa file audio (o trascinali sulla timeline)', () => picker.click()),
        button('Esporta mix', 'Esporta il mix in WAV', () => files.exportMix()),
        button('Demo', 'Carica il progetto demo', () => files.loadDemo()),
        picker),
      group(this.play, button('■', 'Stop e torna all\'inizio (Invio)', () => commands.stopAndRewind()), this.pos),
      group(labelled('BPM', this.bpm), this.loop, this.metro, this.snap),
      group(this.undo, this.redo, button('−', 'Zoom indietro (-)', () => commands.zoom(0.8)), button('+', 'Zoom avanti (+)', () => commands.zoom(1.25))),
      this.title,
    );
    store.onChange(() => this.render());
    ui.onChange(() => this.render());
    engine.onStateChange(() => this.render());
    this.render();
    const tick = () => {
      this.pos.textContent = this.store.project.signature.format(this.engine.position);
      requestAnimationFrame(tick);
    };
    tick();
  }

  render(): void {
    const p = this.store.project;
    if (document.activeElement !== this.bpm) this.bpm.value = String(p.tempo.bpm);
    this.play.textContent = this.engine.playing ? '❚❚' : '▶';
    this.play.classList.toggle('on', this.engine.playing);
    this.loop.classList.toggle('on', p.loop.enabled);
    this.metro.classList.toggle('on', this.engine.metronomeOn);
    this.snap.classList.toggle('on', this.ui.snap);
    this.undo.disabled = !this.store.canUndo;
    this.redo.disabled = !this.store.canRedo;
    this.undo.title = this.store.undoLabel ? `Annulla: ${this.store.undoLabel} (Ctrl+Z)` : 'Niente da annullare';
    this.redo.title = this.store.redoLabel ? `Ripeti: ${this.store.redoLabel} (Ctrl+Y)` : 'Niente da ripetere';
    this.title.textContent = this.projectName();
  }
}

function labelled(text: string, input: HTMLElement): HTMLElement {
  const l = document.createElement('label');
  l.append(text, ' ', input);
  return l;
}
