import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { MODEL, padNote, padParam, padSlot } from '../../src/devices/instruments/drums/drums';
import { buildFuoriLive, FUORI_LIVE_BPM, FUORI_LIVE_SOUNDS, type FuoriLiveSound } from '../../src/demo/fuori-live';
import { envelopeValueAt } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('Fuori dal corpo', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const sounds = Object.fromEntries(FUORI_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 48000, channels: 2, frames: 48000 * 30, analysis: null,
    } satisfies SampleRef])) as Record<FuoriLiveSound, SampleRef>;
    buildFuoriLive(store, sounds);
    return store.project;
  };
  const track = (p: Project, name: string) => p.tracks.find(t => t.name === name) as MidiTrack;

  it('intro, groove, salita, drop, vuoto, salita, secondo drop, outro', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(FUORI_LIVE_BPM);
    expect(p.scenes.map(s => s.name)).toEqual(['Intro', 'Groove', 'Salita', 'Drop', 'Vuoto', 'Salita 2', 'Drop 2', 'Outro']);
    expect(Math.max(...p.tracks.map(t => t.arrangementEnd))).toBe(144 * 4);
    expect(p.masterEffects.map(e => e.type)).toEqual(['eq', 'multiband', 'compressor', 'limiter']);
    // il break è senza cassa; il ringhio suona solo nel secondo drop, il reese mai lì
    expect(track(p, 'Cassa').slots[4]).toBeNull();
    expect(track(p, 'Ringhio').slots.map(s => s !== null)).toEqual([false, false, false, false, false, false, true, false]);
    expect(track(p, 'Reese').slots[6]).toBeNull();
  });

  it('i bassi sono Neuro (reese e ringhio), il bordone Analog, gli stacchi fette dei loop in choke', () => {
    const p = build();
    expect(track(p, 'Reese').instrument.type).toBe('neuro');
    expect(track(p, 'Ringhio').instrument.type).toBe('neuro');
    expect(track(p, 'Vuoto').instrument.type).toBe('analog');
    const chops = track(p, 'Neuro').instrument;
    for (let i = 0; i < 10; i++) expect(chops.params[padParam(i, 'choke')]).toBe(2);
    // la cassa: corpo sintetico e attacco campionato, suonati insieme
    const kick = track(p, 'Cassa');
    expect(kick.instrument.params[padParam(0, 'model')]).toBe(MODEL.kick);
    expect(kick.instrument.params[padParam(1, 'model')]).toBe(MODEL.sample);
    expect(Object.keys(kick.instrument.samples ?? {})).toEqual([padSlot(1)]);
    const notes = (kick.slots[3] as MidiClip).notes;
    expect(notes.filter(n => n.pitch === padNote(0)).length).toBe(notes.filter(n => n.pitch === padNote(1)).length);
  });

  it('i bassi pompano sulla cassa e si muovono con le modulazioni delle clip', () => {
    const p = build();
    const riff = track(p, 'Reese').slots[3] as MidiClip;
    const pump = riff.envelopes.find(e => e.target.kind === 'mixer')!;
    expect(envelopeValueAt(pump.points, 4)).toBeCloseTo(0.3);
    expect(envelopeValueAt(pump.points, 4.29)).toBeGreaterThan(0.95);
    const params = riff.envelopes.flatMap(e => (e.target.kind === 'device' ? [e.target.param] : []));
    expect(params).toEqual(expect.arrayContaining(['vowel', 'fold']));
    // nel break la picchiata: il trasporto scende di un'ottava nell'ultima battuta
    const breath = track(p, 'Reese').slots[4] as MidiClip;
    const transpose = breath.envelopes.find(e => e.target.kind === 'device' && e.target.param === 'transpose')!;
    expect(envelopeValueAt(transpose.points, 60)).toBe(0);
    expect(envelopeValueAt(transpose.points, 64)).toBe(-0.25);
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
