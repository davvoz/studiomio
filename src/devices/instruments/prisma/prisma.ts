/* "Prisma": il synth a tabelle d'onda grande, come Serum (senza effetti). Due oscillatori a
 * tabella con i warp (sync, bend, PWM, asimmetria, specchio, FM/AM/RM dall'altro oscillatore…)
 * e un unison fino a 16 copie, il sub, il rumore, due filtri (in serie o in parallelo, ogni
 * sorgente sceglie dove andare), quattro inviluppi con le curve (il primo è il volume), quattro
 * LFO disegnabili e quattro macro. Tutto si muove dalla matrice delle modulazioni: 16 posti,
 * ognuno con una fonte, una destinazione (quasi ogni manopola), la quantità in frazione della
 * corsa della manopola, la polarità, una curva e una fonte "aux" che la scala. Nel pannello
 * una fonte si trascina su una manopola e la modulazione nasce lì.
 * Qui c'è solo la descrizione (parametri, fonti, destinazioni); i preset sono in
 * prisma-presets.ts, il suono in prisma-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { LFO_SYNC, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { TABLE_NAMES } from '../wavetable/tables';
import { LFO_POINTS, LFO_SHAPE, LFO_SHAPES, pointCountParam, pointParam, pointsForShape } from './shapes';
import { prismaPresets } from './prisma-presets';

export { LFO_SYNC, VOICE_MODE };

/** Copie al massimo dell'unison di un oscillatore. */
export const MAX_UNISON = 16;
/** Posti della matrice delle modulazioni. */
export const MOD_SLOTS = 16;
export const OSCS = ['a', 'b'] as const;
export type OscKey = typeof OSCS[number];
export const LFOS = 4;
export const ENVS = 4;
export const MACROS = 4;

/** Le tabelle di un oscillatore: quelle generate, poi il file importato (un WAV per oscillatore). */
export const PRISMA_TABLES = [...TABLE_NAMES, 'File importato'] as const;
export const USER_TABLE = PRISMA_TABLES.length - 1;
/** Il posto del sample importato come tabella per l'oscillatore. */
export const tableSlot = (o: OscKey): string => `wt${o.toUpperCase()}`;

/** I warp: come l'oscillatore legge la sua tabella. Quelli di fase (sync, bend, PWM, asimmetria)
 *  piegano il tempo del periodo; gli altri cambiano il suono letto; FM, AM e RM prendono
 *  l'altro oscillatore (che deve essere acceso: anche a livello zero fa da modulante). */
export const WARPS = ['Nessuno', 'Sync', 'Sync morbido', 'Bend +', 'Bend −', 'Bend ±', 'PWM', 'Asimm. +', 'Asimm. −', 'Specchio',
  'Flip', 'Quantizza', 'FM', 'AM', 'RM', 'FM dal Sub'] as const;
export const WARP = {
  none: 0, sync: 1, softSync: 2, bendUp: 3, bendDown: 4, bendBoth: 5, pwm: 6, asymUp: 7, asymDown: 8, mirror: 9,
  flip: 10, quantize: 11, fm: 12, am: 13, rm: 14, subFm: 15,
} as const;
/** I warp che leggono l'altro oscillatore. */
export const CROSS_WARPS: readonly number[] = [WARP.fm, WARP.am, WARP.rm];

export const SUB_SHAPES = ['Seno', 'Triangolo', 'Dente', 'Quadra', 'Impulso'] as const;
export const NOISE_TYPES = ['Bianco', 'Rosa', 'Marrone', 'Digitale', 'Crepitio'] as const;
export const NOISE = { white: 0, pink: 1, brown: 2, digital: 3, crackle: 4 } as const;

export const FILTER_TYPES = ['LP 12', 'LP 24', 'LP Ladder', 'HP 12', 'HP 24', 'BP 12', 'BP 24', 'Notch', 'Peak', 'Comb +', 'Comb −',
  'Formante', 'Phaser'] as const;
export const FILTER = {
  lp12: 0, lp24: 1, ladder: 2, hp12: 3, hp24: 4, bp12: 5, bp24: 6, notch: 7, peak: 8, combUp: 9, combDown: 10, formant: 11, phaser: 12,
} as const;
/** Dove va ogni sorgente. In serie il primo filtro va nel secondo: "Tutti e due" è come "Filtro 1". */
export const ROUTES = ['Filtro 1', 'Filtro 2', 'Tutti e due', 'Diretto'] as const;
export const ROUTE = { f1: 0, f2: 1, both: 2, direct: 3 } as const;
export const FILTER_MODES = ['Serie', 'Parallelo'] as const;
export const FILTER_MODE = { serial: 0, parallel: 1 } as const;

/** Nota: l'LFO riparte a ogni nota. Libero: tutte le voci seguono lo stesso giro. Una volta:
 *  fa un giro solo e resta sull'ultimo valore (un inviluppo disegnato). */
export const LFO_TRIGS = ['Nota', 'Libero', 'Una volta'] as const;
export const LFO_TRIG = { note: 0, free: 1, once: 2 } as const;
export { LFO_SHAPE, LFO_SHAPES };

export const ON_OFF = ['Off', 'On'] as const;
export const POLARITIES = ['Uni', 'Bi'] as const;

/** Le fonti delle modulazioni, nell'ordine delle opzioni. Tutte vanno da 0 a 1; la matrice le
 *  rende bipolari se il posto è "Bi". */
export const SOURCES = ['—', 'Env 1', 'Env 2', 'Env 3', 'Env 4', 'LFO 1', 'LFO 2', 'LFO 3', 'LFO 4', 'Velocity', 'Nota', 'Casuale',
  'Gate', 'Macro 1', 'Macro 2', 'Macro 3', 'Macro 4'] as const;
export const SRC = {
  none: 0, env1: 1, env2: 2, env3: 3, env4: 4, lfo1: 5, lfo2: 6, lfo3: 7, lfo4: 8, velocity: 9, note: 10, random: 11, gate: 12,
  macro1: 13, macro2: 14, macro3: 15, macro4: 16,
} as const;
export const isLfoSource = (src: number): boolean => src >= SRC.lfo1 && src <= SRC.lfo4;
export const isEnvSource = (src: number): boolean => src >= SRC.env1 && src <= SRC.env4;

/** I parametri di un posto della matrice. */
export const slotParam = (n: number, field: 'Src' | 'Dst' | 'Amt' | 'Pol' | 'Curve' | 'Aux'): string => `m${n}${field}`;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number, max = 10) => num(id, label, 0.001, max, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
const onOff = (id: string, on: boolean) => choice(id, 'Acceso', ON_OFF, on ? 1 : 0);
const unisonOn = (o: OscKey) => ({ param: `${o}Unison`, is: Array.from({ length: MAX_UNISON - 1 }, (_, i) => i + 2) });

/** Un oscillatore; `pos`: dove parte la posizione (A parte dal dente di sega della tabella Base). */
const oscParams = (o: OscKey, on: boolean, table: number, pos: number): ParamSpec[] => [
  onOff(`${o}On`, on),
  choice(`${o}Table`, 'Tabella', PRISMA_TABLES, table),
  percent(`${o}Pos`, 'Posizione', pos),
  choice(`${o}Warp`, 'Warp', WARPS),
  percent(`${o}WarpAmt`, 'Quanto', 0),
  num(`${o}Oct`, 'Ottava', -4, 4, 0, '', { step: 1 }),
  num(`${o}Semi`, 'Semitoni', -12, 12, 0, 'st', { step: 1 }),
  num(`${o}Fine`, 'Fine', -100, 100, 0, 'ct', { step: 1 }),
  num(`${o}Unison`, 'Unison', 1, MAX_UNISON, 1, '', { step: 1 }),
  num(`${o}Detune`, 'Detune', 0, 100, 25, 'ct', { step: 1, when: unisonOn(o) }),
  { ...percent(`${o}Blend`, 'Blend', 75), when: unisonOn(o) },
  { ...percent(`${o}Width`, 'Stereo', 80), when: unisonOn(o) },
  { ...percent(`${o}Spread`, 'Pos. ±', 0), when: unisonOn(o) },
  num(`${o}Phase`, 'Fase', 0, 360, 0, '°', { step: 1 }),
  percent(`${o}Rand`, 'Casuale', 100),
  percent(`${o}Level`, 'Livello', 75),
  num(`${o}Pan`, 'Pan', -100, 100, 0, 'pan', { step: 1 }),
];

const filterParams = (f: 1 | 2, on: boolean, type: number, cutoff: number): ParamSpec[] => [
  onOff(`f${f}On`, on),
  choice(`f${f}Type`, 'Tipo', FILTER_TYPES, type),
  num(`f${f}Cutoff`, 'Cutoff', 20, 20000, cutoff, 'Hz', { scale: 'log' }),
  percent(`f${f}Res`, 'Risonanza', 0),
  percent(`f${f}Drive`, 'Drive', 0),
  percent(`f${f}Var`, 'Var', 50),
  percent(`f${f}Key`, 'Key track', 0),
  percent(`f${f}Mix`, 'Mix', 100),
];

/** Inviluppo `n`: il primo è il volume (sustain pieno), gli altri partono come un pluck. */
const envParams = (n: number): ParamSpec[] => {
  const amp = n === 1;
  return [
    time(`e${n}A`, 'Attack', amp ? 0.002 : 0.005),
    time(`e${n}H`, 'Hold', 0.001),
    time(`e${n}D`, 'Decay', amp ? 1 : 0.5),
    percent(`e${n}S`, 'Sustain', amp ? 100 : 0),
    time(`e${n}R`, 'Release', amp ? 0.05 : 0.3),
    num(`e${n}Ac`, 'Curva A', -100, 100, 0, '', { step: 1 }),
    num(`e${n}Dc`, 'Curva D', -100, 100, 60, '', { step: 1 }),
    num(`e${n}Rc`, 'Curva R', -100, 100, 60, '', { step: 1 }),
  ];
};

/** LFO `n`, con i punti della forma disegnata (nascosti: si muovono solo dal disegno). */
const lfoParams = (n: number, division: number): ParamSpec[] => {
  const start = pointsForShape(LFO_SHAPE.triangle);
  const hidden = { hidden: true };
  const points: ParamSpec[] = [num(pointCountParam(n), 'Punti', 2, LFO_POINTS, start.length, '', { step: 1, ...hidden })];
  for (let k = 1; k <= LFO_POINTS; k++) {
    const p = start[k - 1];
    points.push(
      num(pointParam(n, 'X', k), `Punto ${k} x`, 0, 1, p?.x ?? 1, '', hidden),
      num(pointParam(n, 'Y', k), `Punto ${k} y`, 0, 1, p?.y ?? 0, '', hidden),
      num(pointParam(n, 'C', k), `Punto ${k} curva`, -100, 100, 0, '', { step: 1, ...hidden }),
    );
  }
  return [
    choice(`l${n}Shape`, 'Forma', LFO_SHAPES),
    choice(`l${n}Sync`, 'Sincro', ['Tempo', 'Hz'], LFO_SYNC.tempo),
    choice(`l${n}Div`, 'Divisione', TEMPO_RATES.map(([l]) => l), division, { when: { param: `l${n}Sync`, is: LFO_SYNC.tempo } }),
    // a tempo la manopola in Hz non conta (resta il riferimento di chi la modula: la velocità si
    // moltiplica come si muove lei)
    num(`l${n}Rate`, 'Velocità', 0.02, 50, 2, 'Hz', { scale: 'log', when: { param: `l${n}Sync`, is: LFO_SYNC.hz } }),
    choice(`l${n}Trig`, 'Ripartenza', LFO_TRIGS),
    num(`l${n}Phase`, 'Fase', 0, 360, 0, '°', { step: 1 }),
    time(`l${n}Delay`, 'Ritardo', 0.001),
    time(`l${n}Rise`, 'Salita', 0.001),
    percent(`l${n}Smooth`, 'Morbido', 0),
    ...points,
  ];
};

const slotParams = (n: number): ParamSpec[] => {
  const hidden = { hidden: true };
  return [
    choice(slotParam(n, 'Src'), 'Fonte', SOURCES, 0, hidden),
    num(slotParam(n, 'Amt'), `Quantità ${n}`, -100, 100, 0, '%', { step: 1 }),
    choice(slotParam(n, 'Dst'), 'Destinazione', ['—', ...DESTINATIONS.map(d => d.label)], 0, hidden),
    choice(slotParam(n, 'Pol'), 'Polarità', POLARITIES, 0, hidden),
    num(slotParam(n, 'Curve'), 'Curva', -100, 100, 0, '', { step: 1, ...hidden }),
    choice(slotParam(n, 'Aux'), 'Aux', SOURCES, 0, hidden),
  ];
};

/** Una destinazione della matrice: un parametro numerico, con il gruppo per i menu. Il velocità
 *  di un LFO a tempo si moltiplica come quella in Hz (la manopola è logaritmica). */
export interface Destination {
  readonly param: string;
  readonly group: string;
  readonly label: string;
}

const oscDestinations = (o: OscKey): Destination[] => {
  const group = `Osc ${o.toUpperCase()}`;
  return [
    ['Pos', 'Posizione'], ['WarpAmt', 'Warp'], ['Semi', 'Pitch'], ['Fine', 'Fine'], ['Detune', 'Detune'], ['Blend', 'Blend'],
    ['Width', 'Stereo'], ['Spread', 'Pos. ±'], ['Phase', 'Fase'], ['Level', 'Livello'], ['Pan', 'Pan'],
  ].map(([p, label]) => ({ param: `${o}${p}`, group, label: `${group} · ${label}` }));
};

const filterDestinations = (f: 1 | 2): Destination[] => {
  const group = `Filtro ${f}`;
  return [['Cutoff', 'Cutoff'], ['Res', 'Risonanza'], ['Drive', 'Drive'], ['Var', 'Var'], ['Mix', 'Mix']]
    .map(([p, label]) => ({ param: `f${f}${p}`, group, label: `${group} · ${label}` }));
};

const envDestinations = (n: number): Destination[] => {
  const group = `Env ${n}`;
  return [['A', 'Attack'], ['D', 'Decay'], ['S', 'Sustain'], ['R', 'Release']]
    .map(([p, label]) => ({ param: `e${n}${p}`, group, label: `${group} · ${label}` }));
};

/** Le destinazioni nell'ordine delle opzioni (dopo "—"). */
export const DESTINATIONS: readonly Destination[] = [
  ...oscDestinations('a'),
  ...oscDestinations('b'),
  { param: 'subLevel', group: 'Sub', label: 'Sub · Livello' },
  { param: 'subPan', group: 'Sub', label: 'Sub · Pan' },
  { param: 'nTone', group: 'Rumore', label: 'Rumore · Tono' },
  { param: 'nLevel', group: 'Rumore', label: 'Rumore · Livello' },
  { param: 'nPan', group: 'Rumore', label: 'Rumore · Pan' },
  ...filterDestinations(1),
  ...filterDestinations(2),
  ...[1, 2, 3, 4].flatMap(envDestinations),
  ...[1, 2, 3, 4].map(n => ({ param: `l${n}Rate`, group: 'LFO', label: `LFO ${n} · Velocità` })),
  { param: 'tune', group: 'Globale', label: 'Globale · Pitch' },
  { param: 'volume', group: 'Globale', label: 'Globale · Volume' },
];

/** L'opzione della destinazione di un parametro (0: non è una destinazione). */
const DEST_INDEX = new Map(DESTINATIONS.map((d, i) => [d.param, i + 1]));
export const destinationOf = (param: string): number => DEST_INDEX.get(param) ?? 0;

export const PRISMA: DeviceType = {
  type: 'prisma',
  label: 'Prisma',
  sections: [
    { label: 'Oscillatore A', params: oscParams('a', true, 0, 67) },
    { label: 'Oscillatore B', params: oscParams('b', false, 2, 0) },
    {
      label: 'Sub',
      params: [onOff('subOn', false), choice('subShape', 'Forma', SUB_SHAPES), num('subOct', 'Ottava', -3, 1, -1, '', { step: 1 }),
        percent('subLevel', 'Livello', 75), num('subPan', 'Pan', -100, 100, 0, 'pan', { step: 1 })],
    },
    {
      label: 'Rumore',
      params: [onOff('nOn', false), choice('nType', 'Tipo', NOISE_TYPES), percent('nTone', 'Tono', 100), percent('nLevel', 'Livello', 40),
        num('nPan', 'Pan', -100, 100, 0, 'pan', { step: 1 })],
    },
    { label: 'Filtro 1', params: filterParams(1, true, FILTER.lp12, 20000) },
    { label: 'Filtro 2', params: filterParams(2, false, FILTER.hp12, 20) },
    {
      label: 'Percorsi',
      params: [
        choice('fMode', 'Filtri', FILTER_MODES),
        choice('aRoute', 'Osc A', ROUTES), choice('bRoute', 'Osc B', ROUTES), choice('subRoute', 'Sub', ROUTES), choice('nRoute', 'Rumore', ROUTES),
      ],
    },
    { label: 'Env 1 · volume', params: envParams(1) },
    { label: 'Env 2', params: envParams(2) },
    { label: 'Env 3', params: envParams(3) },
    { label: 'Env 4', params: envParams(4) },
    { label: 'LFO 1', params: lfoParams(1, TEMPO_RATE['1/4']) },
    { label: 'LFO 2', params: lfoParams(2, TEMPO_RATE['1/8']) },
    { label: 'LFO 3', params: lfoParams(3, TEMPO_RATE['1 battuta']) },
    { label: 'LFO 4', params: lfoParams(4, TEMPO_RATE['1/16']) },
    { label: 'Macro', params: [1, 2, 3, 4].map(n => percent(`macro${n}`, `Macro ${n}`, 0)) },
    {
      label: 'Voce',
      params: [
        choice('voiceMode', 'Modo', VOICE_MODES),
        num('glide', 'Glide', 0, 1000, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        num('tune', 'Pitch', -24, 24, 0, 'st', { step: 1 }),
        num('volume', 'Volume', -36, 6, -12, 'dB', { step: 0.5 }),
      ],
    },
    { label: 'Matrice', params: Array.from({ length: MOD_SLOTS }, (_, i) => slotParams(i + 1)).flat() },
  ],
  // i preset usano le costanti di questo file: si costruiscono alla prima lettura
  get presets() {
    return prismaPresets();
  },
};
