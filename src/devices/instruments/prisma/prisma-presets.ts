/* Prisma's presets. Each preset gives only the values different from the defaults; the modulations are
 * written as matrix rows ([source, target, amount, options]) and the drawn
 * LFOs as points. */
import type { Preset } from '../../device-type';
import type { ParamValues } from '../../../model/device';
import { TEMPO_RATE } from '../../rates';
import { TABLE_NAMES } from '../wavetable/tables';
import { destinationOf, FILTER, FILTER_MODE, LFO_SYNC, LFO_TRIG, NOISE, ROUTE, slotParam, SRC, VOICE_MODE, WARP } from './prisma';
import { LFO_SHAPE, pointValues, type LfoPoint } from './shapes';

/** A matrix row: the source (SRC), the target parameter, the amount (−100…100). */
export type ModRow = readonly [src: number, dst: string, amount: number, options?: { readonly bi?: boolean; readonly curve?: number; readonly aux?: number }];

/** The matrix rows as parameters, from the first slot. */
export function mods(...rows: readonly ModRow[]): ParamValues {
  const out: Record<string, number> = {};
  rows.forEach(([src, dst, amount, o = {}], i) => {
    const n = i + 1, d = destinationOf(dst);
    if (!d) throw new Error(`Prisma: "${dst}" isn't a target`);
    out[slotParam(n, 'Src')] = src;
    out[slotParam(n, 'Dst')] = d;
    out[slotParam(n, 'Amt')] = amount;
    if (o.bi) out[slotParam(n, 'Pol')] = 1;
    if (o.curve) out[slotParam(n, 'Curve')] = o.curve;
    if (o.aux) out[slotParam(n, 'Aux')] = o.aux;
  });
  return out;
}

/** A drawn LFO: the points as [x, y, curve]. */
export function drawn(lfo: number, points: readonly (readonly [number, number, number?])[]): ParamValues {
  const list: LfoPoint[] = points.map(([x, y, curve = 0]) => ({ x, y, curve }));
  return { [`l${lfo}Shape`]: LFO_SHAPE.drawn, ...pointValues(lfo, list) };
}

let cache: readonly Preset[] | null = null;

/** The presets, built the first time they're needed. */
export function prismaPresets(): readonly Preset[] {
  return (cache ??= build());
}

/** The tables, by name. */
const T = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, i])) as Readonly<Record<string, number>>;
const R = TEMPO_RATE;

function build(): Preset[] {
  return [
    { name: 'Init', params: {} },
    // ---- basses
    {
      name: 'Deep reese',
      params: {
        aUnison: 4, aDetune: 18, aWidth: 35, bOn: 1, bTable: T.Basic, bPos: 67, bFine: -9, bUnison: 2, bDetune: 12, bLevel: 70, subOn: 1, subLevel: 70,
        voiceMode: VOICE_MODE.mono, glide: 40, f1Type: FILTER.lp24, f1Cutoff: 700, f1Res: 20, f1Drive: 30, f1Key: 30, e1R: 0.08, volume: -11,
        l1Shape: LFO_SHAPE.triangle, l1Div: R['2 bars'], l1Trig: LFO_TRIG.free, l2Div: R['4 bars'], l2Trig: LFO_TRIG.free,
        ...mods([SRC.lfo1, 'f1Cutoff', 12, { bi: true }], [SRC.lfo2, 'bFine', 25, { bi: true }]),
      },
    },
    {
      name: 'Wobble 1/8',
      params: {
        aTable: T.Growl, aPos: 15, bOn: 1, bTable: T.Vocal, bPos: 30, bLevel: 55, bOct: -1, subOn: 1, subLevel: 65, voiceMode: VOICE_MODE.legato,
        glide: 30, f1Type: FILTER.lp24, f1Cutoff: 260, f1Res: 35, f1Drive: 45, e1R: 0.06, volume: -10.5, l1Div: R['1/8'],
        ...mods([SRC.lfo1, 'f1Cutoff', 45], [SRC.lfo1, 'aPos', 55], [SRC.lfo1, 'bPos', 40]),
      },
    },
    {
      name: 'FM growl bass',
      params: {
        aPos: 0, aWarp: WARP.fm, aWarpAmt: 30, bOn: 1, bTable: T.Basic, bPos: 30, bLevel: 0, bOct: 1, subOn: 1, subLevel: 60, voiceMode: VOICE_MODE.mono,
        glide: 25, f1Type: FILTER.ladder, f1Cutoff: 2200, f1Res: 30, f1Drive: 50, e1R: 0.06, e2D: 0.35, e2S: 30, volume: -6,
        l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l1Smooth: 20,
        ...mods([SRC.env2, 'aWarpAmt', 40], [SRC.lfo1, 'aWarpAmt', 25, { bi: true }], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      name: 'Falling 808',
      params: {
        aPos: 0, aRand: 0, voiceMode: VOICE_MODE.mono, glide: 60, f1Drive: 35, e1A: 0.001, e1D: 1.6, e1S: 0, e1R: 0.4, e1Dc: 40,
        e2A: 0.001, e2D: 0.09, e2Dc: 70, volume: -10, ...mods([SRC.env2, 'tune', 25], [SRC.velocity, 'volume', 18]),
      },
    },
    {
      name: 'Acid bass',
      params: {
        voiceMode: VOICE_MODE.legato, glide: 70, f1Type: FILTER.ladder, f1Cutoff: 320, f1Res: 75, f1Drive: 30, f1Key: 20, e1R: 0.04, e2D: 0.22,
        volume: -7, ...mods([SRC.env2, 'f1Cutoff', 50], [SRC.velocity, 'f1Cutoff', 15], [SRC.velocity, 'f1Res', 10]),
      },
    },
    {
      name: 'Digital bass',
      params: {
        aTable: T.Digital, aPos: 25, aWarp: WARP.quantize, aWarpAmt: 30, subOn: 1, subShape: 3, subLevel: 45, voiceMode: VOICE_MODE.mono, glide: 20,
        f1Type: FILTER.lp24, f1Cutoff: 1500, f1Res: 25, e1D: 0.4, e1S: 60, e1R: 0.05, e2D: 0.15, volume: -9,
        ...mods([SRC.env2, 'aPos', 45], [SRC.env2, 'f1Cutoff', 35]),
      },
    },
    {
      name: 'Pure sub',
      params: {
        aPos: 0, aRand: 0, voiceMode: VOICE_MODE.mono, glide: 15, f1On: 0, e1A: 0.003, e1R: 0.06, volume: -14,
        ...mods([SRC.velocity, 'volume', 10]),
      },
    },
    {
      // dark techno's boom: a saturated, closed triangle dying out slowly
      name: 'Boom',
      params: {
        aPos: 30, aRand: 0, subOn: 1, subLevel: 50, voiceMode: VOICE_MODE.mono, f1Type: FILTER.ladder, f1Cutoff: 220, f1Res: 25, f1Drive: 75,
        e1A: 0.002, e1D: 0.9, e1S: 0, e1R: 0.5, e1Dc: 30, e2A: 0.001, e2D: 0.12, l1Shape: LFO_SHAPE.sine, l1Div: R['1/16'], volume: 0,
        ...mods([SRC.env2, 'f1Cutoff', 25], [SRC.lfo1, 'f1Cutoff', 6, { bi: true }], [SRC.velocity, 'f1Drive', 20]),
      },
    },
    {
      name: 'Rolling bass',
      params: {
        aUnison: 2, aDetune: 8, aWidth: 30, subOn: 1, subLevel: 55, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 350, f1Res: 30,
        f1Drive: 25, f1Key: 40, e1A: 0.001, e1D: 0.22, e1S: 25, e1R: 0.06, e2A: 0.001, e2D: 0.12, e2Dc: 70, volume: -5,
        ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.velocity, 'f1Cutoff', 15], [SRC.velocity, 'e2D', 20]),
      },
    },
    {
      // short, with the filter breathing over four bars: for techno's long loops
      name: 'Hypnotic bass',
      params: {
        aTable: T.Harmonics, aPos: 55, aUnison: 2, aDetune: 6, subOn: 1, subLevel: 50, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono,
        f1Type: FILTER.lp24, f1Cutoff: 450, f1Res: 40, f1Drive: 30, e1A: 0.001, e1D: 0.25, e1S: 10, e1R: 0.08, e2A: 0.001, e2D: 0.1,
        l1Shape: LFO_SHAPE.sine, l1Div: R['4 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Div: R['8 bars'],
        l2Trig: LFO_TRIG.free, volume: -7,
        ...mods(
          [SRC.env2, 'f1Cutoff', 25], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }], [SRC.lfo2, 'f1Res', 15, { bi: true }],
          [SRC.lfo2, 'aPos', 20, { bi: true }],
        ),
      },
    },
    {
      // short and on the offbeat: leaves room for the kick
      name: 'Offbeat bass',
      params: {
        aUnison: 3, aDetune: 10, aWidth: 40, subOn: 1, subLevel: 60, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 600, f1Res: 20,
        f1Drive: 20, e1A: 0.001, e1D: 0.15, e1S: 0, e1R: 0.05, e2A: 0.001, e2D: 0.08, volume: -6,
        ...mods([SRC.env2, 'f1Cutoff', 30], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      // the octaves jumping in sixteenths (LFO 1), the filter plucking each step (LFO 2)
      name: 'Octave bass',
      params: {
        aUnison: 2, aDetune: 10, aLevel: 35, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 500, f1Res: 35, f1Drive: 30, e1R: 0.05,
        l1Div: R['1/8'], ...drawn(1, steps([0, 1])), l2Div: R['1/16'], ...drawn(2, [[0, 1, 60], [0.8, 0], [1, 0]]), volume: -9,
        ...mods([SRC.lfo1, 'tune', 25], [SRC.lfo2, 'f1Cutoff', 35], [SRC.lfo2, 'aLevel', 60]),
      },
    },
    {
      // two detuned, saturated saws, the direct sub, a slow phaser in the second filter
      name: 'Dirty reese',
      params: {
        aUnison: 2, aDetune: 20, aWidth: 60, bOn: 1, bTable: T.Basic, bPos: 67, bFine: 15, bUnison: 2, bDetune: 14, bLevel: 70, subOn: 1,
        subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 35, f1Type: FILTER.ladder, f1Cutoff: 1100, f1Res: 20,
        f1Drive: 70, f2On: 1, f2Type: FILTER.phaser, f2Cutoff: 700, f2Res: 50, f2Var: 60, e1R: 0.08, l1Shape: LFO_SHAPE.triangle,
        l1Div: R['2 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['1 bar'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'f2Cutoff', 30, { bi: true }], [SRC.lfo2, 'bFine', 20, { bi: true }], [SRC.lfo2, 'f1Cutoff', 10, { bi: true }]),
      },
    },
    {
      // FM from oscillator B at ratio 3: the metallic bite closing with Env 2
      name: 'Metallic FM bass',
      params: {
        aPos: 0, aWarp: WARP.fm, aWarpAmt: 10, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 1, bSemi: 7, bLevel: 0, subOn: 1, subLevel: 50,
        subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.lp24, f1Cutoff: 3000, f1Drive: 30, e1R: 0.06,
        e2A: 0.001, e2D: 0.2, e2S: 10, volume: -13,
        ...mods([SRC.env2, 'aWarpAmt', 45], [SRC.velocity, 'aWarpAmt', 20], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    {
      // Macro 1 brings in an eighth-note LFO on the folding
      name: 'Folded bass',
      params: {
        aTable: T.Fold, aPos: 10, aRand: 0, subOn: 1, subLevel: 45, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 25,
        f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 15, e1R: 0.06, e2A: 0.001, e2D: 0.3, e2S: 20, l1Shape: LFO_SHAPE.sine, l1Div: R['1/8'],
        volume: -12, ...mods([SRC.env2, 'aPos', 50], [SRC.velocity, 'aPos', 25], [SRC.lfo1, 'aPos', 30, { aux: SRC.macro1 }]),
      },
    },
    {
      name: 'Pulsar bass',
      params: {
        aTable: T.Pulsar, aPos: 30, subOn: 1, subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.lp24,
        f1Cutoff: 1800, f1Res: 25, e1R: 0.06, l1Shape: LFO_SHAPE.sawDown, l1Div: R['1/8'], volume: -9,
        ...mods([SRC.lfo1, 'aPos', 50], [SRC.lfo1, 'f1Cutoff', 25]),
      },
    },
    {
      name: 'Sync bass',
      params: {
        aWarp: WARP.sync, aWarpAmt: 5, aUnison: 2, aDetune: 8, subOn: 1, subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono,
        glide: 30, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 15, f1Drive: 35, e1R: 0.06, e2A: 0.001, e2D: 0.25, e2S: 15, volume: -13,
        ...mods([SRC.env2, 'aWarpAmt', 40], [SRC.velocity, 'aWarpAmt', 15], [SRC.env2, 'f1Cutoff', 15]),
      },
    },
    {
      // Macro 1 opens the growl, Macro 2 brings in the sixteenth LFO
      name: 'Macro growl',
      params: {
        aTable: T.Growl, aPos: 10, aWarp: WARP.bendBoth, aWarpAmt: 0, bOn: 1, bTable: T.Basic, bPos: 67, bOct: -1, bLevel: 40, subOn: 1,
        subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 25, f1Type: FILTER.lp24, f1Cutoff: 500, f1Res: 30, f1Drive: 50,
        e1R: 0.06, macro1: 40, l1Shape: LFO_SHAPE.sine, l1Div: R['1/16'], volume: -14,
        ...mods(
          [SRC.macro1, 'aPos', 70], [SRC.macro1, 'f1Cutoff', 35], [SRC.macro1, 'aWarpAmt', 30],
          [SRC.lfo1, 'f1Cutoff', 30, { aux: SRC.macro2 }], [SRC.lfo1, 'aPos', 30, { aux: SRC.macro2 }],
        ),
      },
    },
    {
      name: 'Squared acid',
      params: {
        aPos: 100, voiceMode: VOICE_MODE.legato, glide: 60, f1Type: FILTER.ladder, f1Cutoff: 260, f1Res: 82, f1Drive: 45, f1Key: 25, e1R: 0.04,
        e2A: 0.001, e2D: 0.16, e2Dc: 70, volume: -9,
        ...mods([SRC.env2, 'f1Cutoff', 45], [SRC.velocity, 'f1Cutoff', 20], [SRC.velocity, 'e2D', 25], [SRC.macro1, 'f1Cutoff', 30]),
      },
    },
    {
      // reduced bits, crackle and a comb on the note: rusty iron
      name: 'Industrial bass',
      params: {
        aTable: T.Digital, aPos: 55, aUnison: 2, aDetune: 12, nOn: 1, nType: NOISE.crackle, nLevel: 15, subOn: 1, subShape: 3, subLevel: 45,
        subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.combDown, f1Cutoff: 300, f1Res: 55, f1Key: 100, f1Mix: 60,
        f1Drive: 50, f2On: 1, f2Type: FILTER.lp24, f2Cutoff: 2500, e1R: 0.06, e2A: 0.001, e2D: 0.2, l1Shape: LFO_SHAPE.sampleHold,
        l1Div: R['1/16'], volume: -11,
        ...mods([SRC.env2, 'f2Cutoff', 30], [SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.lfo1, 'f1Res', 15, { bi: true }]),
      },
    },
    {
      // a swelling sine: velocity saturates it, the pitch slides down at the attack
      name: 'Rubber bass',
      params: {
        aTable: T['Warm sine'], aPos: 20, aRand: 0, voiceMode: VOICE_MODE.legato, glide: 80, f1Type: FILTER.lp12, f1Cutoff: 1500, e1A: 0.002,
        e1D: 0.5, e1S: 60, e1R: 0.1, e2A: 0.001, e2D: 0.07, volume: -9,
        ...mods([SRC.env2, 'tune', 4], [SRC.velocity, 'aPos', 50], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    // ---- lead
    {
      name: 'Supersaw',
      params: {
        aUnison: 9, aDetune: 30, aWidth: 100, aBlend: 70, bOn: 1, bTable: T.Basic, bPos: 67, bOct: 1, bUnison: 5, bDetune: 22, bWidth: 100, bLevel: 40,
        f1Cutoff: 9000, e1A: 0.005, e1R: 0.35, volume: -19, ...mods([SRC.velocity, 'volume', 12]),
      },
    },
    {
      name: 'Screaming sync lead',
      params: {
        aWarp: WARP.sync, aWarpAmt: 15, aUnison: 2, aDetune: 10, voiceMode: VOICE_MODE.legato, glide: 50, f1Cutoff: 8000, e1A: 0.005, e1R: 0.15,
        e2D: 0.6, e2S: 20, l1Sync: LFO_SYNC.hz, l1Rate: 5.5, l1Delay: 0.3, l1Rise: 0.4, volume: -7.5,
        ...mods([SRC.env2, 'aWarpAmt', 45], [SRC.lfo1, 'tune', 1, { bi: true }]),
      },
    },
    {
      name: 'Soft PWM lead',
      params: {
        aTable: T.PWM, aPos: 15, aUnison: 3, aDetune: 10, aWidth: 60, voiceMode: VOICE_MODE.legato, glide: 45, f1Type: FILTER.lp24, f1Cutoff: 4200,
        f1Key: 30, e1A: 0.01, e1R: 0.25, l1Shape: LFO_SHAPE.triangle, l1Div: R['2 bars'], l1Trig: LFO_TRIG.free, l2Sync: LFO_SYNC.hz,
        l2Rate: 5, l2Delay: 0.4, l2Rise: 0.5, volume: -13,
        ...mods([SRC.lfo1, 'aPos', 35, { bi: true }], [SRC.lfo2, 'tune', 1, { bi: true }]),
      },
    },
    {
      name: 'Talking lead',
      params: {
        aTable: T.Vocal, aPos: 0, aUnison: 2, aDetune: 8, voiceMode: VOICE_MODE.legato, glide: 60, f1Type: FILTER.formant, f1Cutoff: 1000,
        f1Var: 20, f1Res: 40, f1Mix: 70, e1A: 0.01, e1R: 0.2, l1Div: R['1/4'], ...drawn(1, [[0, 0, 40], [0.5, 1, -40], [1, 0]]),
        l2Shape: LFO_SHAPE.triangle, l2Div: R['2 bars'], volume: -1,
        ...mods([SRC.lfo1, 'aPos', 80], [SRC.lfo2, 'f1Var', 60]),
      },
    },
    {
      // the rave "hoover": detuned pulses rising in pitch at the attack
      name: 'Hoover',
      params: {
        aTable: T.PWM, aPos: 35, aUnison: 7, aDetune: 40, aWidth: 100, bOn: 1, bTable: T.Basic, bPos: 67, bOct: -1, bUnison: 3, bDetune: 25,
        bLevel: 55, voiceMode: VOICE_MODE.legato, glide: 120, f1Type: FILTER.lp24, f1Cutoff: 3500, f1Res: 15, e1A: 0.01, e1R: 0.3, e2A: 0.001,
        e2D: 0.2, e2Dc: 50, l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz, l1Rate: 0.8, l1Trig: LFO_TRIG.free, volume: -13,
        ...mods([SRC.env2, 'tune', -6], [SRC.lfo1, 'aPos', 30, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      name: 'Trance lead',
      params: {
        aUnison: 9, aDetune: 28, aWidth: 100, bOn: 1, bTable: T.Basic, bPos: 67, bOct: 1, bUnison: 5, bDetune: 20, bLevel: 35,
        voiceMode: VOICE_MODE.legato, glide: 50, f1Type: FILTER.lp24, f1Cutoff: 7000, f1Res: 10, e1A: 0.005, e1R: 0.4, l1Shape: LFO_SHAPE.sine,
        l1Sync: LFO_SYNC.hz, l1Rate: 5.5, l1Delay: 0.4, l1Rise: 0.6, volume: -10,
        ...mods([SRC.lfo1, 'tune', 1, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // two slightly detuned saws in the ladder, the opening envelope: the old-school lead
      name: 'Analog lead',
      params: {
        bOn: 1, bTable: T.Basic, bPos: 67, bFine: 8, bLevel: 70, voiceMode: VOICE_MODE.legato, glide: 45, f1Type: FILTER.ladder, f1Cutoff: 1100,
        f1Res: 35, f1Drive: 20, f1Key: 50, e1A: 0.003, e1R: 0.2, e2A: 0.005, e2D: 0.6, e2S: 30, l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz,
        l1Rate: 5, l1Delay: 0.5, l1Rise: 0.6, volume: -8,
        ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.velocity, 'f1Cutoff', 15], [SRC.lfo1, 'tune', 1, { bi: true }], [SRC.macro1, 'f1Cutoff', 25]),
      },
    },
    {
      name: 'Saturated acid lead',
      params: {
        aUnison: 2, aDetune: 6, voiceMode: VOICE_MODE.legato, glide: 55, f1Type: FILTER.ladder, f1Cutoff: 700, f1Res: 65, f1Drive: 70, f1Key: 40,
        e1R: 0.08, e2A: 0.001, e2D: 0.35, e2S: 20, volume: -7,
        ...mods([SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 15], [SRC.macro1, 'f1Cutoff', 30]),
      },
    },
    {
      // the sync table running back and forth, squeezed into a band-pass and saturated
      name: 'Shrill lead',
      params: {
        aTable: T.Sync, aPos: 40, aUnison: 3, aDetune: 15, aWidth: 70, voiceMode: VOICE_MODE.legato, glide: 30, f1Type: FILTER.bp12,
        f1Cutoff: 2200, f1Res: 30, f1Drive: 55, f1Key: 50, f1Mix: 75, e1A: 0.003, e1R: 0.15, l1Shape: LFO_SHAPE.triangle, l1Div: R['1/8'],
        volume: -5, ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo1, 'f1Cutoff', 10, { bi: true }], [SRC.velocity, 'f1Drive', 20]),
      },
    },
    {
      name: 'Cutting FM lead',
      params: {
        aTable: T.FM, aPos: 55, aUnison: 2, aDetune: 7, voiceMode: VOICE_MODE.legato, glide: 35, f1Type: FILTER.lp12, f1Cutoff: 7000,
        e1A: 0.003, e1R: 0.15, e2A: 0.001, e2D: 0.5, e2S: 40, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 5, l1Delay: 0.4, l1Rise: 0.5,
        volume: -10, ...mods([SRC.env2, 'aPos', 35], [SRC.velocity, 'aPos', 15], [SRC.lfo1, 'tune', 1, { bi: true }]),
      },
    },
    {
      name: 'Octave lead',
      params: {
        aTable: T.Octaves, aPos: 60, aUnison: 3, aDetune: 12, aWidth: 70, bOn: 1, bTable: T.Basic, bPos: 67, bOct: -1, bLevel: 40,
        voiceMode: VOICE_MODE.legato, glide: 40, f1Type: FILTER.lp24, f1Cutoff: 5000, f1Res: 15, f1Key: 30, e1A: 0.005, e1R: 0.2, volume: -9,
        ...mods([SRC.velocity, 'aPos', 30], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // the high formants and a peak pushing them: thin and nasal
      name: 'Nasal lead',
      params: {
        aTable: T.Formants, aPos: 55, aUnison: 2, aDetune: 6, voiceMode: VOICE_MODE.legato, glide: 40, f1Type: FILTER.peak, f1Cutoff: 1500,
        f1Res: 50, f1Key: 50, e1A: 0.005, e1R: 0.2, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 0.3, l1Trig: LFO_TRIG.free, volume: -7,
        ...mods([SRC.lfo1, 'aPos', 20, { bi: true }], [SRC.velocity, 'aPos', 15]),
      },
    },
    {
      // a sine with a breath of air and the vibrato arriving late
      name: 'Whistle',
      params: {
        aPos: 5, aRand: 0, nOn: 1, nType: NOISE.pink, nLevel: 6, voiceMode: VOICE_MODE.legato, glide: 90, f1Type: FILTER.lp12, f1Cutoff: 3000,
        f1Key: 60, e1A: 0.04, e1R: 0.25, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 5.5, l1Delay: 0.3, l1Rise: 0.5, volume: -11,
        ...mods([SRC.lfo1, 'tune', 1, { bi: true }], [SRC.velocity, 'nLevel', 10]),
      },
    },
    {
      // a square jumping an octave at 1/32, as in 8-bit video games
      name: 'Chiptune lead',
      params: {
        aTable: T.PWM, aPos: 30, aRand: 0, voiceMode: VOICE_MODE.legato, f1On: 0, e1A: 0.001, e1R: 0.08, l1Div: R['1/16'],
        ...drawn(1, steps([0, 1])), l2Shape: LFO_SHAPE.triangle, l2Div: R['1 bar'], l2Trig: LFO_TRIG.free, volume: -11,
        ...mods([SRC.lfo1, 'tune', 25], [SRC.lfo2, 'aPos', 40, { bi: true }]),
      },
    },
    // ---- pad
    {
      name: 'Glass pad',
      params: {
        aTable: T.Metal, aPos: 30, aUnison: 6, aDetune: 15, aSpread: 30, bOn: 1, bTable: T['Warm sine'], bPos: 0, bOct: 1, bLevel: 40,
        nOn: 1, nType: 1, nTone: 55, nLevel: 8, f1Type: FILTER.lp24, f1Cutoff: 5000, f1Res: 15, e1A: 1.2, e1D: 2, e1S: 80, e1R: 2.5,
        l1Div: R['4 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Div: R['8 bars'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.lfo2, 'f1Cutoff', 15, { bi: true }], [SRC.velocity, 'f1Cutoff', 10]),
      },
    },
    {
      name: 'Spectral pad',
      params: {
        aTable: T.Spectral, aPos: 20, aUnison: 5, aDetune: 14, aWidth: 100, bOn: 1, bTable: T.Additive, bPos: 35, bLevel: 45, bSemi: 7, bUnison: 3,
        bDetune: 10, f1Type: FILTER.lp12, f1Cutoff: 3500, e1A: 0.9, e1D: 1.5, e1S: 85, e1R: 2, e2A: 1.5, e2D: 3, e2S: 40,
        l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['2 bars'], l1Trig: LFO_TRIG.free, l2Div: R['8 bars'], l2Trig: LFO_TRIG.free, volume: -15,
        ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo2, 'bPos', 50, { bi: true }], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Soft strings',
      params: {
        aUnison: 7, aDetune: 12, aWidth: 90, f1Type: FILTER.lp12, f1Cutoff: 2800, f1Key: 50, e1A: 0.4, e1D: 1, e1S: 90, e1R: 0.9,
        l1Sync: LFO_SYNC.hz, l1Rate: 5, l1Delay: 0.5, l1Rise: 0.6, volume: -14,
        ...mods([SRC.lfo1, 'tune', 1, { bi: true }], [SRC.velocity, 'f1Cutoff', 20], [SRC.velocity, 'e1A', -15]),
      },
    },
    {
      name: 'Formant choir',
      params: {
        aTable: T.Formants, aPos: 30, aUnison: 5, aDetune: 15, aSpread: 25, f1Type: FILTER.formant, f1Cutoff: 1000, f1Var: 40, f1Res: 30,
        f1Mix: 60, e1A: 0.6, e1D: 1.5, e1S: 85, e1R: 1.6, l1Shape: LFO_SHAPE.triangle, l1Div: R['4 bars'], l1Trig: LFO_TRIG.free,
        l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['1 bar'], l2Trig: LFO_TRIG.free, volume: -9,
        ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo2, 'f1Var', 30, { bi: true }]),
      },
    },
    {
      // Macro 1 opens the filter
      name: 'Dark pad',
      params: {
        aUnison: 6, aDetune: 16, aWidth: 100, bOn: 1, bTable: T.Basic, bPos: 100, bOct: -1, bUnison: 3, bDetune: 12, bLevel: 40,
        f1Type: FILTER.lp24, f1Cutoff: 450, f1Res: 25, f1Key: 30, e1A: 1.5, e1D: 2, e1S: 90, e1R: 3, l1Shape: LFO_SHAPE.sine,
        l1Div: R['8 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['2 bars'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'f1Cutoff', 15, { bi: true }], [SRC.lfo2, 'aDetune', 15, { bi: true }], [SRC.macro1, 'f1Cutoff', 35]),
      },
    },
    {
      name: 'Lukewarm pad',
      params: {
        aTable: T['Warm sine'], aPos: 45, aUnison: 5, aDetune: 14, aWidth: 90, bOn: 1, bTable: T.Basic, bPos: 33, bOct: 1, bUnison: 3, bDetune: 10,
        bLevel: 30, f1Type: FILTER.lp12, f1Cutoff: 2200, f1Key: 40, e1A: 0.8, e1D: 1.5, e1S: 85, e1R: 2, l1Shape: LFO_SHAPE.triangle,
        l1Div: R['4 bars'], l1Trig: LFO_TRIG.free, volume: -16,
        ...mods([SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // two pulses widening and narrowing at different speeds
      name: '80s pad',
      params: {
        aTable: T.PWM, aPos: 20, aUnison: 4, aDetune: 12, aWidth: 90, bOn: 1, bTable: T.PWM, bPos: 50, bFine: -8, bUnison: 3, bDetune: 10,
        bLevel: 60, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 15, f1Key: 30, e1A: 0.5, e1D: 1, e1S: 85, e1R: 1.5, e2A: 0.8, e2D: 2, e2S: 30,
        l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz, l1Rate: 0.6, l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Sync: LFO_SYNC.hz,
        l2Rate: 0.45, l2Trig: LFO_TRIG.free, volume: -16,
        ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo2, 'bPos', 40, { bi: true }], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Phaser pad',
      params: {
        aUnison: 7, aDetune: 20, aWidth: 100, f1Type: FILTER.phaser, f1Cutoff: 900, f1Res: 60, f1Var: 80, f2On: 1, f2Type: FILTER.lp12,
        f2Cutoff: 5000, e1A: 0.6, e1D: 1, e1S: 90, e1R: 2, l1Shape: LFO_SHAPE.triangle, l1Div: R['4 bars'], l1Trig: LFO_TRIG.free, volume: -12,
        ...mods([SRC.lfo1, 'f1Cutoff', 40, { bi: true }]),
      },
    },
    {
      name: 'Metallic pad',
      params: {
        aTable: T.Metal, aPos: 20, aLevel: 100, aUnison: 5, aDetune: 10, aSpread: 20, aWidth: 100, bOn: 1,
        bTable: T['Warm sine'], bOct: 1, bLevel: 12, f1Type: FILTER.lp24, f1Cutoff: 4000, f2On: 1,
        f2Type: FILTER.phaser, f2Cutoff: 1200, f2Res: 50, f2Var: 70, e1A: 1, e1D: 2, e1S: 85, e1R: 2.5, l1Shape: LFO_SHAPE.triangle,
        l1Div: R['8 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sine, l2Div: R['2 bars'], l2Trig: LFO_TRIG.free, volume: 0,
        ...mods([SRC.lfo1, 'aPos', 50], [SRC.lfo2, 'f2Cutoff', 35, { bi: true }]),
      },
    },
    {
      // the pink noise acting as breath for an additive hum, in a formant changing vowel
      name: 'Ghost pad',
      params: {
        aTable: T.Additive, aPos: 45, aUnison: 4, aDetune: 10, aLevel: 50, nOn: 1, nType: NOISE.pink, nLevel: 35, f1Type: FILTER.formant,
        f1Cutoff: 900, f1Var: 70, f1Res: 50, e1A: 2, e1D: 2, e1S: 90, e1R: 3, l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['4 bars'],
        l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sine, l2Sync: LFO_SYNC.hz, l2Rate: 0.15, l2Trig: LFO_TRIG.free, volume: 0,
        ...mods([SRC.lfo1, 'f1Var', 50, { bi: true }], [SRC.lfo2, 'nPan', 60, { bi: true }], [SRC.lfo2, 'aPos', 20, { bi: true }]),
      },
    },
    {
      // the vowels O and U, down low: a choir of monks
      name: 'Dark choir',
      params: {
        aUnison: 6, aDetune: 12, aWidth: 90, bOn: 1, bTable: T.Vocal, bPos: 75, bOct: -1, bLevel: 55, f1Type: FILTER.formant, f1Cutoff: 700,
        f1Var: 85, f1Res: 45, e1A: 1, e1D: 1.5, e1S: 90, e1R: 2.5, l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['2 bars'], l1Trig: LFO_TRIG.free,
        volume: -10, ...mods([SRC.lfo1, 'f1Var', 15, { bi: true }], [SRC.lfo1, 'f1Cutoff', 8, { bi: true }]),
      },
    },
    {
      name: 'Icy pad',
      params: {
        aTable: T.Additive, aPos: 80, aUnison: 6, aDetune: 12, aWidth: 100, bOn: 1, bTable: T.Metal, bPos: 60, bOct: 1, bLevel: 30, nOn: 1,
        nType: NOISE.white, nLevel: 10, f1Type: FILTER.lp12, f1Cutoff: 9000, f2On: 1, f2Type: FILTER.hp12, f2Cutoff: 400, e1A: 1.2, e1D: 2,
        e1S: 80, e1R: 3, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l1Smooth: 60, l1Trig: LFO_TRIG.free, volume: -3,
        ...mods([SRC.lfo1, 'bPos', 30, { bi: true }], [SRC.lfo1, 'bPan', 60, { bi: true }]),
      },
    },
    {
      // a fast smoothed S&H on the position: the table swarms like a cloud of grains
      name: 'Teeming pad',
      params: {
        aTable: T.Formants, aPos: 40, aUnison: 8, aDetune: 15, aSpread: 40, aWidth: 100, f1Type: FILTER.lp24, f1Cutoff: 3000, f1Res: 15,
        e1A: 1, e1D: 2, e1S: 85, e1R: 2.5, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/32'], l1Smooth: 70, l2Shape: LFO_SHAPE.triangle,
        l2Div: R['8 bars'], l2Trig: LFO_TRIG.free, volume: -7,
        ...mods([SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.lfo2, 'aSpread', 40, { bi: true }], [SRC.lfo2, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      // Env 3, eight seconds long, opens the filter, widens the unison and brings in B while held
      name: 'Opening pad',
      params: {
        aUnison: 8, aDetune: 6, aWidth: 100, bOn: 1, bTable: T.Spectral, bPos: 30, bOct: 1, bUnison: 4, bDetune: 8, bLevel: 0,
        f1Type: FILTER.lp24, f1Cutoff: 250, f1Res: 30, e1A: 0.8, e1D: 2, e1S: 90, e1R: 3, e3A: 8, e3S: 100, e3Ac: -40, volume: -13,
        ...mods([SRC.env3, 'f1Cutoff', 55], [SRC.env3, 'aDetune', 25], [SRC.env3, 'bLevel', 50], [SRC.env3, 'f1Res', -15]),
      },
    },
    {
      // two fifths and the sub, held: a carpet for the whole section
      name: 'Fifths drone',
      params: {
        aTable: T.Harmonics, aPos: 50, aUnison: 3, aDetune: 8, bOn: 1, bTable: T.Harmonics, bPos: 40, bSemi: 7, bUnison: 3, bDetune: 8,
        bLevel: 60, subOn: 1, subLevel: 50, f1Type: FILTER.lp24, f1Cutoff: 1200, f1Res: 20, e1A: 2.5, e1D: 2, e1S: 100, e1R: 4,
        l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['8 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sine, l2Div: R['4 bars'],
        l2Trig: LFO_TRIG.free, volume: -17,
        ...mods([SRC.lfo1, 'f1Cutoff', 20, { bi: true }], [SRC.lfo2, 'aPos', 25, { bi: true }], [SRC.lfo2, 'bPos', -25, { bi: true }]),
      },
    },
    // ---- keys and plucks
    {
      name: 'Crystal pluck',
      params: {
        aTable: T.FM, aPos: 40, aUnison: 3, aDetune: 8, f1Type: FILTER.lp12, f1Cutoff: 2500, f1Key: 50, e1A: 0.001, e1D: 0.6, e1S: 0, e1R: 0.5,
        e2A: 0.001, e2D: 0.25, volume: -11,
        ...mods([SRC.env2, 'aPos', 45], [SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Bells',
      params: {
        aTable: T.Metal, aPos: 55, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 2, bLevel: 30, aWarp: WARP.fm, aWarpAmt: 15, e1A: 0.001, e1D: 2.5,
        e1S: 0, e1R: 2, e2D: 1.2, volume: -11, ...mods([SRC.env2, 'aWarpAmt', 30], [SRC.velocity, 'volume', 15]),
      },
    },
    {
      name: 'Warm keys',
      params: {
        aTable: T['Warm sine'], aPos: 25, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 1, bLevel: 25, f1Type: FILTER.lp12, f1Cutoff: 5000, f1Key: 30,
        e1A: 0.002, e1D: 1.4, e1S: 35, e1R: 0.45, l1Sync: LFO_SYNC.hz, l1Rate: 4.5, l1Trig: LFO_TRIG.free, volume: -20,
        ...mods([SRC.velocity, 'aPos', 50], [SRC.lfo1, 'aPan', 20, { bi: true }], [SRC.velocity, 'volume', 15]),
      },
    },
    {
      name: 'S&H harp',
      params: {
        aTable: T.Harmonics, aPos: 30, e1A: 0.001, e1D: 0.35, e1S: 0, e1R: 0.3, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l1Trig: LFO_TRIG.free,
        f1Type: FILTER.lp24, f1Cutoff: 3000, f1Res: 30, volume: -8,
        ...mods([SRC.lfo1, 'aPos', 50], [SRC.lfo1, 'f1Cutoff', 25, { bi: true }], [SRC.random, 'aPan', 40, { bi: true }]),
      },
    },
    {
      // soft FM dying out, harder when played loud; the stereo tremolo
      name: 'Electric piano',
      params: {
        aTable: T.FM, aPos: 15, aRand: 0, aWarp: WARP.fm, aWarpAmt: 0, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 2, bLevel: 0, f1Type: FILTER.lp12,
        f1Cutoff: 6000, e1A: 0.002, e1D: 2.5, e1S: 0, e1R: 0.4, e1Dc: 50, e2A: 0.001, e2D: 0.5, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz,
        l1Rate: 4, l1Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.env2, 'aWarpAmt', 20, { aux: SRC.velocity }], [SRC.velocity, 'aPos', 30], [SRC.lfo1, 'aPan', 35, { bi: true }]),
      },
    },
    {
      name: 'Trance pluck',
      params: {
        aUnison: 7, aDetune: 22, aWidth: 100, bOn: 1, bTable: T.Basic, bPos: 100, bOct: 1, bLevel: 25, f1Type: FILTER.lp24, f1Cutoff: 500,
        f1Res: 25, f1Key: 40, e1A: 0.001, e1D: 0.4, e1S: 0, e1R: 0.3, e2A: 0.001, e2D: 0.2, e2Dc: 70, volume: -10,
        ...mods([SRC.env2, 'f1Cutoff', 50], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // Env 2 takes the position towards the bigger bits and lets it come back smooth
      name: 'Digital pluck',
      params: {
        aTable: T.Digital, aPos: 20, aUnison: 2, aDetune: 8, f1Type: FILTER.lp12, f1Cutoff: 5000, e1A: 0.001, e1D: 0.45, e1S: 0, e1R: 0.3,
        e2A: 0.001, e2D: 0.3, volume: -9, ...mods([SRC.env2, 'aPos', 60], [SRC.random, 'aPan', 40, { bi: true }]),
      },
    },
    {
      name: 'Marimba',
      params: {
        aPos: 0, aRand: 0, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 2, bLevel: 25, f1On: 0, e1A: 0.001, e1D: 0.5, e1S: 0, e1R: 0.3, e1Dc: 70,
        e2A: 0.001, e2D: 0.05, volume: -14, ...mods([SRC.env2, 'bLevel', 60], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      // FM from B at a crooked ratio: the plucked metal tine
      name: 'Kalimba',
      params: {
        aPos: 0, aRand: 0, aWarp: WARP.fm, aWarpAmt: 0, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 1, bSemi: 9, bLevel: 0, f1On: 0, e1A: 0.001,
        e1D: 0.9, e1S: 0, e1R: 0.5, e2A: 0.001, e2D: 0.08, volume: -10,
        ...mods([SRC.env2, 'aWarpAmt', 35], [SRC.velocity, 'aWarpAmt', 10]),
      },
    },
    {
      name: 'Music box',
      params: {
        aPos: 0, aRand: 0, tune: 12, bOn: 1, bTable: T.Metal, bPos: 70, bOct: 1, bLevel: 30, f1On: 0, e1A: 0.001, e1D: 1.8, e1S: 0, e1R: 1.5,
        e2A: 0.001, e2D: 0.4, volume: -13, ...mods([SRC.env2, 'bLevel', 40], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      name: 'Sweet harp',
      params: {
        aTable: T.Harmonics, aPos: 40, aRand: 0, f1Type: FILTER.lp12, f1Cutoff: 1800, f1Key: 60, e1A: 0.002, e1D: 1.8, e1S: 0, e1R: 1.2,
        e1Dc: 50, e2A: 0.001, e2D: 0.6, volume: -10, ...mods([SRC.env2, 'f1Cutoff', 30], [SRC.velocity, 'aPos', 25]),
      },
    },
    {
      name: 'Clavinet',
      params: {
        aTable: T.PWM, aPos: 70, aRand: 0, f1Type: FILTER.bp12, f1Cutoff: 1500, f1Res: 25, f1Key: 60, f1Mix: 80, e1A: 0.001, e1D: 0.8,
        e1S: 20, e1R: 0.08, e2A: 0.001, e2D: 0.15, volume: -6,
        ...mods([SRC.env2, 'f1Cutoff', 30, { aux: SRC.velocity }], [SRC.velocity, 'aPos', -20]),
      },
    },
    {
      // the organ drawbars, short, with the filter closing: the house stab
      name: 'House organ',
      params: {
        aTable: T.Organ, aPos: 55, aRand: 0, f1Type: FILTER.lp24, f1Cutoff: 900, f1Res: 20, e1A: 0.002, e1D: 0.3, e1S: 0, e1R: 0.15,
        e2A: 0.001, e2D: 0.15, volume: -7, ...mods([SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Detroit stab',
      params: {
        aUnison: 3, aDetune: 10, aWidth: 70, bOn: 1, bTable: T.Basic, bPos: 100, bLevel: 50, f1Type: FILTER.lp24, f1Cutoff: 1100, f1Res: 30,
        f1Key: 40, e1A: 0.002, e1D: 0.5, e1S: 10, e1R: 0.4, e2A: 0.001, e2D: 0.3, l1Shape: LFO_SHAPE.sine, l1Div: R['8 bars'],
        l1Trig: LFO_TRIG.free, volume: -12,
        ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.velocity, 'f1Cutoff', 15], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      // metal and a comb tuned to the note: industrial techno's hard chord
      name: 'Iron stab',
      params: {
        aTable: T.Metal, aPos: 45, aUnison: 3, aDetune: 15, bOn: 1, bTable: T.Basic, bPos: 67, bLevel: 45, f1Type: FILTER.combUp,
        f1Cutoff: 500, f1Res: 60, f1Key: 100, f1Mix: 60, f1Drive: 40, f2On: 1, f2Type: FILTER.lp24, f2Cutoff: 1500, e1A: 0.001, e1D: 0.35,
        e1S: 0, e1R: 0.3, e2A: 0.001, e2D: 0.2, volume: -5, ...mods([SRC.env2, 'f2Cutoff', 45], [SRC.velocity, 'f1Drive', 25]),
      },
    },
    // ---- brass and organs
    {
      name: 'Brass',
      params: {
        aUnison: 2, aDetune: 8, aWidth: 50, bOn: 1, bTable: T.Basic, bPos: 100, bLevel: 35, f1Type: FILTER.lp24, f1Cutoff: 650, f1Res: 10, f1Key: 30,
        e1A: 0.03, e1D: 0.5, e1S: 85, e1R: 0.2, e2A: 0.05, e2D: 0.4, e2S: 40, volume: -16,
        ...mods([SRC.env2, 'f1Cutoff', 45], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      name: 'Organ',
      params: {
        aTable: T.Organ, aPos: 70, e1A: 0.003, e1D: 0.1, e1S: 100, e1R: 0.08, f1On: 0, l1Sync: LFO_SYNC.hz, l1Rate: 6.5, l1Trig: LFO_TRIG.free,
        volume: -11, ...mods([SRC.lfo1, 'aLevel', 10, { bi: true }], [SRC.lfo1, 'aPan', 25, { bi: true }]),
      },
    },
    {
      name: 'Church organ',
      params: {
        aTable: T.Organ, aPos: 100, aRand: 0, aUnison: 2, aDetune: 4, bOn: 1, bTable: T.Organ, bPos: 60, bOct: -1, bLevel: 50, f1On: 0,
        e1A: 0.08, e1D: 0.1, e1S: 100, e1R: 0.8, volume: -14,
      },
    },
    {
      name: 'Accordion',
      params: {
        aTable: T.PWM, aPos: 55, aRand: 0, aUnison: 3, aDetune: 14, aBlend: 100, bOn: 1, bTable: T.Spectral, bPos: 20, bOct: 1, bLevel: 35,
        f1Type: FILTER.lp12, f1Cutoff: 3500, e1A: 0.04, e1D: 0.2, e1S: 100, e1R: 0.12, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 6,
        l1Trig: LFO_TRIG.free, volume: -16, ...mods([SRC.lfo1, 'aLevel', 10, { bi: true }]),
      },
    },
    {
      name: 'Brass stab',
      params: {
        aUnison: 3, aDetune: 10, aWidth: 70, bOn: 1, bTable: T.Basic, bPos: 67, bOct: -1, bLevel: 40, f1Type: FILTER.lp24, f1Cutoff: 500,
        f1Res: 15, f1Key: 40, e1A: 0.01, e1D: 0.4, e1S: 30, e1R: 0.2, e2A: 0.02, e2D: 0.25, volume: -9,
        ...mods([SRC.env2, 'f1Cutoff', 50], [SRC.velocity, 'f1Cutoff', 20]),
      },
    },
    // ---- rhythmic and effects
    {
      name: 'Quarter gate',
      params: {
        aUnison: 7, aDetune: 25, aWidth: 100, aLevel: 0, f1Cutoff: 7000, e1A: 0.002, e1R: 0.2, l1Div: R['1/4'], volume: -14,
        ...drawn(1, [[0, 1], [0.2, 1, 40], [0.25, 0], [0.5, 0], [0.5, 0.7], [0.7, 0.7, 40], [0.75, 0], [1, 0]]),
        ...mods([SRC.lfo1, 'aLevel', 100]),
      },
    },
    {
      name: 'Sidechain pump',
      params: {
        aUnison: 5, aDetune: 20, aWidth: 100, aLevel: 0, bOn: 1, bTable: T.Basic, bPos: 67, bOct: -1, bLevel: 0, f1Cutoff: 6000, e1A: 0.005, e1R: 0.3,
        l1Div: R['1/4'], volume: -17, ...drawn(1, [[0, 0, 60], [0.45, 1], [1, 1]]),
        ...mods([SRC.lfo1, 'aLevel', 75], [SRC.lfo1, 'bLevel', 50]),
      },
    },
    {
      // a sixteenth square, and a stepped LFO (aux) deciding which steps play
      name: 'Trance gate',
      params: {
        aUnison: 7, aDetune: 24, aWidth: 100, aLevel: 0, bOn: 1, bTable: T.Basic, bPos: 100, bOct: -1, bUnison: 3, bDetune: 15, bLevel: 0,
        f1Type: FILTER.lp24, f1Cutoff: 4000, f1Res: 15, e1A: 0.05, e1D: 1, e1S: 90, e1R: 0.6, l1Shape: LFO_SHAPE.square, l1Div: R['1/16'],
        l2Div: R['1/2'], ...drawn(2, steps([1, 1, 0, 1, 1, 0, 1, 1])), volume: -15,
        ...mods([SRC.lfo1, 'aLevel', 90, { aux: SRC.lfo2 }], [SRC.lfo1, 'bLevel', 60, { aux: SRC.lfo2 }]),
      },
    },
    {
      // stepped LFO 1 makes the pitches (root, minor second, fifth, octave…), LFO 2 the pluck of each sixteenth
      name: 'Phrygian arpeggio',
      params: {
        aPos: 80, aUnison: 3, aDetune: 10, aLevel: 25, f1Type: FILTER.lp24, f1Cutoff: 1000, f1Res: 35, e1A: 0.002, e1R: 0.3, l1Div: R['1/2'],
        ...drawn(1, steps([0, 1, 7, 12, 13, 12, 7, 1].map(st => st / 24))), l2Div: R['1/16'], ...drawn(2, [[0, 1, 60], [0.8, 0.05], [1, 0]]),
        l3Shape: LFO_SHAPE.sine, l3Div: R['4 bars'], l3Trig: LFO_TRIG.free, volume: -12,
        ...mods([SRC.lfo1, 'tune', 50], [SRC.lfo2, 'f1Cutoff', 40], [SRC.lfo2, 'aLevel', 70], [SRC.lfo3, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      // an acid loop on a held note: LFO 1 the pitches, LFO 2 the filter hit, LFO 3 the accents
      name: 'Acid sequence',
      params: {
        aPos: 70, voiceMode: VOICE_MODE.mono, f1Type: FILTER.ladder, f1Cutoff: 280, f1Res: 75, f1Drive: 40, f1Key: 30, e1R: 0.05,
        l1Div: R['1/2'], ...drawn(1, steps([0, 0, 12, 0, 1, 0, 13, 7].map(st => st / 24))), l2Div: R['1/16'],
        ...drawn(2, [[0, 1, 70], [0.7, 0], [1, 0]]), l3Div: R['1/2'], ...drawn(3, steps([1, 0, 0.4, 0, 1, 0.3, 0, 0.6])),
        l4Shape: LFO_SHAPE.triangle, l4Div: R['4 bars'], l4Trig: LFO_TRIG.free, volume: -5,
        ...mods(
          [SRC.lfo1, 'tune', 50], [SRC.lfo2, 'f1Cutoff', 25], [SRC.lfo2, 'f1Cutoff', 25, { aux: SRC.lfo3 }],
          [SRC.lfo4, 'f1Cutoff', 20, { bi: true }], [SRC.macro1, 'f1Res', 20],
        ),
      },
    },
    {
      // the cutoff in sixteenth steps, like a sequencer
      name: 'Step filter',
      params: {
        aUnison: 4, aDetune: 15, aWidth: 90, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 45, e1A: 0.005, e1R: 0.3, l1Div: R['1/2'],
        ...drawn(1, steps([0.1, 0.6, 0.3, 0.9, 0.2, 0.7, 0.4, 1])), volume: -15,
        ...mods([SRC.lfo1, 'f1Cutoff', 50], [SRC.lfo1, 'f1Res', 10]),
      },
    },
    {
      name: 'Triplet pulse',
      params: {
        aTable: T.Harmonics, aPos: 50, aUnison: 5, aDetune: 18, aWidth: 100, aLevel: 0, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 20,
        e1A: 0.01, e1R: 0.4, l1Div: R['1/8T'], ...drawn(1, [[0, 1, 50], [0.6, 0.1], [1, 0]]), l2Shape: LFO_SHAPE.triangle,
        l2Div: R['2 bars'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'aLevel', 90], [SRC.lfo1, 'f1Cutoff', 20], [SRC.lfo2, 'aPos', 30, { bi: true }]),
      },
    },
    {
      name: 'Rise',
      params: {
        aUnison: 7, aDetune: 30, aWidth: 100, nOn: 1, nType: 0, nLevel: 0, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 30, e1A: 0.01, e1R: 1,
        l1Div: R['8 bars'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0, -40], [1, 1]]), volume: -14,
        ...mods([SRC.lfo1, 'f1Cutoff', 70], [SRC.lfo1, 'tune', 25], [SRC.lfo1, 'nLevel', 60], [SRC.lfo1, 'aDetune', 40]),
      },
    },
    {
      name: 'Zap',
      params: {
        aPos: 0, aWarp: WARP.bendUp, aWarpAmt: 40, e1A: 0.001, e1D: 0.3, e1S: 0, e1R: 0.2, e2A: 0.001, e2D: 0.15, e2Dc: 80, volume: -9,
        ...mods([SRC.env2, 'tune', 45], [SRC.env2, 'aWarpAmt', 50]),
      },
    },
    {
      // noise only: over eight bars the band-pass rises and narrows
      name: 'Rising noise',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.white, nLevel: 90, f1Type: FILTER.bp12, f1Cutoff: 300, f1Res: 30, e1A: 0.01, e1R: 1.5,
        l1Div: R['8 bars'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0, -50], [1, 1]]), volume: -13,
        ...mods([SRC.lfo1, 'f1Cutoff', 55], [SRC.lfo1, 'f1Res', 40], [SRC.lfo1, 'volume', 15]),
      },
    },
    {
      name: 'Falling noise',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.white, nLevel: 90, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 25, e1A: 0.001, e1D: 3, e1S: 0, e1R: 1,
        e1Dc: 30, l1Div: R['2 bars'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 1, 40], [1, 0]]), volume: -11,
        ...mods([SRC.lfo1, 'f1Cutoff', 60]),
      },
    },
    {
      name: 'Wind',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.pink, nLevel: 90, f1Type: FILTER.bp12, f1Cutoff: 800, f1Res: 45, f2On: 1, f2Type: FILTER.lp12,
        f2Cutoff: 4000, e1A: 1.5, e1D: 1, e1S: 100, e1R: 3, l1Shape: LFO_SHAPE.smoothRandom, l1Sync: LFO_SYNC.hz, l1Rate: 0.3,
        l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Sync: LFO_SYNC.hz, l2Rate: 0.7, l2Trig: LFO_TRIG.free, volume: -4,
        ...mods([SRC.lfo1, 'f1Cutoff', 25, { bi: true }], [SRC.lfo2, 'f1Res', 25, { bi: true }], [SRC.lfo2, 'nPan', 50, { bi: true }]),
      },
    },
    {
      // two tones a fourth apart, alternating
      name: 'Two-tone siren',
      params: {
        aPos: 50, aRand: 0, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp12, f1Cutoff: 3500, e1A: 0.01, e1R: 0.3, l1Sync: LFO_SYNC.hz,
        l1Rate: 0.8, ...drawn(1, [[0, 0], [0.5, 0], [0.5, 1], [1, 1]]), volume: -12, ...mods([SRC.lfo1, 'tune', 10]),
      },
    },
    {
      // the dub siren: the pitch falling back like a saw, faster and faster while holding the note
      name: 'Dub siren',
      params: {
        aPos: 90, aRand: 0, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 3000, f1Res: 20, e1A: 0.005, e1R: 0.4, e3A: 3,
        e3S: 100, l1Shape: LFO_SHAPE.sawDown, l1Sync: LFO_SYNC.hz, l1Rate: 2, volume: -13,
        ...mods([SRC.lfo1, 'tune', 15], [SRC.env3, 'l1Rate', 20], [SRC.lfo1, 'f1Cutoff', 10]),
      },
    },
    {
      // a laser shot at every sixteenth, while the note is held
      name: 'Laser burst',
      params: {
        aTable: T.Sync, aPos: 30, aRand: 0, aWarp: WARP.sync, aWarpAmt: 20, aLevel: 0, f1Type: FILTER.lp12, f1Cutoff: 9000, e1A: 0.001,
        e1R: 0.15, l1Div: R['1/16'], ...drawn(1, [[0, 1, 60], [0.95, 0], [1, 0]]), volume: -2,
        ...mods([SRC.lfo1, 'tune', 40], [SRC.lfo1, 'aWarpAmt', 40], [SRC.lfo1, 'aLevel', 90]),
      },
    },
    {
      // the hit closing a riser: a sine collapsing an octave and a lash of noise
      name: 'Impact',
      params: {
        aPos: 0, aRand: 0, nOn: 1, nType: NOISE.white, nLevel: 0, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 8000,
        e1A: 0.001, e1D: 2.5, e1S: 0, e1R: 1.5, e1Dc: 40, e2A: 0.001, e2D: 1.2, e2Dc: 50, e3A: 0.001, e3D: 0.4, e3Dc: 70, volume: -7,
        ...mods([SRC.env2, 'tune', 25], [SRC.env3, 'nLevel', 70], [SRC.env3, 'f1Cutoff', 10]),
      },
    },
    {
      name: 'Drop',
      params: {
        aPos: 0, aRand: 0, tune: 12, f1On: 0, e1A: 0.001, e1D: 0.25, e1S: 0, e1R: 0.2, e1Dc: 70, e2A: 0.001, e2D: 0.12, e2Dc: 30, volume: -9,
        ...mods([SRC.env2, 'tune', -25], [SRC.random, 'tune', 4, { bi: true }]),
      },
    },
    {
      name: 'Broken radio',
      params: {
        aTable: T.Digital, aPos: 70, nOn: 1, nType: NOISE.crackle, nLevel: 30, f1Type: FILTER.bp24, f1Cutoff: 1500, f1Res: 40, f1Drive: 40,
        e1A: 0.01, e1R: 0.3, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l2Shape: LFO_SHAPE.sampleHold, l2Div: R['1/8T'],
        l2Trig: LFO_TRIG.free, l3Shape: LFO_SHAPE.square, l3Div: R['1/32'], volume: -2,
        ...mods(
          [SRC.lfo1, 'f1Cutoff', 30, { bi: true }], [SRC.lfo2, 'aPos', 30, { bi: true }], [SRC.lfo3, 'aLevel', -50, { aux: SRC.lfo2 }],
          [SRC.lfo1, 'tune', 2, { bi: true }],
        ),
      },
    },
    {
      // turning blades: the noise and the sub cut by a fast accelerating LFO
      name: 'Helicopter',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.brown, nLevel: 10, subOn: 1, subLevel: 20, f1Type: FILTER.lp24, f1Cutoff: 600, f1Res: 20, e1A: 0.5,
        e1R: 1.5, e3A: 4, e3S: 100, l1Sync: LFO_SYNC.hz, l1Rate: 9, ...drawn(1, [[0, 1, 60], [0.5, 0], [1, 0]]), volume: -9,
        ...mods([SRC.lfo1, 'nLevel', 80], [SRC.lfo1, 'subLevel', 50], [SRC.env3, 'l1Rate', 15]),
      },
    },
    {
      // a low growl in the brown noise, with the comb sliding slowly: the warehouse at night
      name: 'Industrial drone',
      params: {
        aTable: T.Growl, aPos: 40, aUnison: 4, aDetune: 15, aWidth: 100, nOn: 1, nType: NOISE.brown, nLevel: 30, subOn: 1, subLevel: 40,
        f1Type: FILTER.combDown, f1Cutoff: 200, f1Res: 60, f1Mix: 70, f1Drive: 40, f2On: 1, f2Type: FILTER.lp24, f2Cutoff: 1800, e1A: 2,
        e1D: 1, e1S: 100, e1R: 4, l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['8 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle,
        l2Div: R['4 bars'], l2Trig: LFO_TRIG.free, volume: -8,
        ...mods([SRC.lfo1, 'f1Cutoff', 25, { bi: true }], [SRC.lfo2, 'aPos', 35, { bi: true }], [SRC.lfo1, 'f2Cutoff', 15, { bi: true }]),
      },
    },
    {
      name: 'Electronic tom',
      params: {
        aPos: 0, aRand: 0, nOn: 1, nType: NOISE.pink, nLevel: 0, f1On: 0, e1A: 0.001, e1D: 0.45, e1S: 0, e1R: 0.3, e1Dc: 60, e2A: 0.001,
        e2D: 0.18, e2Dc: 50, e3A: 0.001, e3D: 0.03, volume: -14,
        ...mods([SRC.env2, 'tune', 20], [SRC.env3, 'nLevel', 30], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      // tone and noise together, the noise longer: a drum machine snare
      name: 'Synthetic snare',
      params: {
        aPos: 15, aRand: 0, tune: 12, nOn: 1, nType: NOISE.white, nLevel: 0, f1Type: FILTER.hp12, f1Cutoff: 150, e1A: 0.001, e1D: 0.3,
        e1S: 0, e1R: 0.2, e2A: 0.001, e2D: 0.06, e3A: 0.001, e3D: 0.22, e3Dc: 70, volume: -17,
        ...mods([SRC.env2, 'tune', 8], [SRC.env2, 'aLevel', 25], [SRC.env3, 'nLevel', 80], [SRC.velocity, 'volume', 12]),
      },
    },
    // ---- movement: envelopes, LFOs and matrix pushed
    {
      // Env 3 opens everything in four seconds; four free LFOs at different speeds, and the slowest
      // changes the speed of the first
      name: 'Breathing pad',
      params: {
        aTable: T.Harmonics, aPos: 30, aUnison: 6, aDetune: 12, aWidth: 100, bOn: 1, bTable: T.Formants, bPos: 20, bUnison: 4, bDetune: 10,
        bLevel: 45, f1Type: FILTER.lp24, f1Cutoff: 900, f1Res: 25, e1A: 1.5, e1D: 3, e1S: 85, e1R: 3, e3A: 4, e3D: 6, e3S: 60, e3R: 4, e3Ac: -30,
        l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['2 bars'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Div: R['4 bars'],
        l2Trig: LFO_TRIG.free, l3Div: R['8 bars'], l3Trig: LFO_TRIG.free, l4Sync: LFO_SYNC.hz, l4Rate: 0.25, l4Trig: LFO_TRIG.free, volume: -12,
        ...mods(
          [SRC.env3, 'f1Cutoff', 35], [SRC.env3, 'f1Res', 15], [SRC.env3, 'aDetune', 20], [SRC.lfo1, 'aPos', 30, { bi: true }],
          [SRC.lfo2, 'bPos', 45, { bi: true }], [SRC.lfo3, 'f1Cutoff', 12, { bi: true }], [SRC.lfo3, 'l1Rate', 25, { bi: true }],
          [SRC.lfo4, 'aPan', 40, { bi: true }], [SRC.lfo4, 'bPan', -40, { bi: true }], [SRC.velocity, 'e3A', -20],
        ),
      },
    },
    {
      // holding the note Env 3 makes the wobble run from 1/4 towards 1/16
      name: 'Accelerating wobble',
      params: {
        aTable: T.Growl, aPos: 20, aWarp: WARP.bendBoth, aWarpAmt: 10, bOn: 1, bTable: T.Basic, bPos: 67, bOct: -1, bLevel: 50, subOn: 1,
        subLevel: 60, voiceMode: VOICE_MODE.mono, glide: 30, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 40, f1Drive: 40, e1R: 0.08,
        e3A: 3, e3S: 100, e3Ac: -30, l1Shape: LFO_SHAPE.sine, l1Div: R['1/4'], l2Shape: LFO_SHAPE.sampleHold, l2Div: R['1/16'], volume: -12,
        ...mods(
          [SRC.lfo1, 'f1Cutoff', 45], [SRC.lfo1, 'aPos', 50], [SRC.lfo1, 'aWarpAmt', 35], [SRC.env3, 'l1Rate', 18], [SRC.env3, 'f1Res', 20],
          [SRC.lfo2, 'bFine', 15, { bi: true }], [SRC.velocity, 'f1Cutoff', 10],
        ),
      },
    },
    {
      // stepped LFO 1 is the pitch sequence (in 1 bar), LFO 2 is the pluck of each step
      name: 'Drawn arpeggio',
      params: {
        aTable: T.Harmonics, aPos: 45, aUnison: 3, aDetune: 10, aLevel: 25, f1Type: FILTER.lp24, f1Cutoff: 1400, f1Res: 30, e1A: 0.002, e1R: 0.3,
        l1Div: R['1 bar'], ...drawn(1, steps([0, 12, 7, 19, 12, 24, 7, 12].map(st => st / 24))),
        l2Div: R['1/8'], ...drawn(2, [[0, 1, 60], [0.7, 0.1], [1, 0]]),
        l3Shape: LFO_SHAPE.triangle, l3Div: R['2 bars'], l3Trig: LFO_TRIG.free, volume: -11,
        ...mods(
          [SRC.lfo1, 'tune', 50], [SRC.lfo2, 'f1Cutoff', 40], [SRC.lfo2, 'aLevel', 70], [SRC.lfo3, 'aPos', 30, { bi: true }],
          [SRC.velocity, 'f1Cutoff', 15],
        ),
      },
    },
    {
      // four envelopes for a single hit: filter, pitch blip, FM; velocity and note change the times
      name: 'Elastic pluck',
      params: {
        aTable: T.FM, aPos: 20, aWarp: WARP.fm, aWarpAmt: 0, bOn: 1, bTable: T.Basic, bPos: 0, bOct: 1, bLevel: 0, f1Type: FILTER.lp24,
        f1Cutoff: 400, f1Res: 35, f1Key: 40, e1A: 0.001, e1D: 0.9, e1S: 0, e1R: 0.5, e1Dc: 50, e2A: 0.001, e2D: 0.18, e2Dc: 75,
        e3A: 0.001, e3D: 0.04, e3Dc: 80, e4A: 0.001, e4D: 0.45, e4Dc: 40, volume: -10,
        ...mods(
          [SRC.env2, 'f1Cutoff', 45], [SRC.env2, 'f1Cutoff', 20, { aux: SRC.velocity }], [SRC.env3, 'tune', 3], [SRC.env4, 'aWarpAmt', 45],
          [SRC.velocity, 'e1D', 15], [SRC.note, 'e2D', -25, { bi: true }], [SRC.random, 'aPan', 30, { bi: true }],
        ),
      },
    },
    {
      // the vibrato arrives late and speeds up (Env 3 on the LFO's rate); Macro 1 widens it
      name: 'Expressive lead',
      params: {
        aUnison: 3, aDetune: 12, bOn: 1, bTable: T.Basic, bPos: 100, bFine: 7, bLevel: 45, voiceMode: VOICE_MODE.legato, glide: 60,
        f1Type: FILTER.ladder, f1Cutoff: 900, f1Res: 30, f1Drive: 25, f1Key: 40, e1A: 0.01, e1R: 0.3, e2A: 0.08, e2D: 0.8, e2S: 35,
        e3A: 2.5, e3S: 100, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 5, l1Delay: 0.35, l1Rise: 0.8,
        l2Shape: LFO_SHAPE.triangle, l2Sync: LFO_SYNC.hz, l2Rate: 3.5, l2Delay: 0.6, l2Rise: 1, volume: -8,
        ...mods(
          [SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 20], [SRC.velocity, 'e2A', -25], [SRC.lfo1, 'tune', 1, { bi: true }],
          [SRC.lfo1, 'tune', 2, { bi: true, aux: SRC.macro1 }], [SRC.env3, 'l1Rate', 8], [SRC.lfo2, 'f1Cutoff', 8, { bi: true }],
        ),
      },
    },
    {
      // four synced LFOs that never meet: triplets, sixteenths, dotted quarters, halves
      name: 'Polyrhythm',
      params: {
        aTable: T.Digital, aPos: 30, aUnison: 4, aDetune: 18, aWidth: 90, aLevel: 20, bOn: 1, bTable: T.Pulsar, bPos: 40, bLevel: 50,
        f1Type: FILTER.lp24, f1Cutoff: 1500, f1Res: 40, e1A: 0.003, e1R: 0.4, l1Shape: LFO_SHAPE.sine, l1Div: R['1/8T'],
        l2Div: R['1/16'], ...drawn(2, [[0, 1, 30], [0.6, 0.2], [1, 0]]), l3Shape: LFO_SHAPE.sawDown, l3Div: R['1/4.'],
        l4Shape: LFO_SHAPE.triangle, l4Div: R['1/2'], volume: -14,
        ...mods(
          [SRC.lfo1, 'f1Cutoff', 35], [SRC.lfo2, 'aLevel', 70], [SRC.lfo3, 'aPos', 40], [SRC.lfo3, 'bLevel', -40],
          [SRC.lfo4, 'bPos', 50, { bi: true }], [SRC.lfo4, 'aPan', 50, { bi: true }], [SRC.lfo4, 'bPan', -50, { bi: true }],
        ),
      },
    },
    {
      // all random: a slow S&H changes the speed of the other two
      name: 'Glitch S&H',
      params: {
        aTable: T.Pulsar, aPos: 50, aWarp: WARP.quantize, aWarpAmt: 20, bOn: 1, bTable: T.Digital, bPos: 30, bLevel: 40,
        f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 35, e1A: 0.002, e1R: 0.2, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'],
        l2Shape: LFO_SHAPE.sampleHold, l2Div: R['1/32'], l3Shape: LFO_SHAPE.sampleHold, l3Div: R['1/4'], l4Shape: LFO_SHAPE.square,
        l4Div: R['1/16'], volume: -12,
        ...mods(
          [SRC.lfo1, 'aPos', 60], [SRC.lfo1, 'f1Cutoff', 30, { bi: true }], [SRC.lfo2, 'aWarpAmt', 50], [SRC.lfo2, 'bPos', 40],
          [SRC.lfo3, 'l1Rate', 25, { bi: true }], [SRC.lfo3, 'l2Rate', 20, { bi: true }], [SRC.lfo4, 'aLevel', -60],
          [SRC.random, 'aPan', 50, { bi: true }],
        ),
      },
    },
    {
      // a "once" LFO drops the pitch by two octaves in 2 bars and slows down the trembling
      name: 'Free fall',
      params: {
        aTable: T.Sync, aPos: 40, aWarp: WARP.sync, aWarpAmt: 20, aUnison: 5, aDetune: 20, aWidth: 100, nOn: 1, nType: 1, nLevel: 20,
        f1Type: FILTER.lp24, f1Cutoff: 5000, f1Res: 30, e1A: 0.005, e1R: 1.5, l1Div: R['2 bars'], l1Trig: LFO_TRIG.once,
        ...drawn(1, [[0, 1, 50], [1, 0]]), l2Shape: LFO_SHAPE.sine, l2Sync: LFO_SYNC.hz, l2Rate: 3, volume: -13,
        ...mods(
          [SRC.lfo1, 'tune', 50], [SRC.lfo1, 'f1Cutoff', 40], [SRC.lfo1, 'aWarpAmt', 50], [SRC.lfo1, 'l2Rate', 30],
          [SRC.lfo2, 'aPos', 30, { bi: true }], [SRC.lfo1, 'nLevel', 40],
        ),
      },
    },
    {
      // Env 2 the filter, Env 3 the bite of the FM from the sub, Env 4 the pitch hit
      name: 'Four-envelope bass',
      params: {
        aWarp: WARP.subFm, aWarpAmt: 0, subOn: 1, subLevel: 55, voiceMode: VOICE_MODE.mono, glide: 15, f1Type: FILTER.ladder, f1Cutoff: 180,
        f1Res: 45, f1Drive: 45, f1Key: 30, e1A: 0.001, e1D: 0.6, e1S: 70, e1R: 0.08, e2A: 0.001, e2D: 0.25, e2S: 15, e2Dc: 70,
        e3A: 0.001, e3D: 0.12, e3Dc: 80, e4A: 0.001, e4D: 0.03, l1Shape: LFO_SHAPE.sine, l1Div: R['1/16'], volume: -5,
        ...mods(
          [SRC.env2, 'f1Cutoff', 50, { curve: 30 }], [SRC.env2, 'f1Res', -15], [SRC.env3, 'aWarpAmt', 45],
          [SRC.env3, 'aWarpAmt', 20, { aux: SRC.velocity }], [SRC.env4, 'tune', 6], [SRC.velocity, 'f1Cutoff', 15],
          [SRC.lfo1, 'f1Cutoff', 15, { bi: true, aux: SRC.macro1 }],
        ),
      },
    },
    {
      // Macro 1 transforms the sound, Macro 2 gives the LFO depth, Macro 3 its speed,
      // Macro 4 turns on the S&H
      name: 'Macro metamorphosis',
      params: {
        aTable: T.Formants, aPos: 0, aUnison: 5, aDetune: 14, bOn: 1, bTable: T.Metal, bPos: 0, bLevel: 50, f1Type: FILTER.lp24,
        f1Cutoff: 1500, f1Res: 20, e1A: 0.3, e1D: 1, e1S: 80, e1R: 1.2, e2A: 0.6, e2D: 1.5, e2S: 30, macro1: 35, macro2: 40,
        l1Shape: LFO_SHAPE.triangle, l1Div: R['1/2'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sampleHold, l2Div: R['1/16'], volume: -11,
        ...mods(
          [SRC.macro1, 'aPos', 80], [SRC.macro1, 'bPos', 70], [SRC.macro1, 'f1Cutoff', 30], [SRC.macro1, 'aDetune', 25],
          [SRC.lfo1, 'aPos', 30, { bi: true, aux: SRC.macro2 }], [SRC.lfo1, 'f1Cutoff', 20, { bi: true, aux: SRC.macro2 }],
          [SRC.macro3, 'l1Rate', 30], [SRC.lfo2, 'aPan', 60, { bi: true, aux: SRC.macro4 }], [SRC.lfo2, 'bPos', 40, { aux: SRC.macro4 }],
          [SRC.env2, 'f1Cutoff', 20],
        ),
      },
    },
    {
      // a "once" LFO drawn as a multi-stage envelope: rises, falls back, comes up again
      name: 'Drawn envelope',
      params: {
        aTable: T.Octaves, aPos: 40, aUnison: 3, aDetune: 10, f1Type: FILTER.lp24, f1Cutoff: 500, f1Res: 30, e1A: 0.002, e1D: 2, e1S: 30,
        e1R: 0.6, l1Div: R['1/2'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0, 60], [0.05, 1, -30], [0.3, 0.35], [0.5, 0.8, 40], [1, 0.2]]),
        l2Shape: LFO_SHAPE.sine, l2Sync: LFO_SYNC.hz, l2Rate: 0.5, volume: -9,
        ...mods([SRC.lfo1, 'f1Cutoff', 50], [SRC.lfo1, 'aPos', 40], [SRC.lfo2, 'aPos', 15, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // the two tables swap (A rises while B falls), each in its own filter in parallel
      name: 'Crossover',
      params: {
        aTable: T.Spectral, aPos: 0, aUnison: 4, aDetune: 12, bOn: 1, bTable: T.Formants, bPos: 100, bUnison: 4, bDetune: 12, bLevel: 75,
        fMode: FILTER_MODE.parallel, bRoute: ROUTE.f2, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 20, f2On: 1, f2Type: FILTER.bp12,
        f2Cutoff: 1200, f2Res: 30, e1A: 0.3, e1D: 1, e1S: 85, e1R: 1.5, l1Shape: LFO_SHAPE.sine, l1Div: R['2 bars'], l1Trig: LFO_TRIG.free,
        volume: -14,
        ...mods([SRC.lfo1, 'aPos', 100], [SRC.lfo1, 'bPos', -100], [SRC.lfo1, 'f2Cutoff', 30], [SRC.lfo1, 'f1Cutoff', -20]),
      },
    },
    // ---- others
    {
      // the siren: the slow LFO on the pitch, the filter following it
      name: 'Siren',
      params: {
        aTable: T.Basic, aPos: 67, aUnison: 3, aDetune: 12, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 4000, f1Res: 25, e1R: 0.3,
        l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz, l1Rate: 0.4, l1Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'tune', 30, { bi: true }], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      name: 'Rave stab',
      params: {
        aTable: T.Basic, aPos: 67, aUnison: 7, aDetune: 30, aWidth: 100, bOn: 1, bTable: T.PWM, bPos: 40, bOct: -1, bLevel: 50,
        f1Type: FILTER.lp24, f1Cutoff: 900, f1Res: 25, e1D: 0.35, e1S: 0, e1R: 0.25, e2D: 0.25, volume: -14,
        ...mods([SRC.env2, 'f1Cutoff', 55], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // the formant filter's vowels turning over four bars
      name: 'Vowel pad',
      params: {
        aTable: T.Basic, aPos: 67, aUnison: 5, aDetune: 18, bOn: 1, bTable: T.Vocal, bPos: 40, bLevel: 60, f1Type: FILTER.formant,
        f1Cutoff: 1200, f1Res: 40, f1Var: 30, e1A: 1, e1D: 1, e1S: 90, e1R: 2, l1Shape: LFO_SHAPE.triangle, l1Div: R['4 bars'],
        l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['1 bar'], l2Trig: LFO_TRIG.free, volume: -8,
        ...mods([SRC.lfo1, 'f1Var', 60, { bi: true }], [SRC.lfo2, 'bPos', 30, { bi: true }]),
      },
    },
    {
      name: 'Comb bass',
      params: {
        aTable: T.Basic, aPos: 67, subOn: 1, subLevel: 70, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.combUp, f1Cutoff: 400, f1Res: 70,
        f1Key: 100, f1Mix: 70, e1R: 0.06, e2D: 0.3, volume: -11,
        ...mods([SRC.env2, 'f1Cutoff', 40], [SRC.env2, 'f1Res', -30]),
      },
    },
    {
      name: 'Metal harp',
      params: {
        aTable: T.Metal, aPos: 30, bOn: 1, bTable: T['Warm sine'], bOct: 1, bLevel: 40, f1Type: FILTER.lp12, f1Cutoff: 6000,
        e1D: 1.2, e1S: 0, e1R: 1, e2D: 0.4, volume: -10,
        ...mods([SRC.env2, 'aPos', 50], [SRC.velocity, 'f1Cutoff', 25]),
      },
    },
    {
      // the dub techno chord: short, dark, with the filter opening over bars
      name: 'Dub chord',
      params: {
        aTable: T.Basic, aPos: 67, aUnison: 3, aDetune: 10, bOn: 1, bTable: T.PWM, bPos: 50, bLevel: 50, f1Type: FILTER.lp24, f1Cutoff: 600,
        f1Res: 40, f1Key: 50, e1D: 0.3, e1S: 0, e1R: 0.35, e2D: 0.2, l1Shape: LFO_SHAPE.sine, l1Div: R['4 bars'], l1Trig: LFO_TRIG.free,
        volume: -11, ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.lfo1, 'f1Cutoff', 20, { bi: true }]),
      },
    },
  ];
}

/** A stepped LFO: one value per step, all the same length. */
function steps(values: readonly number[]): [number, number][] {
  const n = values.length;
  return values.flatMap((y, k): [number, number][] => [[k / n, y], [(k + 1) / n, y]]);
}
