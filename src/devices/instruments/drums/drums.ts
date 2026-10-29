/* "Drum Machine": 16 pad, uno per nota da C1 (36) in su come nel Drum Rack di Live, ognuno con
 * un suono scelto tra i modelli (cassa, rullante, hi-hat…) e i suoi controlli. I modelli sono
 * sintetizzati dal DSP, in drums-core.ts; il modello "Sample" suona invece un file audio del
 * progetto, caricato sul pad. Un pad può anche suonare uno strumento intero (Kick, Snare, Hat e
 * Piatti), come un pad del Drum Rack con dentro uno strumento: i suoi parametri stanno tra quelli
 * della Drum Machine, con il pad e lo strumento davanti ("p3.kick.decay"), e ci sono solo quando
 * il pad suona quello strumento. Qui c'è la descrizione (parametri, kit predefinito, preset). */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection, ParamSpec } from '../../params';
import { CYMBALS, PIECES } from '../cymbals/cymbals';
import { KICK, ROOT_NOTE as KICK_ROOT } from '../kick/kick';
import { ROOT_NOTE as SNARE_ROOT, SNARE } from '../snare/snare';

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
  // gli strumenti: dopo gli altri, così i valori dei modelli di prima non cambiano
  { id: 'kickInst', label: 'Kick', decay: 0.45, tone: 30, snap: 45, hint: 'Lo strumento Kick, con tutti i suoi strati' },
  { id: 'snareInst', label: 'Snare', decay: 0.28, tone: 55, snap: 60, hint: 'Lo strumento Snare, con tutti i suoi strati' },
  {
    id: 'cymbalsInst', label: 'Hat e Piatti', decay: 0.5, tone: 55, snap: 25,
    hint: 'Il pad suona il pezzo scelto. Per l\'hi-hat aperto: copia il pad (Ctrl + trascina), scegli l\'altro pezzo e metti i due pad nello stesso Choke',
  },
];

/** Modello per id, nell'ordine dei valori. */
export const MODEL = Object.fromEntries(DRUM_MODELS.map((m, i) => [m.id, i])) as Readonly<Record<string, number>>;

/** Gli strumenti che un pad può suonare, per id del modello: il tipo e la nota con cui il pad lo
 *  suona (per Hat e Piatti quella del pezzo scelto). */
export interface PadInstrument {
  readonly type: DeviceType;
  note(piece: number): number;
}

export const PAD_INSTRUMENTS: Readonly<Record<string, PadInstrument>> = {
  kickInst: { type: KICK, note: () => KICK_ROOT },
  snareInst: { type: SNARE, note: () => SNARE_ROOT },
  cymbalsInst: { type: CYMBALS, note: piece => PIECES[piece]?.note ?? PIECES[0].note },
};

/** Lo strumento di un modello, se è uno strumento. */
export const padInstrument = (model: number): PadInstrument | undefined => PAD_INSTRUMENTS[DRUM_MODELS[model]?.id];

/** I modelli che non sono strumenti: solo loro hanno intonazione, decay, tono e snap del pad. */
const VOICE_MODELS = DRUM_MODELS.flatMap((m, i) => (PAD_INSTRUMENTS[m.id] ? [] : [i]));

/** Davanti ai parametri (e ai posti dei sample) dello strumento `type` del pad `index`: "p3.kick.". */
export const innerPrefix = (index: number, type: string): string => `p${index + 1}.${type}.`;

/** Pad, strumento e parametro (o posto) di un id con il prefisso; null se non ne ha uno. */
export function splitInner(id: string): { pad: number; type: string; inner: string } | null {
  const m = /^p(\d+)\.(\w+)\.(.+)$/.exec(id);
  const pad = m ? Number(m[1]) - 1 : -1;
  return m && pad >= 0 && pad < DRUM_PADS ? { pad, type: m[2], inner: m[3] } : null;
}

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
  /** Solo per i Sample: da dove parte (frazione del file, 0..1 in percento) e se al contrario. */
  readonly start: number;
  readonly reverse: number;
  /** Solo per Hat e Piatti: il pezzo che il pad suona (indice di PIECES). */
  readonly piece: number;
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
    start: values[padParam(i, 'start')],
    reverse: values[padParam(i, 'reverse')],
    piece: values[padParam(i, 'piece')],
  }));

/** I nomi dei pad: quello del modello, numerato se lo stesso modello è su più pad (Tom 1, Tom 2…);
 *  i pad Sample prendono il nome del loro sample. */
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
  readonly start?: number;
  readonly reverse?: number;
  readonly piece?: number;
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
    level: k.level ?? 0, pan: k.pan ?? 0, choke: k.choke ?? 0, start: k.start ?? 0, reverse: k.reverse ?? 0,
    piece: k.piece ?? 0,
  };
};

/** I parametri di un kit (16 pad), da usare come preset. */
const kitParams = (kit: readonly KitPad[]): Record<string, number> =>
  Object.fromEntries(kit.flatMap((k, i) => Object.entries(resolveKitPad(k)).map(([key, v]) => [padParam(i, key as PadKey), v])));

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', { step: 1, ...extra });

/** I parametri di un pad, con i predefiniti del kit di partenza. */
function padSection(i: number): ParamSection {
  const d = resolveKitPad(DEFAULT_KIT[i]);
  const id = (key: PadKey) => padParam(i, key);
  const choke: ChoiceParam = { kind: 'choice', id: id('choke'), label: 'Choke', options: CHOKE_GROUPS, default: d.choke };
  const sampleOnly = { when: { param: id('model'), is: MODEL.sample } };
  const voice = { when: { param: id('model'), is: VOICE_MODELS } };
  const reverse: ChoiceParam = { kind: 'choice', id: id('reverse'), label: 'Verso', options: ['Avanti', 'Indietro'], default: d.reverse, ...sampleOnly };
  const piece: ChoiceParam = {
    kind: 'choice', id: id('piece'), label: 'Pezzo', options: PIECES.map(p => p.label), default: d.piece,
    when: { param: id('model'), is: MODEL.cymbalsInst },
  };
  return {
    label: `Pad ${i + 1}`,
    params: [
      { kind: 'choice', id: id('model'), label: 'Suono', options: DRUM_MODELS.map(m => m.label), default: d.model },
      num(id('tune'), 'Intonazione', -24, 24, d.tune, 'st', { step: 1, ...voice }),
      num(id('decay'), 'Decay', 0.01, MAX_DECAY, d.decay, 's', { scale: 'log', ...voice }),
      // al centesimo di percento: per affettare un loop di qualche secondo serve il millisecondo
      num(id('start'), 'Inizio', 0, 100, d.start, '%', { step: 0.01, ...sampleOnly }),
      reverse,
      percent(id('tone'), 'Tono', d.tone, voice),
      percent(id('snap'), 'Snap', d.snap, voice),
      piece,
      num(id('level'), 'Livello', -36, 6, d.level, 'dB', { step: 0.5 }),
      num(id('pan'), 'Pan', -100, 100, d.pan, 'pan', { step: 1 }),
      choke,
    ],
  };
}

/** Un parametro dello strumento di un pad: con il prefisso, anche nella sua condizione. */
const innerSpec = (prefix: string, p: ParamSpec): ParamSpec =>
  ({ ...p, id: prefix + p.id, ...(p.when ? { when: { ...p.when, param: prefix + p.when.param } } : {}) });

/** Le sezioni degli strumenti del pad `index`: ognuna c'è solo quando il pad suona quello strumento. */
const innerSections = (i: number): ParamSection[] =>
  Object.entries(PAD_INSTRUMENTS).flatMap(([model, { type }]) => type.sections.map(s => ({
    label: `Pad ${i + 1} · ${type.label} · ${s.label}`,
    when: { param: padParam(i, 'model'), is: MODEL[model] },
    params: s.params.map(p => innerSpec(innerPrefix(i, type.type), p)),
  })));

/** I parametri di un preset dello strumento del pad, con il prefisso (gli altri tornano ai loro
 *  predefiniti, come scegliendo il preset sullo strumento). */
export function innerPresetParams(index: number, type: DeviceType, preset: Preset): Record<string, number> {
  const prefix = innerPrefix(index, type.type);
  return Object.fromEntries(type.sections.flatMap(s => s.params.map(p => [prefix + p.id, preset.params[p.id] ?? p.default])));
}

/** Un pad di un kit con uno strumento: il preset dello strumento da cui parte e i valori che
 *  cambia (senza prefisso; per Hat e Piatti con il pezzo: "closedDecay"…). */
interface KitInstrumentPad extends KitPad {
  readonly preset?: string;
  readonly inner?: Readonly<Record<string, number>>;
}

/** Il preset `name` di `type` sul pad `index`, con i valori `changes`. Un nome sbagliato è un
 *  errore di chi scrive i kit: si ferma subito (e i test lo vedono). */
function innerPreset(index: number, type: DeviceType, name: string, changes: Readonly<Record<string, number>> = {}): Record<string, number> {
  const preset = type.presets.find(p => p.name === name);
  if (!preset) throw new Error(`${type.label}: nessun preset "${name}"`);
  const prefix = innerPrefix(index, type.type);
  for (const id of Object.keys(changes)) if (!type.sections.some(s => s.params.some(p => p.id === id))) throw new Error(`${type.label}: nessun parametro "${id}"`);
  return { ...innerPresetParams(index, type, preset), ...Object.fromEntries(Object.entries(changes).map(([id, v]) => [prefix + id, v])) };
}

/** Un kit: quello di partenza con questi pad al posto dei suoi; quelli con uno strumento portano
 *  anche i parametri dello strumento. */
function instrumentKit(changes: Readonly<Record<number, KitInstrumentPad>>): Record<string, number> {
  const kit = DEFAULT_KIT.map((k, i) => changes[i] ?? k);
  const inner = Object.entries(changes).map(([i, c]) => {
    const instrument = PAD_INSTRUMENTS[c.model];
    return instrument ? innerPreset(Number(i), instrument.type, c.preset ?? 'Init', c.inner) : {};
  });
  return Object.assign(kitParams(kit), ...inner);
}

/* I kit fatti con gli strumenti. I pad stanno sulle note General MIDI: 36 cassa, 37 side stick,
 * 38 rullante, 39 clap, 40 secondo rullante, 42 hat chiuso, 44 hat pedale, 46 hat aperto, 48 seconda
 * cassa, 49 crash, 51 ride. Gli hi-hat sono nello stesso gruppo di choke. Le note delle casse e dei
 * rullanti sono indici delle loro scale: per la cassa 4 = E0, 5 = F0; per il rullante 7 = E2. */

/** Kick, Snare e hi-hat 909 e 808, il resto come il kit di partenza. */
const STRUMENTI = instrumentKit({
  0: { model: 'kickInst', preset: '909' },
  2: { model: 'snareInst', preset: '909' },
  6: { model: 'cymbalsInst', preset: '808', piece: 0, choke: 1, inner: { volume: 4 } },
  10: { model: 'cymbalsInst', preset: '808', piece: 2, choke: 1, inner: { volume: 4 } },
});

/** Rave: cassa con il rumble in E, rullante con la stanza, hi-hat secchi, una seconda cassa più dura. */
const RAVE = instrumentKit({
  0: { model: 'kickInst', preset: 'Rumble', inner: { note: 4, rumble: 70, rumbleTime: 1.4 } },
  1: { model: 'rim', tone: 65, level: -6 },
  2: { model: 'snareInst', preset: 'Techno', level: -3, inner: { note: 7, room: 45, roomTime: 1.3 } },
  3: { model: 'clap', decay: 0.4, snap: 75, level: -3 },
  4: { model: 'snareInst', preset: 'Rimshot', level: -4, inner: { note: 14, roomOn: 1, room: 30, roomTime: 0.8 } },
  6: { model: 'cymbalsInst', preset: 'Techno secca', piece: 0, choke: 1, pan: 10 },
  8: { model: 'cymbalsInst', preset: 'Techno secca', piece: 1, choke: 1, pan: 10, level: 4 },
  10: { model: 'cymbalsInst', preset: 'Techno secca', piece: 2, choke: 1, pan: 10, inner: { openDecay: 0.4 } },
  12: { model: 'kickInst', preset: 'Industriale', inner: { note: 4, decay: 0.3, tailDecay: 0.6 } },
  13: { model: 'cymbalsInst', preset: 'Techno secca', piece: 3, pan: -20 },
  15: { model: 'cymbalsInst', preset: 'Techno secca', piece: 4, pan: 25 },
});

/** Industriale: tutto saturo, metalli ad anello, rullante sporco nella stanza grande. */
const INDUSTRIALE = instrumentKit({
  0: { model: 'kickInst', preset: 'Industriale', inner: { note: 2 } },
  1: { model: 'snareInst', preset: 'Rimshot', level: -5, inner: { drive: 50, driveType: 1, grain: 40 } },
  2: { model: 'snareInst', preset: 'Industriale' },
  3: { model: 'clap', decay: 0.5, snap: 85, tone: 35, level: -2 },
  4: { model: 'snareInst', preset: 'Lo-fi', level: -3, inner: { note: 3, grain: 90, drive: 60 } },
  5: { model: 'tom', tune: -9, snap: 60, pan: -30, level: -3 },
  6: { model: 'cymbalsInst', preset: 'Industriale', piece: 0, choke: 1, pan: 15 },
  7: { model: 'tom', tune: -5, snap: 60, pan: -10, level: -3 },
  8: { model: 'cymbalsInst', preset: 'Industriale', piece: 1, choke: 1, pan: 15 },
  9: { model: 'tom', tune: -1, snap: 60, pan: 10, level: -3 },
  10: { model: 'cymbalsInst', preset: 'Industriale', piece: 2, choke: 1, pan: 15 },
  12: { model: 'kickInst', preset: 'Rumble', inner: { note: 2, rumbleDrive: 90, rumbleTone: 100, driveType: 1 } },
  13: { model: 'cymbalsInst', preset: 'Industriale', piece: 3, pan: -25, level: -3 },
  15: { model: 'cymbalsInst', preset: 'Industriale', piece: 4, pan: 30 },
});

/** 808: casse lunghe (la seconda più bassa, da basso), rullante e hi-hat 808, clap e campanaccio. */
const OTTO = instrumentKit({
  0: { model: 'kickInst', preset: '808 lunga' },
  2: { model: 'snareInst', preset: '808', level: 2 },
  3: { model: 'clap', decay: 0.4, snap: 70, level: -2 },
  4: { model: 'snareInst', preset: '808', level: -3, inner: { note: 12, decay: 0.1, wiresDecay: 0.08 } },
  6: { model: 'cymbalsInst', preset: '808', piece: 0, choke: 1, pan: 15, inner: { volume: 6 } },
  8: { model: 'cymbalsInst', preset: '808', piece: 1, choke: 1, pan: 15, level: 4, inner: { volume: 6 } },
  10: { model: 'cymbalsInst', preset: '808', piece: 2, choke: 1, pan: 15, inner: { volume: 6 } },
  11: { model: 'cowbell', level: -6, pan: 20 },
  12: { model: 'kickInst', preset: '808 lunga', inner: { note: 2, tailDecay: 3.5, tailDrive: 30 } },
  13: { model: 'cymbalsInst', preset: '808', piece: 3, pan: -15, inner: { volume: 6 } },
  15: { model: 'cymbalsInst', preset: '808', piece: 4, pan: 25, inner: { volume: 6 } },
});

/** Acustica: cassa e rullante di pelle, side stick, piatti veri con la stanza. */
const ACUSTICA = instrumentKit({
  0: { model: 'kickInst', preset: 'Acustica', inner: { volume: -1 } },
  1: { model: 'snareInst', preset: 'Rimshot', level: -2, inner: { note: 12, wiresLevel: 0, roomOn: 1, room: 20, roomTime: 0.5 } },
  2: { model: 'snareInst', preset: 'Acustica', level: 2 },
  4: { model: 'snareInst', preset: 'Stanza grande', level: -2 },
  6: { model: 'cymbalsInst', preset: 'Acustica', piece: 0, choke: 1, pan: 20, inner: { volume: 0 } },
  8: { model: 'cymbalsInst', preset: 'Acustica', piece: 1, choke: 1, pan: 20, level: 5, inner: { volume: 0 } },
  10: { model: 'cymbalsInst', preset: 'Acustica', piece: 2, choke: 1, pan: 20, inner: { volume: 0 } },
  12: { model: 'kickInst', preset: 'Acustica', inner: { note: 7, decay: 0.25, volume: -2 } },
  13: { model: 'cymbalsInst', preset: 'Acustica', piece: 3, pan: -30, level: -2, inner: { volume: 0 } },
  15: { model: 'cymbalsInst', preset: 'Acustica', piece: 4, pan: 30, level: 4, inner: { volume: 0 } },
});

/** Lo-fi: tutto sgranato e scuro, come da un campionatore vecchio. */
const LOFI = instrumentKit({
  0: { model: 'kickInst', preset: 'Secca', inner: { drive: 40, driveType: 0, lowCut: 35, snapTone: 2200 } },
  2: { model: 'snareInst', preset: 'Lo-fi', level: -3 },
  3: { model: 'clap', tone: 30, level: -4 },
  4: { model: 'snareInst', preset: 'Lo-fi', level: -5, inner: { note: 12, grain: 90, roomOn: 1, room: 25 } },
  6: { model: 'cymbalsInst', preset: 'Lo-fi', piece: 0, choke: 1, pan: 10 },
  8: { model: 'shaker', tone: 40, level: -8, pan: -20 },
  10: { model: 'cymbalsInst', preset: 'Lo-fi', piece: 2, choke: 1, pan: 10 },
  12: { model: 'kickInst', preset: 'Profonda', inner: { drive: 30, lowCut: 30 } },
  15: { model: 'cymbalsInst', preset: 'Lo-fi', piece: 4, pan: 25 },
});

/** House: cassa tonda, rullante e hat 909, clap, il ride sopra. */
const HOUSE = instrumentKit({
  0: { model: 'kickInst', preset: 'House' },
  2: { model: 'snareInst', preset: '909' },
  3: { model: 'clap', decay: 0.35, snap: 70, level: -2 },
  4: { model: 'snareInst', preset: 'Elettro', level: -4 },
  6: { model: 'cymbalsInst', preset: '909', piece: 0, choke: 1, pan: 15 },
  8: { model: 'cymbalsInst', preset: '909', piece: 1, choke: 1, pan: 15, level: 4 },
  10: { model: 'cymbalsInst', preset: '909', piece: 2, choke: 1, pan: 15 },
  12: { model: 'kickInst', preset: '909' },
  13: { model: 'cymbalsInst', preset: '909', piece: 3, pan: -20 },
  15: { model: 'cymbalsInst', preset: '909', piece: 4, pan: 25 },
});

/** Dub techno: cassa morbida con il rumble, rim nella stanza lunga, hat larghi e scuri. */
const DUB = instrumentKit({
  0: { model: 'kickInst', preset: 'Dub techno' },
  1: { model: 'snareInst', preset: 'Rimshot', level: -3, inner: { roomOn: 1, room: 50, roomTime: 2.5, roomTone: 4000 } },
  2: { model: 'snareInst', preset: 'Stanza grande', level: -3, inner: { room: 70, roomTime: 2.5 } },
  3: { model: 'clap', decay: 0.5, tone: 35, level: -6 },
  6: { model: 'cymbalsInst', preset: 'Dub', piece: 0, choke: 1, pan: 20 },
  8: { model: 'shaker', tone: 40, level: -10, pan: -25 },
  10: { model: 'cymbalsInst', preset: 'Dub', piece: 2, choke: 1, pan: 20 },
  12: { model: 'kickInst', preset: 'Profonda' },
  13: { model: 'cymbalsInst', preset: 'Dub', piece: 3, pan: -25 },
  15: { model: 'cymbalsInst', preset: 'Dub', piece: 4, pan: 30, level: 4 },
});

/** Breakbeat: cassa e rullante secchi da breaks, un rullante fantasma piano, piatti veri. */
const BREAKBEAT = instrumentKit({
  0: { model: 'kickInst', preset: 'Breakbeat' },
  2: { model: 'snareInst', preset: 'Breakbeat' },
  4: { model: 'snareInst', preset: 'Breakbeat', level: -9, inner: { note: 14, snapLevel: 30 } },
  6: { model: 'cymbalsInst', preset: 'Acustica', piece: 0, choke: 1, pan: 20, inner: { volume: 0 } },
  8: { model: 'cymbalsInst', preset: 'Acustica', piece: 1, choke: 1, pan: 20, level: 4, inner: { volume: 0 } },
  10: { model: 'cymbalsInst', preset: 'Acustica', piece: 2, choke: 1, pan: 20, inner: { volume: 0 } },
  12: { model: 'kickInst', preset: 'Acustica', inner: { volume: -2 } },
  13: { model: 'cymbalsInst', preset: 'Acustica', piece: 3, pan: -30, inner: { volume: 0 } },
  15: { model: 'cymbalsInst', preset: 'Acustica', piece: 4, pan: 30, level: 4, inner: { volume: 0 } },
});

/** Trap: l'808 lunga che fa da basso, rullante alto nella stanza, hat cortissimi. */
const TRAP = instrumentKit({
  0: { model: 'kickInst', preset: '808 lunga', inner: { note: 7, tailDecay: 3, tailDrive: 25 } },
  2: { model: 'snareInst', preset: 'Trap' },
  3: { model: 'clap', decay: 0.3, snap: 80, level: -2 },
  6: { model: 'cymbalsInst', preset: 'Trap', piece: 0, choke: 1, pan: 10 },
  8: { model: 'cymbalsInst', preset: 'Trap', piece: 1, choke: 1, pan: 10, level: 4 },
  10: { model: 'cymbalsInst', preset: 'Trap', piece: 2, choke: 1, pan: 10 },
  12: { model: 'kickInst', preset: '808 lunga', inner: { note: 12, tailDecay: 2 } },
  13: { model: 'cymbalsInst', preset: 'Trap', piece: 3, pan: -20 },
});

/** Minimal: tutto corto e piccolo, click e metallo. */
const MINIMAL = instrumentKit({
  0: { model: 'kickInst', preset: 'Minimal', inner: { volume: 1 } },
  1: { model: 'rim', tone: 70, level: -5 },
  2: { model: 'snareInst', preset: 'Elettro', inner: { wiresLevel: 30, decay: 0.07 } },
  6: { model: 'cymbalsInst', preset: 'Minimal', piece: 0, choke: 1, pan: -10 },
  8: { model: 'shaker', tone: 70, level: -9, pan: 20 },
  10: { model: 'cymbalsInst', preset: 'Minimal', piece: 2, choke: 1, pan: -10 },
  12: { model: 'kickInst', preset: 'Secca' },
  15: { model: 'cymbalsInst', preset: 'Minimal', piece: 4, pan: 30 },
});

/** Electro: cassa 808 con il click, rullante elettronico, campanaccio e hat 808. */
const ELECTRO = instrumentKit({
  0: { model: 'kickInst', preset: 'Electro', inner: { volume: -3 } },
  2: { model: 'snareInst', preset: 'Elettro', level: 2 },
  3: { model: 'clap', decay: 0.4, snap: 70, level: -2 },
  6: { model: 'cymbalsInst', preset: '808', piece: 0, choke: 1, pan: 15, inner: { volume: 6 } },
  10: { model: 'cymbalsInst', preset: '808', piece: 2, choke: 1, pan: 15, inner: { volume: 6 } },
  11: { model: 'cowbell', level: -5, pan: 20 },
  12: { model: 'kickInst', preset: '808 lunga', inner: { note: 2 } },
  13: { model: 'cymbalsInst', preset: '808', piece: 3, pan: -15, inner: { volume: 6 } },
});

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
  { name: 'Strumenti', params: STRUMENTI },
  { name: 'Rave', params: RAVE },
  { name: 'Industriale', params: INDUSTRIALE },
  { name: '808 strumenti', params: OTTO },
  { name: 'Acustica', params: ACUSTICA },
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
    { label: 'Uscita', params: [percent('velocity', 'Velocity', 70), num('volume', 'Volume', -36, 6, -4, 'dB', { step: 0.5 })] },
    ...Array.from({ length: DRUM_PADS }, (_, i) => innerSections(i)).flat(),
  ],
  presets: PRESETS,
  kit: true,
  noteNames: (values, samples) => new Map(padNames(values, samples).map((name, i) => [padNote(i), name])),
};

/** I valori che un pad prende quando gli si cambia modello: quelli del modello, il resto resta. */
export const modelDefaults = (index: number, model: number): Record<string, number> => {
  const m = DRUM_MODELS[model];
  return { [padParam(index, 'model')]: model, [padParam(index, 'decay')]: m.decay, [padParam(index, 'tone')]: m.tone, [padParam(index, 'snap')]: m.snap };
};
