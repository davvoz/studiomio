import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { buildSacrificioLive, SACRIFICIO_LIVE_BPM, SACRIFICIO_LIVE_SOUNDS, type SacrificioLiveSound } from '../../src/demo/sacrificio-live';
import { envelopeValueAt } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('Sacrificio', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const sounds = Object.fromEntries(SACRIFICIO_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 48000, channels: 2, frames: 48000, analysis: null,
    } satisfies SampleRef])) as Record<SacrificioLiveSound, SampleRef>;
    buildSacrificioLive(store, sounds);
    return store.project;
  };

  it('intro, drop, bridge, drop modificato, outro; master con multibanda, colla e limiter', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(SACRIFICIO_LIVE_BPM);
    expect(p.scenes.map(s => s.name)).toEqual(['Intro', 'Drop', 'Drop +', 'Bridge', 'Salita', 'Drop modificato', 'Drop modificato +', 'Outro']);
    expect(p.masterEffects.map(e => e.type)).toEqual(['eq', 'multiband', 'compressor', 'limiter']);
    expect(Math.max(...p.tracks.map(t => t.arrangementEnd))).toBe(112 * 4);
    // il bridge è senza cassa, il drop modificato ha gli stab
    const kick = p.tracks.find(t => t.name === 'Cassa')!, stab = p.tracks.find(t => t.name === 'Stab')!;
    expect(kick.slots[3]).toBeNull();
    expect(stab.slots[5]).not.toBeNull();
    expect(stab.slots[1]).toBeNull();
  });

  it('il rumble è la cassa nel riverbero, distorta e filtrata, e tace sul colpo', () => {
    const p = build();
    const rumble = p.tracks.find(t => t.name === 'Rumble') as MidiTrack;
    expect(rumble.effects.map(e => e.type)).toEqual(['reverb', 'drive', 'eq']);
    expect(rumble.effects[0].params.mix).toBe(100);
    const pump = rumble.slots[1]!.envelopes.find(e => e.target.kind === 'mixer')!;
    expect(envelopeValueAt(pump.points, 2)).toBe(0);
    expect(envelopeValueAt(pump.points, 2.85)).toBeGreaterThan(0.9);
  });

  it('lead e stab sono supersaw (unison a 7); le clip stanno nel giro; si salva e si riapre uguale', () => {
    const p = build();
    for (const name of ['Lead', 'Stab']) expect((p.tracks.find(t => t.name === name) as MidiTrack).instrument.params.unison).toBe(7);
    for (const t of p.tracks as MidiTrack[]) {
      const effects = new Set(t.effects.map(e => e.id));
      for (const c of t.clips as MidiClip[]) {
        expect(c.notes.every(n => n.start >= 0 && n.start < c.loop.end), c.name).toBe(true);
        for (const e of c.envelopes) if (e.target.kind === 'device' && e.target.device !== 'instrument') expect(effects.has(e.target.device), c.name).toBe(true);
      }
    }
    const codec = new ProjectCodec();
    expect(codec.stringify(codec.parse(codec.stringify(p)))).toBe(codec.stringify(p));
  });
});
