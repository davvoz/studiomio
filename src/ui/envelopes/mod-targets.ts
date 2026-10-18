/* Cosa si può modulare sulla traccia di una clip, per i menu dell'editor delle modulazioni:
 * il mixer (volume e pan), lo strumento e gli effetti, con i loro parametri numerici. */
import type { DeviceId } from '../../core/id';
import { paramSpec, type DeviceType } from '../../devices/device-type';
import { effectType, instrumentType } from '../../devices/registry';
import { INSTRUMENT_DEVICE, scaleKindOf, type ModScaleKind, type ModTarget } from '../../model/envelope';
import { chainItems, macroName, macroParam, rackName, type DeviceKey, type Rack } from '../../model/rack';
import { MidiTrack, type Track } from '../../model/track';

export interface TargetParam {
  readonly target: ModTarget;
  readonly label: string;
}

/** Un gruppo di parametri (una sezione del dispositivo). */
export interface TargetSection {
  readonly label: string;
  readonly params: readonly TargetParam[];
}

/** Un dispositivo della traccia, con i parametri che si possono modulare. */
export interface TargetDevice {
  /** "mixer", "instrument", l'id dell'effetto o quello del rack. */
  readonly key: string;
  readonly label: string;
  readonly sections: readonly TargetSection[];
}

const MIXER: TargetDevice = {
  key: 'mixer',
  label: 'Mixer',
  sections: [{
    label: 'Mixer',
    params: [
      { target: { kind: 'mixer', param: 'volume' }, label: 'Volume' },
      { target: { kind: 'mixer', param: 'pan' }, label: 'Pan' },
    ],
  }],
};

/** I parametri numerici di un dispositivo, sezione per sezione (le scelte non si modulano). */
function deviceTargets(key: string, label: string, type: DeviceType | undefined): TargetDevice | null {
  if (!type) return null;
  const device = key as DeviceId;
  const sections = type.sections
    .map(s => ({
      label: s.label,
      params: s.params.filter(p => p.kind === 'number' && !p.hidden).map(p => ({ target: { kind: 'device', device, param: p.id } as ModTarget, label: p.label })),
    }))
    .filter(s => s.params.length);
  return { key, label, sections };
}

/** I dispositivi della traccia, nell'ordine in cui il suono li attraversa (il mixer per primo);
 *  un rack viene prima dei suoi dispositivi, con le sue macro. */
export function targetDevices(track: Track): TargetDevice[] {
  const types = new Map<DeviceKey, { type: DeviceType | undefined; name: string }>();
  if (track instanceof MidiTrack) types.set(INSTRUMENT_DEVICE, { type: instrumentType(track.instrument.type), name: track.instrument.type });
  for (const e of track.effects) types.set(e.id, { type: effectType(e.type), name: e.type });
  const out: TargetDevice[] = [MIXER];
  const seen = new Map<string, number>();
  const device = (key: DeviceKey) => {
    const { type, name } = types.get(key)!;
    // due effetti dello stesso tipo: "Delay", "Delay 2"
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const d = deviceTargets(key, `${type?.label ?? name}${n > 1 ? ` ${n}` : ''}`, type);
    if (d) out.push(d);
  };
  for (const item of chainItems(track.chainKeys, track.racks)) {
    if (item.kind === 'device') device(item.key);
    else {
      out.push(rackTargets(item.rack, (k, param) => { const t = types.get(k)?.type; return t && paramSpec(t, param)?.label; }));
      item.rack.devices.forEach(device);
    }
  }
  return out;
}

/** Le macro di un rack (si modulano come i parametri: spostano tutti quelli mappati). */
const rackTargets = (rack: Rack, label: (device: DeviceKey, param: string) => string | undefined): TargetDevice => ({
  key: rack.id,
  label: rackName(rack),
  sections: [{
    label: 'Macro',
    params: rack.macros.map((m, i) => ({
      target: { kind: 'device', device: rack.id, param: macroParam(i) } as ModTarget,
      label: macroName(m, i, x => label(x.device, x.param)),
    })),
  }],
});

/** Il dispositivo che contiene il bersaglio. */
export const deviceKeyOf = (t: ModTarget): string => (t.kind === 'mixer' ? 'mixer' : t.device);

/** Come si scrive un valore della curva, per tipo di bersaglio. */
const FORMATS: { readonly [K in ModScaleKind]: (v: number) => string } = {
  volume: v => (v <= 0.0001 ? '0 % (−∞ dB)' : `${Math.round(v * 100)} % (${(40 * Math.log10(v)).toFixed(1)} dB)`),
  pan: v => (Math.abs(v) < 0.005 ? 'centro' : `${Math.round(Math.abs(v) * 100)} ${v < 0 ? 'L' : 'R'}`),
  param: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %`,
};

export const formatModValue = (target: ModTarget, value: number): string => FORMATS[scaleKindOf(target)](value);
