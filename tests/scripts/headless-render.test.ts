import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import { addEffect, addMidiClip, addTrack, setMasterMixer, setMixer, updateClip } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { decodeWav, renderProject } from '../../scripts/headless-render';

interface WavSpec {
  channels: number;
  rate: number;
  bits: number;
  frames: number;
  format?: number;
  extensible?: boolean;
  write: (v: DataView, offset: number, frame: number, channel: number) => void;
}

/** Builds a WAV file in memory: `write` stores each sample. */
function wav(spec: WavSpec): Uint8Array {
  const { channels, rate, bits, frames } = spec, bps = bits / 8;
  const fmtSize = spec.extensible ? 40 : 16, dataSize = frames * channels * bps;
  const bytes = new Uint8Array(12 + 8 + fmtSize + 8 + dataSize);
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => { bytes[at + i] = ch.codePointAt(0)!; });
  tag(0, 'RIFF');
  v.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, fmtSize, true);
  v.setUint16(20, spec.extensible ? 0xfffe : (spec.format ?? 1), true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint16(34, bits, true);
  if (spec.extensible) v.setUint16(44, spec.format ?? 1, true);
  const dataAt = 20 + fmtSize;
  tag(dataAt, 'data');
  v.setUint32(dataAt + 4, dataSize, true);
  let o = dataAt + 8;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++, o += bps) spec.write(v, o, i, c);
  return bytes;
}

describe('decodeWav', () => {
  it('reads 16-bit PCM stereo', () => {
    const out = decodeWav(wav({ channels: 2, rate: 44100, bits: 16, frames: 2, write: (v, o, i, c) => v.setInt16(o, (c ? -1 : 1) * (i ? 16384 : 32767), true) }));
    expect(out.sampleRate).toBe(44100);
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0][0]).toBeCloseTo(32767 / 32768, 6);
    expect(out.channels[1][1]).toBeCloseTo(-0.5, 6);
  });

  it('reads 8-bit, 24-bit and 32-bit integer PCM', () => {
    const w8 = decodeWav(wav({ channels: 1, rate: 8000, bits: 8, frames: 2, write: (v, o, i) => v.setUint8(o, i ? 192 : 0) }));
    expect([...w8.channels[0]]).toEqual([-1, 0.5]);
    const w24 = decodeWav(wav({ channels: 1, rate: 8000, bits: 24, frames: 2, write: (v, o, i) => {
      const x = i ? -4194304 : 4194304; // ±0.5
      v.setUint8(o, x & 255);
      v.setUint8(o + 1, (x >> 8) & 255);
      v.setUint8(o + 2, (x >> 16) & 255);
    } }));
    expect([...w24.channels[0]]).toEqual([0.5, -0.5]);
    const w32 = decodeWav(wav({ channels: 1, rate: 8000, bits: 32, frames: 2, write: (v, o, i) => v.setInt32(o, i ? -1073741824 : 1073741824, true) }));
    expect([...w32.channels[0]]).toEqual([0.5, -0.5]);
  });

  it('reads float 32 and 64, also when the format sits in the extensible subtype', () => {
    const f32 = decodeWav(wav({ channels: 1, rate: 48000, bits: 32, format: 3, frames: 2, write: (v, o, i) => v.setFloat32(o, i ? -0.25 : 0.75, true) }));
    expect([...f32.channels[0]]).toEqual([0.75, -0.25]);
    const f64 = decodeWav(wav({ channels: 1, rate: 48000, bits: 64, format: 3, frames: 2, extensible: true, write: (v, o, i) => v.setFloat64(o, i ? -0.25 : 0.75, true) }));
    expect([...f64.channels[0]]).toEqual([0.75, -0.25]);
  });

  it('keeps at most two channels of a multichannel file', () => {
    const out = decodeWav(wav({ channels: 3, rate: 8000, bits: 16, frames: 2, write: (v, o, _i, c) => v.setInt16(o, (c + 1) * 8192, true) }));
    expect(out.channels).toHaveLength(2);
    expect(out.channels[1][0]).toBeCloseTo(0.5, 6);
  });

  it('rejects what is not a WAV and a WAV without data', () => {
    expect(() => decodeWav(new Uint8Array(16))).toThrow('not a WAV');
    const noData = wav({ channels: 1, rate: 8000, bits: 16, frames: 0, write: () => undefined }).slice(0, 36);
    expect(() => decodeWav(noData)).toThrow('no audio data');
  });
});

const RATE = 8000;
type Setup = (store: ProjectStore, t: (i: number) => TrackId) => void;

/** Two MIDI tracks, the first with a 2-beat clip; `setupFn` edits the rest. */
function project(setupFn: Setup): Project {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('Render', ids, 4), ids);
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  store.apply(addMidiClip(t(0), 0, 2));
  setupFn(store, t);
  return store.project;
}

const withNote: Setup = (store, t) => {
  const pl = store.project.tracks[0].arrangement[0];
  store.apply(updateClip<MidiClip>('note', t(0), pl.id, c => c.addingNotes({ pitch: 60, start: 0, duration: 1, velocity: 100 })));
};

const peak = (a: Float32Array, from = 0, to = a.length) => a.subarray(from, to).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const render = (p: Project, opts: { stems?: boolean; tail?: number; onProgress?: (f: number) => void } = {}) =>
  renderProject(p, new Map(), { sampleRate: RATE, tail: 0.1, ...opts });

describe('renderProject', () => {
  it('renders a note into sound, in whole blocks, with the requested tail', () => {
    const out = render(project(withNote), { tail: 0.5 });
    // 2 beats at 120 BPM = 1 s, plus the tail, in blocks of 128 frames
    expect(out.left).toHaveLength(Math.ceil(1.5 * RATE / 128) * 128);
    expect(out.right).toHaveLength(out.left.length);
    expect(out.sampleRate).toBe(RATE);
    expect(peak(out.left)).toBeGreaterThan(0.001);
    expect(out.stems.size).toBe(0);
  });

  it('an empty clip renders silence', () => {
    const out = render(project(() => undefined));
    expect(peak(out.left)).toBe(0);
    expect(peak(out.right)).toBe(0);
  });

  it('gives a stem per MIDI track and reports progress', () => {
    const p = project(withNote);
    const progress: number[] = [];
    const out = render(p, { stems: true, onProgress: f => progress.push(f) });
    expect([...out.stems.keys()]).toEqual(p.tracks.map(t => t.name));
    const [first, second] = [...out.stems.values()];
    expect(peak(first.l)).toBeGreaterThan(0.001);
    expect(peak(second.l)).toBe(0);
    expect(progress[0]).toBe(0);
  });

  it('the master mute silences the mix, a track mute its own stem', () => {
    const master = render(project((s, t) => { withNote(s, t); s.apply(setMasterMixer({ mute: true })); }));
    expect(peak(master.left)).toBe(0);
    const track = render(project((s, t) => { withNote(s, t); s.apply(setMixer(t(0), { mute: true })); }), { stems: true });
    expect(peak(track.left)).toBe(0);
    expect(peak([...track.stems.values()][0].l)).toBe(0);
  });

  it('the fader lowers the level and the pan moves it to one side', () => {
    const base = render(project(withNote));
    const quiet = render(project((s, t) => { withNote(s, t); s.apply(setMixer(t(0), { volumeDb: -20 })); }));
    expect(peak(quiet.left)).toBeLessThan(peak(base.left) * 0.2);
    const left = render(project((s, t) => { withNote(s, t); s.apply(setMixer(t(0), { pan: -1 })); }));
    expect(peak(left.right)).toBeLessThan(peak(left.left) * 0.2);
    const right = render(project((s, t) => { withNote(s, t); s.apply(setMixer(t(0), { pan: 1 })); }));
    expect(peak(right.left)).toBeLessThan(peak(right.right) * 0.2);
  });

  it('a volume curve at zero silences the clip; pan, instrument and clip curves are accepted', () => {
    const curves: Setup = (store, t) => {
      withNote(store, t);
      const pl = store.project.tracks[0].arrangement[0];
      store.apply(updateClip<MidiClip>('mod', t(0), pl.id, c => c
        .withEnvelope({ kind: 'mixer', param: 'volume' }, [{ beat: 0, value: 0 }, { beat: 2, value: 0 }])
        .withEnvelope({ kind: 'mixer', param: 'pan' }, [{ beat: 0, value: 0.5 }, { beat: 2, value: 0.5 }])
        .withEnvelope({ kind: 'device', device: INSTRUMENT_DEVICE, param: 'cutoff' }, [{ beat: 0, value: 0 }, { beat: 1, value: 0.5 }])
        .withEnvelope({ kind: 'clip', param: 'transpose' }, [{ beat: 0, value: 1 }])));
    };
    expect(peak(render(project(curves)).left, 0, RATE)).toBeLessThan(1e-6);
  });

  it('runs a track effect chain and the master chain, ignoring a curve on a missing device', () => {
    const p = project((s, t) => {
      withNote(s, t);
      s.apply(addEffect(t(0), 'delay', 'Delay'));
      s.apply(addEffect('master', 'limiter', 'Limiter'));
      const pl = s.project.tracks[0].arrangement[0];
      s.apply(updateClip<MidiClip>('mod', t(0), pl.id, c => c
        .withEnvelope({ kind: 'device', device: 'nope' as never, param: 'x' }, [{ beat: 0, value: 0.5 }])));
    });
    expect(peak(render(p, { tail: 0.5 }).left)).toBeGreaterThan(0.001);
  });
});
