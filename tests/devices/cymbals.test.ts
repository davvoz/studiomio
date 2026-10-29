import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { CYMBALS, PIECES, pieceParam, pieceSlot, SOURCE } from '../../src/devices/instruments/cymbals/cymbals';
import { CymbalsCore } from '../../src/devices/instruments/cymbals/cymbals-core';
import { instrumentType } from '../../src/devices/registry';
import { INSTRUMENT_CORES } from '../../src/devices/worklet/cores';

const SR = 48000;
const at = (s: number) => Math.round(s * SR);
const [CLOSED, PEDAL, OPEN, CRASH, RIDE, BELL] = [0, 1, 2, 3, 4, 5];

/** Lo strumento con questi parametri (niente velocity né variazione, volume a 0 dB). */
function make(params: Record<string, number> = {}) {
  const core = new CymbalsCore(SR);
  core.setParams(resolveParams(CYMBALS, { velocity: 0, variation: 0, volume: 0, ...params }));
  return core;
}

/** Suona `notes` ([nota, secondi]) e restituisce `seconds` di suono. */
function play(core: CymbalsCore, notes: readonly (readonly [number, number])[], seconds: number) {
  const n = at(seconds), left = new Float32Array(n), right = new Float32Array(n);
  const events = [...notes].sort((a, b) => a[1] - b[1]);
  let f = 0;
  for (const [pitch, time] of [...events, [-1, seconds] as const]) {
    const until = Math.min(n, at(time));
    for (; f < until; f += Math.min(128, until - f)) core.render(left, right, f, Math.min(until, f + 128));
    if (pitch >= 0) core.noteOn(1, pitch, 127);
  }
  return { left, right };
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (x: Float32Array) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};
const note = (i: number) => PIECES[i].note;

describe('Hat e Piatti: descrizione', () => {
  it('sei pezzi sulle note General MIDI, con i loro nomi; ha il suo motore', () => {
    expect(instrumentType('cymbals')).toBe(CYMBALS);
    expect(INSTRUMENT_CORES.cymbals(SR)).toBeInstanceOf(CymbalsCore);
    expect(PIECES.map(p => p.note)).toEqual([42, 44, 46, 49, 51, 53]);
    expect(CYMBALS.noteNames!({}).get(46)).toBe('Hat aperto');
    expect(pieceParam(RIDE, 'bell')).toBe('rideBell');
  });

  it('ogni preset suona ogni pezzo, senza esplodere', () => {
    for (const preset of CYMBALS.presets) {
      const core = make({ ...preset.params, variation: preset.params.variation ?? 20 });
      for (const p of PIECES) {
        const { left, right } = play(core, [[p.note, 0]], 0.3);
        expect(left.every(Number.isFinite) && right.every(Number.isFinite), `${preset.name} ${p.label}`).toBe(true);
        expect(peak(left) + peak(right), `${preset.name} ${p.label}`).toBeGreaterThan(0.02);
        expect(peak(left), `${preset.name} ${p.label}`).toBeLessThan(2);
        core.silence();
        play(core, [], 0.02);
      }
    }
  });
});

describe('Hat e Piatti: il suono', () => {
  it('acuto e brillante; più brillantezza, più acuto', () => {
    const dull = play(make({ [pieceParam(CLOSED, 'tone')]: 20 }), [[note(CLOSED), 0]], 0.05).left;
    const bright = play(make({ [pieceParam(CLOSED, 'tone')]: 90 }), [[note(CLOSED), 0]], 0.05).left;
    expect(zeroCrossHz(dull, 0, at(0.04))).toBeGreaterThan(2000);
    expect(zeroCrossHz(bright, 0, at(0.04))).toBeGreaterThan(zeroCrossHz(dull, 0, at(0.04)));
  });

  it('il decay: il chiuso è corto, l\'aperto e i piatti durano', () => {
    const closed = play(make(), [[note(CLOSED), 0]], 0.5).left;
    const open = play(make(), [[note(OPEN), 0]], 0.5).left;
    const crash = play(make(), [[note(CRASH), 0]], 1.5).left;
    expect(rms(closed, at(0.2), at(0.3))).toBeLessThan(1e-4);
    expect(rms(open, at(0.2), at(0.3))).toBeGreaterThan(0.005);
    expect(rms(crash, at(1), at(1.5))).toBeGreaterThan(0.002);
  });

  it('il chiuso e il pedale fermano l\'aperto, in pochi millisecondi', () => {
    for (const stop of [CLOSED, PEDAL]) {
      // il colpo che ferma è cortissimo: dopo, si sentirebbe solo l'aperto
      const { left } = play(make({ [pieceParam(stop, 'level')]: -36, [pieceParam(stop, 'decay')]: 0.01 }), [[note(OPEN), 0], [note(stop), 0.1]], 0.2);
      expect(rms(left, at(0.05), at(0.09)), PIECES[stop].label).toBeGreaterThan(0.01);
      expect(rms(left, at(0.12), at(0.2)), PIECES[stop].label).toBeLessThan(1e-4);
    }
    // il crash no
    const { left } = play(make({ [pieceParam(CLOSED, 'level')]: -36 }), [[note(CRASH), 0], [note(CLOSED), 0.1]], 0.2);
    expect(rms(left, at(0.12), at(0.2))).toBeGreaterThan(0.01);
  });

  it('i colpi dello stesso pezzo si sovrappongono a due a due: il terzo sfuma il primo', () => {
    const one = play(make(), [[note(CRASH), 0]], 0.4).left;
    const two = play(make(), [[note(CRASH), 0], [note(CRASH), 0.2]], 0.4).left;
    expect(rms(two, at(0.25), at(0.4))).toBeGreaterThan(rms(one, at(0.25), at(0.4)) * 1.2);
    const { left } = play(make(), [[note(CRASH), 0], [note(CRASH), 0.1], [note(CRASH), 0.2]], 0.4);
    expect(left.every(Number.isFinite)).toBe(true);
  });

  it('la campana: parziali intonati che si sentono sopra il rumore del ride', () => {
    const quiet = { [pieceParam(BELL, 'noise')]: 0, [pieceParam(BELL, 'tone')]: 0, [pieceParam(BELL, 'level')]: 0 };
    const none = play(make({ ...quiet, [pieceParam(BELL, 'bell')]: 0 }), [[note(BELL), 0]], 0.2).left;
    const bell = play(make({ ...quiet, [pieceParam(BELL, 'bell')]: 100 }), [[note(BELL), 0]], 0.2).left;
    expect(rms(bell, at(0.05), at(0.2))).toBeGreaterThan(rms(none, at(0.05), at(0.2)) * 1.5);
    expect(zeroCrossHz(bell, at(0.05), at(0.2))).toBeLessThan(zeroCrossHz(none, at(0.05), at(0.2)));
  });

  it('larghezza: a zero il rumore è al centro, aperta i due canali si separano', () => {
    const piece = { [pieceParam(CRASH, 'pan')]: 0 };
    const mono = play(make({ ...piece, width: 0 }), [[note(CRASH), 0]], 0.2);
    const wide = play(make({ ...piece, width: 100 }), [[note(CRASH), 0]], 0.2);
    const diff = (x: { left: Float32Array; right: Float32Array }) => rms(x.left.map((v, i) => v - x.right[i]), 0, at(0.2));
    expect(diff(mono)).toBeLessThan(1e-6);
    expect(diff(wide)).toBeGreaterThan(0.01);
  });

  it('un pezzo può suonare un sample, con la sua intonazione', () => {
    const tone = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.8);
    const core = make({ [pieceParam(RIDE, 'source')]: SOURCE.sample, [pieceParam(RIDE, 'tone')]: 50, [pieceParam(RIDE, 'level')]: 0, [pieceParam(RIDE, 'pan')]: 0 });
    expect(peak(play(core, [[note(RIDE), 0]], 0.1).left)).toBe(0); // senza sample tace
    core.setSample(pieceSlot(RIDE), { sampleRate: SR, channels: [tone] });
    expect(zeroCrossHz(play(core, [[note(RIDE), 0]], 0.3).left, at(0.01), at(0.3))).toBeCloseTo(1000, -1);
    core.setParams(resolveParams(CYMBALS, { velocity: 0, variation: 0, volume: 0, [pieceParam(RIDE, 'source')]: SOURCE.sample,
      [pieceParam(RIDE, 'tone')]: 50, [pieceParam(RIDE, 'tune')]: 12 }));
    core.silence(); // il colpo di prima (il ride dura) sfuma
    play(core, [], 0.02);
    expect(zeroCrossHz(play(core, [[note(RIDE), 0]], 0.3).left, at(0.01), at(0.3))).toBeCloseTo(2000, -1);
  });

  it('la variazione cambia ogni colpo un poco; senza, i colpi sono uguali', () => {
    const hits = (variation: number) => {
      // senza rumore (che cambia comunque a ogni colpo)
      const core = make({ variation, [pieceParam(CLOSED, 'noise')]: 0 });
      return [0, 1].map(() => {
        core.silence();
        play(core, [], 0.01);
        return rms(play(core, [[note(CLOSED), 0]], 0.03).left, 0, at(0.03));
      });
    };
    const [a, b] = hits(0);
    expect(a).toBeCloseTo(b, 6);
    const [c, d] = hits(100);
    expect(Math.abs(c - d)).toBeGreaterThan(1e-4);
  });

  it('le altre note non suonano', () => {
    expect(peak(play(make(), [[60, 0]], 0.1).left)).toBe(0);
  });
});
