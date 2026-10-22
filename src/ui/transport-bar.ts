import type { PlaybackEngine } from '../engine/playback-engine';
import { setTempo } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { Commands } from './keymap';
import type { UiState } from './ui-state';

const button = (text: string, title: string, onclick: () => void, className = '') =>
  Object.assign(document.createElement('button'), { textContent: text, title, onclick, className });

/** La barra di controllo: ciò che serve per suonare (trasporto, tempo, loop, metronomo, segui).
 *  Tutto il resto sta nella barra dei menu. */
export class TransportBar {
  readonly element = Object.assign(document.createElement('header'), { className: 'transport' });
  private readonly play: HTMLButtonElement;
  private readonly pos = Object.assign(document.createElement('span'), { className: 'pos' });
  private readonly bpm: HTMLInputElement;
  private readonly loop: HTMLButtonElement;
  private readonly metro: HTMLButtonElement;
  private readonly follow: HTMLButtonElement;
  private readonly keys: HTMLButtonElement;
  private readonly midi: HTMLButtonElement;

  constructor(private readonly store: ProjectStore, private readonly ui: UiState, private readonly engine: PlaybackEngine, commands: Commands) {
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
    this.follow = button('↦ Segui', '', () => commands.toggleFollow(), 'follow');
    this.keys = button('KEY', 'Mappa la tastiera del computer sulle macro dei rack e sui parametri dei dispositivi (Ctrl+K)',
      () => commands.toggleKeyMap(), 'key-map');
    this.midi = button('MIDI', 'Mappa il MIDI di un controller qualsiasi sulle macro, sui parametri e sul mixer (Ctrl+M)',
      () => commands.toggleMidiMap(), 'midi-map');
    this.element.append(
      group(this.play, button('■', 'Stop e torna all\'inizio (Invio)', () => commands.stopAndRewind()), this.pos, this.follow),
      group(labelled('BPM', this.bpm), this.loop, this.metro, this.keys, this.midi),
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

  /** Aggiunge un gruppo di controlli in fondo a destra. */
  addGroup(...nodes: Node[]): void {
    const g = group(...nodes);
    g.classList.add('end');
    this.element.append(g);
  }

  render(): void {
    const p = this.store.project;
    if (document.activeElement !== this.bpm) this.bpm.value = String(p.tempo.bpm);
    this.play.textContent = this.engine.playing ? '❚❚' : '▶';
    this.play.classList.toggle('on', this.engine.playing);
    this.loop.classList.toggle('on', p.loop.enabled);
    this.metro.classList.toggle('on', this.engine.metronomeOn);
    this.keys.classList.toggle('on', this.ui.keyMapping);
    this.midi.classList.toggle('on', this.ui.midiMapping);
    const paused = this.ui.followPaused;
    this.follow.classList.toggle('on', this.ui.following);
    this.follow.classList.toggle('paused', paused);
    this.follow.title = paused
      ? 'Segui è in pausa perché hai spostato la vista: clic qui, sul righello o di nuovo Play per riprendere (Ctrl+Maiusc+F)'
      : 'Segui la testina mentre suona (Ctrl+Maiusc+F)';
  }
}

function group(...nodes: Node[]): HTMLElement {
  const d = Object.assign(document.createElement('div'), { className: 'group' });
  d.append(...nodes);
  return d;
}

function labelled(text: string, input: HTMLElement): HTMLElement {
  const l = document.createElement('label');
  l.append(text, ' ', input);
  return l;
}
