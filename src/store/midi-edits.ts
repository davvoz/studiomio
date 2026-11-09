/* Any controller's MIDI on macros, parameters and mixer: giving a control
 * to a target and moving it. A CC (knob, fader) takes the target to the point of its travel:
 * the volume like Live's fader (0 dB at 85%), the pan with the centre at 64, mute, solo,
 * toggles and buttons on from 64 up. A note acts like a computer key (see
 * key-edits): a switch or a menu changes, a knob jumps from one end to the other, a
 * button macro stays on while the note plays; on the mixer mute and solo change, the volume
 * goes from 0 dB to −∞ and back, a send from closed to 0 dB, the pan returns to the centre. */
import { faderToDb, knobToPan, SILENT_DB } from '../control/mixer-scale';
import { paramFromUnit } from '../devices/params';
import { mappingSpec } from '../devices/rack-params';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { controlOf, midiTargetsOf, withControl, type MidiControl, type MidiTarget } from '../model/midi-map';
import { MASTER, type Project } from '../model/project';
import { macroMode, macroOf, MACRO_MAX } from '../model/rack';
import { SEND_OFF_DB, type MixerSettings } from '../model/track';
import { setEffectParam, setInstrumentParam, setMasterMixer, setMixer, setSend } from './edits';
import { hold, macroAt, press, springTargets } from './key-edits';
import { edit, type Edit, type EditContext } from './project-store';
import { setMacro } from './rack-edits';

/** The highest value of a CC. */
const CC_MAX = 127;

/** Gives a MIDI control to a target (null: removes it). */
export const setMidi = (target: MidiTarget, control: MidiControl | null): Edit =>
  edit(control ? 'Map to MIDI' : 'Remove the MIDI', p => {
    if (!p.hasMidiTarget(target)) throw new RangeError('the MIDI target doesn\'t exist');
    const before = controlOf(p.midiMap, target);
    if (!before && !control) return p;
    return p.updatingMidiMap(map => withControl(map, target, control));
  });

/** An arrived CC (0…127): the targets go to the point of their travel. The button macros belong
 *  to `holdMidi`, the springs to `pullMidi`. */
export const moveMidi = (control: MidiControl, value: number): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of midiTargetsOf(p.midiMap, control)) p = turn(p, ctx, t, value);
    return p;
  });

/** A played note: toggles, knobs, parameters and mixer change (one undo step). */
export const pressMidi = (control: MidiControl): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of midiTargetsOf(p.midiMap, control)) p = t.kind === 'macro' || t.kind === 'param' ? press(p, ctx, t) : toggleMixer(p, ctx, t);
    return p;
  });

/** The button macros: on while the note plays or the CC stays from 64 up; the springs pulled all the way
 *  by a note (a change that undoes itself, to apply `transient`). */
export const holdMidi = (control: MidiControl, down: boolean, note = true): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of midiTargetsOf(p.midiMap, control)) {
      if (t.kind !== 'macro') continue;
      const m = macroAt(p, t);
      if (m && (note || macroMode(m) === 'button')) p = hold(p, ctx, t, down);
    }
    return p;
  });

/** A CC on the spring macros: it takes them to the point of the travel without making an undo step
 *  (the spring brings them back; to apply `transient`). */
export const pullMidi = (control: MidiControl, value: number): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of springTargets(p, midiTargetsOf(p.midiMap, control))) {
      p = setMacro(t.owner, t.rack, t.index, Math.round(Math.max(0, Math.min(1, value / CC_MAX)) * MACRO_MAX)).apply(p, ctx);
    }
    return p;
  });

const on = (value: number) => value >= 64;

function turn(p: Project, ctx: EditContext, t: MidiTarget, value: number): Project {
  const unit = Math.max(0, Math.min(1, value / CC_MAX));
  switch (t.kind) {
    case 'macro': {
      const m = macroAt(p, t);
      if (!m || macroMode(m) === 'button' || macroMode(m) === 'spring') return p;
      return setMacro(t.owner, t.rack, t.index, Math.round(unit * MACRO_MAX)).apply(p, ctx);
    }
    case 'param': {
      // a parameter mapped to a macro is moved by the macro
      if (macroOf(p.racksOf(t.owner), t.device, t.param)) return p;
      const spec = mappingSpec(p, t.owner, t);
      if (!spec) return p;
      const v = paramFromUnit(spec, unit);
      if (t.device !== INSTRUMENT_DEVICE) return setEffectParam(t.owner, t.device, t.param, v).apply(p, ctx);
      return t.owner === MASTER ? p : setInstrumentParam(t.owner, t.param, v).apply(p, ctx);
    }
    case 'send':
      return setSend(t.owner, t.bus, Math.round((SEND_OFF_DB - unit * SEND_OFF_DB) * 2) / 2).apply(p, ctx);
    case 'mixer':
      switch (t.control) {
        case 'volume': return mixer(p, ctx, t.owner, { volumeDb: faderToDb(value) });
        case 'pan': return mixer(p, ctx, t.owner, { pan: knobToPan(value) });
        case 'mute': return mixer(p, ctx, t.owner, { mute: on(value) });
        case 'solo': return mixer(p, ctx, t.owner, { solo: on(value) });
      }
  }
}

function toggleMixer(p: Project, ctx: EditContext, t: Extract<MidiTarget, { kind: 'mixer' | 'send' }>): Project {
  if (t.kind === 'send') {
    const track = p.track(t.owner);
    if (!track) return p;
    return setSend(t.owner, t.bus, track.send(t.bus) > SEND_OFF_DB ? SEND_OFF_DB : 0).apply(p, ctx);
  }
  const m = t.owner === MASTER ? p.master : p.track(t.owner)?.mixer;
  if (!m) return p;
  switch (t.control) {
    case 'volume': return mixer(p, ctx, t.owner, { volumeDb: m.volumeDb > SILENT_DB ? SILENT_DB : 0 });
    case 'pan': return mixer(p, ctx, t.owner, { pan: 0 });
    case 'mute': return mixer(p, ctx, t.owner, { mute: !m.mute });
    case 'solo': return mixer(p, ctx, t.owner, { solo: !m.solo });
  }
}

/** The mixer of a track or of the master (which has only volume and mute); an equal value changes nothing. */
function mixer(p: Project, ctx: EditContext, owner: MidiTarget['owner'], patch: Partial<MixerSettings>): Project {
  if (owner === MASTER) {
    const { volumeDb, mute } = patch;
    patch = { ...(volumeDb !== undefined ? { volumeDb } : {}), ...(mute !== undefined ? { mute } : {}) };
  }
  const current = owner === MASTER ? p.master : p.track(owner)?.mixer;
  if (!current || Object.entries(patch).every(([k, v]) => current[k as keyof MixerSettings] === v)) return p;
  return owner === MASTER ? setMasterMixer(patch).apply(p, ctx) : setMixer(owner, patch).apply(p, ctx);
}
