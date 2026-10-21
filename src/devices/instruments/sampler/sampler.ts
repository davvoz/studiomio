/* "Sampler": suona un file audio sulla tastiera, come Simpler e Sampler di Live. Tre modi:
 * Classic (il sample all'intonazione del tasto, con il loop che tiene la nota finché la si
 * tiene), One-Shot (dall'inizio alla fine a ogni colpo, il rilascio non lo ferma) e Slice (il
 * sample tagliato a fette, una per tasto da C1 in su, ai transienti o in parti uguali). Poi il
 * filtro (gli stessi tipi di Prisma), tre inviluppi con le curve (volume, filtro, pitch) e un
 * LFO su pitch, filtro, volume e pan.
 * Le posizioni (inizio, fine, loop, fette) sono frazioni del sample come lo si vede: con
 * Reverse il sample è rovesciato e le posizioni valgono sul sample rovesciato.
 * Qui c'è solo la descrizione (parametri e preset); il suono è in sampler-core.ts. */
import type { ParamValues } from '../../../model/device';
import { resolveParams, type DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { LFO_SYNC, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { FILTER, FILTER_TYPES } from '../prisma/prisma';

export { LFO_SYNC, VOICE_MODE };

/** Il posto del sample nel dispositivo (quello della prima zona). */
export const SAMPLE_SLOT = 'sample';

/** Le zone al massimo: ognuna un sample, sui tasti da `lo` a `hi` e sulle velocity da `vlo` a
 *  `vhi`, come nel Sampler di Live. Una nota suona tutte le zone che la contengono. */
export const MAX_ZONES = 32;
/** I parametri dei tre inviluppi (volume, filtro, pitch). */
const ENV_KEYS = ['e1A', 'e1H', 'e1D', 'e1S', 'e1R', 'e1Ac', 'e1Dc', 'e1Rc', 'e2A', 'e2H', 'e2D', 'e2S', 'e2R', 'e2Ac', 'e2Dc', 'e2Rc', 'e3A', 'e3H', 'e3D', 'e3S', 'e3R', 'e3Ac', 'e3Dc', 'e3Rc'] as const;
/** Il suono di una zona: come si legge il sample (loop, reverse), l'intonazione, il filtro, gli
 *  inviluppi e l'LFO. Le zone dalla seconda in su li prendono dalla prima finché non hanno i loro
 *  (`own`). Restano di tutto il Sampler il modo, la voce (Poli, Mono, Legato: una voce sola è di
 *  tutte le zone) con il glide, e l'uscita. */
export const SOUND_KEYS = [
  'loop', 'xfade', 'loopRelease', 'reverse',
  'transpose', 'detune', 'keyTrack', 'pitchEnv',
  'fOn', 'fType', 'fCutoff', 'fRes', 'fDrive', 'fVar', 'fKey', 'fEnv', 'fVel',
  ...ENV_KEYS,
  'lfoShape', 'lfoSync', 'lfoDiv', 'lfoRate', 'lfoTrig', 'lfoFade', 'lfoPitch', 'lfoCutoff', 'lfoVolume', 'lfoPan',
] as const;
/** I parametri di una zona. Quelli della prima per le posizioni, la nota base e il suono sono i
 *  parametri del sample singolo (`start`, `root`, `loop`, `fCutoff`…), così un Sampler con un solo
 *  sample resta com'era. `own` (dalla seconda zona): il suono è suo e non quello della prima. */
export type ZoneKey = 'lo' | 'hi' | 'vlo' | 'vhi' | 'root' | 'gain' | 'pan' | 'start' | 'end' | 'loopStart' | 'loopEnd'
  | 'own' | (typeof SOUND_KEYS)[number];
/** Le chiavi della zona che per la prima zona sono i parametri con il loro nome. */
export const FIRST_ZONE_KEYS: ReadonlySet<ZoneKey> = new Set<ZoneKey>(['root', 'start', 'end', 'loopStart', 'loopEnd', ...SOUND_KEYS]);
const SOUND: ReadonlySet<ZoneKey> = new Set(SOUND_KEYS);
/** Il posto del sample della zona `i` (da 0): "sample", poi "z2", "z3"… */
export const zoneSlot = (i: number): string => (i === 0 ? SAMPLE_SLOT : `z${i + 1}`);
/** La zona di un posto dei sample, o −1. */
export const zoneOfSlot = (slot: string): number => {
  if (slot === SAMPLE_SLOT) return 0;
  const m = /^z(\d+)$/.exec(slot);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 1 && i < MAX_ZONES ? i : -1;
};
/** L'id del parametro `key` della zona `i` (da 0): "z1lo", "z2root"… ("root", "start"… per la prima). */
export const zoneParam = (i: number, key: ZoneKey): string => (i === 0 && FIRST_ZONE_KEYS.has(key) ? key : `z${i + 1}${key}`);
/** Il parametro da cui la zona `i` prende `key`: il suo, o quello della prima se il suono della
 *  zona segue la prima. */
export const zoneSource = (values: Readonly<Record<string, number>>, i: number, key: ZoneKey): string =>
  zoneParam(i > 0 && SOUND.has(key) && values[zoneParam(i, 'own')] !== 1 ? 0 : i, key);
/** I valori che rendono suo il suono della zona `i` (copiato dalla prima), se non lo è già. */
export const ownSound = (values: Readonly<Record<string, number>>, i: number): Record<string, number> =>
  i === 0 || values[zoneParam(i, 'own')] === 1 ? {}
    : { [zoneParam(i, 'own')]: 1, ...Object.fromEntries(SOUND_KEYS.map(k => [zoneParam(i, k), values[k]])) };
/** I parametri che un preset non tocca: la mappa delle zone dipende dai sample caricati (e il
 *  suono proprio di una zona è di quel sample; quello delle zone che seguono la prima lo cambia). */
const ZONE_PARAM = /^z\d+[a-zA-Z]\w*$/;

export const MODES = ['Classic', 'One-Shot', 'Slice'] as const;
export const MODE = { classic: 0, oneShot: 1, slice: 2 } as const;
/** Il loop di Classic: in avanti (con la dissolvenza tra fine e inizio) o avanti e indietro. */
export const LOOPS = ['Off', 'Avanti', 'Ping-pong'] as const;
export const LOOP = { off: 0, forward: 1, pingPong: 2 } as const;
/** Lasciata la nota, il loop continua (e sfuma con il rilascio) o il sample prosegue fino alla fine. */
export const LOOP_RELEASES = ['Nel loop', 'Fino alla fine'] as const;
export const LOOP_RELEASE = { stay: 0, exit: 1 } as const;
/** In One-Shot e Slice: Trigger suona tutto anche se la nota finisce prima; Gate si ferma
 *  (con il rilascio) quando finisce la nota. */
export const TRIGGERS = ['Trigger', 'Gate'] as const;
export const TRIGGER = { trigger: 0, gate: 1 } as const;
export const SLICE_BY = ['Transienti', 'Griglia'] as const;
export const SLICE = { transients: 0, grid: 1 } as const;
export const SLICE_GRIDS = [4, 8, 16, 32, 64] as const;
/** Le fette al massimo (e le note da C1 in su che le suonano). */
export const MAX_SLICES = 64;
/** La nota della prima fetta: C1, come i pad della Drum Machine e le fette di Simpler. */
export const FIRST_SLICE_NOTE = 36;

export const LFO_SHAPES = ['Seno', 'Triangolo', 'Dente ↑', 'Dente ↓', 'Quadra', 'S&H', 'Casuale morbido'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawUp: 2, sawDown: 3, square: 4, sampleHold: 5, smoothRandom: 6 } as const;
/** Nota: l'LFO riparte a ogni nota. Libero: tutte le voci seguono lo stesso giro. */
export const LFO_TRIGS = ['Nota', 'Libero'] as const;
export const LFO_TRIG = { note: 0, free: 1 } as const;

export const ON_OFF = ['Off', 'On'] as const;
/** I tipi del filtro che usano "Var" (comb, formante, phaser). */
export const VAR_FILTERS: readonly number[] = [FILTER.combUp, FILTER.combDown, FILTER.formant, FILTER.phaser];
export { FILTER, FILTER_TYPES };

/** Gli inviluppi, nell'ordine dei loro parametri (`e1A`, `e2A`…). */
export const ENV_NAMES = ['Volume', 'Filtro', 'Pitch'] as const;
export const ENV = { amp: 1, filter: 2, pitch: 3 } as const;

/** Di quante ottave muovono il cutoff, al massimo, l'inviluppo del filtro, la velocity e l'LFO. */
export const FILTER_ENV_OCTAVES = 6;
export const FILTER_VEL_OCTAVES = 4;
export const LFO_CUTOFF_OCTAVES = 3;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Il nome di una nota MIDI come in Live (60 = C3). */
export const noteName = (p: number): string => `${NAMES[p % 12]}${Math.floor(p / 12) - 2}`;
export const NOTE_NAMES = Array.from({ length: 128 }, (_, p) => noteName(p));

/** I parametri delle fette trovate ai transienti (nascosti: si muovono dal disegno). */
export const sliceParam = (k: number): string => `sl${k}`;
export const SLICE_COUNT = 'slices';
export const SENSITIVITY = 'sens';

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number, max = 10) => num(id, label, 0.001, max, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
/** Una posizione nel sample, in percento (senza passo: sui sample lunghi serve finezza). */
const position = (id: string, label: string, def: number, extra: Partial<NumberParam> = {}) => num(id, label, 0, 100, def, '%', extra);

const looping = { param: 'loop', is: [LOOP.forward, LOOP.pingPong] };
const filterOn = { param: 'fOn', is: 1 };

/** Inviluppo `n` (1 volume, 2 filtro, 3 pitch): come quelli di Prisma, con le curve. */
const envParams = (n: number): ParamSpec[] => {
  const amp = n === ENV.amp;
  return [
    time(`e${n}A`, 'Attack', amp ? 0.001 : 0.005),
    time(`e${n}H`, 'Hold', 0.001),
    time(`e${n}D`, 'Decay', amp ? 1 : 0.5),
    percent(`e${n}S`, 'Sustain', amp ? 100 : 0),
    time(`e${n}R`, 'Release', amp ? 0.05 : 0.3),
    num(`e${n}Ac`, 'Curva A', -100, 100, 0, '', { step: 1 }),
    num(`e${n}Dc`, 'Curva D', -100, 100, 60, '', { step: 1 }),
    num(`e${n}Rc`, 'Curva R', -100, 100, 60, '', { step: 1 }),
  ];
};

const SAMPLE_PARAMS: ParamSpec[] = [
  choice('mode', 'Modo', MODES),
  position('start', 'Inizio', 0),
  position('end', 'Fine', 100),
  choice('reverse', 'Reverse', ON_OFF),
  choice('trigger', 'Nota', TRIGGERS, TRIGGER.trigger, { when: { param: 'mode', is: [MODE.oneShot, MODE.slice] } }),
  choice('loop', 'Loop', LOOPS, LOOP.off, { when: { param: 'mode', is: MODE.classic } }),
  position('loopStart', 'Loop da', 0, { when: looping }),
  position('loopEnd', 'Loop a', 100, { when: looping }),
  num('xfade', 'Fade', 0, 50, 0, '%', { step: 1, when: { param: 'loop', is: LOOP.forward } }),
  choice('loopRelease', 'Rilascio', LOOP_RELEASES, LOOP_RELEASE.stay, { when: looping }),
  choice('sliceBy', 'Fette', SLICE_BY, SLICE.transients, { when: { param: 'mode', is: MODE.slice } }),
  choice('sliceGrid', 'Griglia', SLICE_GRIDS.map(String), 2, { when: { param: 'sliceBy', is: SLICE.grid } }),
];

const PITCH_PARAMS: ParamSpec[] = [
  choice('root', 'Nota base', NOTE_NAMES, 60, { when: { param: 'mode', is: [MODE.classic, MODE.oneShot] } }),
  num('transpose', 'Transpose', -48, 48, 0, 'st', { step: 1 }),
  num('detune', 'Detune', -50, 50, 0, 'ct', { step: 1 }),
  { ...percent('keyTrack', 'Key track', 100), when: { param: 'mode', is: [MODE.classic, MODE.oneShot] } },
  choice('voiceMode', 'Voce', VOICE_MODES),
  num('glide', 'Glide', 0, 1000, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
  num('pitchEnv', 'Env pitch', -48, 48, 0, 'st', { step: 0.1 }),
];

const FILTER_PARAMS: ParamSpec[] = [
  choice('fOn', 'Acceso', ON_OFF),
  choice('fType', 'Tipo', FILTER_TYPES, FILTER.lp24, { when: filterOn }),
  num('fCutoff', 'Cutoff', 20, 20000, 6000, 'Hz', { scale: 'log', when: filterOn }),
  { ...percent('fRes', 'Risonanza', 0), when: filterOn },
  { ...percent('fDrive', 'Drive', 0), when: filterOn },
  { ...percent('fVar', 'Var', 50), when: { param: 'fType', is: VAR_FILTERS } },
  { ...percent('fKey', 'Key track', 0), when: filterOn },
  { ...percent('fEnv', 'Inviluppo', 0, -100), when: filterOn },
  { ...percent('fVel', 'Velocity', 0), when: filterOn },
];

const LFO_PARAMS: ParamSpec[] = [
  choice('lfoShape', 'Forma', LFO_SHAPES),
  choice('lfoSync', 'Sincro', ['Tempo', 'Hz'], LFO_SYNC.hz),
  choice('lfoDiv', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/8'], { when: { param: 'lfoSync', is: LFO_SYNC.tempo } }),
  num('lfoRate', 'Velocità', 0.05, 30, 4, 'Hz', { scale: 'log', when: { param: 'lfoSync', is: LFO_SYNC.hz } }),
  choice('lfoTrig', 'Ripartenza', LFO_TRIGS),
  num('lfoFade', 'Entrata', 0, 5, 0, 's', { step: 0.01 }),
  num('lfoPitch', '→ Pitch', 0, 12, 0, 'st', { step: 0.01 }),
  percent('lfoCutoff', '→ Cutoff', 0),
  percent('lfoVolume', '→ Volume', 0),
  percent('lfoPan', '→ Pan', 0),
];

const ENV_PARAMS = [ENV.amp, ENV.filter, ENV.pitch].map(envParams);

/** I parametri della prima zona che le altre hanno uguali, con il loro nome. */
const FIRST_ZONE = new Map([...SAMPLE_PARAMS, ...PITCH_PARAMS, ...FILTER_PARAMS, ...ENV_PARAMS.flat(), ...LFO_PARAMS].map(p => [p.id, p]));

/** Il parametro `key` della zona `i`: come quello della prima zona, nascosto, e con le condizioni
 *  sui parametri della zona (es. "Loop da" conta se c'è il loop della zona). */
const ofZone = (i: number, key: ZoneKey): ParamSpec => {
  const p = FIRST_ZONE.get(key)!, when = p.when;
  const zoneWhen = when && FIRST_ZONE_KEYS.has(when.param as ZoneKey) ? { ...when, param: zoneParam(i, when.param as ZoneKey) } : when;
  return { ...p, id: zoneParam(i, key), hidden: true, ...(zoneWhen ? { when: zoneWhen } : {}) };
};

/** I parametri delle zone (nascosti: si muovono dall'editor delle zone, dalla forma d'onda e dai
 *  controlli del pannello quando si guarda la zona). */
const zoneParams = (): ParamSpec[] => Array.from({ length: MAX_ZONES }, (_, i): ParamSpec[] => {
  const hidden = { hidden: true };
  const own: ParamSpec[] = i === 0 ? [] : [
    ...(['root', 'start', 'end', 'loopStart', 'loopEnd'] as const).map(k => ofZone(i, k)),
    choice(zoneParam(i, 'own'), 'Suono proprio', ON_OFF, 0, hidden),
    ...SOUND_KEYS.map(k => ofZone(i, k)),
  ];
  return [
    choice(zoneParam(i, 'lo'), 'Da', NOTE_NAMES, 0, hidden),
    choice(zoneParam(i, 'hi'), 'A', NOTE_NAMES, 127, hidden),
    num(zoneParam(i, 'vlo'), 'Vel. da', 1, 127, 1, '', { step: 1, ...hidden }),
    num(zoneParam(i, 'vhi'), 'Vel. a', 1, 127, 127, '', { step: 1, ...hidden }),
    num(zoneParam(i, 'gain'), 'Volume', -36, 12, 0, 'dB', { step: 0.5, ...hidden }),
    num(zoneParam(i, 'pan'), 'Pan', -100, 100, 0, 'pan', { step: 1, ...hidden }),
    ...own,
  ];
}).flat();

const sliceParams = (): ParamSpec[] => {
  const hidden = { hidden: true };
  return [
    num(SLICE_COUNT, 'Fette', 0, MAX_SLICES, 0, '', { step: 1, ...hidden }),
    num(SENSITIVITY, 'Sensibilità', 0, 100, 50, '%', { step: 1, ...hidden }),
    ...Array.from({ length: MAX_SLICES }, (_, i) => num(sliceParam(i + 1), `Fetta ${i + 1}`, 0, 1, 0, '', hidden)),
  ];
};

export const SAMPLER: DeviceType = {
  type: 'sampler',
  label: 'Sampler',
  sections: [
    { label: 'Sample', params: [...SAMPLE_PARAMS, ...sliceParams(), ...zoneParams()] },
    { label: 'Intonazione', params: PITCH_PARAMS },
    { label: 'Filtro', params: FILTER_PARAMS },
    { label: 'Inviluppo volume', params: ENV_PARAMS[0] },
    { label: 'Inviluppo filtro', params: ENV_PARAMS[1] },
    { label: 'Inviluppo pitch', params: ENV_PARAMS[2] },
    { label: 'LFO', params: LFO_PARAMS },
    {
      label: 'Uscita',
      params: [
        percent('velocity', 'Velocity', 50),
        num('pan', 'Pan', -100, 100, 0, 'pan', { step: 1 }),
        num('volume', 'Volume', -36, 6, -6, 'dB', { step: 0.5 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'One-shot', params: { mode: MODE.oneShot, e1R: 0.02 } },
    { name: 'Loop sostenuto', params: { loop: LOOP.forward, loopStart: 30, loopEnd: 90, xfade: 30, e1A: 0.01, e1R: 0.6 } },
    {
      name: 'Pad lento',
      params: { loop: LOOP.pingPong, loopStart: 25, loopEnd: 85, e1A: 1.2, e1D: 2, e1S: 85, e1R: 2.5, e1Ac: 40, fOn: 1, fType: FILTER.lp24,
        fCutoff: 1800, fRes: 15, lfoRate: 0.25, lfoCutoff: 25, lfoPan: 30, volume: -9 },
    },
    {
      name: 'Basso',
      params: { voiceMode: VOICE_MODE.legato, glide: 60, fOn: 1, fType: FILTER.ladder, fCutoff: 380, fRes: 45, fEnv: 55, fKey: 40,
        e2D: 0.25, e2S: 10, e1D: 1, e1S: 90, e1R: 0.06, velocity: 40, volume: -8 },
    },
    {
      name: 'Pluck',
      params: { fOn: 1, fType: FILTER.lp24, fCutoff: 500, fRes: 25, fEnv: 70, e2D: 0.3, e2S: 0, e1D: 0.5, e1S: 0, e1R: 0.25 },
    },
    { name: 'Al contrario', params: { reverse: 1, e1A: 0.15, e1Ac: -60, e1R: 0.08 } },
    { name: 'Vibrato', params: { e1A: 0.05, e1R: 0.4, lfoRate: 5.5, lfoFade: 0.6, lfoPitch: 0.3, lfoTrig: LFO_TRIG.note } },
    {
      name: 'Lo-fi',
      params: { fOn: 1, fType: FILTER.bp12, fCutoff: 1400, fRes: 30, fDrive: 60, detune: -12, lfoRate: 0.4, lfoPitch: 0.12, volume: -8 },
    },
    { name: 'Caduta', params: { mode: MODE.oneShot, pitchEnv: -24, e3A: 0.001, e3D: 0.8, e3S: 0, e3Dc: 40 } },
    { name: 'Fette in 16', params: { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 2, voiceMode: VOICE_MODE.mono, e1R: 0.02 } },
  ],
  noteNames: (values, samples) => {
    if (values.mode === MODE.slice) return new Map(Array.from({ length: sliceStarts(values).length }, (_, i) => [FIRST_SLICE_NOTE + i, `Fetta ${i + 1}`]));
    // le zone su un tasto solo (un kit di suoni, uno per tasto) danno il nome del loro sample
    const names = new Map<number, string>();
    for (const [slot, name] of samples ?? []) {
      const i = zoneOfSlot(slot);
      if (i < 0) continue;
      const lo = values[zoneParam(i, 'lo')], hi = values[zoneParam(i, 'hi')];
      if (lo === hi) names.set(lo, names.has(lo) ? `${names.get(lo)} + ${name}` : name);
    }
    return names;
  },
  keepsOnPreset: id => id === 'root' || ZONE_PARAM.test(id),
};

/** Una zona come la usano motore e interfaccia: i suoi tasti, velocity e la nota base. */
export interface ZoneMap {
  readonly index: number;
  readonly lo: number;
  readonly hi: number;
  readonly vlo: number;
  readonly vhi: number;
  readonly root: number;
}

/** La mappa della zona `i` con questi valori. */
export const zoneMap = (values: Readonly<Record<string, number>>, i: number): ZoneMap => {
  const v = (key: ZoneKey) => values[zoneParam(i, key)];
  return { index: i, lo: Math.min(v('lo'), v('hi')), hi: Math.max(v('lo'), v('hi')), vlo: Math.min(v('vlo'), v('vhi')), vhi: Math.max(v('vlo'), v('vhi')), root: v('root') };
};

/** I valori che mettono la zona `i` sui tasti `lo`…`hi` con la nota base `root` (le velocity
 *  tornano tutte). */
export const zoneKeys = (i: number, lo: number, hi: number, root: number): Record<string, number> =>
  ({ [zoneParam(i, 'lo')]: lo, [zoneParam(i, 'hi')]: hi, [zoneParam(i, 'root')]: root });

/** Tutti i parametri della zona `i` ai predefiniti (per una zona nuova o tolta). */
export const zoneDefaults = (i: number): Record<string, number> => {
  const keys: ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'root', 'gain', 'pan', 'start', 'end', 'loopStart', 'loopEnd'];
  // il suono della prima zona sono i parametri del Sampler: resta
  if (i > 0) keys.push('own', ...SOUND_KEYS);
  const specs = SAMPLER.sections.flatMap(s => s.params);
  return Object.fromEntries(keys.map(k => zoneParam(i, k)).map(id => [id, specs.find(p => p.id === id)!.default]));
};

/** I parametri di un Sampler salvato fino alla 0.3.18, quando le zone avevano Tune e Fine, con
 *  quei valori nel Transpose e nel Detune del suono della zona (gli stessi parametri di oggi
 *  altrimenti). Una zona che seguiva la prima e che la conversione cambierebbe prende il suo
 *  suono, così tutte suonano com'erano. `samples`: i posti dei sample caricati; senza (un rack
 *  salvato) contano le zone di cui c'è qualche parametro. */
export function upgradeZoneTune(params: ParamValues, samples?: Readonly<Record<string, unknown>>): ParamValues {
  const stale = Object.keys(params).filter(k => /^z\d+(tune|fine)$/.test(k));
  if (!stale.length) return params;
  const shift = Array.from({ length: MAX_ZONES }, (_, i) => (params[`z${i + 1}tune`] ?? 0) + (params[`z${i + 1}fine`] ?? 0) / 100);
  const named = new Set(Object.keys(params).map(k => Number(/^z(\d+)[a-zA-Z]/.exec(k)?.[1]) - 1));
  const used = (i: number) => (samples ? !!samples[zoneSlot(i)] : named.has(i));
  const v = resolveParams(SAMPLER, params);
  const out: Record<string, number> = { ...params };
  for (const k of stale) delete out[k];
  // il Tune della prima zona va nel Transpose del Sampler, che le zone che la seguono prendono
  for (let i = 1; i < MAX_ZONES; i++) if (used(i) && (shift[0] || shift[i])) Object.assign(out, ownSound(v, i));
  for (let i = 0; i < MAX_ZONES; i++) {
    const now = { ...v, ...out };
    if (!shift[i] || (i > 0 && now[zoneParam(i, 'own')] !== 1)) continue;
    const semis = now[zoneParam(i, 'transpose')] + now[zoneParam(i, 'detune')] / 100 + shift[i];
    const st = Math.max(-48, Math.min(48, Math.round(semis)));
    out[zoneParam(i, 'transpose')] = st;
    out[zoneParam(i, 'detune')] = Math.max(-50, Math.min(50, Math.round((semis - st) * 100)));
  }
  return out;
}

/** La nota scritta nel nome di un file ("Piano C3.wav", "bass_f#1", "Vox-Eb2"), come la
 *  scrive Live (C3 = 60), o null. */
export function noteInName(name: string): number | null {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  // l'ultima nota scritta nel nome, staccata da altre lettere ("Bd1" non è un D1)
  const found = [...base.matchAll(/(?<![a-z])([a-g])([#b♯♭]?)(-?[0-8])(?![0-9])/gi)].at(-1);
  if (!found) return null;
  const pc = ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 } as Record<string, number>)[found[1].toLowerCase()];
  const acc = found[2] === '#' || found[2] === '♯' ? 1 : found[2] ? -1 : 0;
  const p = pc + acc + (Number(found[3]) + 2) * 12;
  return p >= 0 && p <= 127 ? p : null;
}

/** I tasti di zone con queste note base, come un multicampionamento: ognuna va da metà strada
 *  dalla nota sotto a metà strada da quella sopra (la più bassa da C-2, la più alta fino a G8);
 *  zone con la stessa nota base prendono gli stessi tasti. */
export function spreadRanges(roots: readonly number[]): { lo: number; hi: number }[] {
  const unique = [...new Set(roots)].sort((a, b) => a - b);
  return roots.map(r => {
    const k = unique.indexOf(r), prev = unique[k - 1], next = unique[k + 1];
    return { lo: prev === undefined ? 0 : Math.floor((prev + r) / 2) + 1, hi: next === undefined ? 127 : Math.floor((r + next) / 2) };
  });
}

/** Dove vanno dei sample caricati insieme, uno per zona: se sono più d'uno e tutti i nomi dicono
 *  una nota ("Piano C3"), quella è la nota base e le zone si dividono la tastiera (vedi
 *  spreadRanges); altrimenti un tasto ciascuno da `first` in su, con la nota base sul tasto
 *  (suonano alla loro altezza, come i pad di una batteria). */
export function layoutZones(names: readonly string[], first: number): { lo: number; hi: number; root: number }[] {
  const notes = names.map(noteInName);
  if (names.length > 1 && notes.every(n => n !== null)) {
    const roots = notes as number[];
    return spreadRanges(roots).map((r, i) => ({ ...r, root: roots[i] }));
  }
  return names.map((_, i) => {
    const key = Math.max(0, Math.min(127, first + i));
    return { lo: key, hi: key, root: key };
  });
}

/** Gli inizi delle fette (frazioni del sample, in ordine) dentro la regione Inizio…Fine: in
 *  parti uguali con la griglia; ai transienti trovati (i parametri nascosti), più l'inizio. La
 *  fine di una fetta è l'inizio della successiva (dell'ultima: Fine). */
export function sliceStarts(values: Readonly<Record<string, number>>): number[] {
  const a = clamp01(values.start / 100), b = Math.max(a, clamp01(values.end / 100));
  if (b - a <= 0) return [];
  if (values.sliceBy === SLICE.grid) {
    const n = SLICE_GRIDS[values.sliceGrid] ?? 16;
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / n);
  }
  const count = Math.max(0, Math.min(MAX_SLICES, Math.round(values[SLICE_COUNT] ?? 0)));
  const inside: number[] = [];
  for (let k = 1; k <= count; k++) {
    const x = values[sliceParam(k)];
    // un transiente proprio sull'inizio è la prima fetta; quelli fuori dalla regione non suonano
    if (x > a + 1e-6 && x < b - 1e-6) inside.push(x);
  }
  inside.sort((x, y) => x - y);
  return [a, ...inside].slice(0, MAX_SLICES);
}

/** I parametri che descrivono le fette `points` (frazioni del sample, già in ordine). */
export function sliceValues(points: readonly number[]): Record<string, number> {
  const kept = points.slice(0, MAX_SLICES);
  const out: Record<string, number> = { [SLICE_COUNT]: kept.length };
  for (let k = 1; k <= MAX_SLICES; k++) out[sliceParam(k)] = k <= kept.length ? Math.round(kept[k - 1] * 1e6) / 1e6 : 0;
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
