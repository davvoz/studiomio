/* "Drum Machine": 16 pad, uno per nota da C1 (36) in su come nel Drum Rack di Live, ognuno con
 * un suono scelto tra i modelli (cassa, rullante, hi-hat…) e i suoi controlli. I modelli sono
 * sintetizzati dal DSP, in drums-core.ts; il modello "Sample" suona invece un file audio del
 * progetto, caricato sul pad. Qui c'è la descrizione (parametri, kit predefinito, preset). */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection } from '../../params';

export const DRUM_PADS = 16;
/** La nota del primo pad: C1, come in Live. */
export const FIRST_PAD_NOTE = 36;

/** Il decay più lungo di un pad: abbastanza per un riser o un piatto lasciato andare (al
 *  massimo un pad Sample suona tutto il file). */
export const MAX_DECAY = 12;

/** Un modello di suono. I valori sono quelli che il pad prende quando lo si sceglie; `tone` e
 *  `snap` hanno un significato per modello, scritto in `hint`. */
export interface DrumModel {
  readonly id: string;
  readonly label: string;
  readonly decay: number;
  readonly tone: number;
  readonly snap: number;
  readonly hint: string;
}

/** I modelli, nell'ordine dei valori del parametro (il motore li cerca per `id`). */
export const DRUM_MODELS: readonly DrumModel[] = [
  { id: 'kick', label: 'Cassa', decay: 0.45, tone: 30, snap: 45, hint: 'Tono: saturazione · Snap: colpo d\'attacco' },
  { id: 'boom', label: 'Cassa 808', decay: 1.4, tone: 15, snap: 30, hint: 'Tono: saturazione · Snap: caduta d\'intonazione' },
  { id: 'snare', label: 'Rullante', decay: 0.28, tone: 55, snap: 60, hint: 'Tono: brillantezza · Snap: quanta cordiera' },
  { id: 'clap', label: 'Clap', decay: 0.3, tone: 45, snap: 60, hint: 'Tono: filtro · Snap: forza dei colpi iniziali' },
  { id: 'rim', label: 'Rimshot', decay: 0.06, tone: 50, snap: 40, hint: 'Tono: brillantezza · Snap: click' },
  { id: 'hatClosed', label: 'Hi-hat chiuso', decay: 0.07, tone: 55, snap: 25, hint: 'Tono: brillantezza · Snap: rumore' },
  { id: 'hatOpen', label: 'Hi-hat aperto', decay: 0.5, tone: 55, snap: 25, hint: 'Tono: brillantezza · Snap: rumore' },
  { id: 'cymbal', label: 'Piatto', decay: 2, tone: 50, snap: 40, hint: 'Tono: brillantezza · Snap: rumore' },
  { id: 'tom', label: 'Tom', decay: 0.4, tone: 25, snap: 35, hint: 'Tono: pelle (rumore) · Snap: caduta d\'intonazione' },
  { id: 'cowbell', label: 'Campanaccio', decay: 0.35, tone: 50, snap: 50, hint: 'Tono: filtro · Snap: attacco' },
  { id: 'shaker', label: 'Shaker', decay: 0.09, tone: 65, snap: 50, hint: 'Tono: brillantezza · Snap: attacco veloce' },
  { id: 'sample', label: 'Sample', decay: MAX_DECAY, tone: 50, snap: 0, hint: 'Decay: accorcia · Tono: ◂ passa-basso, ▸ passa-alto · Snap: satura' },
];

/** Modello per id, nell'ordine dei valori. */
export const MODEL = Object.fromEntries(DRUM_MODELS.map((m, i) => [m.id, i])) as Readonly<Record<string, number>>;

/** Gruppi di "choke": un pad ferma gli altri del suo gruppo (l'hi-hat chiuso ferma l'aperto). */
export const CHOKE_GROUPS = ['—', '1', '2'] as const;

/** Un pad, con i valori già validati. */
export interface DrumPad {
  readonly model: number;
  readonly tune: number;
  readonly decay: number;
  readonly tone: number;
  readonly snap: number;
  readonly level: number;
  readonly pan: number;
  readonly choke: number;
}

export type PadKey = keyof DrumPad;

/** L'id del parametro `key` del pad `index` (da 0): "p1model", "p12decay"… */
export const padParam = (index: number, key: PadKey): string => `p${index + 1}${key}`;

export const padNote = (index: number): number => FIRST_PAD_NOTE + index;

/** Il posto del sample del pad `index` (da 0) nei sample del dispositivo: "p1", "p12"… */
export const padSlot = (index: number): string => `p${index + 1}`;

/** Il pad di un posto dei sample, o −1. */
export const padOfSlot = (slot: string): number => {
  const m = /^p(\d+)$/.exec(slot);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 0 && i < DRUM_PADS ? i : -1;
};

/** Il pad di una nota, o −1 se la nota non ne ha. */
export const padOfNote = (pitch: number): number => {
  const i = pitch - FIRST_PAD_NOTE;
  return i >= 0 && i < DRUM_PADS ? i : -1;
};

/** I pad dai valori dei parametri (completi, come li dà resolveParams). */
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
  }));

/** I nomi dei pad: quello del modello, numerato se lo stesso modello è su più pad (Tom 1, Tom 2…);
 *  i pad Sample prendono il nome del loro sample. */
export function padNames(values: Readonly<Record<string, number>>, samples: ReadonlyMap<string, string> = new Map()): string[] {
  const labels = padsOf(values).map((p, i) =>
    (p.model === MODEL.sample ? samples.get(padSlot(i)) : undefined) ?? DRUM_MODELS[p.model]?.label ?? '?');
  const seen = new Map<string, number>();
  return labels.map(label => {
    if (labels.filter(x => x === label).length < 2) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${label} ${n}`;
  });
}

/** Un pad del kit: il modello e solo ciò che cambia rispetto ai valori del modello. */
interface KitPad {
  readonly model: string;
  readonly tune?: number;
  readonly decay?: number;
  readonly tone?: number;
  readonly snap?: number;
  readonly level?: number;
  readonly pan?: number;
  readonly choke?: number;
}

/** Il kit di partenza, sulle note della mappa General MIDI dove si può (36 cassa, 38 rullante,
 *  42 hi-hat chiuso, 46 aperto…), così le parti di batteria scritte altrove suonano giuste. */
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

/** I valori completi di un pad del kit. */
const resolveKitPad = (k: KitPad): DrumPad => {
  const m = DRUM_MODELS[MODEL[k.model]];
  return {
    model: MODEL[k.model], tune: k.tune ?? 0, decay: k.decay ?? m.decay, tone: k.tone ?? m.tone, snap: k.snap ?? m.snap,
    level: k.level ?? 0, pan: k.pan ?? 0, choke: k.choke ?? 0,
  };
};

/** I parametri di un kit (16 pad), da usare come preset. */
const kitParams = (kit: readonly KitPad[]): Record<string, number> =>
  Object.fromEntries(kit.flatMap((k, i) => Object.entries(resolveKitPad(k)).map(([key, v]) => [padParam(i, key as PadKey), v])));

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number) => num(id, label, 0, 100, def, '%', { step: 1 });

/** I parametri di un pad, con i predefiniti del kit di partenza. */
function padSection(i: number): ParamSection {
  const d = resolveKitPad(DEFAULT_KIT[i]);
  const id = (key: PadKey) => padParam(i, key);
  const choke: ChoiceParam = { kind: 'choice', id: id('choke'), label: 'Choke', options: CHOKE_GROUPS, default: d.choke };
  return {
    label: `Pad ${i + 1}`,
    params: [
      { kind: 'choice', id: id('model'), label: 'Suono', options: DRUM_MODELS.map(m => m.label), default: d.model },
      num(id('tune'), 'Intonazione', -24, 24, d.tune, 'st', { step: 1 }),
      num(id('decay'), 'Decay', 0.01, MAX_DECAY, d.decay, 's', { scale: 'log' }),
      percent(id('tone'), 'Tono', d.tone),
      percent(id('snap'), 'Snap', d.snap),
      num(id('level'), 'Livello', -36, 6, d.level, 'dB', { step: 0.5 }),
      num(id('pan'), 'Pan', -100, 100, d.pan, 'pan', { step: 1 }),
      choke,
    ],
  };
}

/** Kit secco: decadimenti corti, cassa tesa, niente coda. */
const TIGHT: readonly KitPad[] = DEFAULT_KIT.map(k => {
  const m = DRUM_MODELS[MODEL[k.model]];
  return { ...k, decay: (k.decay ?? m.decay) * 0.55, snap: Math.min(100, (k.snap ?? m.snap) + 15) };
});

/** Kit "808": casse lunghe, clap e campanaccio in evidenza, hi-hat più scuri. */
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
  { name: 'Secco', params: kitParams(TIGHT) },
];

export const DRUMS: DeviceType = {
  type: 'drums',
  label: 'Drum Machine',
  sections: [
    ...Array.from({ length: DRUM_PADS }, (_, i) => padSection(i)),
    { label: 'Uscita', params: [percent('velocity', 'Velocity', 70), num('volume', 'Volume', -36, 6, -4, 'dB', { step: 0.5 })] },
  ],
  presets: PRESETS,
  noteNames: (values, samples) => new Map(padNames(values, samples).map((name, i) => [padNote(i), name])),
};

/** I valori che un pad prende quando gli si cambia modello: quelli del modello, il resto resta. */
export const modelDefaults = (index: number, model: number): Record<string, number> => {
  const m = DRUM_MODELS[model];
  return { [padParam(index, 'model')]: model, [padParam(index, 'decay')]: m.decay, [padParam(index, 'tone')]: m.tone, [padParam(index, 'snap')]: m.snap };
};
