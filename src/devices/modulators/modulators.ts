/* I modulatori: "LFO" e "Inviluppo", dispositivi della catena che non toccano il suono (passa
 * com'è) ma muovono fino a 8 parametri qualsiasi della traccia: quelli dello strumento e degli
 * effetti, le macro dei rack, il volume e il pan. Sono gli LFO e gli inviluppi di Prisma portati
 * fuori dal synth: la stessa forma da disegnare (con le curve), lo stesso inviluppo con hold e
 * curve. Ogni destinazione ha la sua quantità, in frazione della corsa della manopola (−100 …
 * +100 %): come le curve delle clip, sposta la manopola da dov'è, e si somma a loro.
 * Il calcolo è nel motore (engine/device-modulators.ts), programmato in anticipo come le curve;
 * qui c'è la descrizione, in mod-shapes.ts le forme. */
import type { DeviceType } from '../device-type';
import { LFO_POINTS, LFO_SHAPE, LFO_SHAPES, pointCountParam, pointParam, pointsForShape } from '../instruments/prisma/shapes';
import type { ChoiceParam, NumberParam, ParamSpec } from '../params';
import { TEMPO_RATE, TEMPO_RATES } from '../rates';

/** Le destinazioni di un modulatore. */
export const MOD_LINKS = 8;

/** La quantità della destinazione `n` (1 … MOD_LINKS): un parametro come gli altri, quindi si
 *  può mappare su una macro e muovere con le curve delle clip. */
export const linkAmount = (n: number): string => `a${n}`;

export const SYNC = { tempo: 0, hz: 1 } as const;
/** Libero: agganciato alla battuta (a tempo) o all'orologio (in Hz). Nota: riparte a ogni nota
 *  della traccia. Una volta: a ogni nota fa un giro solo e resta sull'ultimo valore. */
export const LFO_TRIGS = ['Libero', 'Nota', 'Una volta'] as const;
export const LFO_TRIG = { free: 0, note: 1, once: 2 } as const;
/** Nota: parte con ogni nota della traccia e rilascia quando finisce. Tempo: parte a ogni
 *  divisione della battuta e resta acceso per `gate` della divisione (anche sulle tracce audio). */
export const ENV_TRIGS = ['Nota', 'Tempo'] as const;
export const ENV_TRIG = { note: 0, tempo: 1 } as const;
/** Uni: da 0 a +1 (la manopola si sposta da una parte sola). Bi: da −1 a +1, intorno alla manopola. */
export const POLARITIES = ['Uni', 'Bi'] as const;
export const POLARITY = { uni: 0, bi: 1 } as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number, max = 10) => num(id, label, 0.001, max, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });

const links: ParamSpec[] = Array.from({ length: MOD_LINKS }, (_, i) => num(linkAmount(i + 1), `Quantità ${i + 1}`, -100, 100, 50, '%', { step: 1 }));
const output = (polarity: number): ParamSpec[] => [
  percent('depth', 'Profondità', 100),
  choice('pol', 'Polarità', POLARITIES, polarity),
];

/** I punti della forma disegnata (come un LFO di Prisma, il primo: `l1Pts`, `l1X2`…), nascosti:
 *  si muovono solo dal disegno. */
function pointParams(): ParamSpec[] {
  const start = pointsForShape(LFO_SHAPE.triangle);
  const hidden = { hidden: true };
  const out: ParamSpec[] = [num(pointCountParam(1), 'Punti', 2, LFO_POINTS, start.length, '', { step: 1, ...hidden })];
  for (let k = 1; k <= LFO_POINTS; k++) {
    const p = start[k - 1];
    out.push(
      num(pointParam(1, 'X', k), `Punto ${k} x`, 0, 1, p?.x ?? 1, '', hidden),
      num(pointParam(1, 'Y', k), `Punto ${k} y`, 0, 1, p?.y ?? 0, '', hidden),
      num(pointParam(1, 'C', k), `Punto ${k} curva`, -100, 100, 0, '', { step: 1, ...hidden }),
    );
  }
  return out;
}

export const LFO_DEVICE: DeviceType = {
  type: 'lfo',
  label: 'LFO',
  modulator: true,
  sections: [
    {
      label: 'Forma',
      params: [
        choice('l1Shape', 'Forma', LFO_SHAPES, LFO_SHAPE.sine),
        choice('sync', 'Sincro', ['Tempo', 'Hz'], SYNC.tempo),
        choice('division', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'sync', is: SYNC.tempo } }),
        num('rate', 'Velocità', 0.01, 40, 1, 'Hz', { scale: 'log', when: { param: 'sync', is: SYNC.hz } }),
        choice('trig', 'Ripartenza', LFO_TRIGS),
        num('phase', 'Fase', 0, 360, 0, '°', { step: 1 }),
        time('delay', 'Ritardo', 0.001),
        time('rise', 'Salita', 0.001),
        ...pointParams(),
      ],
    },
    { label: 'Uscita', params: output(POLARITY.bi) },
    { label: 'Destinazioni', params: links },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Wobble 1/8', params: { division: TEMPO_RATE['1/8'], pol: POLARITY.uni } },
    { name: 'Respiro 2 battute', params: { division: TEMPO_RATE['2 battute'], l1Shape: LFO_SHAPE.triangle } },
    { name: 'Salita 4 battute', params: { division: TEMPO_RATE['4 battute'], l1Shape: LFO_SHAPE.sawUp, pol: POLARITY.uni } },
    { name: 'Quadra 1/16', params: { division: TEMPO_RATE['1/16'], l1Shape: LFO_SHAPE.square, pol: POLARITY.uni } },
    { name: 'Casuale 1/16', params: { division: TEMPO_RATE['1/16'], l1Shape: LFO_SHAPE.sampleHold } },
    { name: 'Deriva lenta', params: { division: TEMPO_RATE['8 battute'], l1Shape: LFO_SHAPE.smoothRandom } },
    { name: 'Vibrato', params: { sync: SYNC.hz, rate: 5.5, trig: LFO_TRIG.note, delay: 0.25, rise: 0.4 } },
  ],
};

export const ENVELOPE_DEVICE: DeviceType = {
  type: 'envelope',
  label: 'Inviluppo',
  modulator: true,
  sections: [
    {
      label: 'Inviluppo',
      // gli stessi nomi del secondo inviluppo di Prisma ("e1…", per il disegno), che parte come un pluck
      params: [
        time('e1A', 'Attack', 0.005),
        time('e1H', 'Hold', 0.001),
        time('e1D', 'Decay', 0.5),
        percent('e1S', 'Sustain', 0),
        time('e1R', 'Release', 0.3),
        num('e1Ac', 'Curva A', -100, 100, 0, '', { step: 1 }),
        num('e1Dc', 'Curva D', -100, 100, 60, '', { step: 1 }),
        num('e1Rc', 'Curva R', -100, 100, 60, '', { step: 1 }),
      ],
    },
    {
      label: 'Partenza',
      params: [
        choice('trig', 'Partenza', ENV_TRIGS),
        choice('division', 'Ogni', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'trig', is: ENV_TRIG.tempo } }),
        percent('gate', 'Gate', 50),
        percent('vel', 'Velocity', 0),
      ],
    },
    { label: 'Uscita', params: output(POLARITY.uni) },
    { label: 'Destinazioni', params: links },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Pluck', params: { e1D: 0.25 } },
    { name: 'Pompa 1/4', params: { trig: ENV_TRIG.tempo, e1A: 0.001, e1D: 0.22, e1S: 0, e1Dc: 40, a1: -100 } },
    { name: 'Pompa 1/8', params: { trig: ENV_TRIG.tempo, division: TEMPO_RATE['1/8'], e1A: 0.001, e1D: 0.12, e1Dc: 40, a1: -100 } },
    { name: 'Swell', params: { e1A: 1.5, e1Ac: -40, e1D: 1, e1S: 100, e1R: 1 } },
    { name: 'Colpo lungo', params: { e1D: 2, e1Dc: 70, e1R: 1 } },
    { name: 'Gate a tempo', params: { trig: ENV_TRIG.tempo, division: TEMPO_RATE['1/16'], gate: 40, e1A: 0.002, e1D: 0.01, e1S: 100, e1R: 0.02 } },
  ],
};

/** Vero per i tipi che non toccano il suono e muovono altri parametri. */
export const isModulatorType = (type: string): boolean => type === LFO_DEVICE.type || type === ENVELOPE_DEVICE.type;
