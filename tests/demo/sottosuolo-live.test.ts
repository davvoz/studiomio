import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { MODEL, padNote, padParam, padSlot } from '../../src/devices/instruments/drums/drums';
import { buildSottosuoloLive, SOTTOSUOLO_LIVE_BPM, SOTTOSUOLO_LIVE_SOUNDS, type SottosuoloLiveSound } from '../../src/demo/sottosuolo-live';
import { envelopeValueAt } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('Sottosuolo', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const sounds = Object.fromEntries(SOTTOSUOLO_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 48000, channels: 2, frames: 48000 * 30, analysis: null,
    } satisfies SampleRef])) as Record<SottosuoloLiveSound, SampleRef>;
    buildSottosuoloLive(store, sounds);
    return store.project;
  };
  const track = (p: Project, name: string) => p.tracks.find(t => t.name === name) as MidiTrack;

  it('intro e groove per chi mixa, tensione, drop, pausa, salita, secondo drop, dopo, outro, fine', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(SOTTOSUOLO_LIVE_BPM);
    expect(p.scenes.map(s => s.name)).toEqual(['Intro', 'Groove', 'Tensione', 'Drop', 'Pausa', 'Salita', 'Drop 2', 'Dopo', 'Outro', 'Fine']);
    expect(Math.max(...p.tracks.map(t => t.arrangementEnd))).toBe(184 * 4);
    // ogni sezione dura un multiplo di otto battute (le frasi su cui mixa un DJ)
    const starts = [...new Set(p.tracks.flatMap(t => t.arrangement.map(pl => pl.start)))].sort((a, b) => a - b);
    for (const s of starts) expect(s % 32).toBe(0);
    // il master: EQ, colla, clipper, bassi mono, limiter
    expect(p.masterEffects.map(e => e.type)).toEqual(['eq', 'compressor', 'clipper', 'stereo', 'limiter']);
    // nella pausa niente cassa né rumble
    expect(track(p, 'Cassa').slots[4]).toBeNull();
    expect(track(p, 'Rumble').slots[4]).toBeNull();
  });

  it('la cassa ha due strati campionati suonati insieme; il rumble suona i suoi colpi nel riverbero tutto bagnato', () => {
    const p = build();
    const kick = track(p, 'Cassa');
    expect(kick.instrument.params[padParam(0, 'model')]).toBe(MODEL.sample);
    expect(Object.keys(kick.instrument.samples ?? {})).toEqual([padSlot(0), padSlot(1)]);
    const drop = kick.slots[3] as MidiClip;
    expect(drop.notes.filter(n => n.pitch === padNote(0)).length).toBe(drop.notes.filter(n => n.pitch === padNote(1)).length);
    const rumble = track(p, 'Rumble');
    const reverb = rumble.effects.find(e => e.type === 'reverb')!;
    expect(reverb.params.mix).toBe(100);
    expect(reverb.params.width).toBe(0);
    // ogni colpo pieno della cassa ha il suo colpo di rumble
    const hits = drop.notes.filter(n => n.pitch === padNote(0) && n.velocity >= 100).map(n => n.start);
    expect((rumble.slots[3] as MidiClip).notes.map(n => n.start)).toEqual(hits);
  });

  it('il rumble è zero sul colpo e pieno sul levare; i bassi e la sequenza pompano sulla cassa', () => {
    const p = build();
    const rumble = (track(p, 'Rumble').slots[3] as MidiClip).envelopes.find(e => e.target.kind === 'mixer')!;
    expect(envelopeValueAt(rumble.points, 4)).toBe(0);
    expect(envelopeValueAt(rumble.points, 4.5)).toBeCloseTo(1);
    for (const name of ['Basso', 'Sequenza']) {
      const pump = (track(p, name).slots[3] as MidiClip).envelopes.find(e => e.target.kind === 'mixer')!;
      expect(envelopeValueAt(pump.points, 8), name).toBeLessThan(0.6);
      expect(envelopeValueAt(pump.points, 8.45), name).toBeGreaterThan(0.95);
    }
  });

  it('il basso non suona mai sul battere (lì c\'è la cassa); tutto è in Sol# frigio', () => {
    const p = build();
    const SCALE = new Set([8, 9, 11, 1, 3, 4, 6]); // Sol# La Si Do# Re# Mi Fa#
    for (const name of ['Basso', 'Sequenza', 'Stab', 'Bordone']) {
      for (const c of track(p, name).clips as MidiClip[]) {
        for (const n of c.notes) expect(SCALE.has(n.pitch % 12), `${name} ${c.name} ${n.pitch}`).toBe(true);
      }
    }
    for (const c of track(p, 'Basso').clips as MidiClip[]) {
      for (const n of c.notes) expect(Math.abs(n.start - Math.round(n.start)), c.name).toBeGreaterThan(0.1);
    }
  });

  it('i bassi restano mono e la cassa è centrata', () => {
    const p = build();
    expect(track(p, 'Cassa').effects.find(e => e.type === 'stereo')!.params.width).toBe(0);
    expect(track(p, 'Rumble').effects.find(e => e.type === 'stereo')!.params.width).toBe(0);
    expect(p.masterEffects.find(e => e.type === 'stereo')!.params.monoFreq).toBe(110);
  });

  it('le clip stanno nel giro e gli effetti modulati esistono; si salva e si riapre uguale', () => {
    const p = build();
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
