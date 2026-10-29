/* "Hat e Piatti": uno strumento solo per i metalli della batteria. Sei pezzi, sulle note della
 * mappa General MIDI (così le parti di batteria scritte altrove suonano giuste): hi-hat chiuso,
 * pedale e aperto, crash, ride e la campana del ride. Ogni pezzo è un synth (il "metallo": sei
 * quadre stonate tra loro come nella 808, più rumore e i parziali di una campana, filtrati) o un
 * sample, con intonazione, decay, brillantezza, livello e pan. Come in un charleston vero, il
 * chiuso e il pedale fermano l'aperto. Per tutti: il tipo di metallo, la variazione da colpo a
 * colpo (niente "mitragliatrice"), la larghezza stereo, la saturazione. Qui c'è la descrizione;
 * il suono è in cymbals-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection } from '../../params';

/** Un pezzo: il suo nome, la sua nota e i valori con cui parte. */
export interface Piece {
  readonly id: string;
  readonly label: string;
  readonly note: number;
  readonly decay: number;
  readonly tune: number;
  readonly tone: number;
  readonly noise: number;
  readonly bell: number;
  readonly level: number;
  readonly pan: number;
  /** I pezzi del charleston: il chiuso e il pedale fermano l'aperto. */
  readonly hat?: 'closes' | 'open';
}

export const PIECES: readonly Piece[] = [
  { id: 'closed', label: 'Hat chiuso', note: 42, decay: 0.07, tune: 0, tone: 60, noise: 35, bell: 0, level: -4, pan: 15, hat: 'closes' },
  { id: 'pedal', label: 'Hat pedale', note: 44, decay: 0.05, tune: -1, tone: 45, noise: 25, bell: 0, level: -7, pan: 15, hat: 'closes' },
  { id: 'open', label: 'Hat aperto', note: 46, decay: 0.55, tune: 0, tone: 58, noise: 40, bell: 0, level: -6, pan: 15, hat: 'open' },
  { id: 'crash', label: 'Crash', note: 49, decay: 2.4, tune: -3, tone: 50, noise: 60, bell: 5, level: -8, pan: -25 },
  { id: 'ride', label: 'Ride', note: 51, decay: 3, tune: 0, tone: 55, noise: 20, bell: 30, level: -9, pan: 30 },
  { id: 'bell', label: 'Campana', note: 53, decay: 1.6, tune: 2, tone: 70, noise: 5, bell: 85, level: -10, pan: 30 },
];

export type PieceKey = 'source' | 'tune' | 'decay' | 'tone' | 'noise' | 'bell' | 'level' | 'pan';

/** L'id del parametro `key` del pezzo `index`: "closedDecay", "rideBell"… */
export const pieceParam = (index: number, key: PieceKey): string => `${PIECES[index].id}${key[0].toUpperCase()}${key.slice(1)}`;

/** Il posto del sample del pezzo `index`: il suo id ("closed", "ride"…). */
export const pieceSlot = (index: number): string => PIECES[index].id;

export const pieceOfSlot = (slot: string): number => PIECES.findIndex(p => p.id === slot);

export const pieceOfNote = (pitch: number): number => PIECES.findIndex(p => p.note === pitch);

export const SOURCE = { synth: 0, sample: 1 } as const;
/** Il metallo dei pezzi synth: le quadre della 808, un altro gruppo più stonato, o le quadre
 *  moltiplicate a coppie (modulazione ad anello: più metallico, quasi un gong). */
export const METALS = ['808', 'Ruvido', 'Anello'] as const;
export const MAX_DECAY = 8;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', { step: 1, ...extra });

function pieceSection(i: number): ParamSection {
  const p = PIECES[i], id = (key: PieceKey) => pieceParam(i, key);
  const synth = { when: { param: id('source'), is: SOURCE.synth } };
  const source: ChoiceParam = { kind: 'choice', id: id('source'), label: 'Sorgente', options: ['Synth', 'Sample'], default: SOURCE.synth };
  return {
    label: p.label,
    params: [
      source,
      num(id('tune'), 'Intonazione', -24, 24, p.tune, 'st', { step: 1 }),
      num(id('decay'), 'Decay', 0.01, MAX_DECAY, p.decay, 's', { scale: 'log' }),
      percent(id('tone'), 'Brillantezza', p.tone),
      percent(id('noise'), 'Rumore', p.noise, synth),
      percent(id('bell'), 'Campana', p.bell, synth),
      num(id('level'), 'Livello', -36, 6, p.level, 'dB', { step: 0.5 }),
      num(id('pan'), 'Pan', -100, 100, p.pan, 'pan', { step: 1 }),
    ],
  };
}

/** I valori di un pezzo per un preset: solo quelli dati. */
const piece = (index: number, values: Partial<Record<PieceKey, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(values).map(([key, v]) => [pieceParam(index, key as PieceKey), v]));

const PRESETS: readonly Preset[] = [
  { name: 'Init', params: {} },
  {
    name: '808',
    params: { metal: 0, variation: 10, width: 30, ...piece(0, { decay: 0.05, tone: 55, noise: 15 }), ...piece(2, { decay: 0.7, noise: 15 }),
      ...piece(3, { decay: 1.8, noise: 30, tone: 45 }) },
  },
  {
    name: 'Techno secca',
    params: { metal: 1, variation: 25, width: 45, drive: 20, ...piece(0, { decay: 0.035, tone: 72, noise: 55 }),
      ...piece(1, { decay: 0.03, tone: 65 }), ...piece(2, { decay: 0.3, tone: 70, noise: 55 }),
      ...piece(4, { decay: 1.8, tone: 68, bell: 45, noise: 30 }) },
  },
  {
    name: 'Industriale',
    params: { metal: 2, variation: 30, width: 50, drive: 45, ...piece(0, { decay: 0.06, tone: 50, noise: 45, tune: -4 }),
      ...piece(2, { decay: 0.5, tone: 48, noise: 50, tune: -4 }), ...piece(3, { decay: 3.5, tune: -8, tone: 40, noise: 70 }),
      ...piece(4, { tune: -5, bell: 50 }) },
  },
  {
    // scuri, sporchi e un po' diversi a ogni colpo
    name: 'Lo-fi',
    params: { metal: 0, variation: 55, width: 25, drive: 30, ...piece(0, { decay: 0.06, tone: 38, noise: 30 }),
      ...piece(2, { decay: 0.45, tone: 40, noise: 35 }), ...piece(4, { decay: 2.4, tone: 40, bell: 35, noise: 20 }) },
  },
  {
    name: 'Acustica',
    params: { metal: 1, variation: 40, width: 60, ...piece(0, { decay: 0.09, tone: 52, noise: 60 }),
      ...piece(2, { decay: 0.9, tone: 50, noise: 65 }), ...piece(3, { decay: 3, tone: 45, noise: 75 }),
      ...piece(4, { decay: 3.6, tone: 50, noise: 35, bell: 25 }) },
  },
  {
    name: '909',
    params: { metal: 1, variation: 15, width: 35, drive: 10, ...piece(0, { decay: 0.06, tone: 75, noise: 40 }),
      ...piece(2, { decay: 0.45, tone: 72, noise: 45 }), ...piece(3, { decay: 2.8, tone: 65, noise: 70 }),
      ...piece(4, { decay: 3.2, tone: 70, bell: 40 }), volume: 0 },
  },
  {
    // hat cortissimi per i rulli
    name: 'Trap',
    params: { metal: 0, variation: 30, width: 50, ...piece(0, { decay: 0.025, tone: 80, noise: 30, level: -3 }),
      ...piece(1, { decay: 0.02, tone: 75 }), ...piece(2, { decay: 0.25, tone: 75 }), ...piece(3, { decay: 2, tone: 70 }), volume: 2 },
  },
  {
    name: 'Dub',
    params: { metal: 0, variation: 35, width: 80, ...piece(0, { decay: 0.1, tone: 45, noise: 50 }),
      ...piece(2, { decay: 1.2, tone: 42, noise: 55 }), ...piece(3, { decay: 4, tone: 40, noise: 60 }),
      ...piece(4, { decay: 5, tone: 45, bell: 25 }), volume: -1 },
  },
  {
    // il metallo ad anello, accordato in basso e lungo: gong e campane
    name: 'Gong',
    params: { metal: 2, variation: 10, width: 70, ...piece(2, { decay: 2, tune: -8, tone: 40 }),
      ...piece(3, { decay: 7, tune: -12, tone: 35, noise: 30, bell: 60 }), ...piece(4, { decay: 6, tune: -7, bell: 80 }),
      ...piece(5, { decay: 5, tune: -5 }) },
  },
  {
    name: 'Minimal',
    params: { metal: 1, variation: 10, width: 20, ...piece(0, { decay: 0.03, tone: 85, noise: 20 }),
      ...piece(2, { decay: 0.2, tone: 80 }), ...piece(4, { decay: 1.5, tone: 80, bell: 55 }), volume: 6 },
  },
];

export const CYMBALS: DeviceType = {
  type: 'cymbals',
  label: 'Hat e Piatti',
  sections: [
    ...PIECES.map((_, i) => pieceSection(i)),
    {
      label: 'Tutti',
      params: [
        { kind: 'choice', id: 'metal', label: 'Metallo', options: METALS, default: 0 },
        percent('variation', 'Variazione', 20),
        percent('width', 'Larghezza', 40),
        percent('drive', 'Drive', 0),
        percent('velocity', 'Velocity', 60),
        num('volume', 'Volume', -36, 6, -4, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: PRESETS,
  noteNames: () => new Map(PIECES.map(p => [p.note, p.label])),
};
