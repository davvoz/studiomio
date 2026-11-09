import type { PlaybackEngine } from '../engine/playback-engine';
import { setTempo } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import type { Commands } from './keymap';
import type { UiState } from './ui-state';

const button = (text: string, title: string, onclick: () => void, className = '') =>
  Object.assign(document.createElement('button'), { textContent: text, title, onclick, className });

/** The control bar: what's needed to play (transport, tempo, loop, metronome, follow).
 *  Everything else is in the menu bar. */
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
    this.play = button('▶', 'Play / Stop (Space)', () => commands.togglePlay(), 'play');
    this.bpm = Object.assign(document.createElement('input'), { type: 'number', min: '20', max: '999', step: '0.01', title: 'Tempo (BPM)' });
    this.bpm.onchange = () => {
      const v = Number(this.bpm.value);
      if (v >= 20 && v <= 999) store.apply(setTempo(Math.round(v * 100) / 100));
      else this.render();
    };
    this.bpm.onkeydown = e => { if (e.key === 'Enter') this.bpm.blur(); };
    this.loop = button('⟲ Loop', 'Loop (Ctrl+L)', () => commands.toggleLoop());
    this.metro = button('♩ Metro', 'Metronome (Ctrl+Shift+M)', () => commands.toggleMetronome());
    this.follow = button('↦ Follow', '', () => commands.toggleFollow(), 'follow');
    this.keys = button('KEY', 'Map the computer keyboard to the racks\' macros and the devices\' parameters (Ctrl+K)',
      () => commands.toggleKeyMap(), 'key-map');
    this.midi = button('MIDI', 'Map any controller\'s MIDI to the macros, the parameters and the mixer (Ctrl+M)',
      () => commands.toggleMidiMap(), 'midi-map');
    this.element.append(
      group(this.play, button('■', 'Stop and return to the start (Enter)', () => commands.stopAndRewind()), this.pos, this.follow),
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

  /** Adds a group of controls at the far right. */
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
      ? 'Follow is paused because you moved the view: click here, on the ruler or Play again to resume (Ctrl+Shift+F)'
      : 'Follow the playhead while playing (Ctrl+Shift+F)';
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
