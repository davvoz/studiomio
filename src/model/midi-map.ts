/* Any controller's MIDI on the app's controls, like Live's MIDI Map: a
 * knob, a fader (CC) or a pad, a key (note) moves a rack's macro, a parameter of
 * an instrument or an effect, the volume, the pan, a send, the mute or the solo of a track,
 * the master's volume or mute. A control can move more than one; each has at most one
 * control. As for the keyboard (see key-map): the mappings belong to the project, those of
 * targets that are gone stay written but don't apply and aren't saved. The control is
 * recognized by channel and number, from whatever port it arrives. */
import { asId, type TrackId } from '../core/id';
import { checkKeyMap, sameTarget, type KeyTarget } from './key-map';
import type { ChainOwner } from './project';
import type { DeviceKey } from './rack';

/** A control of the controller: a CC (knob, fader) or a note (pad, key). Channel 0…15. */
export interface MidiControl {
  readonly type: 'cc' | 'note';
  readonly channel: number;
  readonly number: number;
}

export type MixerControl = 'volume' | 'pan' | 'mute' | 'solo';

export type MidiTarget =
  | KeyTarget
  /** Of the master only volume and mute. */
  | { readonly kind: 'mixer'; readonly owner: ChainOwner; readonly control: MixerControl }
  | { readonly kind: 'send'; readonly owner: TrackId; readonly bus: TrackId };

export interface MidiMapping {
  readonly control: MidiControl;
  readonly target: MidiTarget;
}

export type MidiMap = readonly MidiMapping[];

/** No mappings (always the same list: changes are recognized by reference). */
export const NO_MIDI: MidiMap = Object.freeze([]);

export const sameControl = (a: MidiControl, b: MidiControl): boolean =>
  a.type === b.type && a.channel === b.channel && a.number === b.number;

export const sameMidiTarget = (a: MidiTarget, b: MidiTarget): boolean => {
  if (a.kind === 'mixer') return b.kind === 'mixer' && a.owner === b.owner && a.control === b.control;
  if (a.kind === 'send') return b.kind === 'send' && a.owner === b.owner && a.bus === b.bus;
  return (b.kind === 'macro' || b.kind === 'param') && sameTarget(a, b);
};

/** A target's control, or null. */
export const controlOf = (map: MidiMap, target: MidiTarget): MidiControl | null =>
  map.find(m => sameMidiTarget(m.target, target))?.control ?? null;

/** A control's targets. */
export const midiTargetsOf = (map: MidiMap, control: MidiControl): MidiTarget[] =>
  map.filter(m => sameControl(m.control, control)).map(m => m.target);

/** Gives a target a control (null: removes it); the previous control no longer moves it. */
export function withControl(map: MidiMap, target: MidiTarget, control: MidiControl | null): MidiMap {
  const kept = map.filter(m => !sameMidiTarget(m.target, target));
  if (control === null) return kept.length === map.length ? map : kept;
  const before = controlOf(map, target);
  if (before && sameControl(before, control)) return map;
  return [...kept, { control, target }];
}

/** Removes the controls of a device's parameters (e.g. the instrument changed: the parameters are different). */
export const withoutParamControlsOf = (map: MidiMap, owner: ChainOwner, device: DeviceKey): MidiMap => {
  const kept = map.filter(m => m.target.kind !== 'param' || m.target.owner !== owner || m.target.device !== device);
  return kept.length === map.length ? map : kept;
};

const isKeyTarget = (t: MidiTarget): t is KeyTarget => t.kind === 'macro' || t.kind === 'param';

/** The rules: valid MIDI controls, macros that exist, no target twice. */
export function checkMidiMap(map: MidiMap): void {
  checkKeyMap(map.filter(m => isKeyTarget(m.target)).map(m => ({ key: midiLabel(m.control), target: m.target as KeyTarget })));
  map.forEach((m, i) => {
    const c = m.control;
    if (!(Number.isInteger(c.channel) && c.channel >= 0 && c.channel < 16 && Number.isInteger(c.number) && c.number >= 0 && c.number < 128)) {
      throw new RangeError(`invalid MIDI control: ${c.type} ${c.number} on channel ${c.channel + 1}`);
    }
    if (map.findIndex(x => sameMidiTarget(x.target, m.target)) !== i) throw new Error(`${midiLabel(c)} is on a target that already has a control`);
  });
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** A control's name as it's shown: "CC 7", "C3" (middle C, 60, is C3 as in
 *  Live); with the channel if it isn't 1: "CC 7 · 2". */
export function midiLabel(c: MidiControl): string {
  const name = c.type === 'cc' ? `CC ${c.number}` : `${NOTE_NAMES[c.number % 12]}${Math.floor(c.number / 12) - 2}`;
  return c.channel ? `${name} · ${c.channel + 1}` : name;
}

/** The target written in a string (for the DOM: `data-midi-target`), and back. */
export function encodeMidiTarget(t: MidiTarget): string {
  switch (t.kind) {
    case 'macro': return `macro|${t.owner}|${t.rack}|${t.index}`;
    case 'param': return `param|${t.owner}|${t.device}|${t.param}`;
    case 'mixer': return `mixer|${t.owner}|${t.control}`;
    case 'send': return `send|${t.owner}|${t.bus}`;
  }
}

export function decodeMidiTarget(s: string): MidiTarget | null {
  const [kind, owner, a, b] = s.split('|');
  const o = owner as ChainOwner;
  switch (kind) {
    case 'macro': return { kind, owner: o, rack: asId(a), index: Number(b) };
    case 'param': return { kind, owner: o, device: a as DeviceKey, param: b };
    case 'mixer': return MIXER_CONTROLS.includes(a as MixerControl) ? { kind, owner: o, control: a as MixerControl } : null;
    case 'send': return { kind, owner: o as TrackId, bus: a as TrackId };
    default: return null;
  }
}

export const MIXER_CONTROLS: readonly MixerControl[] = ['volume', 'pan', 'mute', 'solo'];
