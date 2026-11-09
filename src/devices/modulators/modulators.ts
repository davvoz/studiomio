/* The modulators: "LFO" and "Envelope", chain devices that don't touch the sound (it passes
 * as it is) but move up to 8 arbitrary parameters of the track: those of the instrument and the
 * effects, the racks' macros, the volume and the pan. They're Prisma's LFOs and envelopes brought
 * out of the synth: the same shape to draw (with the curves), the same envelope with hold and
 * curves. Each target has its own amount, as a fraction of the knob's travel (−100 …
 * +100 %): like the clip curves, it moves the knob from where it is, and adds to them.
 * The computation is in the engine (engine/device-modulators.ts), scheduled in advance like the curves;
 * here is the description, the shapes in mod-shapes.ts. */
import type { DeviceType } from '../device-type';
import { LFO_POINTS, LFO_SHAPE, LFO_SHAPES, pointCountParam, pointParam, pointsForShape } from '../instruments/prisma/shapes';
import type { ChoiceParam, NumberParam, ParamSpec } from '../params';
import { TEMPO_RATE, TEMPO_RATES } from '../rates';

/** A modulator's targets. */
export const MOD_LINKS = 8;

/** The amount of target `n` (1 … MOD_LINKS): a parameter like the others, so it
 *  can be mapped to a macro and moved with the clip curves. */
export const linkAmount = (n: number): string => `a${n}`;

export const SYNC = { tempo: 0, hz: 1 } as const;
/** Free: locked to the bar (synced) or to the clock (in Hz). Note: restarts at every note
 *  of the track. Once: at every note it does a single cycle and stays on the last value. */
export const LFO_TRIGS = ['Free', 'Note', 'Once'] as const;
export const LFO_TRIG = { free: 0, note: 1, once: 2 } as const;
/** Note: starts with every note of the track and releases when it ends. Tempo: starts at every
 *  division of the bar and stays on for `gate` of the division (also on audio tracks). */
export const ENV_TRIGS = ['Note', 'Tempo'] as const;
export const ENV_TRIG = { note: 0, tempo: 1 } as const;
/** Uni: from 0 to +1 (the knob moves in one direction only). Bi: from −1 to +1, around the knob. */
export const POLARITIES = ['Uni', 'Bi'] as const;
export const POLARITY = { uni: 0, bi: 1 } as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number, max = 10) => num(id, label, 0.001, max, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });

const links: ParamSpec[] = Array.from({ length: MOD_LINKS }, (_, i) => num(linkAmount(i + 1), `Amount ${i + 1}`, -100, 100, 50, '%', { step: 1 }));
const output = (polarity: number): ParamSpec[] => [
  percent('depth', 'Depth', 100),
  choice('pol', 'Polarity', POLARITIES, polarity),
];

/** The points of the drawn shape (like a Prisma LFO, the first: `l1Pts`, `l1X2`…), hidden:
 *  they move only from the drawing. */
function pointParams(): ParamSpec[] {
  const start = pointsForShape(LFO_SHAPE.triangle);
  const hidden = { hidden: true };
  const out: ParamSpec[] = [num(pointCountParam(1), 'Points', 2, LFO_POINTS, start.length, '', { step: 1, ...hidden })];
  for (let k = 1; k <= LFO_POINTS; k++) {
    const p = start[k - 1];
    out.push(
      num(pointParam(1, 'X', k), `Point ${k} x`, 0, 1, p?.x ?? 1, '', hidden),
      num(pointParam(1, 'Y', k), `Point ${k} y`, 0, 1, p?.y ?? 0, '', hidden),
      num(pointParam(1, 'C', k), `Point ${k} curve`, -100, 100, 0, '', { step: 1, ...hidden }),
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
      label: 'Shape',
      params: [
        choice('l1Shape', 'Shape', LFO_SHAPES, LFO_SHAPE.sine),
        choice('sync', 'Sync', ['Tempo', 'Hz'], SYNC.tempo),
        choice('division', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'sync', is: SYNC.tempo } }),
        num('rate', 'Rate', 0.01, 40, 1, 'Hz', { scale: 'log', when: { param: 'sync', is: SYNC.hz } }),
        choice('trig', 'Restart', LFO_TRIGS),
        num('phase', 'Phase', 0, 360, 0, '°', { step: 1 }),
        time('delay', 'Delay', 0.001),
        time('rise', 'Rise', 0.001),
        ...pointParams(),
      ],
    },
    { label: 'Output', params: output(POLARITY.bi) },
    { label: 'Targets', params: links },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Wobble 1/8', params: { division: TEMPO_RATE['1/8'], pol: POLARITY.uni } },
    { name: '2-bar breath', params: { division: TEMPO_RATE['2 bars'], l1Shape: LFO_SHAPE.triangle } },
    { name: '4-bar rise', params: { division: TEMPO_RATE['4 bars'], l1Shape: LFO_SHAPE.sawUp, pol: POLARITY.uni } },
    { name: 'Square 1/16', params: { division: TEMPO_RATE['1/16'], l1Shape: LFO_SHAPE.square, pol: POLARITY.uni } },
    { name: 'Random 1/16', params: { division: TEMPO_RATE['1/16'], l1Shape: LFO_SHAPE.sampleHold } },
    { name: 'Slow drift', params: { division: TEMPO_RATE['8 bars'], l1Shape: LFO_SHAPE.smoothRandom } },
    { name: 'Vibrato', params: { sync: SYNC.hz, rate: 5.5, trig: LFO_TRIG.note, delay: 0.25, rise: 0.4 } },
  ],
};

export const ENVELOPE_DEVICE: DeviceType = {
  type: 'envelope',
  label: 'Envelope',
  modulator: true,
  sections: [
    {
      label: 'Envelope',
      // the same names as Prisma's second envelope ("e1…", for the drawing), which starts as a pluck
      params: [
        time('e1A', 'Attack', 0.005),
        time('e1H', 'Hold', 0.001),
        time('e1D', 'Decay', 0.5),
        percent('e1S', 'Sustain', 0),
        time('e1R', 'Release', 0.3),
        num('e1Ac', 'Curve A', -100, 100, 0, '', { step: 1 }),
        num('e1Dc', 'Curve D', -100, 100, 60, '', { step: 1 }),
        num('e1Rc', 'Curve R', -100, 100, 60, '', { step: 1 }),
      ],
    },
    {
      label: 'Start',
      params: [
        choice('trig', 'Start', ENV_TRIGS),
        choice('division', 'Every', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'trig', is: ENV_TRIG.tempo } }),
        percent('gate', 'Gate', 50),
        percent('vel', 'Velocity', 0),
      ],
    },
    { label: 'Output', params: output(POLARITY.uni) },
    { label: 'Targets', params: links },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Pluck', params: { e1D: 0.25 } },
    { name: 'Pump 1/4', params: { trig: ENV_TRIG.tempo, e1A: 0.001, e1D: 0.22, e1S: 0, e1Dc: 40, a1: -100 } },
    { name: 'Pump 1/8', params: { trig: ENV_TRIG.tempo, division: TEMPO_RATE['1/8'], e1A: 0.001, e1D: 0.12, e1Dc: 40, a1: -100 } },
    { name: 'Swell', params: { e1A: 1.5, e1Ac: -40, e1D: 1, e1S: 100, e1R: 1 } },
    { name: 'Long hit', params: { e1D: 2, e1Dc: 70, e1R: 1 } },
    { name: 'Tempo gate', params: { trig: ENV_TRIG.tempo, division: TEMPO_RATE['1/16'], gate: 40, e1A: 0.002, e1D: 0.01, e1S: 100, e1R: 0.02 } },
  ],
};

/** True for the types that don't touch the sound and move other parameters. */
export const isModulatorType = (type: string): boolean => type === LFO_DEVICE.type || type === ENVELOPE_DEVICE.type;
