import { effectType } from '../devices/registry';
import { MASTER, type Project } from '../model/project';
import { setMasterMixer } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { showContextMenu } from './context-menu';
import { el } from './dom';
import { LevelMeter, PeakReadout, type MeterBoard } from './meters/meter-board';
import { addEffectItems, fxButton, setFxCount, setVolume, volumeSlider } from './mixer-controls';
import type { HeaderActions } from './track-headers';

/** La riga del master in fondo all'arrangement, come in Live: a sinistra mute, volume ed
 *  effetti (allineati alle intestazioni delle tracce), a destra la sua catena in breve.
 *  I controlli si costruiscono una volta e poi si aggiornano, così un trascinamento continua. */
export class MasterStrip {
  readonly header = el('div', { className: 'header master-header' });
  readonly lane = el('div', { className: 'master-lane', title: 'Effetti del master: un clic li apre' });
  private readonly mute: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly fx: HTMLButtonElement;

  constructor(store: ProjectStore, actions: HeaderActions, meters: MeterBoard) {
    const open = () => actions.openDevices(MASTER);
    const toggleMute = () => store.apply(setMasterMixer({ mute: !store.project.master.mute }));
    this.mute = el<HTMLButtonElement>('button', { textContent: 'M', title: 'Mute del master', onclick: toggleMute });
    this.volume = volumeSlider(store, store.project.master.volumeDb, 'vol-master',
      (volumeDb, mergeKey) => store.apply(setMasterMixer({ volumeDb }), mergeKey ? { mergeKey } : {}));
    this.fx = fxButton(0, 'Effetti del master', open);
    const reset = () => meters.resetClip(MASTER);
    const meter = new LevelMeter('master-meter', reset), peak = new PeakReadout(reset);
    meters.attach(MASTER, meter);
    meters.attach(MASTER, peak);
    this.header.append(
      el('div', { className: 'top' }, el('span', { className: 'track-name', textContent: 'Master' }), peak.element),
      el('div', { className: 'controls' }, this.mute, this.volume, this.fx),
      meter.element);
    this.lane.onclick = open;
    const menu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Effetti del master', run: open },
        ...addEffectItems(store, MASTER, open),
        { label: store.project.master.mute ? 'Togli il mute' : 'Mute', run: toggleMute },
      ]);
    };
    this.header.oncontextmenu = menu;
    this.lane.oncontextmenu = menu;
    store.onChange(p => this.render(p));
    this.render(store.project);
  }

  private render(p: Project): void {
    this.mute.classList.toggle('on', p.master.mute);
    setVolume(this.volume, p.master.volumeDb);
    setFxCount(this.fx, p.masterEffects.length);
    const chips = p.masterEffects.map(e => {
      const label = effectType(e.type)?.label ?? e.type;
      return el('span', { className: e.enabled ? 'chip' : 'chip off', textContent: e.preset ? `${label} · ${e.preset}` : label });
    });
    this.lane.replaceChildren(...(chips.length
      ? chips.flatMap((c, i) => (i ? [el('span', { className: 'arrow', textContent: '→' }), c] : [c]))
      : [el('span', { className: 'muted', textContent: 'Nessun effetto sul master: un clic per aggiungerne' })]));
  }
}
