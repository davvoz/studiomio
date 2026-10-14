/* Il mix della timeline calcolato in Node, senza browser: gli stessi motori DSP dell'AudioWorklet
 * (strumenti, effetti, modulazioni a blocchi di 128 campioni), la stessa lettura della timeline
 * (tratti delle clip, note tagliate alla fine del tratto) e lo stesso canale del mixer di
 * mixer-graph.ts (effetti → volume → modulazione del volume al quadrato → pan stereo di Web
 * Audio). Serve a misurare un progetto (loudness, spettro, picchi) mentre lo si costruisce;
 * può dare anche le tracce separate (stem). */
import { resolveParams } from '../src/devices/device-type';
import { dbToGain, playsSamples, type EffectCore, type InstrumentCore, type SampleData } from '../src/devices/dsp/core';
import type { NumberParam } from '../src/devices/params';
import { paramsOf } from '../src/devices/device-type';
import { effectType, instrumentType } from '../src/devices/registry';
import { EFFECT_CORES, INSTRUMENT_CORES } from '../src/devices/worklet/cores';
import { EffectRunner } from '../src/devices/worklet/effect-runner';
import { ParamModulation } from '../src/devices/worklet/mod-timeline';
import { NoteQueue } from '../src/devices/worklet/note-queue';
import { placementSegments } from '../src/engine/segments';
import { envelopeValueAt, scaleOf, type ClipEnvelope } from '../src/model/envelope';
import type { EffectSettings } from '../src/model/device';
import type { MidiClip } from '../src/model/midi-clip';
import { audibleTracks } from '../src/engine/mixer-graph';
import type { Project } from '../src/model/project';
import type { MidiTrack } from '../src/model/track';
import type { SampleId } from '../src/core/id';

const BLOCK = 128;

/** Un WAV (PCM 8/16/24/32 o float 32/64, anche "extensible") in canali float. */
export function decodeWav(bytes: Uint8Array): SampleData {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('non è un WAV');
  let channels = 0, sampleRate = 0, bits = 0, format = 1;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), size = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      format = v.getUint16(at + 8, true);
      channels = v.getUint16(at + 10, true);
      sampleRate = v.getUint32(at + 12, true);
      bits = v.getUint16(at + 22, true);
      // WAVE_FORMAT_EXTENSIBLE: il formato vero è nel sottotipo
      if (format === 0xfffe && size >= 26) format = v.getUint16(at + 32, true);
    } else if (id === 'data') {
      const bps = bits / 8, frames = Math.floor(Math.min(size, bytes.length - at - 8) / (channels * bps));
      const out = Array.from({ length: Math.min(2, channels) }, () => new Float32Array(frames));
      const read: (o: number) => number =
        format === 3 ? (bits === 64 ? o => v.getFloat64(o, true) : o => v.getFloat32(o, true))
        : bits === 8 ? o => (v.getUint8(o) - 128) / 128
        : bits === 16 ? o => v.getInt16(o, true) / 32768
        : bits === 24 ? o => ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16))) / 8388608
        : o => v.getInt32(o, true) / 2147483648;
      let o = at + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++, o += bps) if (c < out.length) out[c][i] = read(o);
      }
      return { sampleRate, channels: out };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('nessun dato audio');
}

const numberSpecs = (t: ReturnType<typeof effectType>): Map<string, NumberParam> =>
  new Map((t ? paramsOf(t) : []).flatMap(p => (p.kind === 'number' ? [[p.id, p] as const] : [])));

/** Una catena di effetti come nell'AudioWorklet: un motore, le sue modulazioni, il bypass. */
class Chain {
  readonly fx: { id: string; core: EffectCore; runner: EffectRunner; mod: ParamModulation }[];
  private readonly tmpL = new Float32Array(BLOCK);
  private readonly tmpR = new Float32Array(BLOCK);

  constructor(effects: readonly EffectSettings[], bpm: number, sampleRate: number) {
    this.fx = effects.flatMap(e => {
      const factory = EFFECT_CORES[e.type], type = effectType(e.type);
      if (!factory || !type) return [];
      const params = resolveParams(type, e.params), core = factory(sampleRate);
      core.setTempo(bpm);
      core.setParams(params);
      return [{ id: e.id, core, runner: new EffectRunner(core, sampleRate, e.enabled), mod: new ParamModulation(numberSpecs(type), params) }];
    });
  }

  process(l: Float32Array, r: Float32Array, time: number): void {
    for (const f of this.fx) {
      const p = f.mod.paramsAt(time);
      if (p) f.core.setParams(p);
      f.runner.process(l, r, this.tmpL, this.tmpR);
      l.set(this.tmpL);
      r.set(this.tmpR);
    }
  }
}

/** Le curve di una traccia come eventi nel tempo: i parametri dei dispositivi come li riceve
 *  l'AudioWorklet (scalino all'inizio del tratto, rampe ai punti, neutro alla fine), volume e
 *  pan come funzioni del tempo per il canale. */
interface MixerCurves {
  volume: { start: number; end: number; at: (t: number) => number }[];
  pan: { start: number; end: number; at: (t: number) => number }[];
}

class TrackRender {
  readonly core: InstrumentCore;
  readonly queue = new NoteQueue();
  readonly instMod: ParamModulation;
  readonly chain: Chain;
  readonly curves: MixerCurves = { volume: [], pan: [] };
  readonly fader: number;
  readonly pan: number;
  readonly l = new Float32Array(BLOCK);
  readonly r = new Float32Array(BLOCK);

  constructor(readonly track: MidiTrack, project: Project, samples: ReadonlyMap<SampleId, SampleData>, readonly sampleRate: number, readonly audible: boolean) {
    const bpm = project.tempo.bpm, spb = 60 / bpm;
    const it = instrumentType(track.instrument.type);
    const params = it ? resolveParams(it, track.instrument.params) : {};
    this.core = INSTRUMENT_CORES[track.instrument.type](sampleRate);
    this.core.setTempo?.(bpm);
    if (playsSamples(this.core)) {
      for (const [slot, id] of Object.entries(track.instrument.samples ?? {})) this.core.setSample(slot, samples.get(id) ?? null);
    }
    this.core.setParams(params);
    this.instMod = new ParamModulation(numberSpecs(it), params);
    this.chain = new Chain(track.effects, bpm, sampleRate);
    this.fader = dbToGain(track.mixer.volumeDb);
    this.pan = track.mixer.pan;

    for (const p of track.arrangement) {
      const clip = p.clip as unknown as MidiClip;
      for (const seg of placementSegments(p)) {
        const startSec = seg.start * spb, endSec = seg.end * spb;
        const c0 = seg.contentStart, c1 = seg.contentStart + (seg.end - seg.start);
        for (const n of clip.notesIn(c0, c1)) {
          const at = seg.start + (n.start - c0);
          const on = at * spb, off = Math.min(at + n.duration, seg.end) * spb;
          this.queue.add(n.pitch, n.velocity, Math.round(on * sampleRate), Math.round(off * sampleRate));
        }
        for (const env of clip.envelopes) this.addEnvelope(env, seg.start, c0, c1, startSec, endSec, spb);
      }
    }
  }

  private addEnvelope(env: ClipEnvelope, segStart: number, c0: number, c1: number, startSec: number, endSec: number, spb: number): void {
    if (!env.points.length) return;
    const time = (c: number) => (segStart + (c - c0)) * spb;
    const t = env.target;
    if (t.kind === 'mixer') {
      const at = (sec: number) => envelopeValueAt(env.points, c0 + sec / spb - segStart);
      this.curves[t.param].push({ start: startSec, end: endSec, at });
      return;
    }
    const sink = t.device === 'instrument' ? this.instMod : this.chain.fx.find(f => f.id === t.device)?.mod;
    if (!sink) return;
    sink.event(t.param, 'set', envelopeValueAt(env.points, c0), time(c0));
    for (const p of env.points) if (p.beat > c0 && p.beat < c1) sink.event(t.param, 'ramp', p.value, time(p.beat));
    sink.event(t.param, 'ramp', envelopeValueAt(env.points, c1), time(c1));
    sink.event(t.param, 'set', scaleOf(t).neutral, time(c1));
  }

  /** Il blocco che inizia al campione `frame`, sommato nei bus. */
  render(frame: number, busL: Float32Array, busR: Float32Array, stem?: { l: Float32Array; r: Float32Array }): void {
    const { l, r, sampleRate } = this;
    l.fill(0);
    r.fill(0);
    const time = frame / sampleRate;
    const p = this.instMod.paramsAt(time);
    if (p) this.core.setParams(p);
    this.queue.renderBlock(this.core, l, r, frame);
    this.chain.process(l, r, time);
    if (!this.audible) return;
    for (let i = 0; i < BLOCK; i++) {
      const t = (frame + i) / sampleRate;
      let g = this.fader, pan = this.pan;
      for (const c of this.curves.volume) if (t >= c.start && t < c.end) { const v = c.at(t); g *= v * v; break; }
      for (const c of this.curves.pan) if (t >= c.start && t < c.end) { pan += c.at(t); break; }
      pan = Math.max(-1, Math.min(1, pan));
      // StereoPannerNode con ingresso stereo
      const x = (pan <= 0 ? pan + 1 : pan) * Math.PI / 2, gl = Math.cos(x), gr = Math.sin(x);
      const inL = l[i] * g, inR = r[i] * g;
      const outL = pan <= 0 ? inL + inR * gl : inL * gl, outR = pan <= 0 ? inR * gr : inR + inL * gr;
      busL[i] += outL;
      busR[i] += outR;
      if (stem) {
        stem.l[frame + i] = outL;
        stem.r[frame + i] = outR;
      }
    }
  }
}

export interface RenderResult {
  readonly sampleRate: number;
  readonly left: Float32Array;
  readonly right: Float32Array;
  /** Le tracce separate (dopo volume e pan, prima del master), se chieste. */
  readonly stems: ReadonlyMap<string, { l: Float32Array; r: Float32Array }>;
}

/** Il mix della timeline da `from` a `to` battiti (predefinito: tutta), più `tail` secondi di code. */
export function renderProject(
  project: Project, samples: ReadonlyMap<SampleId, SampleData>,
  opts: { sampleRate?: number; stems?: boolean; tail?: number; onProgress?: (fraction: number) => void } = {},
): RenderResult {
  const sampleRate = opts.sampleRate ?? 48000;
  const spb = 60 / project.tempo.bpm;
  const endBeats = Math.max(...project.tracks.map(t => t.arrangementEnd));
  const frames = Math.ceil((endBeats * spb + (opts.tail ?? 2)) * sampleRate / BLOCK) * BLOCK;
  const audible = audibleTracks(project.tracks);
  const tracks = project.tracks.filter(t => 'instrument' in t)
    .map(t => new TrackRender(t as MidiTrack, project, samples, sampleRate, audible.has(t.id)));
  const master = new Chain(project.masterEffects, project.tempo.bpm, sampleRate);
  const masterGain = project.master.mute ? 0 : dbToGain(project.master.volumeDb);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const stems = new Map<string, { l: Float32Array; r: Float32Array }>();
  if (opts.stems) for (const t of tracks) stems.set(t.track.name, { l: new Float32Array(frames), r: new Float32Array(frames) });
  const busL = new Float32Array(BLOCK), busR = new Float32Array(BLOCK);
  for (let frame = 0; frame < frames; frame += BLOCK) {
    busL.fill(0);
    busR.fill(0);
    for (const t of tracks) t.render(frame, busL, busR, stems.get(t.track.name));
    master.process(busL, busR, frame / sampleRate);
    for (let i = 0; i < BLOCK; i++) {
      left[frame + i] = busL[i] * masterGain;
      right[frame + i] = busR[i] * masterGain;
    }
    if (opts.onProgress && frame % (BLOCK * 4096) === 0) opts.onProgress(frame / frames);
  }
  return { sampleRate, left, right, stems };
}
