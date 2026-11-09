import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { ACID_LIVE_BPM, ACID_LIVE_SOUNDS, buildAcidLive, type AcidLiveSound } from '../../src/demo/acid-live';
import { kitParams } from '../../src/demo/live-builder';
import { acid, bars, repeat, steps, swing } from '../../src/demo/patterns';
import { DRUM_MODELS, MODEL, padNote, padParam } from '../../src/devices/instruments/drums/drums';
import { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('writing the parts', () => {
  it('sixteenth rhythms: accents, hits, soft hits, rests; spaces and bars don\'t count', () => {
    const n = steps(2, 'X.x. o... | ....');
    expect(n.map(x => [x.start, x.velocity])).toEqual([[0, 127], [0.5, 104], [1, 66]]);
    expect(n.every(x => x.pitch === padNote(2))).toBe(true);
    // three equal bars and the last one different
    expect(bars(0, 'x...', 3, 'xx..').map(x => x.start)).toEqual([0, 4, 8, 8.25]);
  });

  it('acid lines: pitches, accents, rests, ties and overlapping slides', () => {
    const n = acid('A2 a2~ c3 . eb3 - G#3~ a3');
    expect(n.map(x => x.pitch)).toEqual([45, 45, 48, 51, 56, 57]);
    expect(n.map(x => x.velocity)).toEqual([127, 92, 92, 92, 127, 92]);
    expect(n.map(x => x.start)).toEqual([0, 0.25, 0.5, 1, 1.5, 1.75]);
    // half-step gate; the note with slide reaches past the start of the next
    expect(n[0].duration).toBeCloseTo(0.125);
    expect(n[1].start + n[1].duration).toBeGreaterThan(n[2].start);
    expect(n[3].duration).toBeCloseTo(0.375); // eb3 held one more step
    expect(n[4].start + n[4].duration).toBeGreaterThan(n[5].start);
    expect(() => acid('h2')).toThrow(/invalid/);
    expect(repeat(acid('a2 . a2'), 1, 2).map(x => x.start)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('swing moves only the offbeat sixteenths', () => {
    const n = swing(steps(0, 'xxxx xxxx'), 0.2);
    expect(n.map(x => x.start)).toEqual([0, 0.3, 0.5, 0.8, 1, 1.3, 1.5, 1.8]);
  });

  it('in the kits the pads are Sample or, with the model, synthesized sounds with their defaults', () => {
    const p = kitParams([{ model: 'kick', tune: -1 }, { sound: 'x', decay: 0.1 }]);
    expect(p[padParam(0, 'model')]).toBe(MODEL.kick);
    expect(p[padParam(0, 'decay')]).toBe(DRUM_MODELS[MODEL.kick].decay);
    expect(p[padParam(0, 'tune')]).toBe(-1);
    expect(p[padParam(1, 'model')]).toBe(MODEL.sample);
    expect(p[padParam(1, 'tone')]).toBe(50);
    expect(() => kitParams([{ tune: 0 }])).toThrow(/sound/);
    expect(() => kitParams([{ model: 'theremin' }])).toThrow(/unknown/);
  });
});

describe('Acido crudo', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const sounds = Object.fromEntries(ACID_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 44100, channels: 2, frames: 44100, analysis: null,
    } satisfies SampleRef])) as Record<AcidLiveSound, SampleRef>;
    buildAcidLive(store, sounds);
    return { store, sounds };
  };

  it('tracks, scenes and samples: each sound sits on a pad', () => {
    const { store, sounds } = build();
    const p = store.project;
    expect(p.tempo.bpm).toBe(ACID_LIVE_BPM);
    expect(p.tracks.map(t => t.name)).toEqual(['Cassa', 'Rumble', 'Acido', 'Acido 2', 'Clap', 'Piatti', 'Percussioni', 'FX']);
    expect(p.scenes.map(s => s.name)).toEqual(['Intro', 'Cassa e rumble', 'Entra l\'acido', 'Acido pieno', 'Break', 'Drop', 'Acido 2', 'Martello', 'Break 2', 'Outro']);
    expect(p.samples).toHaveLength(ACID_LIVE_SOUNDS.length);
    expect(p.usedSampleIds()).toEqual(new Set(Object.values(sounds).map(s => s.id)));
    // the break has no kick, the drop has everything
    const slot = (track: number, scene: number) => p.tracks[track].slots[scene];
    expect(slot(0, 4)).toBeNull();
    expect(p.tracks.every(t => t.slots[5] !== null)).toBe(true);
    expect(p.masterEffects.map(e => e.type)).toEqual(['drive']);
  });

  it('the clips: notes inside the loop, modulations on parameters and effects that exist', () => {
    const { store } = build();
    const p = store.project;
    for (const t of p.tracks as MidiTrack[]) {
      const effects = new Set(t.effects.map(e => e.id));
      for (const c of t.clips as MidiClip[]) {
        expect(c.notes.length, c.name).toBeGreaterThan(0);
        expect(c.notes.every(n => n.start >= 0 && n.start < c.loop.end), c.name).toBe(true);
        for (const e of c.envelopes) {
          if (e.target.kind === 'device' && e.target.device !== 'instrument') expect(effects.has(e.target.device), c.name).toBe(true);
        }
      }
    }
  });

  it('the timeline is the live\'s recording: 160 bars, and the project saves and reopens the same', () => {
    const { store } = build();
    const p = store.project;
    expect(Math.max(...p.tracks.map(t => t.arrangementEnd))).toBe(160 * 4);
    // in the breaks the kick is silent
    const kick = p.tracks[0];
    expect(kick.arrangement.some(pl => pl.start < 64 * 4 + 8 * 4 && pl.start + pl.length > 64 * 4)).toBe(false);
    const codec = new ProjectCodec();
    expect(codec.stringify(codec.parse(codec.stringify(p)))).toBe(codec.stringify(p));
  });
});
