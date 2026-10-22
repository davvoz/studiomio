/* Il MIDI di un controller qualsiasi sui controlli dell'app, come la MIDI Map di Live: una
 * manopola, un fader (CC) o un pad, un tasto (nota) muove una macro di un rack, un parametro di
 * uno strumento o di un effetto, il volume, il pan, una mandata, il mute o il solo di una traccia,
 * il volume o il mute del master. Un controllo può muoverne più d'uno; ognuno ha al più un
 * controllo. Come per la tastiera (vedi key-map): le mappature sono del progetto, quelle di
 * bersagli che non ci sono più restano scritte ma non valgono e non si salvano. Il controllo si
 * riconosce da canale e numero, da qualunque porta arrivi. */
import { asId, type TrackId } from '../core/id';
import { checkKeyMap, sameTarget, type KeyTarget } from './key-map';
import type { ChainOwner } from './project';
import type { DeviceKey } from './rack';

/** Un controllo del controller: un CC (manopola, fader) o una nota (pad, tasto). Canale 0…15. */
export interface MidiControl {
  readonly type: 'cc' | 'note';
  readonly channel: number;
  readonly number: number;
}

export type MixerControl = 'volume' | 'pan' | 'mute' | 'solo';

export type MidiTarget =
  | KeyTarget
  /** Del master solo volume e mute. */
  | { readonly kind: 'mixer'; readonly owner: ChainOwner; readonly control: MixerControl }
  | { readonly kind: 'send'; readonly owner: TrackId; readonly bus: TrackId };

export interface MidiMapping {
  readonly control: MidiControl;
  readonly target: MidiTarget;
}

export type MidiMap = readonly MidiMapping[];

/** Nessuna mappatura (sempre la stessa lista: le modifiche si riconoscono dal riferimento). */
export const NO_MIDI: MidiMap = Object.freeze([]);

export const sameControl = (a: MidiControl, b: MidiControl): boolean =>
  a.type === b.type && a.channel === b.channel && a.number === b.number;

export const sameMidiTarget = (a: MidiTarget, b: MidiTarget): boolean => {
  if (a.kind === 'mixer') return b.kind === 'mixer' && a.owner === b.owner && a.control === b.control;
  if (a.kind === 'send') return b.kind === 'send' && a.owner === b.owner && a.bus === b.bus;
  return (b.kind === 'macro' || b.kind === 'param') && sameTarget(a, b);
};

/** Il controllo di un bersaglio, o null. */
export const controlOf = (map: MidiMap, target: MidiTarget): MidiControl | null =>
  map.find(m => sameMidiTarget(m.target, target))?.control ?? null;

/** I bersagli di un controllo. */
export const midiTargetsOf = (map: MidiMap, control: MidiControl): MidiTarget[] =>
  map.filter(m => sameControl(m.control, control)).map(m => m.target);

/** Dà a un bersaglio un controllo (null: lo toglie); il controllo di prima non lo muove più. */
export function withControl(map: MidiMap, target: MidiTarget, control: MidiControl | null): MidiMap {
  const kept = map.filter(m => !sameMidiTarget(m.target, target));
  if (control === null) return kept.length === map.length ? map : kept;
  const before = controlOf(map, target);
  if (before && sameControl(before, control)) return map;
  return [...kept, { control, target }];
}

/** Toglie i controlli dei parametri di un dispositivo (es. lo strumento cambiato: i parametri sono altri). */
export const withoutParamControlsOf = (map: MidiMap, owner: ChainOwner, device: DeviceKey): MidiMap => {
  const kept = map.filter(m => m.target.kind !== 'param' || m.target.owner !== owner || m.target.device !== device);
  return kept.length === map.length ? map : kept;
};

const isKeyTarget = (t: MidiTarget): t is KeyTarget => t.kind === 'macro' || t.kind === 'param';

/** Le regole: controlli MIDI validi, macro che esistono, nessun bersaglio due volte. */
export function checkMidiMap(map: MidiMap): void {
  checkKeyMap(map.filter(m => isKeyTarget(m.target)).map(m => ({ key: midiLabel(m.control), target: m.target as KeyTarget })));
  map.forEach((m, i) => {
    const c = m.control;
    if (!(Number.isInteger(c.channel) && c.channel >= 0 && c.channel < 16 && Number.isInteger(c.number) && c.number >= 0 && c.number < 128)) {
      throw new RangeError(`controllo MIDI non valido: ${c.type} ${c.number} sul canale ${c.channel + 1}`);
    }
    if (map.findIndex(x => sameMidiTarget(x.target, m.target)) !== i) throw new Error(`${midiLabel(c)} è su un bersaglio che ha già un controllo`);
  });
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Il nome di un controllo come si mostra: "CC 7", "C3" (il Do centrale, 60, è C3 come in
 *  Live); con il canale se non è l'1: "CC 7 · 2". */
export function midiLabel(c: MidiControl): string {
  const name = c.type === 'cc' ? `CC ${c.number}` : `${NOTE_NAMES[c.number % 12]}${Math.floor(c.number / 12) - 2}`;
  return c.channel ? `${name} · ${c.channel + 1}` : name;
}

/** Il bersaglio scritto in una stringa (per il DOM: `data-midi-target`), e ritorno. */
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
