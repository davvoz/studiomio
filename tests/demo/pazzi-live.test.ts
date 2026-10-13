import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { buildPazziLive, PAZZI_LIVE_BPM, PAZZI_LIVE_SOUNDS, type PazziLiveSound } from '../../src/demo/pazzi-live';
import { chop, duck, gate, roll } from '../../src/demo/patterns';
import { padNote, padParam } from '../../src/devices/instruments/drums/drums';
import { envelopeValueAt } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('rulli, chop, pompa e gate', () => {
  it('un rullo: colpi a passo fisso con la velocity che cresce', () => {
    const r = roll(3, 2, 4, 0.25, [60, 120]);
    expect(r.map(n => [n.start, n.velocity, n.pitch])).toEqual([[2, 60, padNote(3)], [2.25, 80, padNote(3)], [2.5, 100, padNote(3)], [2.75, 120, padNote(3)]]);
  });

  it('chop: una fetta per sedicesimo, "." lascia suonare', () => {
    expect(chop('0 . 1 . 1 2 | . 3', 4).map(n => [n.start, n.pitch - padNote(0)])).toEqual([[4, 0], [4.5, 1], [5, 1], [5.25, 2], [5.75, 3]]);
    expect(() => chop('x')).toThrow(/fetta/);
  });

  it('la pompa: giù sul colpo, su nel rilascio; il gate: acceso e spento a scatti', () => {
    const d = duck([2, 0], 0.5, 0.5);
    expect(envelopeValueAt(d, 0)).toBe(0.5);
    expect(envelopeValueAt(d, 0.25)).toBeCloseTo(0.75);
    expect(envelopeValueAt(d, 1)).toBe(1);
    expect(envelopeValueAt(d, 2)).toBe(0.5);
    const g = gate(4, 5, 0.5);
    expect([3, 4.1, 4.3, 4.6, 4.8, 5.2].map(b => envelopeValueAt(g, b))).toEqual([1, 1, 0, 1, 0, 1]);
  });
});

describe('Siete pazzi', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const seconds: Partial<Record<PazziLiveSound, number>> = { amen: 5.4857, amenCrush: 5.4857, amenGlitch: 5.4857, vocal: 5.49, vocal2: 42.2 };
    const sounds = Object.fromEntries(PAZZI_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 48000, channels: 2,
      frames: Math.round((seconds[key] ?? 1) * 48000), analysis: null,
    } satisfies SampleRef])) as Record<PazziLiveSound, SampleRef>;
    buildPazziLive(store, sounds);
    return store.project;
  };

  it('tracce, scene, master: compressore e limiter in fondo', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(PAZZI_LIVE_BPM);
    expect(p.tracks.map(t => t.name)).toEqual(['Cassa', 'Rullante', 'Amen', 'Glitch', 'Piatti', 'Sub', 'Reese', 'Pad', 'Voci', 'FX']);
    expect(p.scenes.map(s => s.name)).toEqual(['Intro', 'Salita', 'Stacco', 'Drop', 'Drop B', 'Glitch', 'Pausa', 'Stacco 2', 'Drop 2', 'Drop 2B', 'Fine']);
    expect(p.masterEffects.map(e => e.type)).toEqual(['eq', 'compressor', 'limiter']);
    expect(p.samples).toHaveLength(PAZZI_LIVE_SOUNDS.length);
  });

  it("l'amen è affettato in ottavi: sedici pad in choke, ognuno un ottavo più avanti", () => {
    const amen = (build().tracks[2] as MidiTrack).instrument.params;
    const eighth = 30 / PAZZI_LIVE_BPM;
    for (let k = 0; k < 16; k++) {
      expect(amen[padParam(k, 'start')]).toBeCloseTo((k * eighth * 100) / 5.4857, 2);
      expect(amen[padParam(k, 'choke')]).toBe(1);
    }
    // le sillabe della voce partono dove cominciano nella frase
    const vox = (build().tracks[8] as MidiTrack).instrument.params;
    expect(vox[padParam(1, 'start')]).toBeCloseTo((0.116 * 100) / 5.49, 2);
    expect(vox[padParam(9, 'reverse')]).toBe(1);
  });

  it('le clip: note nel giro, modulazioni su bersagli che esistono; gli stacchi durano una battuta', () => {
    const p = build();
    for (const t of p.tracks as MidiTrack[]) {
      const effects = new Set(t.effects.map(e => e.id));
      for (const c of t.clips as MidiClip[]) {
        expect(c.notes.every(n => n.start >= 0 && n.start < c.loop.end), c.name).toBe(true);
        for (const e of c.envelopes) {
          if (e.target.kind === 'device' && e.target.device !== 'instrument') expect(effects.has(e.target.device), c.name).toBe(true);
        }
      }
    }
    const stacco = p.scenes.findIndex(s => s.name === 'Stacco');
    expect(p.tracks.filter(t => t.slots[stacco]).map(t => t.name)).toEqual(['Voci']);
    // nel drop il reese pompa: la curva del volume scende sulla cassa
    const reese = p.tracks[6].slots[3]!;
    const pump = reese.envelopes.find(e => e.target.kind === 'mixer')!;
    expect(envelopeValueAt(pump.points, 0)).toBeLessThan(0.7);
    expect(envelopeValueAt(pump.points, 0.9)).toBe(1);
  });

  it('la registrazione: 130 battute, e il progetto si salva e si riapre uguale', () => {
    const p = build();
    expect(Math.max(...p.tracks.map(t => t.arrangementEnd))).toBe(130 * 4);
    const codec = new ProjectCodec();
    expect(codec.stringify(codec.parse(codec.stringify(p)))).toBe(codec.stringify(p));
  });
});
