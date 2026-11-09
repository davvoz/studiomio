/* A clip's modulation editor, like Live's "Envelopes" box: in the clip's panel
 * two menus (device and parameter) and below the editor the lane with the curve. The
 * piano roll, the audio editor and the master automation on the timeline use it. */
import { sameTarget, targetKey, type ModTarget } from '../../model/envelope';
import { el } from '../dom';
import { EnvelopeLane, type LaneHost } from './envelope-lane';
import { deviceKeyOf, type TargetDevice } from './mod-targets';

export interface ModulationHost extends LaneHost {
  /** The devices that can be modulated (null: nothing open). */
  devices(): TargetDevice[] | null;
  /** The lane was shown or hidden: the editor makes room. */
  layout(laneVisible: boolean): void;
}

/** The value of the devices menu that hides the lane. */
const NONE = '';
/** Mark next to the devices and parameters that have a modulation. */
const MARK = '● ';

export class ModulationEditor {
  readonly controls = el('div', { className: 'mod-controls' });
  readonly lane: EnvelopeLane;
  /** Under the piano roll's keyboard: the parameter's name. */
  readonly side = el('div', { className: 'mod-side', hidden: true });
  private readonly device = el<HTMLSelectElement>('select', { title: 'The device to modulate' });
  private readonly param = el<HTMLSelectElement>('select', { title: 'The parameter to modulate' });
  private readonly drawButton: HTMLButtonElement;
  private readonly shapesButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private devices: TargetDevice[] = [];
  private target: ModTarget | null = null;
  /** What devices and modulations were like when the menus were filled. */
  private builtFor = '';

  constructor(private readonly host: ModulationHost, title = 'Modulations') {
    this.lane = new EnvelopeLane(host, on => this.drawButton.classList.toggle('on', on), on => this.shapesButton.classList.toggle('on', on));
    this.drawButton = el<HTMLButtonElement>('button', {
      className: 'mini', textContent: '✎', title: 'Draw in steps on the grid (B); with Alt freehand', onclick: () => this.lane.setDraw(!this.lane.draw),
    });
    this.shapesButton = el<HTMLButtonElement>('button', {
      className: 'mini', textContent: '∿', title: 'Ready-made shapes (F): sine, ramps, pump… in the chosen range or over everything that plays',
      onclick: () => this.lane.setShapes(!this.lane.shapes),
    });
    this.clearButton = el<HTMLButtonElement>('button', {
      className: 'mini', textContent: '×', title: 'Clear this parameter\'s modulation',
      onclick: () => { const t = this.target; if (t) host.commit('Clear modulation', t, []); },
    });
    this.device.onchange = () => this.chooseDevice(this.device.value);
    this.param.onchange = () => this.choose(this.paramTargets().find(t => targetKey(t) === this.param.value) ?? null);
    this.controls.append(
      el('div', { className: 'mod-head' }, el('span', { textContent: title }), this.drawButton, this.shapesButton, this.clearButton),
      this.device, this.param);
  }

  /** The shown target (for automated tests). */
  get selected(): ModTarget | null {
    return this.target;
  }

  /** A just-opened clip: it stays on the previous parameter if the track has it, otherwise it
   *  shows the clip's first modulation, if it has one. */
  opened(): void {
    const curves = this.host.curves(), devices = this.host.devices();
    this.builtFor = '';
    if (!curves || !devices) return this.choose(null);
    const valid = (t: ModTarget | null) => !!t && this.targetsOf(devices).some(x => sameTarget(x, t));
    const keep = valid(this.target) ? this.target : null;
    const first = curves.envelopes.map(e => e.target).find(t => valid(t)) ?? null;
    this.choose(keep && (curves.envelope(keep) || !first) ? keep : first);
  }

  /** Brings the lane onto parameter `target`; false if with this clip it can't be modulated. */
  show(target: ModTarget): boolean {
    const devices = this.host.devices();
    if (!devices || !this.targetsOf(devices).some(t => sameTarget(t, target))) return false;
    this.devices = devices;
    this.choose(target);
    return true;
  }

  /** Aligns menus and lane with the curves and the devices (after every project change). */
  sync(): void {
    const curves = this.host.curves(), devices = this.host.devices();
    if (!curves || !devices) return;
    const shape = [...devices.map(d => `${d.key}=${d.label}`), '|', ...curves.envelopes.map(e => targetKey(e.target))].join(',');
    if (shape !== this.builtFor) {
      this.builtFor = shape;
      this.devices = devices;
      // the parameter's device is gone: the lane closes
      if (this.target && !this.targetsOf(devices).some(t => sameTarget(t, this.target!))) return this.choose(null);
      this.fill();
    }
    this.clearButton.disabled = !(this.target && curves.envelope(this.target));
    this.shapesButton.disabled = !this.target;
    this.lane.invalidate();
  }

  frame(): void {
    this.lane.frame();
  }

  // ---------------------------------------------------------------- selection

  private choose(target: ModTarget | null): void {
    this.target = target;
    this.lane.setTarget(target);
    this.side.hidden = target === null;
    this.host.layout(target !== null);
    this.builtFor = '';
    this.sync();
    if (!target) this.fill();
  }

  /** A device: its first modulated parameter, or the first parameter. */
  private chooseDevice(key: string): void {
    const device = this.devices.find(d => d.key === key);
    if (!device) return this.choose(null);
    const curves = this.host.curves();
    const params = device.sections.flatMap(s => s.params.map(p => p.target));
    this.choose(params.find(t => curves?.envelope(t)) ?? params[0] ?? null);
  }

  private targetsOf(devices: readonly TargetDevice[]): ModTarget[] {
    return devices.flatMap(d => d.sections.flatMap(s => s.params.map(p => p.target)));
  }

  private paramTargets(): ModTarget[] {
    const key = this.target ? deviceKeyOf(this.target) : NONE;
    return this.targetsOf(this.devices.filter(d => d.key === key));
  }

  /** The two menus, with the mark on the devices and parameters that have a modulation. */
  private fill(): void {
    const curves = this.host.curves();
    const has = (t: ModTarget) => !!curves?.envelope(t);
    this.device.replaceChildren(
      el('option', { value: NONE, textContent: '— none —' }),
      ...this.devices.map(d => el('option', {
        value: d.key, textContent: `${d.sections.some(s => s.params.some(p => has(p.target))) ? MARK : ''}${d.label}`,
      })));
    const key = this.target ? deviceKeyOf(this.target) : NONE;
    this.device.value = key;
    const device = this.devices.find(d => d.key === key);
    this.param.hidden = !device;
    this.param.replaceChildren(...(device?.sections ?? []).map(s => {
      const options = s.params.map(p => el('option', { value: targetKey(p.target), textContent: `${has(p.target) ? MARK : ''}${p.label}` }));
      // a single section (the mixer): no groups
      return device!.sections.length > 1 ? el('optgroup', { label: s.label }, ...options) : options;
    }).flat());
    if (this.target) this.param.value = targetKey(this.target);
    const label = device?.sections.flatMap(s => s.params).find(p => this.target && sameTarget(p.target, this.target));
    this.side.textContent = label ? `${device!.label} · ${label.label}` : '';
  }
}
