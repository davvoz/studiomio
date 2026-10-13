/* L'editor delle modulazioni di una clip, come il riquadro "Envelopes" di Live: nel pannello
 * della clip due menu (dispositivo e parametro) e sotto l'editor la corsia con la curva. Lo
 * usano sia il piano roll sia l'editor audio. */
import { sameTarget, targetKey, type ModTarget } from '../../model/envelope';
import type { Track } from '../../model/track';
import { el } from '../dom';
import { EnvelopeLane, type LaneHost } from './envelope-lane';
import { deviceKeyOf, targetDevices, type TargetDevice } from './mod-targets';

export interface ModulationHost extends LaneHost {
  /** La traccia della clip aperta. */
  track(): Track | null;
  /** La corsia si è mostrata o nascosta: l'editor fa spazio. */
  layout(laneVisible: boolean): void;
}

/** Il valore del menu dei dispositivi che nasconde la corsia. */
const NONE = '';
/** Segno accanto ai dispositivi e ai parametri che hanno una modulazione. */
const MARK = '● ';

export class ModulationEditor {
  readonly controls = el('div', { className: 'mod-controls' });
  readonly lane: EnvelopeLane;
  /** Sotto la tastiera del piano roll: il nome del parametro. */
  readonly side = el('div', { className: 'mod-side', hidden: true });
  private readonly device = el<HTMLSelectElement>('select', { title: 'Il dispositivo da modulare' });
  private readonly param = el<HTMLSelectElement>('select', { title: 'Il parametro da modulare' });
  private readonly drawButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private devices: TargetDevice[] = [];
  private target: ModTarget | null = null;
  /** Com'erano dispositivi e modulazioni quando i menu sono stati riempiti. */
  private builtFor = '';

  constructor(private readonly host: ModulationHost) {
    this.lane = new EnvelopeLane(host, on => this.drawButton.classList.toggle('on', on));
    this.drawButton = el<HTMLButtonElement>('button', {
      className: 'mini', textContent: '✎', title: 'Disegno a scalini sulla griglia', onclick: () => this.lane.setDraw(!this.lane.draw),
    });
    this.clearButton = el<HTMLButtonElement>('button', {
      className: 'mini', textContent: '×', title: 'Cancella la modulazione di questo parametro',
      onclick: () => { const t = this.target; if (t) host.commit('Cancella modulazione', c => c.withEnvelope(t, [])); },
    });
    this.device.onchange = () => this.chooseDevice(this.device.value);
    this.param.onchange = () => this.choose(this.paramTargets().find(t => targetKey(t) === this.param.value) ?? null);
    this.controls.append(
      el('div', { className: 'mod-head' }, el('span', { textContent: 'Modulazioni' }), this.drawButton, this.clearButton),
      this.device, this.param);
  }

  /** Il bersaglio mostrato (per i test automatici). */
  get selected(): ModTarget | null {
    return this.target;
  }

  /** Una clip appena aperta: si resta sul parametro di prima se la traccia ce l'ha, altrimenti si
   *  mostra la prima modulazione della clip, se ne ha. */
  opened(): void {
    const clip = this.host.clip(), track = this.host.track();
    this.builtFor = '';
    if (!clip || !track) return this.choose(null);
    const valid = (t: ModTarget | null) => !!t && this.targetsOf(targetDevices(track)).some(x => sameTarget(x, t));
    const keep = valid(this.target) ? this.target : null;
    const first = clip.envelopes.map(e => e.target).find(t => valid(t)) ?? null;
    this.choose(keep && (clip.envelope(keep) || !first) ? keep : first);
  }

  /** Allinea menu e corsia alla clip e alla traccia (dopo ogni modifica del progetto). */
  sync(): void {
    const clip = this.host.clip(), track = this.host.track();
    if (!clip || !track) return;
    const devices = targetDevices(track);
    const shape = [...devices.map(d => `${d.key}=${d.label}`), '|', ...clip.envelopes.map(e => targetKey(e.target))].join(',');
    if (shape !== this.builtFor) {
      this.builtFor = shape;
      this.devices = devices;
      if (this.target && !this.targetsOf(devices).some(t => sameTarget(t, this.target!))) this.target = null;
      this.fill();
    }
    this.clearButton.disabled = !(this.target && clip.envelope(this.target));
    this.lane.invalidate();
  }

  frame(): void {
    this.lane.frame();
  }

  // ---------------------------------------------------------------- scelta

  private choose(target: ModTarget | null): void {
    this.target = target;
    this.lane.setTarget(target);
    this.side.hidden = target === null;
    this.host.layout(target !== null);
    this.builtFor = '';
    this.sync();
    if (!target) this.fill();
  }

  /** Un dispositivo: il suo primo parametro modulato, o il primo parametro. */
  private chooseDevice(key: string): void {
    const device = this.devices.find(d => d.key === key);
    if (!device) return this.choose(null);
    const clip = this.host.clip();
    const params = device.sections.flatMap(s => s.params.map(p => p.target));
    this.choose(params.find(t => clip?.envelope(t)) ?? params[0] ?? null);
  }

  private targetsOf(devices: readonly TargetDevice[]): ModTarget[] {
    return devices.flatMap(d => d.sections.flatMap(s => s.params.map(p => p.target)));
  }

  private paramTargets(): ModTarget[] {
    const key = this.target ? deviceKeyOf(this.target) : NONE;
    return this.targetsOf(this.devices.filter(d => d.key === key));
  }

  /** I due menu, con il segno sui dispositivi e i parametri che hanno una modulazione. */
  private fill(): void {
    const clip = this.host.clip();
    const has = (t: ModTarget) => !!clip?.envelope(t);
    this.device.replaceChildren(
      el('option', { value: NONE, textContent: '— nessuna —' }),
      ...this.devices.map(d => el('option', {
        value: d.key, textContent: `${d.sections.some(s => s.params.some(p => has(p.target))) ? MARK : ''}${d.label}`,
      })));
    const key = this.target ? deviceKeyOf(this.target) : NONE;
    this.device.value = key;
    const device = this.devices.find(d => d.key === key);
    this.param.hidden = !device;
    this.param.replaceChildren(...(device?.sections ?? []).map(s => {
      const options = s.params.map(p => el('option', { value: targetKey(p.target), textContent: `${has(p.target) ? MARK : ''}${p.label}` }));
      // una sola sezione (il mixer): niente gruppi
      return device!.sections.length > 1 ? el('optgroup', { label: s.label }, ...options) : options;
    }).flat());
    if (this.target) this.param.value = targetKey(this.target);
    const label = device?.sections.flatMap(s => s.params).find(p => this.target && sameTarget(p.target, this.target));
    this.side.textContent = label ? `${device!.label} · ${label.label}` : '';
  }
}
