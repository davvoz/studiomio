import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { MODEL, padNote, padParam } from '../../src/devices/instruments/drums/drums';
import {
  buildPrestabilitiLive, PRESTABILITI_LIVE_BPM, PRESTABILITI_LIVE_SOUNDS, PRESTABILITI_PHRASES, type PrestabilitiLiveSound,
} from '../../src/demo/prestabiliti-live';
import { envelopeValueAt } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('Prestabiliti', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const sounds = Object.fromEntries(PRESTABILITI_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 48000, channels: 2, frames: 48000 * 61, analysis: null,
    } satisfies SampleRef])) as Record<PrestabilitiLiveSound, SampleRef>;
    buildPrestabilitiLive(store, sounds);
    return store.project;
  };
  const track = (p: Project, name: string) => p.tracks.find(t => t.name === name) as MidiTrack;
  const SCENES = ['Intro', 'Groove', 'Monologo', 'Tensione', 'Drop', 'Prigioniera', 'Libera', 'Drop 2', 'Catena', 'Outro'];

  it('eight tracks (one APC40 page) and ten scenes (two pages), at the voice\'s tempo', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(PRESTABILITI_LIVE_BPM);
    expect(p.tracks.map(t => t.name)).toEqual(['Cassa', 'Rumble', 'Acido', 'Robot', 'Clap', 'Piatti', 'Perc & FX', 'Voce']);
    expect(p.scenes.map(s => s.name)).toEqual(SCENES);
    expect(Math.max(...p.tracks.map(t => t.arrangementEnd))).toBe(184 * 4);
    // each section starts on a multiple of eight bars
    const starts = [...new Set(p.tracks.flatMap(t => t.arrangement.map(pl => pl.start)))].sort((a, b) => a - b);
    for (const s of starts) expect(s % 32).toBe(0);
    expect(p.masterEffects.map(e => e.type)).toEqual(['eq', 'compressor', 'clipper', 'stereo', 'limiter']);
  });

  it('in the break no kick, rumble or clap: the Robotoid holds the bottom', () => {
    const p = build();
    const breakdown = SCENES.indexOf('Prigioniera');
    for (const name of ['Cassa', 'Rumble', 'Clap']) expect(track(p, name).slots[breakdown], name).toBeNull();
    const robot = track(p, 'Robot').slots[breakdown] as MidiClip;
    expect(robot.notes.length).toBeGreaterThan(0);
    expect(robot.notes.every(n => n.pitch <= padNote(3))).toBe(true);
  });

  it('the rumble plays the kick\'s hits and is zero on the hit; acid and robot pump', () => {
    const p = build();
    const drop = SCENES.indexOf('Drop');
    const kick = track(p, 'Cassa').slots[drop] as MidiClip;
    const hits = kick.notes.filter(n => n.pitch === padNote(0) && n.velocity >= 100).map(n => n.start);
    const rumble = track(p, 'Rumble').slots[drop] as MidiClip;
    expect(rumble.notes.map(n => n.start)).toEqual(hits);
    const env = rumble.envelopes.find(e => e.target.kind === 'mixer')!;
    expect(envelopeValueAt(env.points, 4)).toBe(0);
    expect(envelopeValueAt(env.points, 4.5)).toBeCloseTo(1);
    for (const name of ['Acido', 'Robot']) {
      const pump = (track(p, name).slots[drop] as MidiClip).envelopes.find(e => e.target.kind === 'mixer')!;
      expect(envelopeValueAt(pump.points, 8), name).toBeLessThan(0.55);
      expect(envelopeValueAt(pump.points, 8.45), name).toBeGreaterThan(0.95);
    }
  });

  it('the acid is in F phrygian with the sketch motif\'s tritone, and plays in Legato', () => {
    const p = build();
    const SCALE = new Set([5, 6, 8, 10, 11, 0, 1, 3]); // F Gb Ab Bb B C Db Eb
    const acid = track(p, 'Acido');
    expect(acid.instrument.params.voiceMode).toBe(2);
    for (const c of acid.clips as MidiClip[]) {
      for (const n of c.notes) expect(SCALE.has(n.pitch % 12), `${c.name} ${n.pitch}`).toBe(true);
    }
    // the motif: root, flat second, tritone
    const motif = acid.slots[SCENES.indexOf('Groove')] as MidiClip;
    expect([...new Set(motif.notes.map(n => n.pitch % 12))].sort((a, b) => a - b)).toEqual([5, 6, 8, 11]);
  });

  it('the percussion kit is the sketch\'s: the rim down nine semitones and the One_Shots', () => {
    const p = build();
    const perc = track(p, 'Perc & FX');
    expect(perc.instrument.params[padParam(0, 'model')]).toBe(MODEL.rim);
    expect(perc.instrument.params[padParam(0, 'tune')]).toBe(-9);
    expect(perc.instrument.params[padParam(1, 'decay')]).toBe(0.066);
    expect(perc.instrument.params[padParam(2, 'decay')]).toBe(0.087);
    expect(perc.instrument.params[padParam(3, 'decay')]).toBe(0.79);
    // the sketch's kick, a semitone down (from F# to F)
    expect(track(p, 'Cassa').instrument.params[padParam(0, 'tune')]).toBe(-1);
  });

  it('each phrase of the voice starts from its point of the file and is closed by the cut before the next', () => {
    const p = build();
    const vox = track(p, 'Voce');
    const phrases = Object.values(PRESTABILITI_PHRASES);
    const CUT = padNote(15);
    expect(vox.instrument.params[padParam(15, 'choke')]).toBe(1);
    phrases.forEach((ph, i) => {
      expect(vox.instrument.params[padParam(i, 'choke')]).toBe(1);
      // the start in percent of the file (61 s long in the test)
      expect(vox.instrument.params[padParam(i, 'start')]).toBeCloseTo((ph.at / 61) * 100, 2);
    });
    const beat = 60 / PRESTABILITI_LIVE_BPM;
    for (const c of vox.clips as MidiClip[]) {
      const notes = [...c.notes].sort((a, b) => a.start - b.start);
      notes.forEach((n, k) => {
        const i = n.pitch - padNote(0);
        if (i >= phrases.length) return;
        // after a phrase comes its cut, at its end, before any other phrase
        const next = notes[k + 1];
        expect(next?.pitch, c.name).toBe(CUT);
        expect(next.start - n.start, c.name).toBeCloseTo(phrases[i].length / beat + 0.1, 5);
      });
    }
  });

  it('the clips sit in the loop and the modulated effects exist; it saves and reopens the same', () => {
    const p = build();
    for (const t of p.tracks as MidiTrack[]) {
      const effects = new Set(t.effects.map(e => e.id));
      for (const c of t.clips as MidiClip[]) {
        expect(c.notes.every(n => n.start >= 0 && n.start < c.loop.end), `${t.name} ${c.name}`).toBe(true);
        for (const e of c.envelopes) if (e.target.kind === 'device' && e.target.device !== 'instrument') expect(effects.has(e.target.device), c.name).toBe(true);
      }
    }
    const codec = new ProjectCodec();
    expect(codec.stringify(codec.parse(codec.stringify(p)))).toBe(codec.stringify(p));
  });
});
