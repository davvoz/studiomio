/* "Drum Machine": 16 pads, one per note from C1 (36) up as in Live's Drum Rack, each with
 * a sound chosen among the models (kick, snare, hi-hat…) and its controls. The models are
 * synthesized by the DSP, in drums-core.ts; the "Sample" model instead plays an audio file of the
 * project, loaded on the pad. A pad can also play a whole instrument (Kick, Snare, Hat and
 * Cymbals), like a Drum Rack pad with an instrument inside: its parameters sit among those
 * of the Drum Machine, with the pad and the instrument in front ("p3.kick.decay"), and exist only when
 * the pad plays that instrument. Here is the description (parameters, default kit, presets). */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection, ParamSpec } from '../../params';
import { CYMBALS, PIECES } from '../cymbals/cymbals';
import { KICK, ROOT_NOTE as KICK_ROOT } from '../kick/kick';
import { ROOT_NOTE as SNARE_ROOT, SNARE } from '../snare/snare';

export const DRUM_PADS = 16;
/** The first pad's note: C1, as in Live. */
export const FIRST_PAD_NOTE = 36;

/** A pad's longest decay: enough for a riser or a cymbal left ringing (at
 *  most a Sample pad plays the whole file). */
export const MAX_DECAY = 12;

/** A sound model. The values are those the pad takes when it's chosen; `tone` and
 *  `snap` have a meaning per model, written in `hint`. */
export interface DrumModel {
  readonly id: string;
  readonly label: string;
  readonly decay: number;
  readonly tone: number;
  readonly snap: number;
  readonly hint: string;
}

/** The models, in the order of the parameter's values (the engine looks them up by `id`). */
export const DRUM_MODELS: readonly DrumModel[] = [
  { id: 'kick', label: 'Kick', decay: 0.45, tone: 30, snap: 45, hint: 'Tone: saturation · Snap: attack hit' },
  { id: 'boom', label: '808 kick', decay: 1.4, tone: 15, snap: 30, hint: 'Tone: saturation · Snap: pitch drop' },
  { id: 'snare', label: 'Snare', decay: 0.28, tone: 55, snap: 60, hint: 'Tone: brightness · Snap: how much snare wire' },
  { id: 'clap', label: 'Clap', decay: 0.3, tone: 45, snap: 60, hint: 'Tone: filter · Snap: strength of the first hits' },
  { id: 'rim', label: 'Rimshot', decay: 0.06, tone: 50, snap: 40, hint: 'Tone: brightness · Snap: click' },
  { id: 'hatClosed', label: 'Closed hi-hat', decay: 0.07, tone: 55, snap: 25, hint: 'Tone: brightness · Snap: noise' },
  { id: 'hatOpen', label: 'Open hi-hat', decay: 0.5, tone: 55, snap: 25, hint: 'Tone: brightness · Snap: noise' },
  { id: 'cymbal', label: 'Cymbal', decay: 2, tone: 50, snap: 40, hint: 'Tone: brightness · Snap: noise' },
  { id: 'tom', label: 'Tom', decay: 0.4, tone: 25, snap: 35, hint: 'Tone: skin (noise) · Snap: pitch drop' },
  { id: 'cowbell', label: 'Cowbell', decay: 0.35, tone: 50, snap: 50, hint: 'Tone: filter · Snap: attack' },
  { id: 'shaker', label: 'Shaker', decay: 0.09, tone: 65, snap: 50, hint: 'Tone: brightness · Snap: fast attack' },
  { id: 'sample', label: 'Sample', decay: MAX_DECAY, tone: 50, snap: 0, hint: 'Decay: shortens · Tone: ◂ low-pass, ▸ high-pass · Snap: saturates' },
  // the instruments: after the others, so the values of the earlier models don't change
  { id: 'kickInst', label: 'Kick', decay: 0.45, tone: 30, snap: 45, hint: 'The Kick instrument, with all its layers' },
  { id: 'snareInst', label: 'Snare', decay: 0.28, tone: 55, snap: 60, hint: 'The Snare instrument, with all its layers' },
  {
    id: 'cymbalsInst', label: 'Hats and Cymbals', decay: 0.5, tone: 55, snap: 25,
    hint: 'The pad plays the chosen piece. For the open hi-hat: copy the pad (Ctrl + drag), choose the other piece and put the two pads in the same Choke',
  },
];

/** Model by id, in the order of the values. */
export const MODEL = Object.fromEntries(DRUM_MODELS.map((m, i) => [m.id, i])) as Readonly<Record<string, number>>;

/** The instruments a pad can play, by model id: the type and the note the pad plays it
 *  with (for Hat and Cymbals that of the chosen piece). */
export interface PadInstrument {
  readonly type: DeviceType;
  note(piece: number): number;
}

export const PAD_INSTRUMENTS: Readonly<Record<string, PadInstrument>> = {
  kickInst: { type: KICK, note: () => KICK_ROOT },
  snareInst: { type: SNARE, note: () => SNARE_ROOT },
  cymbalsInst: { type: CYMBALS, note: piece => PIECES[piece]?.note ?? PIECES[0].note },
};

/** A model's instrument, if it's an instrument. */
export const padInstrument = (model: number): PadInstrument | undefined => PAD_INSTRUMENTS[DRUM_MODELS[model]?.id];

/** The models that aren't instruments: only they have the pad's pitch, decay, tone and snap. */
const VOICE_MODELS = DRUM_MODELS.flatMap((m, i) => (PAD_INSTRUMENTS[m.id] ? [] : [i]));

/** In front of the parameters (and the sample slots) of instrument `type` of pad `index`: "p3.kick.". */
export const innerPrefix = (index: number, type: string): string => `p${index + 1}.${type}.`;

/** Pad, instrument and parameter (or slot) of an id with the prefix; null if it doesn't have one. */
export function splitInner(id: string): { pad: number; type: string; inner: string } | null {
  const m = /^p(\d+)\.(\w+)\.(.+)$/.exec(id);
  const pad = m ? Number(m[1]) - 1 : -1;
  return m && pad >= 0 && pad < DRUM_PADS ? { pad, type: m[2], inner: m[3] } : null;
}

/** "Choke" groups: a pad stops the others of its group (the closed hi-hat stops the open one). */
export const CHOKE_GROUPS = ['—', '1', '2'] as const;

/** A pad, with the values already validated. */
export interface DrumPad {
  readonly model: number;
  readonly tune: number;
  readonly decay: number;
  readonly tone: number;
  readonly snap: number;
  readonly level: number;
  readonly pan: number;
  readonly choke: number;
  /** Only for Samples: where it starts (fraction of the file, 0..1 in percent) and whether reversed. */
  readonly start: number;
  readonly reverse: number;
  /** Only for Hat and Cymbals: the piece the pad plays (index into PIECES). */
  readonly piece: number;
}

export type PadKey = keyof DrumPad;

/** The id of parameter `key` of pad `index` (from 0): "p1model", "p12decay"… */
export const padParam = (index: number, key: PadKey): string => `p${index + 1}${key}`;

export const padNote = (index: number): number => FIRST_PAD_NOTE + index;

/** The sample slot of pad `index` (from 0) among the device's samples: "p1", "p12"… */
export const padSlot = (index: number): string => `p${index + 1}`;

/** The pad of a sample slot, or −1. */
export const padOfSlot = (slot: string): number => {
  const m = /^p(\d+)$/.exec(slot);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 0 && i < DRUM_PADS ? i : -1;
};

/** The pad of a note, or −1 if the note has none. */
export const padOfNote = (pitch: number): number => {
  const i = pitch - FIRST_PAD_NOTE;
  return i >= 0 && i < DRUM_PADS ? i : -1;
};

/** The pads from the parameter values (complete, as resolveParams gives them). */
export const padsOf = (values: Readonly<Record<string, number>>): DrumPad[] =>
  Array.from({ length: DRUM_PADS }, (_, i) => ({
    model: values[padParam(i, 'model')],
    tune: values[padParam(i, 'tune')],
    decay: values[padParam(i, 'decay')],
    tone: values[padParam(i, 'tone')],
    snap: values[padParam(i, 'snap')],
    level: values[padParam(i, 'level')],
    pan: values[padParam(i, 'pan')],
    choke: values[padParam(i, 'choke')],
    start: values[padParam(i, 'start')],
    reverse: values[padParam(i, 'reverse')],
    piece: values[padParam(i, 'piece')],
  }));

/** The pad names: the model's, numbered if the same model is on several pads (Tom 1, Tom 2…);
 *  Sample pads take the name of their sample. */
export function padNames(values: Readonly<Record<string, number>>, samples: ReadonlyMap<string, string> = new Map()): string[] {
  const labels = padsOf(values).map((p, i) =>
    (p.model === MODEL.sample ? samples.get(padSlot(i)) : undefined)
    ?? (p.model === MODEL.cymbalsInst ? PIECES[p.piece]?.label : undefined)
    ?? DRUM_MODELS[p.model]?.label ?? '?');
  const seen = new Map<string, number>();
  return labels.map(label => {
    if (labels.filter(x => x === label).length < 2) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${label} ${n}`;
  });
}

/** A kit pad: the model and only what changes compared to the model's values. */
interface KitPad {
  readonly model: string;
  readonly tune?: number;
  readonly decay?: number;
  readonly tone?: number;
  readonly snap?: number;
  readonly level?: number;
  readonly pan?: number;
  readonly choke?: number;
  readonly start?: number;
  readonly reverse?: number;
  readonly piece?: number;
}

/** The starting kit, on the notes of the General MIDI map where possible (36 kick, 38 snare,
 *  42 closed hi-hat, 46 open…), so drum parts written elsewhere play right. */
const DEFAULT_KIT: readonly KitPad[] = [
  { model: 'kick' },
  { model: 'rim', level: -4 },
  { model: 'snare', level: -2 },
  { model: 'clap', level: -3 },
  { model: 'snare', tune: 4, tone: 75, snap: 80, decay: 0.16, level: -3 },
  { model: 'tom', tune: -5, pan: -30, level: -3 },
  { model: 'hatClosed', choke: 1, pan: 15, level: -6 },
  { model: 'tom', pan: -10, level: -3 },
  { model: 'shaker', pan: -20, level: -8 },
  { model: 'tom', tune: 5, pan: 10, level: -3 },
  { model: 'hatOpen', choke: 1, pan: 15, level: -7 },
  { model: 'cowbell', pan: 20, level: -8 },
  { model: 'boom', level: -2 },
  { model: 'cymbal', level: -9, pan: -15 },
  { model: 'tom', tune: 9, pan: 30, level: -3 },
  { model: 'cymbal', tune: 5, decay: 2.8, tone: 75, snap: 15, level: -11, pan: 25 },
];

/** The complete values of a kit pad. */
const resolveKitPad = (k: KitPad): DrumPad => {
  const m = DRUM_MODELS[MODEL[k.model]];
  return {
    model: MODEL[k.model], tune: k.tune ?? 0, decay: k.decay ?? m.decay, tone: k.tone ?? m.tone, snap: k.snap ?? m.snap,
    level: k.level ?? 0, pan: k.pan ?? 0, choke: k.choke ?? 0, start: k.start ?? 0, reverse: k.reverse ?? 0,
    piece: k.piece ?? 0,
  };
};

/** The parameters of a kit (16 pads), to use as a preset. */
const kitParams = (kit: readonly KitPad[]): Record<string, number> =>
  Object.fromEntries(kit.flatMap((k, i) => Object.entries(resolveKitPad(k)).map(([key, v]) => [padParam(i, key as PadKey), v])));

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', { step: 1, ...extra });

/** A pad's parameters, with the starting kit's defaults. */
function padSection(i: number): ParamSection {
  const d = resolveKitPad(DEFAULT_KIT[i]);
  const id = (key: PadKey) => padParam(i, key);
  const choke: ChoiceParam = { kind: 'choice', id: id('choke'), label: 'Choke', options: CHOKE_GROUPS, default: d.choke };
  const sampleOnly = { when: { param: id('model'), is: MODEL.sample } };
  const voice = { when: { param: id('model'), is: VOICE_MODELS } };
  const reverse: ChoiceParam = { kind: 'choice', id: id('reverse'), label: 'Direction', options: ['Forward', 'Backward'], default: d.reverse, ...sampleOnly };
  const piece: ChoiceParam = {
    kind: 'choice', id: id('piece'), label: 'Piece', options: PIECES.map(p => p.label), default: d.piece,
    when: { param: id('model'), is: MODEL.cymbalsInst },
  };
  return {
    label: `Pad ${i + 1}`,
    params: [
      { kind: 'choice', id: id('model'), label: 'Sound', options: DRUM_MODELS.map(m => m.label), default: d.model },
      num(id('tune'), 'Pitch', -24, 24, d.tune, 'st', { step: 1, ...voice }),
      num(id('decay'), 'Decay', 0.01, MAX_DECAY, d.decay, 's', { scale: 'log', ...voice }),
      // to the hundredth of a percent: to slice a loop of a few seconds you need the millisecond
      num(id('start'), 'Start', 0, 100, d.start, '%', { step: 0.01, ...sampleOnly }),
      reverse,
      percent(id('tone'), 'Tone', d.tone, voice),
      percent(id('snap'), 'Snap', d.snap, voice),
      piece,
      num(id('level'), 'Level', -36, 6, d.level, 'dB', { step: 0.5 }),
      num(id('pan'), 'Pan', -100, 100, d.pan, 'pan', { step: 1 }),
      choke,
    ],
  };
}

/** A parameter of a pad's instrument: with the prefix, also in its condition. */
const innerSpec = (prefix: string, p: ParamSpec): ParamSpec =>
  ({ ...p, id: prefix + p.id, ...(p.when ? { when: { ...p.when, param: prefix + p.when.param } } : {}) });

/** The sections of the instruments of pad `index`: each exists only when the pad plays that instrument. */
const innerSections = (i: number): ParamSection[] =>
  Object.entries(PAD_INSTRUMENTS).flatMap(([model, { type }]) => type.sections.map(s => ({
    label: `Pad ${i + 1} · ${type.label} · ${s.label}`,
    when: { param: padParam(i, 'model'), is: MODEL[model] },
    params: s.params.map(p => innerSpec(innerPrefix(i, type.type), p)),
  })));

/** The parameters of a preset of the pad's instrument, with the prefix (the others go back to their
 *  defaults, as when choosing the preset on the instrument). */
export function innerPresetParams(index: number, type: DeviceType, preset: Preset): Record<string, number> {
  const prefix = innerPrefix(index, type.type);
  return Object.fromEntries(type.sections.flatMap(s => s.params.map(p => [prefix + p.id, preset.params[p.id] ?? p.default])));
}

/** A kit pad with an instrument: the preset of the instrument it starts from and the values it
 *  changes (without prefix; for Hat and Cymbals with the piece: "closedDecay"…). */
interface KitInstrumentPad extends KitPad {
  readonly preset?: string;
  readonly inner?: Readonly<Record<string, number>>;
}

/** Preset `name` of `type` on pad `index`, with the values `changes`. A wrong name is a
 *  mistake of whoever writes the kits: it stops right away (and the tests see it). */
function innerPreset(index: number, type: DeviceType, name: string, changes: Readonly<Record<string, number>> = {}): Record<string, number> {
  const preset = type.presets.find(p => p.name === name);
  if (!preset) throw new Error(`${type.label}: no preset "${name}"`);
  const prefix = innerPrefix(index, type.type);
  for (const id of Object.keys(changes)) if (!type.sections.some(s => s.params.some(p => p.id === id))) throw new Error(`${type.label}: no parameter "${id}"`);
  return { ...innerPresetParams(index, type, preset), ...Object.fromEntries(Object.entries(changes).map(([id, v]) => [prefix + id, v])) };
}

/** A kit: the starting one with these pads in place of its own; those with an instrument also carry
 *  the instrument's parameters. */
function instrumentKit(changes: Readonly<Record<number, KitInstrumentPad>>): Record<string, number> {
  const kit = DEFAULT_KIT.map((k, i) => changes[i] ?? k);
  const inner = Object.entries(changes).map(([i, c]) => {
    const instrument = PAD_INSTRUMENTS[c.model];
    return instrument ? innerPreset(Number(i), instrument.type, c.preset ?? 'Init', c.inner) : {};
  });
  return Object.assign(kitParams(kit), ...inner);
}

/* The kits made with the instruments. The pads sit on the General MIDI notes: 36 kick, 37 side stick,
 * 38 snare, 39 clap, 40 second snare, 42 closed hat, 44 pedal hat, 46 open hat, 48 second
 * kick, 49 crash, 51 ride. The hi-hats are in the same choke group. The notes of the kicks and the
 * snares are indices into their scales: for the kick 4 = E0, 5 = F0; for the snare 7 = E2. */

/** 909 and 808 Kick, Snare and hi-hats, the rest like the starting kit. */
const STRUMENTI = instrumentKit({
  0: { model: 'kickInst', preset: '909' },
  2: { model: 'snareInst', preset: '909' },
  6: { model: 'cymbalsInst', preset: '808', piece: 0, choke: 1, inner: { volume: 4 } },
  10: { model: 'cymbalsInst', preset: '808', piece: 2, choke: 1, inner: { volume: 4 } },
});

/** Rave: kick with the rumble in E, snare with the room, dry hi-hats, a second harder kick. */
const RAVE = instrumentKit({
  0: { model: 'kickInst', preset: 'Rumble', inner: { note: 4, rumble: 70, rumbleTime: 1.4 } },
  1: { model: 'rim', tone: 65, level: -6 },
  2: { model: 'snareInst', preset: 'Techno', level: -3, inner: { note: 7, room: 45, roomTime: 1.3 } },
  3: { model: 'clap', decay: 0.4, snap: 75, level: -3 },
  4: { model: 'snareInst', preset: 'Rimshot', level: -4, inner: { note: 14, roomOn: 1, room: 30, roomTime: 0.8 } },
  6: { model: 'cymbalsInst', preset: 'Dry techno', piece: 0, choke: 1, pan: 10 },
  8: { model: 'cymbalsInst', preset: 'Dry techno', piece: 1, choke: 1, pan: 10, level: 4 },
  10: { model: 'cymbalsInst', preset: 'Dry techno', piece: 2, choke: 1, pan: 10, inner: { openDecay: 0.4 } },
  12: { model: 'kickInst', preset: 'Industrial', inner: { note: 4, decay: 0.3, tailDecay: 0.6 } },
  13: { model: 'cymbalsInst', preset: 'Dry techno', piece: 3, pan: -20 },
  15: { model: 'cymbalsInst', preset: 'Dry techno', piece: 4, pan: 25 },
});

/** Industrial: everything saturated, ring metals, dirty snare in the big room. */
const INDUSTRIALE = instrumentKit({
  0: { model: 'kickInst', preset: 'Industrial', inner: { note: 2 } },
  1: { model: 'snareInst', preset: 'Rimshot', level: -5, inner: { drive: 50, driveType: 1, grain: 40 } },
  2: { model: 'snareInst', preset: 'Industrial' },
  3: { model: 'clap', decay: 0.5, snap: 85, tone: 35, level: -2 },
  4: { model: 'snareInst', preset: 'Lo-fi', level: -3, inner: { note: 3, grain: 90, drive: 60 } },
  5: { model: 'tom', tune: -9, snap: 60, pan: -30, level: -3 },
  6: { model: 'cymbalsInst', preset: 'Industrial', piece: 0, choke: 1, pan: 15 },
  7: { model: 'tom', tune: -5, snap: 60, pan: -10, level: -3 },
  8: { model: 'cymbalsInst', preset: 'Industrial', piece: 1, choke: 1, pan: 15 },
  9: { model: 'tom', tune: -1, snap: 60, pan: 10, level: -3 },
  10: { model: 'cymbalsInst', preset: 'Industrial', piece: 2, choke: 1, pan: 15 },
  12: { model: 'kickInst', preset: 'Rumble', inner: { note: 2, rumbleDrive: 90, rumbleTone: 100, driveType: 1 } },
  13: { model: 'cymbalsInst', preset: 'Industrial', piece: 3, pan: -25, level: -3 },
  15: { model: 'cymbalsInst', preset: 'Industrial', piece: 4, pan: 30 },
});

/** 808: long kicks (the second lower, as a bass), 808 snare and hi-hats, clap and cowbell. */
const OTTO = instrumentKit({
  0: { model: 'kickInst', preset: 'Long 808' },
  2: { model: 'snareInst', preset: '808', level: 2 },
  3: { model: 'clap', decay: 0.4, snap: 70, level: -2 },
  4: { model: 'snareInst', preset: '808', level: -3, inner: { note: 12, decay: 0.1, wiresDecay: 0.08 } },
  6: { model: 'cymbalsInst', preset: '808', piece: 0, choke: 1, pan: 15, inner: { volume: 6 } },
  8: { model: 'cymbalsInst', preset: '808', piece: 1, choke: 1, pan: 15, level: 4, inner: { volume: 6 } },
  10: { model: 'cymbalsInst', preset: '808', piece: 2, choke: 1, pan: 15, inner: { volume: 6 } },
  11: { model: 'cowbell', level: -6, pan: 20 },
  12: { model: 'kickInst', preset: 'Long 808', inner: { note: 2, tailDecay: 3.5, tailDrive: 30 } },
  13: { model: 'cymbalsInst', preset: '808', piece: 3, pan: -15, inner: { volume: 6 } },
  15: { model: 'cymbalsInst', preset: '808', piece: 4, pan: 25, inner: { volume: 6 } },
});

/** Acoustic: skin kick and snare, side stick, real cymbals with the room. */
const ACUSTICA = instrumentKit({
  0: { model: 'kickInst', preset: 'Acoustic', inner: { volume: -1 } },
  1: { model: 'snareInst', preset: 'Rimshot', level: -2, inner: { note: 12, wiresLevel: 0, roomOn: 1, room: 20, roomTime: 0.5 } },
  2: { model: 'snareInst', preset: 'Acoustic', level: 2 },
  4: { model: 'snareInst', preset: 'Large room', level: -2 },
  6: { model: 'cymbalsInst', preset: 'Acoustic', piece: 0, choke: 1, pan: 20, inner: { volume: 0 } },
  8: { model: 'cymbalsInst', preset: 'Acoustic', piece: 1, choke: 1, pan: 20, level: 5, inner: { volume: 0 } },
  10: { model: 'cymbalsInst', preset: 'Acoustic', piece: 2, choke: 1, pan: 20, inner: { volume: 0 } },
  12: { model: 'kickInst', preset: 'Acoustic', inner: { note: 7, decay: 0.25, volume: -2 } },
  13: { model: 'cymbalsInst', preset: 'Acoustic', piece: 3, pan: -30, level: -2, inner: { volume: 0 } },
  15: { model: 'cymbalsInst', preset: 'Acoustic', piece: 4, pan: 30, level: 4, inner: { volume: 0 } },
});

/** Lo-fi: everything grainy and dark, as from an old sampler. */
const LOFI = instrumentKit({
  0: { model: 'kickInst', preset: 'Dry', inner: { drive: 40, driveType: 0, lowCut: 35, snapTone: 2200 } },
  2: { model: 'snareInst', preset: 'Lo-fi', level: -3 },
  3: { model: 'clap', tone: 30, level: -4 },
  4: { model: 'snareInst', preset: 'Lo-fi', level: -5, inner: { note: 12, grain: 90, roomOn: 1, room: 25 } },
  6: { model: 'cymbalsInst', preset: 'Lo-fi', piece: 0, choke: 1, pan: 10 },
  8: { model: 'shaker', tone: 40, level: -8, pan: -20 },
  10: { model: 'cymbalsInst', preset: 'Lo-fi', piece: 2, choke: 1, pan: 10 },
  12: { model: 'kickInst', preset: 'Deep', inner: { drive: 30, lowCut: 30 } },
  15: { model: 'cymbalsInst', preset: 'Lo-fi', piece: 4, pan: 25 },
});

/** House: round kick, 909 snare and hats, clap, the ride on top. */
const HOUSE = instrumentKit({
  0: { model: 'kickInst', preset: 'House' },
  2: { model: 'snareInst', preset: '909' },
  3: { model: 'clap', decay: 0.35, snap: 70, level: -2 },
  4: { model: 'snareInst', preset: 'Electric', level: -4 },
  6: { model: 'cymbalsInst', preset: '909', piece: 0, choke: 1, pan: 15 },
  8: { model: 'cymbalsInst', preset: '909', piece: 1, choke: 1, pan: 15, level: 4 },
  10: { model: 'cymbalsInst', preset: '909', piece: 2, choke: 1, pan: 15 },
  12: { model: 'kickInst', preset: '909' },
  13: { model: 'cymbalsInst', preset: '909', piece: 3, pan: -20 },
  15: { model: 'cymbalsInst', preset: '909', piece: 4, pan: 25 },
});

/** Dub techno: soft kick with the rumble, rim in the long room, wide dark hats. */
const DUB = instrumentKit({
  0: { model: 'kickInst', preset: 'Dub techno' },
  1: { model: 'snareInst', preset: 'Rimshot', level: -3, inner: { roomOn: 1, room: 50, roomTime: 2.5, roomTone: 4000 } },
  2: { model: 'snareInst', preset: 'Large room', level: -3, inner: { room: 70, roomTime: 2.5 } },
  3: { model: 'clap', decay: 0.5, tone: 35, level: -6 },
  6: { model: 'cymbalsInst', preset: 'Dub', piece: 0, choke: 1, pan: 20 },
  8: { model: 'shaker', tone: 40, level: -10, pan: -25 },
  10: { model: 'cymbalsInst', preset: 'Dub', piece: 2, choke: 1, pan: 20 },
  12: { model: 'kickInst', preset: 'Deep' },
  13: { model: 'cymbalsInst', preset: 'Dub', piece: 3, pan: -25 },
  15: { model: 'cymbalsInst', preset: 'Dub', piece: 4, pan: 30, level: 4 },
});

/** Breakbeat: dry breaks kick and snare, a soft ghost snare, real cymbals. */
const BREAKBEAT = instrumentKit({
  0: { model: 'kickInst', preset: 'Breakbeat' },
  2: { model: 'snareInst', preset: 'Breakbeat' },
  4: { model: 'snareInst', preset: 'Breakbeat', level: -9, inner: { note: 14, snapLevel: 30 } },
  6: { model: 'cymbalsInst', preset: 'Acoustic', piece: 0, choke: 1, pan: 20, inner: { volume: 0 } },
  8: { model: 'cymbalsInst', preset: 'Acoustic', piece: 1, choke: 1, pan: 20, level: 4, inner: { volume: 0 } },
  10: { model: 'cymbalsInst', preset: 'Acoustic', piece: 2, choke: 1, pan: 20, inner: { volume: 0 } },
  12: { model: 'kickInst', preset: 'Acoustic', inner: { volume: -2 } },
  13: { model: 'cymbalsInst', preset: 'Acoustic', piece: 3, pan: -30, inner: { volume: 0 } },
  15: { model: 'cymbalsInst', preset: 'Acoustic', piece: 4, pan: 30, level: 4, inner: { volume: 0 } },
});

/** Trap: the long 808 acting as bass, high snare in the room, very short hats. */
const TRAP = instrumentKit({
  0: { model: 'kickInst', preset: 'Long 808', inner: { note: 7, tailDecay: 3, tailDrive: 25 } },
  2: { model: 'snareInst', preset: 'Trap' },
  3: { model: 'clap', decay: 0.3, snap: 80, level: -2 },
  6: { model: 'cymbalsInst', preset: 'Trap', piece: 0, choke: 1, pan: 10 },
  8: { model: 'cymbalsInst', preset: 'Trap', piece: 1, choke: 1, pan: 10, level: 4 },
  10: { model: 'cymbalsInst', preset: 'Trap', piece: 2, choke: 1, pan: 10 },
  12: { model: 'kickInst', preset: 'Long 808', inner: { note: 12, tailDecay: 2 } },
  13: { model: 'cymbalsInst', preset: 'Trap', piece: 3, pan: -20 },
});

/** Minimal: everything short and small, clicks and metal. */
const MINIMAL = instrumentKit({
  0: { model: 'kickInst', preset: 'Minimal', inner: { volume: 1 } },
  1: { model: 'rim', tone: 70, level: -5 },
  2: { model: 'snareInst', preset: 'Electric', inner: { wiresLevel: 30, decay: 0.07 } },
  6: { model: 'cymbalsInst', preset: 'Minimal', piece: 0, choke: 1, pan: -10 },
  8: { model: 'shaker', tone: 70, level: -9, pan: 20 },
  10: { model: 'cymbalsInst', preset: 'Minimal', piece: 2, choke: 1, pan: -10 },
  12: { model: 'kickInst', preset: 'Dry' },
  15: { model: 'cymbalsInst', preset: 'Minimal', piece: 4, pan: 30 },
});

/** Electro: 808 kick with the click, electronic snare, cowbell and 808 hats. */
const ELECTRO = instrumentKit({
  0: { model: 'kickInst', preset: 'Electro', inner: { volume: -3 } },
  2: { model: 'snareInst', preset: 'Electric', level: 2 },
  3: { model: 'clap', decay: 0.4, snap: 70, level: -2 },
  6: { model: 'cymbalsInst', preset: '808', piece: 0, choke: 1, pan: 15, inner: { volume: 6 } },
  10: { model: 'cymbalsInst', preset: '808', piece: 2, choke: 1, pan: 15, inner: { volume: 6 } },
  11: { model: 'cowbell', level: -5, pan: 20 },
  12: { model: 'kickInst', preset: 'Long 808', inner: { note: 2 } },
  13: { model: 'cymbalsInst', preset: '808', piece: 3, pan: -15, inner: { volume: 6 } },
});

/** Dry kit: short decays, tight kick, no tail. */
const TIGHT: readonly KitPad[] = DEFAULT_KIT.map(k => {
  const m = DRUM_MODELS[MODEL[k.model]];
  return { ...k, decay: (k.decay ?? m.decay) * 0.55, snap: Math.min(100, (k.snap ?? m.snap) + 15) };
});

/** "808" kit: long kicks, clap and cowbell up front, darker hi-hats. */
const EIGHT_O_EIGHT: readonly KitPad[] = DEFAULT_KIT.map((k, i) => {
  const changes: Readonly<Record<number, KitPad>> = {
    0: { model: 'boom', decay: 0.9, snap: 40, level: -1 },
    2: { model: 'snare', tone: 40, snap: 45, decay: 0.18, level: -3 },
    3: { model: 'clap', decay: 0.4, snap: 70, level: -2 },
    6: { model: 'hatClosed', tone: 40, choke: 1, pan: 15, level: -6 },
    10: { model: 'hatOpen', tone: 40, decay: 0.7, choke: 1, pan: 15, level: -7 },
    11: { model: 'cowbell', level: -6, pan: 20 },
    12: { model: 'boom', tune: -5, decay: 2.5, level: -2 },
  };
  return changes[i] ?? k;
});

const PRESETS: readonly Preset[] = [
  { name: 'Init', params: {} },
  { name: '808', params: kitParams(EIGHT_O_EIGHT) },
  { name: 'Dry', params: kitParams(TIGHT) },
  { name: 'Instruments', params: STRUMENTI },
  { name: 'Rave', params: RAVE },
  { name: 'Industrial', params: INDUSTRIALE },
  { name: '808 instruments', params: OTTO },
  { name: 'Acoustic', params: ACUSTICA },
  { name: 'Lo-fi', params: LOFI },
  { name: 'House', params: HOUSE },
  { name: 'Dub techno', params: DUB },
  { name: 'Breakbeat', params: BREAKBEAT },
  { name: 'Trap', params: TRAP },
  { name: 'Minimal', params: MINIMAL },
  { name: 'Electro', params: ELECTRO },
];

export const DRUMS: DeviceType = {
  type: 'drums',
  label: 'Drum Machine',
  sections: [
    ...Array.from({ length: DRUM_PADS }, (_, i) => padSection(i)),
    { label: 'Output', params: [percent('velocity', 'Velocity', 70), num('volume', 'Volume', -36, 6, -4, 'dB', { step: 0.5 })] },
    ...Array.from({ length: DRUM_PADS }, (_, i) => innerSections(i)).flat(),
  ],
  presets: PRESETS,
  kit: true,
  noteNames: (values, samples) => new Map(padNames(values, samples).map((name, i) => [padNote(i), name])),
};

/** The values a pad takes when its model is changed: the model's, the rest stays. */
export const modelDefaults = (index: number, model: number): Record<string, number> => {
  const m = DRUM_MODELS[model];
  return { [padParam(index, 'model')]: model, [padParam(index, 'decay')]: m.decay, [padParam(index, 'tone')]: m.tone, [padParam(index, 'snap')]: m.snap };
};
