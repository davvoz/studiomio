import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { padNote, padParam } from '../../src/devices/instruments/drums/drums';
import { SAMPLER, zoneParam } from '../../src/devices/instruments/sampler/sampler';
import { buildRaveLive, RAVE_LIVE, RAVE_LIVE_BPM, RAVE_LIVE_SOUNDS, RAVE_PARTS, type RaveLiveSound } from '../../src/demo/rave-live';
import { MASTER } from '../../src/model/project';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import type { MidiTrack } from '../../src/model/track';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { ProjectStore } from '../../src/store/project-store';

describe('Rave illegale', () => {
  const build = () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('Prova', ids), ids);
    const sounds = Object.fromEntries(RAVE_LIVE_SOUNDS.map(key => [key, {
      id: ids.next('sample'), name: key, file: `audio/${key}.wav`, sampleRate: 48000, channels: 2, frames: 48000 * 12, analysis: null,
    } satisfies SampleRef])) as Record<RaveLiveSound, SampleRef>;
    buildRaveLive(store, sounds);
    return store.project;
  };
  const track = (p: Project, name: string) => p.tracks.find(t => t.name === name) as MidiTrack;
  const NAMES = ['Cassa', 'Colpi', 'Piatti', 'Levare', 'Acido', 'Sampler', 'Rottura', 'Lunghi'];

  it('exactly eight tracks (one APC40 page), at 145 BPM, launch on the bar', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(RAVE_LIVE_BPM);
    expect(RAVE_LIVE_BPM).toBe(145);
    expect(p.tracks.map(t => t.name)).toEqual(NAMES);
    expect(p.buses).toHaveLength(0);
    expect(p.launchQuantization).toBe('1bar');
  });

  it('the recording on the timeline lasts more than half an hour, in sections of eight bars', () => {
    const p = build();
    const end = Math.max(...p.tracks.map(t => t.arrangementEnd));
    expect(end * (60 / RAVE_LIVE_BPM)).toBeGreaterThan(30 * 60);
    const starts = [...new Set(p.tracks.flatMap(t => t.arrangement.map(pl => pl.start)))];
    for (const s of starts) expect(s % 32).toBe(0);
  });

  it('each track is an Instrument Rack with eight named macros; the acid also has its effects rack', () => {
    const p = build();
    for (const name of NAMES) {
      const racks = p.racksOf(track(p, name).id);
      expect(racks[0].devices[0], name).toBe('instrument');
      expect(racks[0].macros.every(m => m.name && m.mappings.length), name).toBe(true);
    }
    expect(p.racksOf(track(p, 'Acido').id)).toHaveLength(2);
    expect(p.racksOf(MASTER)[0].name).toBe('Macchina');
  });

  it('the kick plays only kicks: eight bodies tuned on the fifth (G), the layers off until the macros raise them', () => {
    const p = build();
    const kick = track(p, 'Cassa');
    for (const [i, b] of RAVE_PARTS.BODIES.entries()) {
      expect(kick.instrument.samples?.[`p${i + 1}`]).toBeDefined();
      expect(kick.instrument.params[padParam(i, 'tune')], b.name).toBe(b.tune);
    }
    const sounds = new Set(Object.values(kick.instrument.samples ?? {}).map(id => p.sample(id)!.name));
    for (const s of sounds) expect(['ancora', 'corpus', 'secca', 'martello', 'distorta', 'industriale', 'gabber', 'boom', 'ferro', 'click', 'rimbombo']).toContain(s);
    // Ferro and Click at 0: the layers at −36 dB
    expect(kick.instrument.params[padParam(8, 'level')]).toBe(-36);
    expect(kick.instrument.params[padParam(9, 'level')]).toBe(-36);
    // each hit of the body also plays the layers
    const dritta = kick.slots[RAVE_LIVE.scenes.findIndex(s => s.name === 'Macchina')] as MidiClip;
    const body = dritta.notes.filter(n => n.pitch === padNote(0)).length;
    expect(dritta.notes.filter(n => n.pitch === padNote(8))).toHaveLength(body);
  });

  it('the bass, the sampler and the long sounds pump with the kick (sidechain)', () => {
    const p = build();
    const kick = track(p, 'Cassa').id;
    for (const name of ['Levare', 'Sampler', 'Lunghi']) {
      const comp = track(p, name).effects.find(e => e.type === 'compressor');
      expect(comp?.sidechain, name).toBe(kick);
    }
  });

  it('the "Seq" clips turn on the sequencer and hold only the root (or the loop); the written ones don\'t', () => {
    const p = build();
    const acid = track(p, 'Acido');
    const clips = acid.clips as MidiClip[];
    const seq = clips.filter(c => c.name.startsWith('Seq'));
    expect(seq.length).toBeGreaterThan(3);
    for (const c of seq) {
      const env = c.envelopes.find(e => e.target.kind === 'device' && e.target.param === 'seqOn');
      expect(env?.points.every(pt => pt.value === 1), c.name).toBe(true);
      expect(c.notes.length, c.name).toBeLessThanOrEqual(3);
    }
    for (const c of clips.filter(c => !c.name.startsWith('Seq'))) expect(c.envelopes.some(e => e.target.kind === 'device' && e.target.param === 'seqOn'), c.name).toBe(false);
    expect(acid.instrument.params.seqOn ?? 0).toBe(0);
    expect(acid.instrument.params.voiceMode).toBe(2);
  });

  it('the acid and the bass are in C phrygian with the tritone (brehho23\'s notes)', () => {
    const p = build();
    const SCALE = new Set([0, 1, 3, 5, 6, 7, 8, 10]); // C Db Eb F F# G Ab Bb
    for (const name of ['Acido', 'Levare']) {
      for (const c of track(p, name).clips as MidiClip[]) {
        for (const n of c.notes) expect(SCALE.has(n.pitch % 12), `${name} ${c.name} ${n.pitch}`).toBe(true);
      }
    }
  });

  it('the samplers: zones on different keys, banks of eight, no long note past the end of the clip', () => {
    const p = build();
    for (const name of ['Sampler', 'Lunghi']) {
      const t = track(p, name);
      expect(t.instrument.type).toBe(SAMPLER.type);
      const slots = Object.keys(t.instrument.samples ?? {});
      const keys = slots.map((_, i) => t.instrument.params[zoneParam(i, 'lo')]);
      expect(new Set(keys).size, name).toBe(slots.length);
      for (const c of t.clips as MidiClip[]) {
        for (const n of c.notes) {
          expect(keys, `${name} ${c.name}`).toContain(n.pitch);
          // a long sound held past the end would be cut without its release
          if (name === 'Lunghi') expect(n.start + n.duration, `${name} ${c.name}`).toBeLessThanOrEqual(c.region.end + 1e-9);
        }
      }
    }
    expect(Object.values(RAVE_PARTS.PERC_BANKS).map(b => b.length)).toEqual([8, 8, 8, 8]);
  });

  it('risers, rolls and impacts play once; the drones loop with the fades', () => {
    const p = build();
    const once = (name: string, clip: string) => (track(p, name).clips as MidiClip[]).find(c => c.name === clip)!;
    for (const [t, c] of [['Lunghi', 'Salita 8'], ['Lunghi', 'Impatto'], ['Cassa', 'Rullo'], ['Colpi', 'Salita'], ['Rottura', 'Tensione']]) {
      expect(once(t, c).loop.enabled, `${t} ${c}`).toBe(false);
    }
    // the riser ends on the clip's last beat
    const rise = once('Lunghi', 'Salita 8');
    expect(Math.max(...rise.notes.map(n => n.start + n.duration))).toBeCloseTo(rise.region.end, 6);
    const long = track(p, 'Lunghi');
    const drone = RAVE_PARTS.LONG_ZONES.findIndex(z => z.sound === 'halfIntro');
    expect(long.instrument.params[zoneParam(drone, 'own')]).toBe(1);
    expect(long.instrument.params[zoneParam(drone, 'loop')]).toBe(1);
  });

  it('the keys: the master\'s buttons on Q W E R T, the roll on A', () => {
    const p = build();
    expect(p.keyMap).toHaveLength(RAVE_PARTS.KEYS.length);
    const keyOf = (code: string) => p.keyMap.find(m => m.key === code)!.target;
    const q = keyOf('KeyQ');
    expect(q.kind === 'macro' && q.owner).toBe(MASTER);
    const master = p.racksOf(MASTER)[0];
    for (const [i, code] of ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'].entries()) {
      const t = keyOf(code);
      expect(t.kind === 'macro' && t.index).toBe(i);
      expect(master.macros[i].mode).toBe('button');
    }
    const a = keyOf('KeyA');
    expect(a.kind === 'macro' && p.racksOf(track(p, 'Colpi').id)[0].macros[a.index].name).toBe('Rullata');
  });

  it('the clips sit in the loop and the modulated effects exist; it saves and reopens the same', () => {
    const p = build();
    for (const t of p.tracks as MidiTrack[]) {
      const effects = new Set(t.effects.map(e => e.id));
      for (const c of t.clips as MidiClip[]) {
        expect(c.notes.every(n => n.start >= 0 && n.start < c.region.end), `${t.name} ${c.name}`).toBe(true);
        for (const e of c.envelopes) if (e.target.kind === 'device' && e.target.device !== 'instrument') expect(effects.has(e.target.device), c.name).toBe(true);
      }
    }
    const codec = new ProjectCodec();
    expect(codec.stringify(codec.parse(codec.stringify(p)))).toBe(codec.stringify(p));
  });
});
