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

  it('esattamente otto tracce (una pagina dell\'APC40), a 145 BPM, lancio alla battuta', () => {
    const p = build();
    expect(p.tempo.bpm).toBe(RAVE_LIVE_BPM);
    expect(RAVE_LIVE_BPM).toBe(145);
    expect(p.tracks.map(t => t.name)).toEqual(NAMES);
    expect(p.buses).toHaveLength(0);
    expect(p.launchQuantization).toBe('1bar');
  });

  it('la registrazione sulla timeline dura più di mezz\'ora, a sezioni di otto battute', () => {
    const p = build();
    const end = Math.max(...p.tracks.map(t => t.arrangementEnd));
    expect(end * (60 / RAVE_LIVE_BPM)).toBeGreaterThan(30 * 60);
    const starts = [...new Set(p.tracks.flatMap(t => t.arrangement.map(pl => pl.start)))];
    for (const s of starts) expect(s % 32).toBe(0);
  });

  it('ogni traccia è un Instrument Rack con otto macro con il nome; l\'acido ha anche il suo rack di effetti', () => {
    const p = build();
    for (const name of NAMES) {
      const racks = p.racksOf(track(p, name).id);
      expect(racks[0].devices[0], name).toBe('instrument');
      expect(racks[0].macros.every(m => m.name && m.mappings.length), name).toBe(true);
    }
    expect(p.racksOf(track(p, 'Acido').id)).toHaveLength(2);
    expect(p.racksOf(MASTER)[0].name).toBe('Macchina');
  });

  it('la cassa suona solo casse: otto corpi accordati sulla quinta (Sol), gli strati spenti finché le macro non li alzano', () => {
    const p = build();
    const kick = track(p, 'Cassa');
    for (const [i, b] of RAVE_PARTS.BODIES.entries()) {
      expect(kick.instrument.samples?.[`p${i + 1}`]).toBeDefined();
      expect(kick.instrument.params[padParam(i, 'tune')], b.name).toBe(b.tune);
    }
    const sounds = new Set(Object.values(kick.instrument.samples ?? {}).map(id => p.sample(id)!.name));
    for (const s of sounds) expect(['ancora', 'corpus', 'secca', 'martello', 'distorta', 'industriale', 'gabber', 'boom', 'ferro', 'click', 'rimbombo']).toContain(s);
    // Ferro e Click a 0: gli strati a −36 dB
    expect(kick.instrument.params[padParam(8, 'level')]).toBe(-36);
    expect(kick.instrument.params[padParam(9, 'level')]).toBe(-36);
    // ogni colpo del corpo suona anche gli strati
    const dritta = kick.slots[RAVE_LIVE.scenes.findIndex(s => s.name === 'Macchina')] as MidiClip;
    const body = dritta.notes.filter(n => n.pitch === padNote(0)).length;
    expect(dritta.notes.filter(n => n.pitch === padNote(8))).toHaveLength(body);
  });

  it('il basso, il sampler e i lunghi pompano con la cassa (sidechain)', () => {
    const p = build();
    const kick = track(p, 'Cassa').id;
    for (const name of ['Levare', 'Sampler', 'Lunghi']) {
      const comp = track(p, name).effects.find(e => e.type === 'compressor');
      expect(comp?.sidechain, name).toBe(kick);
    }
  });

  it('le clip "Seq" accendono il sequencer e tengono solo la tonica (o il giro); le scritte no', () => {
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

  it('l\'acido e il basso stanno in Do frigio con il tritono (le note di brehho23)', () => {
    const p = build();
    const SCALE = new Set([0, 1, 3, 5, 6, 7, 8, 10]); // Do Reb Mib Fa Fa# Sol Lab Sib
    for (const name of ['Acido', 'Levare']) {
      for (const c of track(p, name).clips as MidiClip[]) {
        for (const n of c.notes) expect(SCALE.has(n.pitch % 12), `${name} ${c.name} ${n.pitch}`).toBe(true);
      }
    }
  });

  it('i sampler: zone su tasti diversi, banchi di otto, nessuna nota lunga oltre la fine della clip', () => {
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
          // un suono lungo tenuto oltre la fine verrebbe tagliato senza il suo rilascio
          if (name === 'Lunghi') expect(n.start + n.duration, `${name} ${c.name}`).toBeLessThanOrEqual(c.region.end + 1e-9);
        }
      }
    }
    expect(Object.values(RAVE_PARTS.PERC_BANKS).map(b => b.length)).toEqual([8, 8, 8, 8]);
  });

  it('salite, rulli e impatti suonano una volta; i bordoni sono in loop con le dissolvenze', () => {
    const p = build();
    const once = (name: string, clip: string) => (track(p, name).clips as MidiClip[]).find(c => c.name === clip)!;
    for (const [t, c] of [['Lunghi', 'Salita 8'], ['Lunghi', 'Impatto'], ['Cassa', 'Rullo'], ['Colpi', 'Salita'], ['Rottura', 'Tensione']]) {
      expect(once(t, c).loop.enabled, `${t} ${c}`).toBe(false);
    }
    // la salita finisce sull'ultimo battito della clip
    const rise = once('Lunghi', 'Salita 8');
    expect(Math.max(...rise.notes.map(n => n.start + n.duration))).toBeCloseTo(rise.region.end, 6);
    const long = track(p, 'Lunghi');
    const drone = RAVE_PARTS.LONG_ZONES.findIndex(z => z.sound === 'halfIntro');
    expect(long.instrument.params[zoneParam(drone, 'own')]).toBe(1);
    expect(long.instrument.params[zoneParam(drone, 'loop')]).toBe(1);
  });

  it('i tasti: i pulsanti del master su Q W E R T, la rullata su A', () => {
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

  it('le clip stanno nel giro e gli effetti modulati esistono; si salva e si riapre uguale', () => {
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
