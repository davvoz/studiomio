/* The mixer at the bottom of the session, as in Live: for each track the sends to the buses, FX,
 * pan, vertical volume with the level meter, mute and solo (the buses have no sends);
 * for the master volume, level and peak. Each strip is built once and then
 * updated, so a dragged fader isn't interrupted. */
import { signGlyph } from '../../core/math';
import type { TrackId } from '../../core/id';
import type { NumberParam } from '../../devices/params';
import { instrumentType } from '../../devices/registry';
import type { MidiTarget } from '../../model/midi-map';
import { MASTER, type ChainOwner, type Project } from '../../model/project';
import { BusTrack, GroupTrack, MidiTrack, SEND_OFF_DB, type Track } from '../../model/track';
import { setMasterMixer, setMixer, setSend } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { controlFor, type ParamControl } from '../device/controls';
import { el } from '../dom';
import { LevelMeter, PeakReadout, type MeterBoard } from '../meters/meter-board';
import { automationOnRightClick, fxButton, keyboardButton, midiSlot, midiTarget, setFxCount, setVolume, volumeSlider } from '../mixer-controls';

import type { ModTarget } from '../../model/envelope';
import type { UiState } from '../ui-state';

const PAN: NumberParam = { kind: 'number', id: 'pan', label: 'Pan', min: -50, max: 50, default: 0, unit: 'pan', step: 1 };

/** The knob of the send to a bus: from closed (−∞) to 0 dB, as in Live (without the unit,
 *  which doesn't fit in the small knob: it's in the tooltip). */
const sendParam = (bus: BusTrack): NumberParam => ({
  kind: 'number', id: `send-${bus.id}`, label: bus.name, min: SEND_OFF_DB, max: 0, default: SEND_OFF_DB, step: 0.5, offAtMin: true,
});

const formatDb = (db: number) => (db <= -40 ? '−∞' : `${signGlyph(db)}${Math.abs(db).toFixed(1)}`);

/** The strip's badge: the instrument for MIDI tracks, otherwise the kind of track. */
function badgeOf(t: Track): string {
  if (t instanceof MidiTrack) return instrumentType(t.instrument.type)?.label ?? t.instrument.type;
  if (t instanceof GroupTrack) return 'Group';
  return t instanceof BusTrack ? 'Bus' : 'Audio';
}

export interface StripActions {
  readonly ui: UiState;
  openDevices(owner: ChainOwner): void;
  /** Shows a parameter's curve in the track's clip. */
  showAutomation?(owner: ChainOwner, target: ModTarget): void;
}

/** Vertical fader (mappable to MIDI as `target`), its meter and the value in dB. */
function faderBlock(volume: HTMLInputElement, target: MidiTarget, meter: LevelMeter, db: HTMLElement): HTMLElement {
  volume.classList.add('vertical');
  return el('div', { className: 'fader-block' }, el('div', { className: 'fader-row' }, midiSlot(volume, target), meter.element), db);
}

export class TrackStrip {
  readonly element = el('div', { className: 'strip' });
  private readonly fx: HTMLButtonElement;
  private readonly badge = el('div', { className: 'strip-badge' });
  /** The send knobs, one per bus (the buses don't have them). */
  private readonly sendBox = el('div', { className: 'strip-sends' });
  private sends: { readonly bus: TrackId; readonly control: ParamControl }[] = [];
  private shownBuses: readonly BusTrack[] | null = null;
  private readonly pan: ParamControl;
  private readonly volume: HTMLInputElement;
  private readonly db = el('div', { className: 'strip-db' });
  private readonly mute: HTMLButtonElement;
  private readonly solo: HTMLButtonElement;
  /** Only MIDI tracks have an instrument to play with the keyboard. */
  private readonly keyboard: HTMLButtonElement | null = null;
  private readonly detach: () => void;
  private shown: Track | null = null;

  constructor(private readonly id: TrackId, private readonly store: ProjectStore, actions: StripActions, meters: MeterBoard) {
    const mixer = (patch: Parameters<typeof setMixer>[1], mergeKey?: string) => store.apply(setMixer(id, patch), mergeKey ? { mergeKey } : {});
    const current = () => store.project.track(id)!;
    this.fx = fxButton(0, 'Track instrument and effects', () => actions.openDevices(id));
    this.pan = controlFor(PAN, 0, (v, final) => {
      mixer({ pan: v / 50 }, `pan-${id}`);
      if (final) store.endMerge();
    });
    this.volume = volumeSlider(store, 0, `vol-${id}`, (volumeDb, merge) => mixer({ volumeDb }, merge));
    const toggle = (text: string, flag: 'mute' | 'solo') => midiTarget(
      el<HTMLButtonElement>('button', { textContent: text, title: flag === 'mute' ? 'Mute' : 'Solo', onclick: () => mixer({ [flag]: !current().mixer[flag] }) }),
      { kind: 'mixer', owner: id, control: flag });
    this.mute = toggle('M', 'mute');
    this.solo = toggle('S', 'solo');
    if (current() instanceof MidiTrack) this.keyboard = keyboardButton(actions.ui, id);
    this.element.dataset.track = id;
    const meter = new LevelMeter('strip-meter', () => meters.resetClip(id));
    this.detach = meters.attach(id, meter);
    midiTarget(this.pan.element, { kind: 'mixer', owner: id, control: 'pan' });
    automationOnRightClick(this.pan.element, () => actions.showAutomation?.(id, { kind: 'mixer', param: 'pan' }));
    automationOnRightClick(this.volume, () => actions.showAutomation?.(id, { kind: 'mixer', param: 'volume' }));
    this.element.append(this.sendBox, this.badge, this.fx, this.pan.element,
      faderBlock(this.volume, { kind: 'mixer', owner: id, control: 'volume' }, meter, this.db), el('div', { className: 'strip-ms' }, this.mute, this.solo, ...(this.keyboard ? [this.keyboard] : [])));
  }

  showKeyboard(on: boolean): void {
    this.keyboard?.classList.toggle('on', on);
  }

  /** `buses`: the project's buses, for the send knobs. */
  update(t: Track, buses: readonly BusTrack[]): void {
    this.updateSends(t, buses);
    if (t === this.shown) return;
    this.shown = t;
    this.element.style.setProperty('--color', t.color);
    this.element.classList.toggle('bus-strip', t instanceof BusTrack);
    this.badge.textContent = badgeOf(t);
    for (const s of this.sends) s.control.set(t.send(s.bus));
    setFxCount(this.fx, t.effects.length);
    this.pan.set(Math.round(t.mixer.pan * 50));
    setVolume(this.volume, t.mixer.volumeDb);
    this.db.textContent = formatDb(t.mixer.volumeDb);
    this.mute.classList.toggle('on', t.mixer.mute);
    this.solo.classList.toggle('on', t.mixer.solo);
  }

  /** The knobs are redone only if the buses change (added, removed, moved or renamed). */
  private updateSends(t: Track, buses: readonly BusTrack[]): void {
    if (buses === this.shownBuses) return;
    this.shownBuses = buses;
    this.sends = t instanceof BusTrack ? [] : buses.map(b => {
      const control = controlFor(sendParam(b), t.send(b.id), (db, final) => {
        this.store.apply(setSend(this.id, b.id, db), { mergeKey: `send-${this.id}-${b.id}` });
        if (final) this.store.endMerge();
      });
      control.element.title = `Send to ${b.name}, in dB (double click: closed)`;
      midiTarget(control.element, { kind: 'send', owner: this.id, bus: b.id });
      return { bus: b.id, control };
    });
    this.sendBox.replaceChildren(...this.sends.map(s => s.control.element));
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
    this.fx = fxButton(0, 'Master effects', () => actions.openDevices(MASTER));
    this.volume = volumeSlider(store, 0, 'vol-master', (volumeDb, mergeKey) => store.apply(setMasterMixer({ volumeDb }), mergeKey ? { mergeKey } : {}));
    this.mute = midiTarget(el<HTMLButtonElement>('button', { textContent: 'M', title: 'Master mute', onclick: () => store.apply(setMasterMixer({ mute: !store.project.master.mute })) }),
      { kind: 'mixer', owner: MASTER, control: 'mute' });
    const reset = () => meters.resetClip(MASTER);
    const meter = new LevelMeter('strip-meter', reset), peak = new PeakReadout(reset);
    meters.attach(MASTER, meter);
    meters.attach(MASTER, peak);
    this.element.append(el('div', { className: 'strip-badge' }, 'Master'), this.fx, peak.element,
      faderBlock(this.volume, { kind: 'mixer', owner: MASTER, control: 'volume' }, meter, this.db), el('div', { className: 'strip-ms' }, this.mute));
  }

  update(p: Project): void {
    setFxCount(this.fx, p.masterEffects.length);
    setVolume(this.volume, p.master.volumeDb);
    this.db.textContent = formatDb(p.master.volumeDb);
    this.mute.classList.toggle('on', p.master.mute);
  }
}
