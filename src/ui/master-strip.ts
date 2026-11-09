import { MASTER, type Project } from '../model/project';
import { setMasterMixer } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { showContextMenu } from './context-menu';
import { el } from './dom';
import type { MasterAutomation } from './master-automation';
import { LevelMeter, PeakReadout, type MeterBoard } from './meters/meter-board';
import { addEffectItems, fxButton, midiSlot, midiTarget, setFxCount, setVolume, volumeSlider } from './mixer-controls';
import type { HeaderActions } from './track-headers';

/** The master's row at the bottom of the arrangement, as in Live: on the left mute, volume and
 *  effects (aligned with the track headers), on the right an empty lane; a click on
 *  both (outside the controls) opens its chain.
 *  The controls are built once and then updated, so a drag continues. */
export class MasterStrip {
  readonly header = el('div', { className: 'header master-header' });
  readonly lane = el('div', { className: 'master-lane', title: 'Master effects: a click opens them' });
  private readonly mute: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly fx: HTMLButtonElement;

  constructor(store: ProjectStore, actions: HeaderActions, meters: MeterBoard, automation: MasterAutomation) {
    const open = () => actions.openDevices(MASTER);
    const toggleMute = () => store.apply(setMasterMixer({ mute: !store.project.master.mute }));
    this.mute = midiTarget(el<HTMLButtonElement>('button', { textContent: 'M', title: 'Master mute', onclick: toggleMute }), { kind: 'mixer', owner: MASTER, control: 'mute' });
    this.volume = volumeSlider(store, store.project.master.volumeDb, 'vol-master',
      (volumeDb, mergeKey) => store.apply(setMasterMixer({ volumeDb }), mergeKey ? { mergeKey } : {}));
    this.fx = fxButton(0, 'Master effects', open);
    const reset = () => meters.resetClip(MASTER);
    const meter = new LevelMeter('master-meter', reset), peak = new PeakReadout(reset);
    meters.attach(MASTER, meter);
    meters.attach(MASTER, peak);
    this.header.append(
      el('div', { className: 'top' }, el('span', { className: 'track-name', textContent: 'Master' }), peak.element),
      el('div', { className: 'controls' }, this.mute, midiSlot(this.volume, { kind: 'mixer', owner: MASTER, control: 'volume' }), this.fx, automation.button),
      meter.element);
    this.lane.onclick = open;
    // a click on the header (not on its controls) opens the effects, like FX
    this.header.title = 'Master: a click opens the effects';
    this.header.onclick = e => {
      if (!(e.target as HTMLElement).closest('button, input, .midi-slot, .level-meter')) open();
    };
    const menu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Master effects', run: open },
        { label: automation.isOpen ? 'Hide the automation' : 'Show the automation', run: () => automation.toggle() },
        ...(store.project.masterAutomation.length ? [{
          label: store.project.masterAutomationOn ? 'Switch the automation off' : 'Switch the automation on',
          run: () => automation.switchOn(!store.project.masterAutomationOn),
        }] : []),
        ...addEffectItems(store, MASTER, open),
        { label: store.project.master.mute ? 'Unmute' : 'Mute', run: toggleMute },
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
  }
}
