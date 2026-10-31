/* I preset di Prisma. Ogni preset dà solo i valori diversi dai predefiniti; le modulazioni si
 * scrivono come righe della matrice ([fonte, destinazione, quantità, opzioni]) e gli LFO
 * disegnati come punti. */
import type { Preset } from '../../device-type';
import type { ParamValues } from '../../../model/device';
import { TEMPO_RATE } from '../../rates';
import { TABLE_NAMES } from '../wavetable/tables';
import { destinationOf, FILTER, FILTER_MODE, LFO_SYNC, LFO_TRIG, NOISE, ROUTE, slotParam, SRC, VOICE_MODE, WARP } from './prisma';
import { LFO_SHAPE, pointValues, type LfoPoint } from './shapes';

/** Una riga della matrice: la fonte (SRC), il parametro di destinazione, la quantità (−100…100). */
export type ModRow = readonly [src: number, dst: string, amount: number, options?: { readonly bi?: boolean; readonly curve?: number; readonly aux?: number }];

/** Le righe della matrice come parametri, dal primo posto. */
export function mods(...rows: readonly ModRow[]): ParamValues {
  const out: Record<string, number> = {};
  rows.forEach(([src, dst, amount, o = {}], i) => {
    const n = i + 1, d = destinationOf(dst);
    if (!d) throw new Error(`Prisma: "${dst}" non è una destinazione`);
    out[slotParam(n, 'Src')] = src;
    out[slotParam(n, 'Dst')] = d;
    out[slotParam(n, 'Amt')] = amount;
    if (o.bi) out[slotParam(n, 'Pol')] = 1;
    if (o.curve) out[slotParam(n, 'Curve')] = o.curve;
    if (o.aux) out[slotParam(n, 'Aux')] = o.aux;
  });
  return out;
}

/** Un LFO disegnato: i punti come [x, y, curva]. */
export function drawn(lfo: number, points: readonly (readonly [number, number, number?])[]): ParamValues {
  const list: LfoPoint[] = points.map(([x, y, curve = 0]) => ({ x, y, curve }));
  return { [`l${lfo}Shape`]: LFO_SHAPE.drawn, ...pointValues(lfo, list) };
}

let cache: readonly Preset[] | null = null;

/** I preset, costruiti la prima volta che servono. */
export function prismaPresets(): readonly Preset[] {
  return (cache ??= build());
}

/** Le tabelle, per nome. */
const T = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, i])) as Readonly<Record<string, number>>;
const R = TEMPO_RATE;

function build(): Preset[] {
  return [
    { name: 'Init', params: {} },
    // ---- bassi
    {
      name: 'Reese profondo',
      params: {
        aUnison: 4, aDetune: 18, aWidth: 35, bOn: 1, bTable: T.Base, bPos: 67, bFine: -9, bUnison: 2, bDetune: 12, bLevel: 70, subOn: 1, subLevel: 70,
        voiceMode: VOICE_MODE.mono, glide: 40, f1Type: FILTER.lp24, f1Cutoff: 700, f1Res: 20, f1Drive: 30, f1Key: 30, e1R: 0.08, volume: -11,
        l1Shape: LFO_SHAPE.triangle, l1Div: R['2 battute'], l1Trig: LFO_TRIG.free, l2Div: R['4 battute'], l2Trig: LFO_TRIG.free,
        ...mods([SRC.lfo1, 'f1Cutoff', 12, { bi: true }], [SRC.lfo2, 'bFine', 25, { bi: true }]),
      },
    },
    {
      name: 'Wobble 1/8',
      params: {
        aTable: T.Growl, aPos: 15, bOn: 1, bTable: T.Vocale, bPos: 30, bLevel: 55, bOct: -1, subOn: 1, subLevel: 65, voiceMode: VOICE_MODE.legato,
        glide: 30, f1Type: FILTER.lp24, f1Cutoff: 260, f1Res: 35, f1Drive: 45, e1R: 0.06, volume: -10.5, l1Div: R['1/8'],
        ...mods([SRC.lfo1, 'f1Cutoff', 45], [SRC.lfo1, 'aPos', 55], [SRC.lfo1, 'bPos', 40]),
      },
    },
    {
      name: 'Basso FM growl',
      params: {
        aPos: 0, aWarp: WARP.fm, aWarpAmt: 30, bOn: 1, bTable: T.Base, bPos: 30, bLevel: 0, bOct: 1, subOn: 1, subLevel: 60, voiceMode: VOICE_MODE.mono,
        glide: 25, f1Type: FILTER.ladder, f1Cutoff: 2200, f1Res: 30, f1Drive: 50, e1R: 0.06, e2D: 0.35, e2S: 30, volume: -6,
        l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l1Smooth: 20,
        ...mods([SRC.env2, 'aWarpAmt', 40], [SRC.lfo1, 'aWarpAmt', 25, { bi: true }], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      name: '808 che scende',
      params: {
        aPos: 0, aRand: 0, voiceMode: VOICE_MODE.mono, glide: 60, f1Drive: 35, e1A: 0.001, e1D: 1.6, e1S: 0, e1R: 0.4, e1Dc: 40,
        e2A: 0.001, e2D: 0.09, e2Dc: 70, volume: -10, ...mods([SRC.env2, 'tune', 25], [SRC.velocity, 'volume', 18]),
      },
    },
    {
      name: 'Basso acido',
      params: {
        voiceMode: VOICE_MODE.legato, glide: 70, f1Type: FILTER.ladder, f1Cutoff: 320, f1Res: 75, f1Drive: 30, f1Key: 20, e1R: 0.04, e2D: 0.22,
        volume: -7, ...mods([SRC.env2, 'f1Cutoff', 50], [SRC.velocity, 'f1Cutoff', 15], [SRC.velocity, 'f1Res', 10]),
      },
    },
    {
      name: 'Basso digitale',
      params: {
        aTable: T.Digitale, aPos: 25, aWarp: WARP.quantize, aWarpAmt: 30, subOn: 1, subShape: 3, subLevel: 45, voiceMode: VOICE_MODE.mono, glide: 20,
        f1Type: FILTER.lp24, f1Cutoff: 1500, f1Res: 25, e1D: 0.4, e1S: 60, e1R: 0.05, e2D: 0.15, volume: -9,
        ...mods([SRC.env2, 'aPos', 45], [SRC.env2, 'f1Cutoff', 35]),
      },
    },
    {
      name: 'Sub puro',
      params: {
        aPos: 0, aRand: 0, voiceMode: VOICE_MODE.mono, glide: 15, f1On: 0, e1A: 0.003, e1R: 0.06, volume: -14,
        ...mods([SRC.velocity, 'volume', 10]),
      },
    },
    {
      // il rimbombo della techno scura: un triangolo saturato e chiuso che si spegne lento
      name: 'Rimbombo',
      params: {
        aPos: 30, aRand: 0, subOn: 1, subLevel: 50, voiceMode: VOICE_MODE.mono, f1Type: FILTER.ladder, f1Cutoff: 220, f1Res: 25, f1Drive: 75,
        e1A: 0.002, e1D: 0.9, e1S: 0, e1R: 0.5, e1Dc: 30, e2A: 0.001, e2D: 0.12, l1Shape: LFO_SHAPE.sine, l1Div: R['1/16'], volume: 0,
        ...mods([SRC.env2, 'f1Cutoff', 25], [SRC.lfo1, 'f1Cutoff', 6, { bi: true }], [SRC.velocity, 'f1Drive', 20]),
      },
    },
    {
      name: 'Basso rotolante',
      params: {
        aUnison: 2, aDetune: 8, aWidth: 30, subOn: 1, subLevel: 55, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 350, f1Res: 30,
        f1Drive: 25, f1Key: 40, e1A: 0.001, e1D: 0.22, e1S: 25, e1R: 0.06, e2A: 0.001, e2D: 0.12, e2Dc: 70, volume: -5,
        ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.velocity, 'f1Cutoff', 15], [SRC.velocity, 'e2D', 20]),
      },
    },
    {
      // corto, con il filtro che respira in quattro battute: per i giri lunghi della techno
      name: 'Basso ipnotico',
      params: {
        aTable: T.Armoniche, aPos: 55, aUnison: 2, aDetune: 6, subOn: 1, subLevel: 50, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono,
        f1Type: FILTER.lp24, f1Cutoff: 450, f1Res: 40, f1Drive: 30, e1A: 0.001, e1D: 0.25, e1S: 10, e1R: 0.08, e2A: 0.001, e2D: 0.1,
        l1Shape: LFO_SHAPE.sine, l1Div: R['4 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Div: R['8 battute'],
        l2Trig: LFO_TRIG.free, volume: -7,
        ...mods(
          [SRC.env2, 'f1Cutoff', 25], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }], [SRC.lfo2, 'f1Res', 15, { bi: true }],
          [SRC.lfo2, 'aPos', 20, { bi: true }],
        ),
      },
    },
    {
      // corto e in levare: lascia spazio alla cassa
      name: 'Basso in levare',
      params: {
        aUnison: 3, aDetune: 10, aWidth: 40, subOn: 1, subLevel: 60, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 600, f1Res: 20,
        f1Drive: 20, e1A: 0.001, e1D: 0.15, e1S: 0, e1R: 0.05, e2A: 0.001, e2D: 0.08, volume: -6,
        ...mods([SRC.env2, 'f1Cutoff', 30], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      // le ottave che saltano a sedicesimi (LFO 1), il filtro che pizzica ogni passo (LFO 2)
      name: 'Basso a ottave',
      params: {
        aUnison: 2, aDetune: 10, aLevel: 35, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 500, f1Res: 35, f1Drive: 30, e1R: 0.05,
        l1Div: R['1/8'], ...drawn(1, steps([0, 1])), l2Div: R['1/16'], ...drawn(2, [[0, 1, 60], [0.8, 0], [1, 0]]), volume: -9,
        ...mods([SRC.lfo1, 'tune', 25], [SRC.lfo2, 'f1Cutoff', 35], [SRC.lfo2, 'aLevel', 60]),
      },
    },
    {
      // due denti di sega stonati e saturati, il sub diretto, un phaser lento nel secondo filtro
      name: 'Reese sporco',
      params: {
        aUnison: 2, aDetune: 20, aWidth: 60, bOn: 1, bTable: T.Base, bPos: 67, bFine: 15, bUnison: 2, bDetune: 14, bLevel: 70, subOn: 1,
        subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 35, f1Type: FILTER.ladder, f1Cutoff: 1100, f1Res: 20,
        f1Drive: 70, f2On: 1, f2Type: FILTER.phaser, f2Cutoff: 700, f2Res: 50, f2Var: 60, e1R: 0.08, l1Shape: LFO_SHAPE.triangle,
        l1Div: R['2 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['1 battuta'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'f2Cutoff', 30, { bi: true }], [SRC.lfo2, 'bFine', 20, { bi: true }], [SRC.lfo2, 'f1Cutoff', 10, { bi: true }]),
      },
    },
    {
      // FM dall'oscillatore B a rapporto 3: il morso metallico che si chiude con Env 2
      name: 'Basso FM metallico',
      params: {
        aPos: 0, aWarp: WARP.fm, aWarpAmt: 10, bOn: 1, bTable: T.Base, bPos: 0, bOct: 1, bSemi: 7, bLevel: 0, subOn: 1, subLevel: 50,
        subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.lp24, f1Cutoff: 3000, f1Drive: 30, e1R: 0.06,
        e2A: 0.001, e2D: 0.2, e2S: 10, volume: -13,
        ...mods([SRC.env2, 'aWarpAmt', 45], [SRC.velocity, 'aWarpAmt', 20], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    {
      // Macro 1 fa entrare un LFO a crome sul ripiegamento
      name: 'Basso ripiegato',
      params: {
        aTable: T.Fold, aPos: 10, aRand: 0, subOn: 1, subLevel: 45, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 25,
        f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 15, e1R: 0.06, e2A: 0.001, e2D: 0.3, e2S: 20, l1Shape: LFO_SHAPE.sine, l1Div: R['1/8'],
        volume: -12, ...mods([SRC.env2, 'aPos', 50], [SRC.velocity, 'aPos', 25], [SRC.lfo1, 'aPos', 30, { aux: SRC.macro1 }]),
      },
    },
    {
      name: 'Basso pulsar',
      params: {
        aTable: T.Pulsar, aPos: 30, subOn: 1, subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.lp24,
        f1Cutoff: 1800, f1Res: 25, e1R: 0.06, l1Shape: LFO_SHAPE.sawDown, l1Div: R['1/8'], volume: -9,
        ...mods([SRC.lfo1, 'aPos', 50], [SRC.lfo1, 'f1Cutoff', 25]),
      },
    },
    {
      name: 'Basso sync',
      params: {
        aWarp: WARP.sync, aWarpAmt: 5, aUnison: 2, aDetune: 8, subOn: 1, subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono,
        glide: 30, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 15, f1Drive: 35, e1R: 0.06, e2A: 0.001, e2D: 0.25, e2S: 15, volume: -13,
        ...mods([SRC.env2, 'aWarpAmt', 40], [SRC.velocity, 'aWarpAmt', 15], [SRC.env2, 'f1Cutoff', 15]),
      },
    },
    {
      // Macro 1 apre il ringhio, Macro 2 fa entrare l'LFO a sedicesimi
      name: 'Growl a macro',
      params: {
        aTable: T.Growl, aPos: 10, aWarp: WARP.bendBoth, aWarpAmt: 0, bOn: 1, bTable: T.Base, bPos: 67, bOct: -1, bLevel: 40, subOn: 1,
        subLevel: 55, subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 25, f1Type: FILTER.lp24, f1Cutoff: 500, f1Res: 30, f1Drive: 50,
        e1R: 0.06, macro1: 40, l1Shape: LFO_SHAPE.sine, l1Div: R['1/16'], volume: -14,
        ...mods(
          [SRC.macro1, 'aPos', 70], [SRC.macro1, 'f1Cutoff', 35], [SRC.macro1, 'aWarpAmt', 30],
          [SRC.lfo1, 'f1Cutoff', 30, { aux: SRC.macro2 }], [SRC.lfo1, 'aPos', 30, { aux: SRC.macro2 }],
        ),
      },
    },
    {
      name: 'Acido quadro',
      params: {
        aPos: 100, voiceMode: VOICE_MODE.legato, glide: 60, f1Type: FILTER.ladder, f1Cutoff: 260, f1Res: 82, f1Drive: 45, f1Key: 25, e1R: 0.04,
        e2A: 0.001, e2D: 0.16, e2Dc: 70, volume: -9,
        ...mods([SRC.env2, 'f1Cutoff', 45], [SRC.velocity, 'f1Cutoff', 20], [SRC.velocity, 'e2D', 25], [SRC.macro1, 'f1Cutoff', 30]),
      },
    },
    {
      // bit ridotti, crepitio e un pettine sulla nota: ferro arrugginito
      name: 'Basso industriale',
      params: {
        aTable: T.Digitale, aPos: 55, aUnison: 2, aDetune: 12, nOn: 1, nType: NOISE.crackle, nLevel: 15, subOn: 1, subShape: 3, subLevel: 45,
        subRoute: ROUTE.direct, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.combDown, f1Cutoff: 300, f1Res: 55, f1Key: 100, f1Mix: 60,
        f1Drive: 50, f2On: 1, f2Type: FILTER.lp24, f2Cutoff: 2500, e1R: 0.06, e2A: 0.001, e2D: 0.2, l1Shape: LFO_SHAPE.sampleHold,
        l1Div: R['1/16'], volume: -11,
        ...mods([SRC.env2, 'f2Cutoff', 30], [SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.lfo1, 'f1Res', 15, { bi: true }]),
      },
    },
    {
      // un seno che si gonfia: la velocity lo satura, l'intonazione scivola giù all'attacco
      name: 'Basso di gomma',
      params: {
        aTable: T['Seno caldo'], aPos: 20, aRand: 0, voiceMode: VOICE_MODE.legato, glide: 80, f1Type: FILTER.lp12, f1Cutoff: 1500, e1A: 0.002,
        e1D: 0.5, e1S: 60, e1R: 0.1, e2A: 0.001, e2D: 0.07, volume: -9,
        ...mods([SRC.env2, 'tune', 4], [SRC.velocity, 'aPos', 50], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    // ---- lead
    {
      name: 'Supersaw',
      params: {
        aUnison: 9, aDetune: 30, aWidth: 100, aBlend: 70, bOn: 1, bTable: T.Base, bPos: 67, bOct: 1, bUnison: 5, bDetune: 22, bWidth: 100, bLevel: 40,
        f1Cutoff: 9000, e1A: 0.005, e1R: 0.35, volume: -19, ...mods([SRC.velocity, 'volume', 12]),
      },
    },
    {
      name: 'Lead sync urlante',
      params: {
        aWarp: WARP.sync, aWarpAmt: 15, aUnison: 2, aDetune: 10, voiceMode: VOICE_MODE.legato, glide: 50, f1Cutoff: 8000, e1A: 0.005, e1R: 0.15,
        e2D: 0.6, e2S: 20, l1Sync: LFO_SYNC.hz, l1Rate: 5.5, l1Delay: 0.3, l1Rise: 0.4, volume: -7.5,
        ...mods([SRC.env2, 'aWarpAmt', 45], [SRC.lfo1, 'tune', 1, { bi: true }]),
      },
    },
    {
      name: 'Lead PWM morbido',
      params: {
        aTable: T.PWM, aPos: 15, aUnison: 3, aDetune: 10, aWidth: 60, voiceMode: VOICE_MODE.legato, glide: 45, f1Type: FILTER.lp24, f1Cutoff: 4200,
        f1Key: 30, e1A: 0.01, e1R: 0.25, l1Shape: LFO_SHAPE.triangle, l1Div: R['2 battute'], l1Trig: LFO_TRIG.free, l2Sync: LFO_SYNC.hz,
        l2Rate: 5, l2Delay: 0.4, l2Rise: 0.5, volume: -13,
        ...mods([SRC.lfo1, 'aPos', 35, { bi: true }], [SRC.lfo2, 'tune', 1, { bi: true }]),
      },
    },
    {
      name: 'Lead che parla',
      params: {
        aTable: T.Vocale, aPos: 0, aUnison: 2, aDetune: 8, voiceMode: VOICE_MODE.legato, glide: 60, f1Type: FILTER.formant, f1Cutoff: 1000,
        f1Var: 20, f1Res: 40, f1Mix: 70, e1A: 0.01, e1R: 0.2, l1Div: R['1/4'], ...drawn(1, [[0, 0, 40], [0.5, 1, -40], [1, 0]]),
        l2Shape: LFO_SHAPE.triangle, l2Div: R['2 battute'], volume: -1,
        ...mods([SRC.lfo1, 'aPos', 80], [SRC.lfo2, 'f1Var', 60]),
      },
    },
    {
      // il "hoover" dei rave: impulsi stonati che salgono di pitch all'attacco
      name: 'Hoover',
      params: {
        aTable: T.PWM, aPos: 35, aUnison: 7, aDetune: 40, aWidth: 100, bOn: 1, bTable: T.Base, bPos: 67, bOct: -1, bUnison: 3, bDetune: 25,
        bLevel: 55, voiceMode: VOICE_MODE.legato, glide: 120, f1Type: FILTER.lp24, f1Cutoff: 3500, f1Res: 15, e1A: 0.01, e1R: 0.3, e2A: 0.001,
        e2D: 0.2, e2Dc: 50, l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz, l1Rate: 0.8, l1Trig: LFO_TRIG.free, volume: -13,
        ...mods([SRC.env2, 'tune', -6], [SRC.lfo1, 'aPos', 30, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      name: 'Lead trance',
      params: {
        aUnison: 9, aDetune: 28, aWidth: 100, bOn: 1, bTable: T.Base, bPos: 67, bOct: 1, bUnison: 5, bDetune: 20, bLevel: 35,
        voiceMode: VOICE_MODE.legato, glide: 50, f1Type: FILTER.lp24, f1Cutoff: 7000, f1Res: 10, e1A: 0.005, e1R: 0.4, l1Shape: LFO_SHAPE.sine,
        l1Sync: LFO_SYNC.hz, l1Rate: 5.5, l1Delay: 0.4, l1Rise: 0.6, volume: -10,
        ...mods([SRC.lfo1, 'tune', 1, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // due denti di sega appena stonati nel ladder, l'inviluppo che apre: il lead di una volta
      name: 'Lead analogico',
      params: {
        bOn: 1, bTable: T.Base, bPos: 67, bFine: 8, bLevel: 70, voiceMode: VOICE_MODE.legato, glide: 45, f1Type: FILTER.ladder, f1Cutoff: 1100,
        f1Res: 35, f1Drive: 20, f1Key: 50, e1A: 0.003, e1R: 0.2, e2A: 0.005, e2D: 0.6, e2S: 30, l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz,
        l1Rate: 5, l1Delay: 0.5, l1Rise: 0.6, volume: -8,
        ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.velocity, 'f1Cutoff', 15], [SRC.lfo1, 'tune', 1, { bi: true }], [SRC.macro1, 'f1Cutoff', 25]),
      },
    },
    {
      name: 'Lead acido saturo',
      params: {
        aUnison: 2, aDetune: 6, voiceMode: VOICE_MODE.legato, glide: 55, f1Type: FILTER.ladder, f1Cutoff: 700, f1Res: 65, f1Drive: 70, f1Key: 40,
        e1R: 0.08, e2A: 0.001, e2D: 0.35, e2S: 20, volume: -7,
        ...mods([SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 15], [SRC.macro1, 'f1Cutoff', 30]),
      },
    },
    {
      // la tabella sync che corre avanti e indietro, stretta in un passa-banda e saturata
      name: 'Lead stridulo',
      params: {
        aTable: T.Sync, aPos: 40, aUnison: 3, aDetune: 15, aWidth: 70, voiceMode: VOICE_MODE.legato, glide: 30, f1Type: FILTER.bp12,
        f1Cutoff: 2200, f1Res: 30, f1Drive: 55, f1Key: 50, f1Mix: 75, e1A: 0.003, e1R: 0.15, l1Shape: LFO_SHAPE.triangle, l1Div: R['1/8'],
        volume: -5, ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo1, 'f1Cutoff', 10, { bi: true }], [SRC.velocity, 'f1Drive', 20]),
      },
    },
    {
      name: 'Lead FM tagliente',
      params: {
        aTable: T.FM, aPos: 55, aUnison: 2, aDetune: 7, voiceMode: VOICE_MODE.legato, glide: 35, f1Type: FILTER.lp12, f1Cutoff: 7000,
        e1A: 0.003, e1R: 0.15, e2A: 0.001, e2D: 0.5, e2S: 40, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 5, l1Delay: 0.4, l1Rise: 0.5,
        volume: -10, ...mods([SRC.env2, 'aPos', 35], [SRC.velocity, 'aPos', 15], [SRC.lfo1, 'tune', 1, { bi: true }]),
      },
    },
    {
      name: 'Lead a ottave',
      params: {
        aTable: T.Ottave, aPos: 60, aUnison: 3, aDetune: 12, aWidth: 70, bOn: 1, bTable: T.Base, bPos: 67, bOct: -1, bLevel: 40,
        voiceMode: VOICE_MODE.legato, glide: 40, f1Type: FILTER.lp24, f1Cutoff: 5000, f1Res: 15, f1Key: 30, e1A: 0.005, e1R: 0.2, volume: -9,
        ...mods([SRC.velocity, 'aPos', 30], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // le formanti alte e un picco che le spinge: sottile e nasale
      name: 'Lead nasale',
      params: {
        aTable: T.Formanti, aPos: 55, aUnison: 2, aDetune: 6, voiceMode: VOICE_MODE.legato, glide: 40, f1Type: FILTER.peak, f1Cutoff: 1500,
        f1Res: 50, f1Key: 50, e1A: 0.005, e1R: 0.2, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 0.3, l1Trig: LFO_TRIG.free, volume: -7,
        ...mods([SRC.lfo1, 'aPos', 20, { bi: true }], [SRC.velocity, 'aPos', 15]),
      },
    },
    {
      // un seno con un filo di fiato e il vibrato che arriva tardi
      name: 'Fischio',
      params: {
        aPos: 5, aRand: 0, nOn: 1, nType: NOISE.pink, nLevel: 6, voiceMode: VOICE_MODE.legato, glide: 90, f1Type: FILTER.lp12, f1Cutoff: 3000,
        f1Key: 60, e1A: 0.04, e1R: 0.25, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 5.5, l1Delay: 0.3, l1Rise: 0.5, volume: -11,
        ...mods([SRC.lfo1, 'tune', 1, { bi: true }], [SRC.velocity, 'nLevel', 10]),
      },
    },
    {
      // un quadro che salta d'ottava a 1/32, come nei videogiochi a 8 bit
      name: 'Lead chiptune',
      params: {
        aTable: T.PWM, aPos: 30, aRand: 0, voiceMode: VOICE_MODE.legato, f1On: 0, e1A: 0.001, e1R: 0.08, l1Div: R['1/16'],
        ...drawn(1, steps([0, 1])), l2Shape: LFO_SHAPE.triangle, l2Div: R['1 battuta'], l2Trig: LFO_TRIG.free, volume: -11,
        ...mods([SRC.lfo1, 'tune', 25], [SRC.lfo2, 'aPos', 40, { bi: true }]),
      },
    },
    // ---- pad
    {
      name: 'Pad di vetro',
      params: {
        aTable: T.Metallo, aPos: 30, aUnison: 6, aDetune: 15, aSpread: 30, bOn: 1, bTable: T['Seno caldo'], bPos: 0, bOct: 1, bLevel: 40,
        nOn: 1, nType: 1, nTone: 55, nLevel: 8, f1Type: FILTER.lp24, f1Cutoff: 5000, f1Res: 15, e1A: 1.2, e1D: 2, e1S: 80, e1R: 2.5,
        l1Div: R['4 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Div: R['8 battute'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.lfo2, 'f1Cutoff', 15, { bi: true }], [SRC.velocity, 'f1Cutoff', 10]),
      },
    },
    {
      name: 'Pad spettrale',
      params: {
        aTable: T.Spettrale, aPos: 20, aUnison: 5, aDetune: 14, aWidth: 100, bOn: 1, bTable: T.Additiva, bPos: 35, bLevel: 45, bSemi: 7, bUnison: 3,
        bDetune: 10, f1Type: FILTER.lp12, f1Cutoff: 3500, e1A: 0.9, e1D: 1.5, e1S: 85, e1R: 2, e2A: 1.5, e2D: 3, e2S: 40,
        l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['2 battute'], l1Trig: LFO_TRIG.free, l2Div: R['8 battute'], l2Trig: LFO_TRIG.free, volume: -15,
        ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo2, 'bPos', 50, { bi: true }], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Archi morbidi',
      params: {
        aUnison: 7, aDetune: 12, aWidth: 90, f1Type: FILTER.lp12, f1Cutoff: 2800, f1Key: 50, e1A: 0.4, e1D: 1, e1S: 90, e1R: 0.9,
        l1Sync: LFO_SYNC.hz, l1Rate: 5, l1Delay: 0.5, l1Rise: 0.6, volume: -14,
        ...mods([SRC.lfo1, 'tune', 1, { bi: true }], [SRC.velocity, 'f1Cutoff', 20], [SRC.velocity, 'e1A', -15]),
      },
    },
    {
      name: 'Coro di formanti',
      params: {
        aTable: T.Formanti, aPos: 30, aUnison: 5, aDetune: 15, aSpread: 25, f1Type: FILTER.formant, f1Cutoff: 1000, f1Var: 40, f1Res: 30,
        f1Mix: 60, e1A: 0.6, e1D: 1.5, e1S: 85, e1R: 1.6, l1Shape: LFO_SHAPE.triangle, l1Div: R['4 battute'], l1Trig: LFO_TRIG.free,
        l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['1 battuta'], l2Trig: LFO_TRIG.free, volume: -9,
        ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo2, 'f1Var', 30, { bi: true }]),
      },
    },
    {
      // Macro 1 apre il filtro
      name: 'Pad scuro',
      params: {
        aUnison: 6, aDetune: 16, aWidth: 100, bOn: 1, bTable: T.Base, bPos: 100, bOct: -1, bUnison: 3, bDetune: 12, bLevel: 40,
        f1Type: FILTER.lp24, f1Cutoff: 450, f1Res: 25, f1Key: 30, e1A: 1.5, e1D: 2, e1S: 90, e1R: 3, l1Shape: LFO_SHAPE.sine,
        l1Div: R['8 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['2 battute'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'f1Cutoff', 15, { bi: true }], [SRC.lfo2, 'aDetune', 15, { bi: true }], [SRC.macro1, 'f1Cutoff', 35]),
      },
    },
    {
      name: 'Pad tiepido',
      params: {
        aTable: T['Seno caldo'], aPos: 45, aUnison: 5, aDetune: 14, aWidth: 90, bOn: 1, bTable: T.Base, bPos: 33, bOct: 1, bUnison: 3, bDetune: 10,
        bLevel: 30, f1Type: FILTER.lp12, f1Cutoff: 2200, f1Key: 40, e1A: 0.8, e1D: 1.5, e1S: 85, e1R: 2, l1Shape: LFO_SHAPE.triangle,
        l1Div: R['4 battute'], l1Trig: LFO_TRIG.free, volume: -16,
        ...mods([SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // due impulsi che si allargano e stringono a velocità diverse
      name: 'Pad anni 80',
      params: {
        aTable: T.PWM, aPos: 20, aUnison: 4, aDetune: 12, aWidth: 90, bOn: 1, bTable: T.PWM, bPos: 50, bFine: -8, bUnison: 3, bDetune: 10,
        bLevel: 60, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 15, f1Key: 30, e1A: 0.5, e1D: 1, e1S: 85, e1R: 1.5, e2A: 0.8, e2D: 2, e2S: 30,
        l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz, l1Rate: 0.6, l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Sync: LFO_SYNC.hz,
        l2Rate: 0.45, l2Trig: LFO_TRIG.free, volume: -16,
        ...mods([SRC.lfo1, 'aPos', 40, { bi: true }], [SRC.lfo2, 'bPos', 40, { bi: true }], [SRC.env2, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Pad phaser',
      params: {
        aUnison: 7, aDetune: 20, aWidth: 100, f1Type: FILTER.phaser, f1Cutoff: 900, f1Res: 60, f1Var: 80, f2On: 1, f2Type: FILTER.lp12,
        f2Cutoff: 5000, e1A: 0.6, e1D: 1, e1S: 90, e1R: 2, l1Shape: LFO_SHAPE.triangle, l1Div: R['4 battute'], l1Trig: LFO_TRIG.free, volume: -12,
        ...mods([SRC.lfo1, 'f1Cutoff', 40, { bi: true }]),
      },
    },
    {
      name: 'Pad metallico',
      params: {
        aTable: T.Metallo, aPos: 20, aLevel: 100, aUnison: 5, aDetune: 10, aSpread: 20, aWidth: 100, bOn: 1,
        bTable: T['Seno caldo'], bOct: 1, bLevel: 12, f1Type: FILTER.lp24, f1Cutoff: 4000, f2On: 1,
        f2Type: FILTER.phaser, f2Cutoff: 1200, f2Res: 50, f2Var: 70, e1A: 1, e1D: 2, e1S: 85, e1R: 2.5, l1Shape: LFO_SHAPE.triangle,
        l1Div: R['8 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sine, l2Div: R['2 battute'], l2Trig: LFO_TRIG.free, volume: 0,
        ...mods([SRC.lfo1, 'aPos', 50], [SRC.lfo2, 'f2Cutoff', 35, { bi: true }]),
      },
    },
    {
      // il rumore rosa che fa da fiato a un ronzio additivo, in un formante che cambia vocale
      name: 'Pad fantasma',
      params: {
        aTable: T.Additiva, aPos: 45, aUnison: 4, aDetune: 10, aLevel: 50, nOn: 1, nType: NOISE.pink, nLevel: 35, f1Type: FILTER.formant,
        f1Cutoff: 900, f1Var: 70, f1Res: 50, e1A: 2, e1D: 2, e1S: 90, e1R: 3, l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['4 battute'],
        l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sine, l2Sync: LFO_SYNC.hz, l2Rate: 0.15, l2Trig: LFO_TRIG.free, volume: 0,
        ...mods([SRC.lfo1, 'f1Var', 50, { bi: true }], [SRC.lfo2, 'nPan', 60, { bi: true }], [SRC.lfo2, 'aPos', 20, { bi: true }]),
      },
    },
    {
      // le vocali O e U, in basso: un coro di monaci
      name: 'Coro scuro',
      params: {
        aUnison: 6, aDetune: 12, aWidth: 90, bOn: 1, bTable: T.Vocale, bPos: 75, bOct: -1, bLevel: 55, f1Type: FILTER.formant, f1Cutoff: 700,
        f1Var: 85, f1Res: 45, e1A: 1, e1D: 1.5, e1S: 90, e1R: 2.5, l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['2 battute'], l1Trig: LFO_TRIG.free,
        volume: -10, ...mods([SRC.lfo1, 'f1Var', 15, { bi: true }], [SRC.lfo1, 'f1Cutoff', 8, { bi: true }]),
      },
    },
    {
      name: 'Pad gelido',
      params: {
        aTable: T.Additiva, aPos: 80, aUnison: 6, aDetune: 12, aWidth: 100, bOn: 1, bTable: T.Metallo, bPos: 60, bOct: 1, bLevel: 30, nOn: 1,
        nType: NOISE.white, nLevel: 10, f1Type: FILTER.lp12, f1Cutoff: 9000, f2On: 1, f2Type: FILTER.hp12, f2Cutoff: 400, e1A: 1.2, e1D: 2,
        e1S: 80, e1R: 3, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l1Smooth: 60, l1Trig: LFO_TRIG.free, volume: -3,
        ...mods([SRC.lfo1, 'bPos', 30, { bi: true }], [SRC.lfo1, 'bPan', 60, { bi: true }]),
      },
    },
    {
      // un S&H veloce e smussato sulla posizione: la tabella brulica come una nuvola di grani
      name: 'Pad brulicante',
      params: {
        aTable: T.Formanti, aPos: 40, aUnison: 8, aDetune: 15, aSpread: 40, aWidth: 100, f1Type: FILTER.lp24, f1Cutoff: 3000, f1Res: 15,
        e1A: 1, e1D: 2, e1S: 85, e1R: 2.5, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/32'], l1Smooth: 70, l2Shape: LFO_SHAPE.triangle,
        l2Div: R['8 battute'], l2Trig: LFO_TRIG.free, volume: -7,
        ...mods([SRC.lfo1, 'aPos', 25, { bi: true }], [SRC.lfo2, 'aSpread', 40, { bi: true }], [SRC.lfo2, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      // Env 3, lungo otto secondi, apre il filtro, allarga l'unison e fa entrare B mentre si tiene
      name: 'Pad che si apre',
      params: {
        aUnison: 8, aDetune: 6, aWidth: 100, bOn: 1, bTable: T.Spettrale, bPos: 30, bOct: 1, bUnison: 4, bDetune: 8, bLevel: 0,
        f1Type: FILTER.lp24, f1Cutoff: 250, f1Res: 30, e1A: 0.8, e1D: 2, e1S: 90, e1R: 3, e3A: 8, e3S: 100, e3Ac: -40, volume: -13,
        ...mods([SRC.env3, 'f1Cutoff', 55], [SRC.env3, 'aDetune', 25], [SRC.env3, 'bLevel', 50], [SRC.env3, 'f1Res', -15]),
      },
    },
    {
      // due quinte e il sub, tenute: un tappeto per tutta la sezione
      name: 'Drone di quinte',
      params: {
        aTable: T.Armoniche, aPos: 50, aUnison: 3, aDetune: 8, bOn: 1, bTable: T.Armoniche, bPos: 40, bSemi: 7, bUnison: 3, bDetune: 8,
        bLevel: 60, subOn: 1, subLevel: 50, f1Type: FILTER.lp24, f1Cutoff: 1200, f1Res: 20, e1A: 2.5, e1D: 2, e1S: 100, e1R: 4,
        l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['8 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.sine, l2Div: R['4 battute'],
        l2Trig: LFO_TRIG.free, volume: -17,
        ...mods([SRC.lfo1, 'f1Cutoff', 20, { bi: true }], [SRC.lfo2, 'aPos', 25, { bi: true }], [SRC.lfo2, 'bPos', -25, { bi: true }]),
      },
    },
    // ---- tastiere e pluck
    {
      name: 'Pluck di cristallo',
      params: {
        aTable: T.FM, aPos: 40, aUnison: 3, aDetune: 8, f1Type: FILTER.lp12, f1Cutoff: 2500, f1Key: 50, e1A: 0.001, e1D: 0.6, e1S: 0, e1R: 0.5,
        e2A: 0.001, e2D: 0.25, volume: -11,
        ...mods([SRC.env2, 'aPos', 45], [SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Campane',
      params: {
        aTable: T.Metallo, aPos: 55, bOn: 1, bTable: T.Base, bPos: 0, bOct: 2, bLevel: 30, aWarp: WARP.fm, aWarpAmt: 15, e1A: 0.001, e1D: 2.5,
        e1S: 0, e1R: 2, e2D: 1.2, volume: -11, ...mods([SRC.env2, 'aWarpAmt', 30], [SRC.velocity, 'volume', 15]),
      },
    },
    {
      name: 'Keys caldi',
      params: {
        aTable: T['Seno caldo'], aPos: 25, bOn: 1, bTable: T.Base, bPos: 0, bOct: 1, bLevel: 25, f1Type: FILTER.lp12, f1Cutoff: 5000, f1Key: 30,
        e1A: 0.002, e1D: 1.4, e1S: 35, e1R: 0.45, l1Sync: LFO_SYNC.hz, l1Rate: 4.5, l1Trig: LFO_TRIG.free, volume: -20,
        ...mods([SRC.velocity, 'aPos', 50], [SRC.lfo1, 'aPan', 20, { bi: true }], [SRC.velocity, 'volume', 15]),
      },
    },
    {
      name: 'Arpa S&H',
      params: {
        aTable: T.Armoniche, aPos: 30, e1A: 0.001, e1D: 0.35, e1S: 0, e1R: 0.3, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l1Trig: LFO_TRIG.free,
        f1Type: FILTER.lp24, f1Cutoff: 3000, f1Res: 30, volume: -8,
        ...mods([SRC.lfo1, 'aPos', 50], [SRC.lfo1, 'f1Cutoff', 25, { bi: true }], [SRC.random, 'aPan', 40, { bi: true }]),
      },
    },
    {
      // FM morbida che si spegne, più dura se si suona forte; il tremolo stereo
      name: 'Piano elettrico',
      params: {
        aTable: T.FM, aPos: 15, aRand: 0, aWarp: WARP.fm, aWarpAmt: 0, bOn: 1, bTable: T.Base, bPos: 0, bOct: 2, bLevel: 0, f1Type: FILTER.lp12,
        f1Cutoff: 6000, e1A: 0.002, e1D: 2.5, e1S: 0, e1R: 0.4, e1Dc: 50, e2A: 0.001, e2D: 0.5, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz,
        l1Rate: 4, l1Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.env2, 'aWarpAmt', 20, { aux: SRC.velocity }], [SRC.velocity, 'aPos', 30], [SRC.lfo1, 'aPan', 35, { bi: true }]),
      },
    },
    {
      name: 'Pluck trance',
      params: {
        aUnison: 7, aDetune: 22, aWidth: 100, bOn: 1, bTable: T.Base, bPos: 100, bOct: 1, bLevel: 25, f1Type: FILTER.lp24, f1Cutoff: 500,
        f1Res: 25, f1Key: 40, e1A: 0.001, e1D: 0.4, e1S: 0, e1R: 0.3, e2A: 0.001, e2D: 0.2, e2Dc: 70, volume: -10,
        ...mods([SRC.env2, 'f1Cutoff', 50], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // Env 2 porta la posizione verso i bit più grossi e la lascia tornare liscia
      name: 'Pluck digitale',
      params: {
        aTable: T.Digitale, aPos: 20, aUnison: 2, aDetune: 8, f1Type: FILTER.lp12, f1Cutoff: 5000, e1A: 0.001, e1D: 0.45, e1S: 0, e1R: 0.3,
        e2A: 0.001, e2D: 0.3, volume: -9, ...mods([SRC.env2, 'aPos', 60], [SRC.random, 'aPan', 40, { bi: true }]),
      },
    },
    {
      name: 'Marimba',
      params: {
        aPos: 0, aRand: 0, bOn: 1, bTable: T.Base, bPos: 0, bOct: 2, bLevel: 25, f1On: 0, e1A: 0.001, e1D: 0.5, e1S: 0, e1R: 0.3, e1Dc: 70,
        e2A: 0.001, e2D: 0.05, volume: -14, ...mods([SRC.env2, 'bLevel', 60], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      // FM da B a un rapporto storto: la lamella di metallo pizzicata
      name: 'Kalimba',
      params: {
        aPos: 0, aRand: 0, aWarp: WARP.fm, aWarpAmt: 0, bOn: 1, bTable: T.Base, bPos: 0, bOct: 1, bSemi: 9, bLevel: 0, f1On: 0, e1A: 0.001,
        e1D: 0.9, e1S: 0, e1R: 0.5, e2A: 0.001, e2D: 0.08, volume: -10,
        ...mods([SRC.env2, 'aWarpAmt', 35], [SRC.velocity, 'aWarpAmt', 10]),
      },
    },
    {
      name: 'Carillon',
      params: {
        aPos: 0, aRand: 0, tune: 12, bOn: 1, bTable: T.Metallo, bPos: 70, bOct: 1, bLevel: 30, f1On: 0, e1A: 0.001, e1D: 1.8, e1S: 0, e1R: 1.5,
        e2A: 0.001, e2D: 0.4, volume: -13, ...mods([SRC.env2, 'bLevel', 40], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      name: 'Arpa dolce',
      params: {
        aTable: T.Armoniche, aPos: 40, aRand: 0, f1Type: FILTER.lp12, f1Cutoff: 1800, f1Key: 60, e1A: 0.002, e1D: 1.8, e1S: 0, e1R: 1.2,
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
      // i tiranti dell'organo, corti, con il filtro che si chiude: lo stab della house
      name: 'Organo house',
      params: {
        aTable: T.Organo, aPos: 55, aRand: 0, f1Type: FILTER.lp24, f1Cutoff: 900, f1Res: 20, e1A: 0.002, e1D: 0.3, e1S: 0, e1R: 0.15,
        e2A: 0.001, e2D: 0.15, volume: -7, ...mods([SRC.env2, 'f1Cutoff', 40], [SRC.velocity, 'f1Cutoff', 20]),
      },
    },
    {
      name: 'Stab di Detroit',
      params: {
        aUnison: 3, aDetune: 10, aWidth: 70, bOn: 1, bTable: T.Base, bPos: 100, bLevel: 50, f1Type: FILTER.lp24, f1Cutoff: 1100, f1Res: 30,
        f1Key: 40, e1A: 0.002, e1D: 0.5, e1S: 10, e1R: 0.4, e2A: 0.001, e2D: 0.3, l1Shape: LFO_SHAPE.sine, l1Div: R['8 battute'],
        l1Trig: LFO_TRIG.free, volume: -12,
        ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.velocity, 'f1Cutoff', 15], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      // metallo e un pettine accordato sulla nota: l'accordo duro della techno industriale
      name: 'Stab di ferro',
      params: {
        aTable: T.Metallo, aPos: 45, aUnison: 3, aDetune: 15, bOn: 1, bTable: T.Base, bPos: 67, bLevel: 45, f1Type: FILTER.combUp,
        f1Cutoff: 500, f1Res: 60, f1Key: 100, f1Mix: 60, f1Drive: 40, f2On: 1, f2Type: FILTER.lp24, f2Cutoff: 1500, e1A: 0.001, e1D: 0.35,
        e1S: 0, e1R: 0.3, e2A: 0.001, e2D: 0.2, volume: -5, ...mods([SRC.env2, 'f2Cutoff', 45], [SRC.velocity, 'f1Drive', 25]),
      },
    },
    // ---- ottoni e organi
    {
      name: 'Ottoni',
      params: {
        aUnison: 2, aDetune: 8, aWidth: 50, bOn: 1, bTable: T.Base, bPos: 100, bLevel: 35, f1Type: FILTER.lp24, f1Cutoff: 650, f1Res: 10, f1Key: 30,
        e1A: 0.03, e1D: 0.5, e1S: 85, e1R: 0.2, e2A: 0.05, e2D: 0.4, e2S: 40, volume: -16,
        ...mods([SRC.env2, 'f1Cutoff', 45], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      name: 'Organo',
      params: {
        aTable: T.Organo, aPos: 70, e1A: 0.003, e1D: 0.1, e1S: 100, e1R: 0.08, f1On: 0, l1Sync: LFO_SYNC.hz, l1Rate: 6.5, l1Trig: LFO_TRIG.free,
        volume: -11, ...mods([SRC.lfo1, 'aLevel', 10, { bi: true }], [SRC.lfo1, 'aPan', 25, { bi: true }]),
      },
    },
    {
      name: 'Organo da chiesa',
      params: {
        aTable: T.Organo, aPos: 100, aRand: 0, aUnison: 2, aDetune: 4, bOn: 1, bTable: T.Organo, bPos: 60, bOct: -1, bLevel: 50, f1On: 0,
        e1A: 0.08, e1D: 0.1, e1S: 100, e1R: 0.8, volume: -14,
      },
    },
    {
      name: 'Fisarmonica',
      params: {
        aTable: T.PWM, aPos: 55, aRand: 0, aUnison: 3, aDetune: 14, aBlend: 100, bOn: 1, bTable: T.Spettrale, bPos: 20, bOct: 1, bLevel: 35,
        f1Type: FILTER.lp12, f1Cutoff: 3500, e1A: 0.04, e1D: 0.2, e1S: 100, e1R: 0.12, l1Shape: LFO_SHAPE.sine, l1Sync: LFO_SYNC.hz, l1Rate: 6,
        l1Trig: LFO_TRIG.free, volume: -16, ...mods([SRC.lfo1, 'aLevel', 10, { bi: true }]),
      },
    },
    {
      name: 'Ottoni stab',
      params: {
        aUnison: 3, aDetune: 10, aWidth: 70, bOn: 1, bTable: T.Base, bPos: 67, bOct: -1, bLevel: 40, f1Type: FILTER.lp24, f1Cutoff: 500,
        f1Res: 15, f1Key: 40, e1A: 0.01, e1D: 0.4, e1S: 30, e1R: 0.2, e2A: 0.02, e2D: 0.25, volume: -9,
        ...mods([SRC.env2, 'f1Cutoff', 50], [SRC.velocity, 'f1Cutoff', 20]),
      },
    },
    // ---- ritmici ed effetti
    {
      name: 'Gate in 1/4',
      params: {
        aUnison: 7, aDetune: 25, aWidth: 100, aLevel: 0, f1Cutoff: 7000, e1A: 0.002, e1R: 0.2, l1Div: R['1/4'], volume: -14,
        ...drawn(1, [[0, 1], [0.2, 1, 40], [0.25, 0], [0.5, 0], [0.5, 0.7], [0.7, 0.7, 40], [0.75, 0], [1, 0]]),
        ...mods([SRC.lfo1, 'aLevel', 100]),
      },
    },
    {
      name: 'Pompa sidechain',
      params: {
        aUnison: 5, aDetune: 20, aWidth: 100, aLevel: 0, bOn: 1, bTable: T.Base, bPos: 67, bOct: -1, bLevel: 0, f1Cutoff: 6000, e1A: 0.005, e1R: 0.3,
        l1Div: R['1/4'], volume: -17, ...drawn(1, [[0, 0, 60], [0.45, 1], [1, 1]]),
        ...mods([SRC.lfo1, 'aLevel', 75], [SRC.lfo1, 'bLevel', 50]),
      },
    },
    {
      // un quadro a sedicesimi, e un LFO a scalini (aux) che decide quali passi suonano
      name: 'Gate trance',
      params: {
        aUnison: 7, aDetune: 24, aWidth: 100, aLevel: 0, bOn: 1, bTable: T.Base, bPos: 100, bOct: -1, bUnison: 3, bDetune: 15, bLevel: 0,
        f1Type: FILTER.lp24, f1Cutoff: 4000, f1Res: 15, e1A: 0.05, e1D: 1, e1S: 90, e1R: 0.6, l1Shape: LFO_SHAPE.square, l1Div: R['1/16'],
        l2Div: R['1/2'], ...drawn(2, steps([1, 1, 0, 1, 1, 0, 1, 1])), volume: -15,
        ...mods([SRC.lfo1, 'aLevel', 90, { aux: SRC.lfo2 }], [SRC.lfo1, 'bLevel', 60, { aux: SRC.lfo2 }]),
      },
    },
    {
      // LFO 1 a scalini fa le altezze (tonica, seconda minore, quinta, ottava…), LFO 2 il pizzico di ogni sedicesimo
      name: 'Arpeggio frigio',
      params: {
        aPos: 80, aUnison: 3, aDetune: 10, aLevel: 25, f1Type: FILTER.lp24, f1Cutoff: 1000, f1Res: 35, e1A: 0.002, e1R: 0.3, l1Div: R['1/2'],
        ...drawn(1, steps([0, 1, 7, 12, 13, 12, 7, 1].map(st => st / 24))), l2Div: R['1/16'], ...drawn(2, [[0, 1, 60], [0.8, 0.05], [1, 0]]),
        l3Shape: LFO_SHAPE.sine, l3Div: R['4 battute'], l3Trig: LFO_TRIG.free, volume: -12,
        ...mods([SRC.lfo1, 'tune', 50], [SRC.lfo2, 'f1Cutoff', 40], [SRC.lfo2, 'aLevel', 70], [SRC.lfo3, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      // un giro acido in una nota tenuta: LFO 1 le altezze, LFO 2 il colpo del filtro, LFO 3 gli accenti
      name: 'Sequenza acida',
      params: {
        aPos: 70, voiceMode: VOICE_MODE.mono, f1Type: FILTER.ladder, f1Cutoff: 280, f1Res: 75, f1Drive: 40, f1Key: 30, e1R: 0.05,
        l1Div: R['1/2'], ...drawn(1, steps([0, 0, 12, 0, 1, 0, 13, 7].map(st => st / 24))), l2Div: R['1/16'],
        ...drawn(2, [[0, 1, 70], [0.7, 0], [1, 0]]), l3Div: R['1/2'], ...drawn(3, steps([1, 0, 0.4, 0, 1, 0.3, 0, 0.6])),
        l4Shape: LFO_SHAPE.triangle, l4Div: R['4 battute'], l4Trig: LFO_TRIG.free, volume: -5,
        ...mods(
          [SRC.lfo1, 'tune', 50], [SRC.lfo2, 'f1Cutoff', 25], [SRC.lfo2, 'f1Cutoff', 25, { aux: SRC.lfo3 }],
          [SRC.lfo4, 'f1Cutoff', 20, { bi: true }], [SRC.macro1, 'f1Res', 20],
        ),
      },
    },
    {
      // il cutoff a scalini di sedicesimo, come un sequencer
      name: 'Filtro a passi',
      params: {
        aUnison: 4, aDetune: 15, aWidth: 90, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 45, e1A: 0.005, e1R: 0.3, l1Div: R['1/2'],
        ...drawn(1, steps([0.1, 0.6, 0.3, 0.9, 0.2, 0.7, 0.4, 1])), volume: -15,
        ...mods([SRC.lfo1, 'f1Cutoff', 50], [SRC.lfo1, 'f1Res', 10]),
      },
    },
    {
      name: 'Pulsazione in terzine',
      params: {
        aTable: T.Armoniche, aPos: 50, aUnison: 5, aDetune: 18, aWidth: 100, aLevel: 0, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 20,
        e1A: 0.01, e1R: 0.4, l1Div: R['1/8T'], ...drawn(1, [[0, 1, 50], [0.6, 0.1], [1, 0]]), l2Shape: LFO_SHAPE.triangle,
        l2Div: R['2 battute'], l2Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'aLevel', 90], [SRC.lfo1, 'f1Cutoff', 20], [SRC.lfo2, 'aPos', 30, { bi: true }]),
      },
    },
    {
      name: 'Salita',
      params: {
        aUnison: 7, aDetune: 30, aWidth: 100, nOn: 1, nType: 0, nLevel: 0, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 30, e1A: 0.01, e1R: 1,
        l1Div: R['8 battute'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0, -40], [1, 1]]), volume: -14,
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
      // solo rumore: in otto battute il passa-banda sale e si stringe
      name: 'Rumore che sale',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.white, nLevel: 90, f1Type: FILTER.bp12, f1Cutoff: 300, f1Res: 30, e1A: 0.01, e1R: 1.5,
        l1Div: R['8 battute'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0, -50], [1, 1]]), volume: -13,
        ...mods([SRC.lfo1, 'f1Cutoff', 55], [SRC.lfo1, 'f1Res', 40], [SRC.lfo1, 'volume', 15]),
      },
    },
    {
      name: 'Rumore che scende',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.white, nLevel: 90, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 25, e1A: 0.001, e1D: 3, e1S: 0, e1R: 1,
        e1Dc: 30, l1Div: R['2 battute'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 1, 40], [1, 0]]), volume: -11,
        ...mods([SRC.lfo1, 'f1Cutoff', 60]),
      },
    },
    {
      name: 'Vento',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.pink, nLevel: 90, f1Type: FILTER.bp12, f1Cutoff: 800, f1Res: 45, f2On: 1, f2Type: FILTER.lp12,
        f2Cutoff: 4000, e1A: 1.5, e1D: 1, e1S: 100, e1R: 3, l1Shape: LFO_SHAPE.smoothRandom, l1Sync: LFO_SYNC.hz, l1Rate: 0.3,
        l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Sync: LFO_SYNC.hz, l2Rate: 0.7, l2Trig: LFO_TRIG.free, volume: -4,
        ...mods([SRC.lfo1, 'f1Cutoff', 25, { bi: true }], [SRC.lfo2, 'f1Res', 25, { bi: true }], [SRC.lfo2, 'nPan', 50, { bi: true }]),
      },
    },
    {
      // due toni a una quarta, alternati
      name: 'Sirena bitonale',
      params: {
        aPos: 50, aRand: 0, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp12, f1Cutoff: 3500, e1A: 0.01, e1R: 0.3, l1Sync: LFO_SYNC.hz,
        l1Rate: 0.8, ...drawn(1, [[0, 0], [0.5, 0], [0.5, 1], [1, 1]]), volume: -12, ...mods([SRC.lfo1, 'tune', 10]),
      },
    },
    {
      // la sirena dub: il pitch che ricade a dente di sega, sempre più in fretta tenendo la nota
      name: 'Sirena dub',
      params: {
        aPos: 90, aRand: 0, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 3000, f1Res: 20, e1A: 0.005, e1R: 0.4, e3A: 3,
        e3S: 100, l1Shape: LFO_SHAPE.sawDown, l1Sync: LFO_SYNC.hz, l1Rate: 2, volume: -13,
        ...mods([SRC.lfo1, 'tune', 15], [SRC.env3, 'l1Rate', 20], [SRC.lfo1, 'f1Cutoff', 10]),
      },
    },
    {
      // un colpo di laser a ogni sedicesimo, finché si tiene la nota
      name: 'Raffica laser',
      params: {
        aTable: T.Sync, aPos: 30, aRand: 0, aWarp: WARP.sync, aWarpAmt: 20, aLevel: 0, f1Type: FILTER.lp12, f1Cutoff: 9000, e1A: 0.001,
        e1R: 0.15, l1Div: R['1/16'], ...drawn(1, [[0, 1, 60], [0.95, 0], [1, 0]]), volume: -2,
        ...mods([SRC.lfo1, 'tune', 40], [SRC.lfo1, 'aWarpAmt', 40], [SRC.lfo1, 'aLevel', 90]),
      },
    },
    {
      // il colpo che chiude una salita: un seno che crolla di un'ottava e una frustata di rumore
      name: 'Impatto',
      params: {
        aPos: 0, aRand: 0, nOn: 1, nType: NOISE.white, nLevel: 0, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 8000,
        e1A: 0.001, e1D: 2.5, e1S: 0, e1R: 1.5, e1Dc: 40, e2A: 0.001, e2D: 1.2, e2Dc: 50, e3A: 0.001, e3D: 0.4, e3Dc: 70, volume: -7,
        ...mods([SRC.env2, 'tune', 25], [SRC.env3, 'nLevel', 70], [SRC.env3, 'f1Cutoff', 10]),
      },
    },
    {
      name: 'Goccia',
      params: {
        aPos: 0, aRand: 0, tune: 12, f1On: 0, e1A: 0.001, e1D: 0.25, e1S: 0, e1R: 0.2, e1Dc: 70, e2A: 0.001, e2D: 0.12, e2Dc: 30, volume: -9,
        ...mods([SRC.env2, 'tune', -25], [SRC.random, 'tune', 4, { bi: true }]),
      },
    },
    {
      name: 'Radio rotta',
      params: {
        aTable: T.Digitale, aPos: 70, nOn: 1, nType: NOISE.crackle, nLevel: 30, f1Type: FILTER.bp24, f1Cutoff: 1500, f1Res: 40, f1Drive: 40,
        e1A: 0.01, e1R: 0.3, l1Shape: LFO_SHAPE.sampleHold, l1Div: R['1/16'], l2Shape: LFO_SHAPE.sampleHold, l2Div: R['1/8T'],
        l2Trig: LFO_TRIG.free, l3Shape: LFO_SHAPE.square, l3Div: R['1/32'], volume: -2,
        ...mods(
          [SRC.lfo1, 'f1Cutoff', 30, { bi: true }], [SRC.lfo2, 'aPos', 30, { bi: true }], [SRC.lfo3, 'aLevel', -50, { aux: SRC.lfo2 }],
          [SRC.lfo1, 'tune', 2, { bi: true }],
        ),
      },
    },
    {
      // pale che girano: il rumore e il sub tagliati da un LFO veloce che accelera
      name: 'Elicottero',
      params: {
        aOn: 0, nOn: 1, nType: NOISE.brown, nLevel: 10, subOn: 1, subLevel: 20, f1Type: FILTER.lp24, f1Cutoff: 600, f1Res: 20, e1A: 0.5,
        e1R: 1.5, e3A: 4, e3S: 100, l1Sync: LFO_SYNC.hz, l1Rate: 9, ...drawn(1, [[0, 1, 60], [0.5, 0], [1, 0]]), volume: -9,
        ...mods([SRC.lfo1, 'nLevel', 80], [SRC.lfo1, 'subLevel', 50], [SRC.env3, 'l1Rate', 15]),
      },
    },
    {
      // un ringhio basso nel rumore marrone, con il pettine che scivola lento: il capannone di notte
      name: 'Drone industriale',
      params: {
        aTable: T.Growl, aPos: 40, aUnison: 4, aDetune: 15, aWidth: 100, nOn: 1, nType: NOISE.brown, nLevel: 30, subOn: 1, subLevel: 40,
        f1Type: FILTER.combDown, f1Cutoff: 200, f1Res: 60, f1Mix: 70, f1Drive: 40, f2On: 1, f2Type: FILTER.lp24, f2Cutoff: 1800, e1A: 2,
        e1D: 1, e1S: 100, e1R: 4, l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['8 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle,
        l2Div: R['4 battute'], l2Trig: LFO_TRIG.free, volume: -8,
        ...mods([SRC.lfo1, 'f1Cutoff', 25, { bi: true }], [SRC.lfo2, 'aPos', 35, { bi: true }], [SRC.lfo1, 'f2Cutoff', 15, { bi: true }]),
      },
    },
    {
      name: 'Tom elettronico',
      params: {
        aPos: 0, aRand: 0, nOn: 1, nType: NOISE.pink, nLevel: 0, f1On: 0, e1A: 0.001, e1D: 0.45, e1S: 0, e1R: 0.3, e1Dc: 60, e2A: 0.001,
        e2D: 0.18, e2Dc: 50, e3A: 0.001, e3D: 0.03, volume: -14,
        ...mods([SRC.env2, 'tune', 20], [SRC.env3, 'nLevel', 30], [SRC.velocity, 'volume', 12]),
      },
    },
    {
      // tono e rumore insieme, il rumore più lungo: un rullante da drum machine
      name: 'Rullante sintetico',
      params: {
        aPos: 15, aRand: 0, tune: 12, nOn: 1, nType: NOISE.white, nLevel: 0, f1Type: FILTER.hp12, f1Cutoff: 150, e1A: 0.001, e1D: 0.3,
        e1S: 0, e1R: 0.2, e2A: 0.001, e2D: 0.06, e3A: 0.001, e3D: 0.22, e3Dc: 70, volume: -17,
        ...mods([SRC.env2, 'tune', 8], [SRC.env2, 'aLevel', 25], [SRC.env3, 'nLevel', 80], [SRC.velocity, 'volume', 12]),
      },
    },
    // ---- movimento: inviluppi, LFO e matrice spinti
    {
      // Env 3 apre tutto in quattro secondi; quattro LFO liberi a velocità diverse, e il più lento
      // cambia la velocità del primo
      name: 'Pad che respira',
      params: {
        aTable: T.Armoniche, aPos: 30, aUnison: 6, aDetune: 12, aWidth: 100, bOn: 1, bTable: T.Formanti, bPos: 20, bUnison: 4, bDetune: 10,
        bLevel: 45, f1Type: FILTER.lp24, f1Cutoff: 900, f1Res: 25, e1A: 1.5, e1D: 3, e1S: 85, e1R: 3, e3A: 4, e3D: 6, e3S: 60, e3R: 4, e3Ac: -30,
        l1Shape: LFO_SHAPE.smoothRandom, l1Div: R['2 battute'], l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.triangle, l2Div: R['4 battute'],
        l2Trig: LFO_TRIG.free, l3Div: R['8 battute'], l3Trig: LFO_TRIG.free, l4Sync: LFO_SYNC.hz, l4Rate: 0.25, l4Trig: LFO_TRIG.free, volume: -12,
        ...mods(
          [SRC.env3, 'f1Cutoff', 35], [SRC.env3, 'f1Res', 15], [SRC.env3, 'aDetune', 20], [SRC.lfo1, 'aPos', 30, { bi: true }],
          [SRC.lfo2, 'bPos', 45, { bi: true }], [SRC.lfo3, 'f1Cutoff', 12, { bi: true }], [SRC.lfo3, 'l1Rate', 25, { bi: true }],
          [SRC.lfo4, 'aPan', 40, { bi: true }], [SRC.lfo4, 'bPan', -40, { bi: true }], [SRC.velocity, 'e3A', -20],
        ),
      },
    },
    {
      // tenendo la nota Env 3 fa correre il wobble da 1/4 verso 1/16
      name: 'Wobble che accelera',
      params: {
        aTable: T.Growl, aPos: 20, aWarp: WARP.bendBoth, aWarpAmt: 10, bOn: 1, bTable: T.Base, bPos: 67, bOct: -1, bLevel: 50, subOn: 1,
        subLevel: 60, voiceMode: VOICE_MODE.mono, glide: 30, f1Type: FILTER.lp24, f1Cutoff: 300, f1Res: 40, f1Drive: 40, e1R: 0.08,
        e3A: 3, e3S: 100, e3Ac: -30, l1Shape: LFO_SHAPE.sine, l1Div: R['1/4'], l2Shape: LFO_SHAPE.sampleHold, l2Div: R['1/16'], volume: -12,
        ...mods(
          [SRC.lfo1, 'f1Cutoff', 45], [SRC.lfo1, 'aPos', 50], [SRC.lfo1, 'aWarpAmt', 35], [SRC.env3, 'l1Rate', 18], [SRC.env3, 'f1Res', 20],
          [SRC.lfo2, 'bFine', 15, { bi: true }], [SRC.velocity, 'f1Cutoff', 10],
        ),
      },
    },
    {
      // LFO 1 a scalini è la sequenza delle altezze (in 1 battuta), LFO 2 è il pluck di ogni passo
      name: 'Arpeggio disegnato',
      params: {
        aTable: T.Armoniche, aPos: 45, aUnison: 3, aDetune: 10, aLevel: 25, f1Type: FILTER.lp24, f1Cutoff: 1400, f1Res: 30, e1A: 0.002, e1R: 0.3,
        l1Div: R['1 battuta'], ...drawn(1, steps([0, 12, 7, 19, 12, 24, 7, 12].map(st => st / 24))),
        l2Div: R['1/8'], ...drawn(2, [[0, 1, 60], [0.7, 0.1], [1, 0]]),
        l3Shape: LFO_SHAPE.triangle, l3Div: R['2 battute'], l3Trig: LFO_TRIG.free, volume: -11,
        ...mods(
          [SRC.lfo1, 'tune', 50], [SRC.lfo2, 'f1Cutoff', 40], [SRC.lfo2, 'aLevel', 70], [SRC.lfo3, 'aPos', 30, { bi: true }],
          [SRC.velocity, 'f1Cutoff', 15],
        ),
      },
    },
    {
      // quattro inviluppi per un colpo solo: filtro, blip di pitch, FM; velocity e nota cambiano i tempi
      name: 'Pluck elastico',
      params: {
        aTable: T.FM, aPos: 20, aWarp: WARP.fm, aWarpAmt: 0, bOn: 1, bTable: T.Base, bPos: 0, bOct: 1, bLevel: 0, f1Type: FILTER.lp24,
        f1Cutoff: 400, f1Res: 35, f1Key: 40, e1A: 0.001, e1D: 0.9, e1S: 0, e1R: 0.5, e1Dc: 50, e2A: 0.001, e2D: 0.18, e2Dc: 75,
        e3A: 0.001, e3D: 0.04, e3Dc: 80, e4A: 0.001, e4D: 0.45, e4Dc: 40, volume: -10,
        ...mods(
          [SRC.env2, 'f1Cutoff', 45], [SRC.env2, 'f1Cutoff', 20, { aux: SRC.velocity }], [SRC.env3, 'tune', 3], [SRC.env4, 'aWarpAmt', 45],
          [SRC.velocity, 'e1D', 15], [SRC.note, 'e2D', -25, { bi: true }], [SRC.random, 'aPan', 30, { bi: true }],
        ),
      },
    },
    {
      // il vibrato arriva tardi e accelera (Env 3 sulla velocità dell'LFO); Macro 1 lo allarga
      name: 'Lead espressivo',
      params: {
        aUnison: 3, aDetune: 12, bOn: 1, bTable: T.Base, bPos: 100, bFine: 7, bLevel: 45, voiceMode: VOICE_MODE.legato, glide: 60,
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
      // quattro LFO a tempo che non si incontrano mai: terzine, sedicesimi, quarti puntati, mezze
      name: 'Poliritmo',
      params: {
        aTable: T.Digitale, aPos: 30, aUnison: 4, aDetune: 18, aWidth: 90, aLevel: 20, bOn: 1, bTable: T.Pulsar, bPos: 40, bLevel: 50,
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
      // tutto a caso: un S&H lento cambia la velocità degli altri due
      name: 'Glitch S&H',
      params: {
        aTable: T.Pulsar, aPos: 50, aWarp: WARP.quantize, aWarpAmt: 20, bOn: 1, bTable: T.Digitale, bPos: 30, bLevel: 40,
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
      // un LFO "una volta" fa cadere il pitch di due ottave in 2 battute e rallenta il tremolio
      name: 'Caduta libera',
      params: {
        aTable: T.Sync, aPos: 40, aWarp: WARP.sync, aWarpAmt: 20, aUnison: 5, aDetune: 20, aWidth: 100, nOn: 1, nType: 1, nLevel: 20,
        f1Type: FILTER.lp24, f1Cutoff: 5000, f1Res: 30, e1A: 0.005, e1R: 1.5, l1Div: R['2 battute'], l1Trig: LFO_TRIG.once,
        ...drawn(1, [[0, 1, 50], [1, 0]]), l2Shape: LFO_SHAPE.sine, l2Sync: LFO_SYNC.hz, l2Rate: 3, volume: -13,
        ...mods(
          [SRC.lfo1, 'tune', 50], [SRC.lfo1, 'f1Cutoff', 40], [SRC.lfo1, 'aWarpAmt', 50], [SRC.lfo1, 'l2Rate', 30],
          [SRC.lfo2, 'aPos', 30, { bi: true }], [SRC.lfo1, 'nLevel', 40],
        ),
      },
    },
    {
      // Env 2 il filtro, Env 3 il morso dell'FM dal sub, Env 4 il colpo di pitch
      name: 'Basso a quattro inviluppi',
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
      // Macro 1 trasforma il suono, Macro 2 dà profondità all'LFO, Macro 3 la sua velocità,
      // Macro 4 accende il S&H
      name: 'Metamorfosi a macro',
      params: {
        aTable: T.Formanti, aPos: 0, aUnison: 5, aDetune: 14, bOn: 1, bTable: T.Metallo, bPos: 0, bLevel: 50, f1Type: FILTER.lp24,
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
      // un LFO "una volta" disegnato come inviluppo a più tappe: sale, ricade, torna su
      name: 'Inviluppo disegnato',
      params: {
        aTable: T.Ottave, aPos: 40, aUnison: 3, aDetune: 10, f1Type: FILTER.lp24, f1Cutoff: 500, f1Res: 30, e1A: 0.002, e1D: 2, e1S: 30,
        e1R: 0.6, l1Div: R['1/2'], l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0, 60], [0.05, 1, -30], [0.3, 0.35], [0.5, 0.8, 40], [1, 0.2]]),
        l2Shape: LFO_SHAPE.sine, l2Sync: LFO_SYNC.hz, l2Rate: 0.5, volume: -9,
        ...mods([SRC.lfo1, 'f1Cutoff', 50], [SRC.lfo1, 'aPos', 40], [SRC.lfo2, 'aPos', 15, { bi: true }], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // le due tabelle si scambiano (A sale mentre B scende), ognuna nel suo filtro in parallelo
      name: 'Incrocio',
      params: {
        aTable: T.Spettrale, aPos: 0, aUnison: 4, aDetune: 12, bOn: 1, bTable: T.Formanti, bPos: 100, bUnison: 4, bDetune: 12, bLevel: 75,
        fMode: FILTER_MODE.parallel, bRoute: ROUTE.f2, f1Type: FILTER.lp24, f1Cutoff: 2500, f1Res: 20, f2On: 1, f2Type: FILTER.bp12,
        f2Cutoff: 1200, f2Res: 30, e1A: 0.3, e1D: 1, e1S: 85, e1R: 1.5, l1Shape: LFO_SHAPE.sine, l1Div: R['2 battute'], l1Trig: LFO_TRIG.free,
        volume: -14,
        ...mods([SRC.lfo1, 'aPos', 100], [SRC.lfo1, 'bPos', -100], [SRC.lfo1, 'f2Cutoff', 30], [SRC.lfo1, 'f1Cutoff', -20]),
      },
    },
    // ---- altri
    {
      // la sirena: l'LFO lento sul pitch, il filtro che lo segue
      name: 'Sirena',
      params: {
        aTable: T.Base, aPos: 67, aUnison: 3, aDetune: 12, voiceMode: VOICE_MODE.mono, f1Type: FILTER.lp24, f1Cutoff: 4000, f1Res: 25, e1R: 0.3,
        l1Shape: LFO_SHAPE.triangle, l1Sync: LFO_SYNC.hz, l1Rate: 0.4, l1Trig: LFO_TRIG.free, volume: -10,
        ...mods([SRC.lfo1, 'tune', 30, { bi: true }], [SRC.lfo1, 'f1Cutoff', 15, { bi: true }]),
      },
    },
    {
      name: 'Stab rave',
      params: {
        aTable: T.Base, aPos: 67, aUnison: 7, aDetune: 30, aWidth: 100, bOn: 1, bTable: T.PWM, bPos: 40, bOct: -1, bLevel: 50,
        f1Type: FILTER.lp24, f1Cutoff: 900, f1Res: 25, e1D: 0.35, e1S: 0, e1R: 0.25, e2D: 0.25, volume: -14,
        ...mods([SRC.env2, 'f1Cutoff', 55], [SRC.velocity, 'f1Cutoff', 15]),
      },
    },
    {
      // le vocali del filtro formante che girano in quattro battute
      name: 'Pad di vocali',
      params: {
        aTable: T.Base, aPos: 67, aUnison: 5, aDetune: 18, bOn: 1, bTable: T.Vocale, bPos: 40, bLevel: 60, f1Type: FILTER.formant,
        f1Cutoff: 1200, f1Res: 40, f1Var: 30, e1A: 1, e1D: 1, e1S: 90, e1R: 2, l1Shape: LFO_SHAPE.triangle, l1Div: R['4 battute'],
        l1Trig: LFO_TRIG.free, l2Shape: LFO_SHAPE.smoothRandom, l2Div: R['1 battuta'], l2Trig: LFO_TRIG.free, volume: -8,
        ...mods([SRC.lfo1, 'f1Var', 60, { bi: true }], [SRC.lfo2, 'bPos', 30, { bi: true }]),
      },
    },
    {
      name: 'Basso comb',
      params: {
        aTable: T.Base, aPos: 67, subOn: 1, subLevel: 70, voiceMode: VOICE_MODE.mono, glide: 20, f1Type: FILTER.combUp, f1Cutoff: 400, f1Res: 70,
        f1Key: 100, f1Mix: 70, e1R: 0.06, e2D: 0.3, volume: -11,
        ...mods([SRC.env2, 'f1Cutoff', 40], [SRC.env2, 'f1Res', -30]),
      },
    },
    {
      name: 'Arpa metallica',
      params: {
        aTable: T.Metallo, aPos: 30, bOn: 1, bTable: T['Seno caldo'], bOct: 1, bLevel: 40, f1Type: FILTER.lp12, f1Cutoff: 6000,
        e1D: 1.2, e1S: 0, e1R: 1, e2D: 0.4, volume: -10,
        ...mods([SRC.env2, 'aPos', 50], [SRC.velocity, 'f1Cutoff', 25]),
      },
    },
    {
      // l'accordo della dub techno: corto, scuro, con il filtro che si apre a battute
      name: 'Accordo dub',
      params: {
        aTable: T.Base, aPos: 67, aUnison: 3, aDetune: 10, bOn: 1, bTable: T.PWM, bPos: 50, bLevel: 50, f1Type: FILTER.lp24, f1Cutoff: 600,
        f1Res: 40, f1Key: 50, e1D: 0.3, e1S: 0, e1R: 0.35, e2D: 0.2, l1Shape: LFO_SHAPE.sine, l1Div: R['4 battute'], l1Trig: LFO_TRIG.free,
        volume: -11, ...mods([SRC.env2, 'f1Cutoff', 35], [SRC.lfo1, 'f1Cutoff', 20, { bi: true }]),
      },
    },
  ];
}

/** Un LFO a scalini: un valore per passo, tutti lunghi uguali. */
function steps(values: readonly number[]): [number, number][] {
  const n = values.length;
  return values.flatMap((y, k): [number, number][] => [[k / n, y], [(k + 1) / n, y]]);
}
