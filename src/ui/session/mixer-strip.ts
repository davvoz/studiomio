/* Il mixer in fondo alla session, come in Live: per ogni traccia FX, pan, volume verticale con
 * il misuratore di livello, mute e solo; per il master volume, livello e picco. Ogni striscia
 * si costruisce una volta e poi si aggiorna, così un fader trascinato non si interrompe. */
import type { TrackId } from '../../core/id';
import type { NumberParam } from '../../devices/params';
import { instrumentType } from '../../devices/registry';
import { MASTER, type ChainOwner, type Project } from '../../model/project';
import { GroupTrack, MidiTrack, type Track } from '../../model/track';
import { setMasterMixer, setMixer } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { controlFor, type ParamControl } from '../device/controls';
import { el } from '../dom';
import { LevelMeter, PeakReadout, type MeterBoard } from '../meters/meter-board';
import { fxButton, setFxCount, setVolume, volumeSlider } from '../mixer-controls';

const PAN: NumberParam = { kind: 'number', id: 'pan', label: 'Pan', min: -50, max: 50, default: 0, unit: 'pan', step: 1 };

const formatDb = (db: number) => (db <= -40 ? '−∞' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`);

export interface StripActions {
  openDevices(owner: ChainOwner): void;
}

/** Fader verticale, il suo misuratore e il valore in dB. */
function faderBlock(volume: HTMLInputElement, meter: LevelMeter, db: HTMLElement): HTMLElement {
  volume.classList.add('vertical');
  return el('div', { className: 'fader-block' }, el('div', { className: 'fader-row' }, volume, meter.element), db);
}

export class TrackStrip {
  readonly element = el('div', { className: 'strip' });
  private readonly fx: HTMLButtonElement;
  private readonly badge = el('div', { className: 'strip-badge' });
  private readonly pan: ParamControl;
  private readonly volume: HTMLInputElement;
  private readonly db = el('div', { className: 'strip-db' });
  private readonly mute: HTMLButtonElement;
  private readonly solo: HTMLButtonElement;
  private readonly detach: () => void;
  private shown: Track | null = null;

  constructor(id: TrackId, store: ProjectStore, actions: StripActions, meters: MeterBoard) {
    const mixer = (patch: Parameters<typeof setMixer>[1], mergeKey?: string) => store.apply(setMixer(id, patch), mergeKey ? { mergeKey } : {});
    const current = () => store.project.track(id)!;
    this.fx = fxButton(0, 'Strumento ed effetti della traccia', () => actions.openDevices(id));
    this.pan = controlFor(PAN, 0, (v, final) => {
      mixer({ pan: v / 50 }, `pan-${id}`);
      if (final) store.endMerge();
    });
    this.volume = volumeSlider(store, 0, `vol-${id}`, (volumeDb, merge) => mixer({ volumeDb }, merge));
    const toggle = (text: string, flag: 'mute' | 'solo') =>
      el<HTMLButtonElement>('button', { textContent: text, title: flag === 'mute' ? 'Mute' : 'Solo', onclick: () => mixer({ [flag]: !current().mixer[flag] }) });
    this.mute = toggle('M', 'mute');
    this.solo = toggle('S', 'solo');
    this.element.dataset.track = id;
    const meter = new LevelMeter('strip-meter', () => meters.resetClip(id));
    this.detach = meters.attach(id, meter);
    this.element.append(this.badge, this.fx, this.pan.element, faderBlock(this.volume, meter, this.db), el('div', { className: 'strip-ms' }, this.mute, this.solo));
  }

  update(t: Track): void {
    if (t === this.shown) return;
    this.shown = t;
    this.element.style.setProperty('--color', t.color);
    this.badge.textContent = t instanceof MidiTrack ? instrumentType(t.instrument.type)?.label ?? t.instrument.type : t instanceof GroupTrack ? 'Gruppo' : 'Audio';
    setFxCount(this.fx, t.effects.length);
    this.pan.set(Math.round(t.mixer.pan * 50));
    setVolume(this.volume, t.mixer.volumeDb);
    this.db.textContent = formatDb(t.mixer.volumeDb);
    this.mute.classList.toggle('on', t.mixer.mute);
    this.solo.classList.toggle('on', t.mixer.solo);
  }

  dispose(): void {
    this.detach();
  }
}

export class MasterStripView {
  readonly element = el('div', { className: 'strip master-strip' });
  private readonly fx: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly db = el('div', { className: 'strip-db' });
  private readonly mute: HTMLButtonElement;

  constructor(store: ProjectStore, actions: StripActions, meters: MeterBoard) {
    this.fx = fxButton(0, 'Effetti del master', () => actions.openDevices(MASTER));
    this.volume = volumeSlider(store, 0, 'vol-master', (volumeDb, mergeKey) => store.apply(setMasterMixer({ volumeDb }), mergeKey ? { mergeKey } : {}));
    this.mute = el<HTMLButtonElement>('button', { textContent: 'M', title: 'Mute del master', onclick: () => store.apply(setMasterMixer({ mute: !store.project.master.mute })) });
    const reset = () => meters.resetClip(MASTER);
    const meter = new LevelMeter('strip-meter', reset), peak = new PeakReadout(reset);
    meters.attach(MASTER, meter);
    meters.attach(MASTER, peak);
    this.element.append(el('div', { className: 'strip-badge' }, 'Master'), this.fx, peak.element, faderBlock(this.volume, meter, this.db), el('div', { className: 'strip-ms' }, this.mute));
  }

  update(p: Project): void {
    setFxCount(this.fx, p.masterEffects.length);
    setVolume(this.volume, p.master.volumeDb);
    this.db.textContent = formatDb(p.master.volumeDb);
    this.mute.classList.toggle('on', p.master.mute);
  }
}
