/* A track's controls a curve can move (the same as the modulation editor's: volume, pan, the
 * instrument's and the effects' parameters, the effects' on/off, the racks' macros), as the recording
 * of movements reads them: the value each one has, how a gesture becomes the curve's values, and the
 * edit that puts the control back. A parameter moved by a macro isn't one: the macro is. */
import type { DeviceId, TrackId } from '../core/id';
import { paramSpec, resolveParams } from '../devices/device-type';
import { paramToUnit } from '../devices/params';
import { effectType, instrumentType } from '../devices/registry';
import { DEVICE_ON, INSTRUMENT_DEVICE, targetKey, type EnvelopePoint, type ModTarget } from '../model/envelope';
import type { Project } from '../model/project';
import { MACRO_MAX, macroIndex, macroOf, type Rack } from '../model/rack';
import { MidiTrack, type Track } from '../model/track';
import { setEffectEnabled, setEffectParam, setInstrumentParam, setMixer } from '../store/edits';
import type { Edit } from '../store/project-store';
import { setMacro } from '../store/rack-edits';
import { targetDevices } from '../ui/envelopes/mod-targets';

/** A control: its value as stored (`raw`), on its travel 0 … 1 (`unit`), the edit that sets it. */
export interface Knob {
  readonly target: ModTarget;
  readonly raw: number;
  readonly unit: number;
  set(raw: number): Edit;
}

/** At or under this the fader is silence (as the mixer plays it). */
const SILENT_DB = -70;

/** The track's controls, by target key. */
export function trackKnobs(p: Project, id: TrackId): Map<string, Knob> {
  const track = p.track(id), out = new Map<string, Knob>();
  if (!track) return out;
  for (const device of targetDevices(track)) {
    for (const section of device.sections) {
      for (const { target } of section.params) {
        const knob = knobOf(p, track, target);
        if (knob) out.set(targetKey(target), knob);
      }
    }
  }
  return out;
}

function knobOf(p: Project, track: Track, target: ModTarget): Knob | null {
  if (target.kind === 'mixer') return mixerKnob(track.id, track, target.param);
  if (target.kind !== 'device') return null;
  const { device, param } = target;
  if (param === DEVICE_ON) return onOffKnob(track, device);
  // a parameter (or an inner rack's macro) a macro moves: the macro is recorded
  if (macroOf(p.racksOf(track.id), device, param)) return null;
  const rack = track.racks.find(r => r.id === device);
  return rack ? macroKnob(track.id, rack, param) : paramKnob(track, device, param);
}

function mixerKnob(id: TrackId, track: Track, param: 'volume' | 'pan'): Knob {
  const target: ModTarget = { kind: 'mixer', param };
  if (param === 'volume') return { target, raw: track.mixer.volumeDb, unit: track.mixer.volumeDb, set: v => setMixer(id, { volumeDb: v }) };
  return { target, raw: track.mixer.pan, unit: track.mixer.pan, set: v => setMixer(id, { pan: v }) };
}

function onOffKnob(track: Track, device: string): Knob | null {
  const effect = track.effects.find(e => e.id === device);
  if (!effect) return null;
  const on = effect.enabled ? 1 : 0;
  return { target: { kind: 'device', device: effect.id, param: DEVICE_ON }, raw: on, unit: on, set: v => setEffectEnabled(track.id, effect.id, v >= 0.5) };
}

function macroKnob(id: TrackId, rack: Rack, param: string): Knob | null {
  const index = macroIndex(param), macro = rack.macros[index];
  if (!macro) return null;
  return { target: { kind: 'device', device: rack.id, param }, raw: macro.value, unit: macro.value / MACRO_MAX, set: v => setMacro(id, rack.id, index, v) };
}

/** A parameter of the instrument or of an effect. */
function paramKnob(track: Track, device: string, param: string): Knob | null {
  const instrument = device === INSTRUMENT_DEVICE;
  const settings = instrument ? instrumentOf(track) : track.effects.find(e => e.id === device);
  if (!settings) return null;
  const type = instrument ? instrumentType(settings.type) : effectType(settings.type);
  const spec = type && paramSpec(type, param);
  if (!type || !spec) return null;
  const raw = resolveParams(type, settings.params)[param];
  const id = track.id;
  const set = instrument ? (v: number) => setInstrumentParam(id, param, v) : (v: number) => setEffectParam(id, device as DeviceId, param, v);
  return { target: { kind: 'device', device: device as DeviceId, param }, raw, unit: paramToUnit(spec, raw), set };
}

const instrumentOf = (track: Track) => (track instanceof MidiTrack ? track.instrument : undefined);

/** A gesture made into curve values: where the control goes back to (`rest`) and how the old curve
 *  and the value before the gesture scale with it (`scale`: 1 unchanged). */
export interface GestureCurve {
  readonly points: EnvelopePoint[];
  readonly rest: number;
  readonly scale: number;
}

/** The fader at `db` heard as a part of the fader at `top` (the volume curve squares it). */
const volumeShare = (db: number, top: number): number => (db <= SILENT_DB ? 0 : Math.pow(10, (db - top) / 40));

const clampOffset = (x: number): number => Math.max(-1, Math.min(1, x));

/** The curve of a gesture from `base` through `samples` (the control's values, at clip beats). A curve
 *  can only lower the volume: the fader goes to the highest point of the gesture, and the curve brings
 *  it down where it was lower (also before the gesture: `scale`). The others go back where they were,
 *  and the curve moves them by the difference (the on/off says on or off). */
export function gestureCurve(base: Knob, samples: readonly { readonly beat: number; readonly knob: Knob }[]): GestureCurve {
  const { target } = base;
  if (target.kind === 'mixer' && target.param === 'volume') {
    const top = Math.max(base.raw, ...samples.map(s => s.knob.raw));
    return { points: samples.map(s => ({ beat: s.beat, value: volumeShare(s.knob.raw, top) })), rest: top, scale: volumeShare(base.raw, top) };
  }
  const value = (k: Knob): number => {
    if (target.kind === 'device' && target.param === DEVICE_ON) return k.raw;
    if (target.kind === 'mixer') return clampOffset(k.raw - base.raw);
    return clampOffset(k.unit - base.unit);
  };
  return { points: samples.map(s => ({ beat: s.beat, value: value(s.knob) })), rest: base.raw, scale: 1 };
}
