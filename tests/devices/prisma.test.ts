import { describe, expect, it } from 'vitest';
import { paramsOf, paramSpec, resolveParams } from '../../src/devices/device-type';
import { midiToHz } from '../../src/devices/dsp/core';
import { clampParam } from '../../src/devices/params';
import { TABLE_SIZE, TABLE_NAMES, cyclesOf } from '../../src/devices/instruments/wavetable/tables';
import {
  DESTINATIONS, destinationOf, FILTER, FILTER_MODE, FILTER_TYPES, LFO_TRIG, PRISMA, ROUTE, SRC, USER_TABLE, VOICE_MODE, WARP, WARPS,
} from '../../src/devices/instruments/prisma/prisma';
import { PrismaCore } from '../../src/devices/instruments/prisma/prisma-core';
import { drawn, mods } from '../../src/devices/instruments/prisma/prisma-presets';
import { bend, drawnValue, LFO_SHAPE, pointsOf, pointValues } from '../../src/devices/instruments/prisma/shapes';
import { CurvedEnv } from '../../src/devices/instruments/prisma/curved-env';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128;
const TABLE = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, i])) as Record<string, number>;

function run(core: PrismaCore, queue: NoteQueue, frames: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let f = 0; f < frames; f += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    queue.renderBlock(core, l, r, f);
    left.set(l.subarray(0, Math.min(BLOCK, frames - f)), f);
    right.set(r.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return { left, right };
}

const synth = (params: Record<string, number> = {}, bpm = 120) => {
  const core = new PrismaCore(SR);
  core.setTempo(bpm);
  core.setParams(resolveParams(PRISMA, params));
  return { core, queue: new NoteQueue() };
};

/** Una nota per `seconds` (tenuta per tutto il tempo, se non si dice altro). */
const play = (params: Record<string, number>, pitch = 57, seconds = 0.5, hold = seconds, velocity = 100) => {
  const { core, queue } = synth(params);
  queue.add(pitch, velocity, 0, Math.round(hold * SR));
  return run(core, queue, Math.round(seconds * SR));
};

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** L'ampiezza della componente a `hz` (DFT su una finestra di Hann). */
function amplitudeAt(x: ArrayLike<number>, hz: number, from: number, length: number): number {
  let re = 0, im = 0, w = 0;
  for (let i = 0; i < length; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length), ph = (2 * Math.PI * hz * i) / SR;
    re += x[from + i] * win * Math.cos(ph);
    im += x[from + i] * win * Math.sin(ph);
    w += win;
  }
  return (2 * Math.hypot(re, im)) / w;
}

/** L'oscillatore A da solo: niente filtro, fase fissa, volume pieno. */
const BARE = { aPos: 0, aLevel: 100, aRand: 0, f1On: 0, volume: 0, e1A: 0.001, e1S: 100, e1R: 0.01 };

describe('Prisma: parametri', () => {
  it('ogni parametro ha un id solo e un predefinito valido', () => {
    const ids = paramsOf(PRISMA).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(resolveParams(PRISMA, {}))).toHaveLength(ids.length);
  });

  it('i preset usano solo parametri esistenti, nei loro limiti', () => {
    expect(PRISMA.presets.length).toBeGreaterThan(1);
    for (const preset of PRISMA.presets) {
      for (const [id, v] of Object.entries(preset.params)) {
        const spec = paramSpec(PRISMA, id);
        expect(spec, `${preset.name}.${id}`).toBeDefined();
        expect(clampParam(spec!, v), `${preset.name}.${id}`).toBeCloseTo(v, 9);
      }
    }
  });

  it('le destinazioni sono manopole visibili, e nascosti restano solo punti e campi della matrice', () => {
    for (const d of DESTINATIONS) {
      const spec = paramSpec(PRISMA, d.param);
      expect(spec?.kind, d.param).toBe('number');
      expect(spec?.hidden, d.param).toBeFalsy();
    }
    const hidden = paramsOf(PRISMA).filter(p => p.hidden).map(p => p.id);
    for (const id of hidden) expect(id, id).toMatch(/^(l\d(Pts|[XYC]\d+)|m\d+(Src|Dst|Pol|Curve|Aux))$/);
  });

  it('le righe della matrice si scrivono per nome della destinazione', () => {
    expect(mods([SRC.lfo1, 'f1Cutoff', 40, { bi: true }])).toEqual({ m1Src: SRC.lfo1, m1Dst: destinationOf('f1Cutoff'), m1Amt: 40, m1Pol: 1 });
    expect(() => mods([SRC.lfo1, 'aTable', 40])).toThrow();
  });
});

describe('Prisma: curve e forme', () => {
  it('una curva va sempre da 0 a 1; positiva corre all\'inizio', () => {
    for (const c of [-100, -30, 0, 30, 100]) {
      expect(bend(0, c)).toBeCloseTo(0, 9);
      expect(bend(1, c)).toBeCloseTo(1, 9);
    }
    expect(bend(0.2, 60)).toBeGreaterThan(0.2);
    expect(bend(0.2, -60)).toBeLessThan(0.2);
  });

  it('i punti di un LFO restano in ordine, con il primo all\'inizio e l\'ultimo alla fine', () => {
    const values = pointValues(1, [{ x: 0.3, y: 1, curve: 0 }, { x: 0.8, y: 0.2, curve: 0 }, { x: 0.4, y: 0.5, curve: 0 }, { x: 0.1, y: 0, curve: 0 }]);
    const p = pointsOf(values, 1);
    expect(p.map(q => q.x)).toEqual([0, 0.4, 0.8, 1]);
    expect(drawnValue(p, 0.2)).toBeCloseTo(0.75, 6); // a metà fra (0, 1) e (0.4, 0.5)
    // due punti alla stessa x: uno scalino
    const step = pointsOf(pointValues(1, [{ x: 0, y: 1, curve: 0 }, { x: 0.5, y: 1, curve: 0 }, { x: 0.5, y: 0, curve: 0 }, { x: 1, y: 0, curve: 0 }]), 1);
    expect(drawnValue(step, 0.49)).toBe(1);
    expect(drawnValue(step, 0.51)).toBe(0);
  });

  it('l\'inviluppo fa attacco, hold, decay, sustain e rilascio nei suoi tempi', () => {
    const rate = 1000, env = new CurvedEnv(rate);
    env.set({ attack: 0.1, hold: 0.05, decay: 0.2, sustain: 0.5, release: 0.1, attackCurve: 0, decayCurve: 0, releaseCurve: 0 });
    env.trigger();
    const values = Array.from({ length: 500 }, () => env.next());
    expect(values[49]).toBeCloseTo(0.5, 1); // metà attacco, lineare
    expect(values[120]).toBe(1); // hold
    expect(values[250]).toBeCloseTo(0.75, 1); // metà decay, lineare
    expect(values[400]).toBe(0.5);
    env.release();
    for (let i = 0; i < 50; i++) env.next();
    expect(env.value).toBeCloseTo(0.25, 1);
    for (let i = 0; i < 60; i++) env.next();
    expect(env.active).toBe(false);
  });
});

describe('Prisma: suono', () => {
  it('suona la nota giusta, con il timbro della posizione', () => {
    const f = midiToHz(57);
    const sine = play({ ...BARE, aTable: TABLE.Base, aPos: 0 }).left;
    expect(amplitudeAt(sine, f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(sine, 2 * f, 4800, 9600)).toBeLessThan(0.01);
    const saw = play({ ...BARE, aTable: TABLE.Base, aPos: 67 }).left;
    expect(amplitudeAt(saw, 2 * f, 4800, 9600) / amplitudeAt(saw, f, 4800, 9600)).toBeCloseTo(0.5, 1);
  });

  it('ottava, semitoni e Pitch globale spostano la nota', () => {
    const f = midiToHz(57);
    const up = play({ ...BARE, aOct: 1, aSemi: 7, tune: -2 }).left;
    expect(amplitudeAt(up, f * Math.pow(2, 17 / 12), 4800, 9600)).toBeGreaterThan(0.9);
  });

  /** Il più forte degli alias udibili (le armoniche oltre Nyquist ripiegate sotto i 15 kHz),
   *  rispetto all'armonica più forte. */
  const worstAlias = (x: Float32Array, f: number) => {
    let loudest = 0, worst = 0;
    for (let k = 1; k * f < SR / 2; k++) loudest = Math.max(loudest, amplitudeAt(x, k * f, 4800, 16384));
    for (let k = Math.ceil(SR / 2 / f); k <= 200; k++) {
      const folded = Math.abs(SR - k * f) % SR, alias = Math.min(folded, SR - folded), r = (alias / f) % 1;
      // quelli che cadono su un'armonica vera non si distinguono
      if (alias < 15000 && Math.min(r, 1 - r) * f > 60) worst = Math.max(worst, amplitudeAt(x, alias, 4800, 16384));
    }
    return worst / loudest;
  };

  it('le note acute non fanno aliasing', () => {
    const pitch = 96;
    const { left } = play({ ...BARE, aTable: TABLE.Sync, aPos: 47 }, pitch);
    expect(worstAlias(left, midiToHz(pitch))).toBeLessThan(0.003);
  });

  it('il warp sync legge una versione più povera della tabella e arrotonda la ripartenza', () => {
    for (const amount of [23, 41]) {
      const pitch = 84;
      const { left } = play({ ...BARE, aPos: 67, aWarp: WARP.sync, aWarpAmt: amount }, pitch);
      expect(worstAlias(left, midiToHz(pitch)), `sync ${amount}`).toBeLessThan(0.012);
    }
  });

  it('tutti i warp e tutti i filtri suonano senza esplodere', () => {
    for (let warp = 0; warp < WARPS.length; warp++) {
      for (const amount of [0, 50, 100]) {
        const { left } = play({ ...BARE, aTable: TABLE.Base, aPos: 67, aWarp: warp, aWarpAmt: amount, bOn: 1, bLevel: 0, subOn: 1, subLevel: 0 }, 57, 0.15);
        expect(left.every(Number.isFinite), `${WARPS[warp]} ${amount}`).toBe(true);
        expect(peak(left), `${WARPS[warp]} ${amount}`).toBeLessThan(4);
        expect(rms(left), `${WARPS[warp]} ${amount}`).toBeGreaterThan(0.01);
      }
    }
    for (let type = 0; type < FILTER_TYPES.length; type++) {
      for (const [cutoff, res] of [[200, 0], [1500, 70], [8000, 100]]) {
        const { left } = play({ ...BARE, aPos: 67, f1On: 1, f1Type: type, f1Cutoff: cutoff, f1Res: res, f1Drive: 40 }, 45, 0.2);
        expect(left.every(Number.isFinite), `${FILTER_TYPES[type]} ${cutoff} ${res}`).toBe(true);
        expect(peak(left), `${FILTER_TYPES[type]} ${cutoff} ${res}`).toBeLessThan(5);
      }
    }
  });

  it('il warp FM prende l\'altro oscillatore solo se è acceso', () => {
    const f = midiToHz(57);
    const base = { ...BARE, aWarp: WARP.fm, aWarpAmt: 60, bLevel: 0, bSemi: 12 };
    const off = play({ ...base, bOn: 0 }).left, on = play({ ...base, bOn: 1 }).left;
    expect(amplitudeAt(off, 3 * f, 4800, 9600)).toBeLessThan(0.01);
    expect(amplitudeAt(on, 3 * f, 4800, 9600)).toBeGreaterThan(0.05);
  });

  it('il passa-basso toglie le alte; "Diretto" lo salta', () => {
    const f = midiToHz(45);
    const lp = { ...BARE, aPos: 67, f1On: 1, f1Type: FILTER.lp24, f1Cutoff: 300 };
    const filtered = play(lp, 45).left, direct = play({ ...lp, aRoute: ROUTE.direct }, 45).left;
    expect(amplitudeAt(filtered, 10 * f, 4800, 9600)).toBeLessThan(0.002);
    expect(amplitudeAt(direct, 10 * f, 4800, 9600)).toBeGreaterThan(0.03);
  });

  it('in serie passa-basso e passa-alto fanno un passa-banda; in parallelo si sommano', () => {
    const f = midiToHz(45);
    const both = { ...BARE, aPos: 67, f1On: 1, f1Type: FILTER.lp24, f1Cutoff: 400, f2On: 1, f2Type: FILTER.hp24, f2Cutoff: 4000, aRoute: ROUTE.both };
    const serial = play({ ...both, fMode: FILTER_MODE.serial }, 45).left;
    const parallel = play({ ...both, fMode: FILTER_MODE.parallel }, 45).left;
    // in serie quasi niente passa (il passa-banda è vuoto), in parallelo le basse e le alte
    expect(rms(serial, 4800)).toBeLessThan(rms(parallel, 4800) * 0.2);
    expect(amplitudeAt(parallel, f, 4800, 9600)).toBeGreaterThan(0.3);
    expect(amplitudeAt(parallel, 50 * f, 4800, 9600)).toBeGreaterThan(0.002);
  });

  it('l\'unison si allarga in stereo con la Larghezza', () => {
    const wide = play({ ...BARE, aPos: 67, aUnison: 7, aDetune: 30, aWidth: 100, aRand: 100 });
    const mono = play({ ...BARE, aPos: 67, aUnison: 7, aDetune: 30, aWidth: 0, aRand: 100 });
    const diff = (x: { left: Float32Array; right: Float32Array }) => rms(x.left.map((v, i) => v - x.right[i]), 4800);
    expect(diff(wide)).toBeGreaterThan(0.1);
    expect(diff(mono)).toBeLessThan(1e-6);
    // il livello resta quello di una copia sola, più o meno
    expect(rms(wide.left, 4800)).toBeGreaterThan(0.25);
    expect(rms(wide.left, 4800)).toBeLessThan(0.9);
  });

  it('il sub e il rumore suonano, ognuno con il suo carattere', () => {
    const f = midiToHz(57);
    const sub = play({ ...BARE, aOn: 0, subOn: 1, subLevel: 100, subOct: -1 }).left;
    expect(amplitudeAt(sub, f / 2, 4800, 9600)).toBeGreaterThan(0.9);
    for (let type = 0; type < 5; type++) {
      const noise = play({ ...BARE, aOn: 0, nOn: 1, nType: type, nLevel: 100 }).left;
      expect(noise.every(Number.isFinite)).toBe(true);
      expect(rms(noise, 4800), `rumore ${type}`).toBeGreaterThan(0.01);
    }
  });
});

describe('Prisma: modulazioni', () => {
  it('un LFO sul cutoff apre e chiude il filtro', () => {
    const f = midiToHz(45);
    const { left } = play({
      ...BARE, aPos: 67, f1On: 1, f1Type: FILTER.lp24, f1Cutoff: 600, l1Sync: 1, l1Rate: 2, l1Shape: LFO_SHAPE.square,
      ...mods([SRC.lfo1, 'f1Cutoff', 40]),
    }, 45, 1);
    // quadra unipolare a 2 Hz: aperto nel primo quarto di secondo (600 Hz + 4 ottave), chiuso nel secondo
    const open = amplitudeAt(left, 16 * f, 1200, 9600), closed = amplitudeAt(left, 16 * f, 13200, 9600);
    expect(open).toBeGreaterThan(closed * 10);
  });

  it('un inviluppo sul pitch fa la picchiata dell\'808', () => {
    const f = midiToHz(45);
    const { left } = play({ ...BARE, aTable: TABLE.Base, aPos: 0, e2D: 0.05, e2Dc: 0, ...mods([SRC.env2, 'tune', 50]) }, 45, 0.5);
    // all'inizio due ottave sopra (50 % della corsa ±24 st), poi la nota
    expect(amplitudeAt(left, 4 * f, 0, 512)).toBeGreaterThan(amplitudeAt(left, f, 0, 512));
    expect(amplitudeAt(left, f, 9600, 9600)).toBeGreaterThan(0.9);
  });

  it('un inviluppo lento sale nel suo tempo anche alla prima nota di una voce', () => {
    const { left } = play({ ...BARE, aLevel: 0, e2A: 0.5, e2S: 100, ...mods([SRC.env2, 'aLevel', 100]) }, 57, 0.6);
    expect(rms(left, 0, 960)).toBeLessThan(0.1 * rms(left, 24000, 28800));
  });

  it('la velocity sul volume rende più forti le note forti; l\'aux scala la modulazione', () => {
    const p = { ...BARE, volume: -20, ...mods([SRC.velocity, 'volume', 40]) };
    const soft = rms(play(p, 57, 0.3, 0.3, 20).left, 4800), loud = rms(play(p, 57, 0.3, 0.3, 127).left, 4800);
    expect(loud / soft).toBeGreaterThan(3);
    // con l'aux sulla macro 1 a zero la velocity non fa più nulla
    const gated = { ...BARE, volume: -20, ...mods([SRC.velocity, 'volume', 40, { aux: SRC.macro1 }]) };
    expect(rms(play(gated, 57, 0.3, 0.3, 127).left, 4800)).toBeCloseTo(rms(play(gated, 57, 0.3, 0.3, 20).left, 4800), 4);
  });

  it('bipolare sposta attorno alla manopola, unipolare solo da una parte', () => {
    const f = midiToHz(57);
    // una macro a metà: in bipolare vale 0, in unipolare metà della quantità
    const bi = play({ ...BARE, macro1: 50, ...mods([SRC.macro1, 'aSemi', 50, { bi: true }]) }).left;
    const uni = play({ ...BARE, macro1: 50, ...mods([SRC.macro1, 'aSemi', 50]) }).left;
    expect(amplitudeAt(bi, f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(uni, f * Math.pow(2, 6 / 12), 4800, 9600)).toBeGreaterThan(0.9); // 25 % di 24 st
  });

  it('un LFO disegnato "Una volta" fa da inviluppo e resta sull\'ultimo valore', () => {
    const f = midiToHz(57);
    const { left } = play({
      ...BARE, l1Sync: 1, l1Rate: 4, l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0], [0.5, 1], [1, 0.5]]),
      ...mods([SRC.lfo1, 'aSemi', 50]),
    }, 57, 1);
    // dopo un giro (0.25 s) resta a 0.5: metà del 50 % della corsa (24 st), 6 st sopra
    expect(amplitudeAt(left, f * Math.pow(2, 6 / 12), 24000, 9600)).toBeGreaterThan(0.9);
  });

  it('il ritardo tiene fermo l\'LFO, poi la salita lo apre', () => {
    const f = midiToHz(57);
    const { left } = play({ ...BARE, l1Sync: 1, l1Rate: 0.02, l1Delay: 0.3, l1Shape: LFO_SHAPE.sawDown, ...mods([SRC.lfo1, 'aSemi', 50]) }, 57, 0.6);
    expect(amplitudeAt(left, f, 2400, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(left, f * 2, 18000, 9600)).toBeGreaterThan(0.8);
  });

  it('in Legato le note scivolano con il glide', () => {
    const { core, queue } = synth({ ...BARE, voiceMode: VOICE_MODE.legato, glide: 200 });
    queue.add(57, 100, 0, SR);
    queue.add(69, 100, SR / 4, SR);
    const { left } = run(core, queue, SR);
    const f = midiToHz(57);
    expect(amplitudeAt(left, f, 2400, 8192)).toBeGreaterThan(0.9);
    expect(amplitudeAt(left, 2 * f, SR - 9600, 9600)).toBeGreaterThan(0.9);
    expect(core.activeVoices).toBe(1);
  });
});

describe('Prisma: preset', () => {
  it('ogni preset suona un accordo, pulito e a un livello sensato', () => {
    for (const preset of PRISMA.presets) {
      const { core, queue } = synth(preset.params);
      for (const p of [48, 55, 60, 64]) queue.add(p, 100, 0, SR);
      const { left, right } = run(core, queue, Math.round(1.5 * SR));
      expect(left.every(Number.isFinite) && right.every(Number.isFinite), preset.name).toBe(true);
      const level = Math.max(rms(left, 0, SR), rms(right, 0, SR));
      expect(level, preset.name).toBeGreaterThan(0.01);
      expect(Math.max(peak(left), peak(right)), preset.name).toBeLessThan(1.6);
    }
  });
});

describe('Prisma: tabelle importate', () => {
  it('un file wavetable diventa una forma per periodo', () => {
    const frames = 4, data = new Float32Array(frames * TABLE_SIZE);
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < TABLE_SIZE; i++) data[f * TABLE_SIZE + i] = Math.sin((2 * Math.PI * (f + 1) * i) / TABLE_SIZE);
    }
    expect(cyclesOf([data])).toHaveLength(frames);
    expect(cyclesOf([new Float32Array(600)])).toHaveLength(1);
    expect(cyclesOf([new Float32Array(48000)]).length).toBeGreaterThan(1);

    const play = (pos: number) => {
      const { core, queue } = synth({ ...BARE, aTable: USER_TABLE, aPos: pos });
      core.setSample('wtA', { sampleRate: SR, channels: [data] });
      queue.add(45, 100, 0, SR);
      return run(core, queue, SR / 2).left;
    };
    const f = midiToHz(45);
    // all'inizio la prima forma (la fondamentale), alla fine la quarta (quarta armonica)
    expect(amplitudeAt(play(0), f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(play(100), 4 * f, 4800, 9600)).toBeGreaterThan(0.9);
  });

  it('senza file la tabella importata suona la prima tabella', () => {
    const { left } = play({ ...BARE, aTable: USER_TABLE });
    expect(amplitudeAt(left, midiToHz(57), 4800, 9600)).toBeGreaterThan(0.9);
  });
});
