/* Il MIDI di un controller qualsiasi sulle macro, sui parametri e sul mixer: dare un controllo
 * a un bersaglio e muoverlo. Un CC (manopola, fader) porta il bersaglio al punto della sua corsa:
 * il volume come il fader di Live (0 dB all'85%), il pan con il centro a 64, mute, solo,
 * interruttori e pulsanti accesi da 64 in su. Una nota fa come un tasto del computer (vedi
 * key-edits): un interruttore o un menu cambia, una manopola salta da un capo all'altro, una
 * macro pulsante resta accesa finché la nota suona; sul mixer mute e solo cambiano, il volume
 * passa da 0 dB a −∞ e ritorno, una mandata da chiusa a 0 dB, il pan torna al centro. */
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

/** Il valore più alto di un CC. */
const CC_MAX = 127;

/** Dà un controllo MIDI a un bersaglio (null: lo toglie). */
export const setMidi = (target: MidiTarget, control: MidiControl | null): Edit =>
  edit(control ? 'Mappa sul MIDI' : 'Togli il MIDI', p => {
    if (!p.hasMidiTarget(target)) throw new RangeError('il bersaglio del MIDI non c\'è');
    const before = controlOf(p.midiMap, target);
    if (!before && !control) return p;
    return p.updatingMidiMap(map => withControl(map, target, control));
  });

/** Un CC arrivato (0…127): i bersagli vanno al punto della loro corsa. Le macro pulsante sono
 *  di `holdMidi`, le molle di `pullMidi`. */
export const moveMidi = (control: MidiControl, value: number): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of midiTargetsOf(p.midiMap, control)) p = turn(p, ctx, t, value);
    return p;
  });

/** Una nota suonata: interruttori, manopole, parametri e mixer cambiano (un passo di annullamento). */
export const pressMidi = (control: MidiControl): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of midiTargetsOf(p.midiMap, control)) p = t.kind === 'macro' || t.kind === 'param' ? press(p, ctx, t) : toggleMixer(p, ctx, t);
    return p;
  });

/** Le macro pulsante: accese finché la nota suona o il CC sta da 64 in su; le molle tirate fino in
 *  fondo da una nota (un cambio che si disfa da solo, da applicare `transient`). */
export const holdMidi = (control: MidiControl, down: boolean, note = true): Edit =>
  edit('MIDI', (p, ctx) => {
    for (const t of midiTargetsOf(p.midiMap, control)) {
      if (t.kind !== 'macro') continue;
      const m = macroAt(p, t);
      if (m && (note || macroMode(m) === 'button')) p = hold(p, ctx, t, down);
    }
    return p;
  });

/** Un CC sulle macro molla: le porta al punto della corsa senza farne un passo di annullamento
 *  (le riporta la molla; da applicare `transient`). */
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
      // un parametro mappato su una macro lo muove la macro
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

/** Il mixer di una traccia o del master (che ha solo volume e mute); un valore uguale non cambia niente. */
function mixer(p: Project, ctx: EditContext, owner: MidiTarget['owner'], patch: Partial<MixerSettings>): Project {
  if (owner === MASTER) {
    const { volumeDb, mute } = patch;
    patch = { ...(volumeDb !== undefined ? { volumeDb } : {}), ...(mute !== undefined ? { mute } : {}) };
  }
  const current = owner === MASTER ? p.master : p.track(owner)?.mixer;
  if (!current || Object.entries(patch).every(([k, v]) => current[k as keyof MixerSettings] === v)) return p;
  return owner === MASTER ? setMasterMixer(patch).apply(p, ctx) : setMixer(owner, patch).apply(p, ctx);
}
