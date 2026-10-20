/* "Sampler": suona un file audio sulla tastiera, come Simpler e Sampler di Live. Tre modi:
 * Classic (il sample all'intonazione del tasto, con il loop che tiene la nota finché la si
 * tiene), One-Shot (dall'inizio alla fine a ogni colpo, il rilascio non lo ferma) e Slice (il
 * sample tagliato a fette, una per tasto da C1 in su, ai transienti o in parti uguali). Poi il
 * filtro (gli stessi tipi di Prisma), tre inviluppi con le curve (volume, filtro, pitch) e un
 * LFO su pitch, filtro, volume e pan.
 * Le posizioni (inizio, fine, loop, fette) sono frazioni del sample come lo si vede: con
 * Reverse il sample è rovesciato e le posizioni valgono sul sample rovesciato.
 * Qui c'è solo la descrizione (parametri e preset); il suono è in sampler-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { LFO_SYNC, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { FILTER, FILTER_TYPES } from '../prisma/prisma';

export { LFO_SYNC, VOICE_MODE };

/** Il posto del sample nel dispositivo. */
export const SAMPLE_SLOT = 'sample';

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
    {
      label: 'Sample',
      params: [
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
        ...sliceParams(),
      ],
    },
    {
      label: 'Intonazione',
      params: [
        choice('root', 'Nota base', NOTE_NAMES, 60, { when: { param: 'mode', is: [MODE.classic, MODE.oneShot] } }),
        num('transpose', 'Transpose', -48, 48, 0, 'st', { step: 1 }),
        num('detune', 'Detune', -50, 50, 0, 'ct', { step: 1 }),
        { ...percent('keyTrack', 'Key track', 100), when: { param: 'mode', is: [MODE.classic, MODE.oneShot] } },
        choice('voiceMode', 'Voce', VOICE_MODES),
        num('glide', 'Glide', 0, 1000, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        num('pitchEnv', 'Env pitch', -48, 48, 0, 'st', { step: 0.1 }),
      ],
    },
    {
      label: 'Filtro',
      params: [
        choice('fOn', 'Acceso', ON_OFF),
        choice('fType', 'Tipo', FILTER_TYPES, FILTER.lp24, { when: filterOn }),
        num('fCutoff', 'Cutoff', 20, 20000, 6000, 'Hz', { scale: 'log', when: filterOn }),
        { ...percent('fRes', 'Risonanza', 0), when: filterOn },
        { ...percent('fDrive', 'Drive', 0), when: filterOn },
        { ...percent('fVar', 'Var', 50), when: { param: 'fType', is: VAR_FILTERS } },
        { ...percent('fKey', 'Key track', 0), when: filterOn },
        { ...percent('fEnv', 'Inviluppo', 0, -100), when: filterOn },
        { ...percent('fVel', 'Velocity', 0), when: filterOn },
      ],
    },
    { label: 'Inviluppo volume', params: envParams(ENV.amp) },
    { label: 'Inviluppo filtro', params: envParams(ENV.filter) },
    { label: 'Inviluppo pitch', params: envParams(ENV.pitch) },
    {
      label: 'LFO',
      params: [
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
      ],
    },
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
  noteNames: values => {
    if (values.mode !== MODE.slice) return new Map();
    return new Map(Array.from({ length: sliceStarts(values).length }, (_, i) => [FIRST_SLICE_NOTE + i, `Fetta ${i + 1}`]));
  },
};

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
