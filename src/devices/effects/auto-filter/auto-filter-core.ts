/* The Auto Filter's sound: drive → multimode filter, one filter per channel. The cutoff is
 * computed in octaves: the knob, plus the LFO (locked to the bar, the right channel offset
 * by "Stereo"), plus the input's envelope (or the key's, with the sidechain). It's recomputed
 * every few samples and glides smoothly, so even the square wave and transport jumps don't
 * click. Runs in the AudioWorklet; no Web Audio here. */
import { dbToGain, type EffectCore, type KeyedEffect, type TransportFollower, type TransportPosition } from '../../dsp/core';
import { EnvelopeFollower } from '../../dsp/envelope-follower';
import { LfoClock, lfoAt, type LfoRate } from '../../dsp/lfo';
import { MultimodeFilter } from '../../dsp/multimode-filter';
import { TEMPO_RATES } from '../../rates';
import { AUTO_FILTER_SYNC, ENV_OCTAVES, LFO_OCTAVES } from './auto-filter';

/** Every how many samples the cutoff is recomputed. */
const CONTROL_RATE = 8;
/** How long the cutoff takes to settle on a new value, in seconds. */
const SMOOTH = 0.002;
const MIN_CUTOFF = 20;

export class AutoFilterCore implements EffectCore, TransportFollower, KeyedEffect {
  private readonly filters: [MultimodeFilter, MultimodeFilter];
  private readonly lfo: LfoClock;
  private readonly env: EnvelopeFollower;
  private readonly smoothK: number;
  /** The cutoff of each channel in octaves (log2 Hz), the one heard and the target one. */
  private readonly octaves = [0, 0];
  private fresh = true;
  private countdown = 0;
  private transport: TransportPosition | null = null;
  private bpm = 120;
  private keyL: Float32Array | null = null;
  private keyR: Float32Array | null = null;

  private type = 0;
  private poles: 2 | 4 = 2;
  private freqOctaves = Math.log2(2000);
  private resonance = 0.2;
  private drive = 1;
  private driveNorm = 1;
  private rate: LfoRate = { beats: 1, hz: 1 };
  private lfoAmount = 0;
  private lfoShape = 0;
  private lfoPhase = 0;
  private lfoStereo = 0;
  private envAmount = 0;
  private mix = 1;
  private output = 1;

  constructor(private readonly sampleRate: number) {
    this.filters = [new MultimodeFilter(sampleRate), new MultimodeFilter(sampleRate)];
    this.lfo = new LfoClock(sampleRate);
    this.env = new EnvelopeFollower(sampleRate);
    this.smoothK = 1 - Math.exp(-CONTROL_RATE / (SMOOTH * sampleRate));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.type = v('type', 0);
    this.poles = v('slope', 0) === 1 ? 4 : 2;
    this.freqOctaves = Math.log2(Math.max(MIN_CUTOFF, v('freq', 2000)));
    this.resonance = v('resonance', 20) / 100;
    this.drive = dbToGain(v('drive', 0));
    this.driveNorm = this.drive > 1 ? 1 / Math.tanh(this.drive) : 1;
    const beats = (TEMPO_RATES[v('lfoDivision', 6)] ?? TEMPO_RATES[6])[1];
    this.rate = { beats: v('lfoSync', AUTO_FILTER_SYNC.tempo) === AUTO_FILTER_SYNC.tempo ? beats : null, hz: v('lfoRate', 1) };
    this.lfoAmount = (v('lfoAmount', 0) / 100) * LFO_OCTAVES;
    this.lfoShape = v('lfoShape', 0);
    this.lfoPhase = v('lfoPhase', 0) / 360;
    this.lfoStereo = v('lfoStereo', 0) / 360;
    this.envAmount = (v('envAmount', 0) / 100) * ENV_OCTAVES;
    this.env.set(v('envAttack', 6) / 1000, v('envRelease', 200) / 1000);
    this.mix = v('mix', 100) / 100;
    this.output = dbToGain(v('output', 0));
    // type, slope and resonance apply right away, even if the cutoff is gliding
    this.countdown = 0;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  setKey(left: Float32Array | null, right: Float32Array | null): void {
    this.keyL = left;
    this.keyR = right;
  }

  /** A channel's current cutoff, in Hz (for tests and for drawing it). */
  cutoff(channel: 0 | 1): number {
    return Math.pow(2, this.octaves[channel]);
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { filters: [fl, fr], lfo, env, octaves } = this;
    const keyL = this.keyL ?? inL, keyR = this.keyR ?? inR;
    const maxOct = Math.log2(this.sampleRate * 0.45), minOct = Math.log2(MIN_CUTOFF);
    const drive = this.drive, norm = this.driveNorm, driven = drive > 1;
    const wet = this.mix * this.output, dry = (1 - this.mix) * this.output;
    lfo.start(this.rate, this.transport, this.bpm);
    for (let i = 0; i < n; i++) {
      const e = env.process(Math.max(Math.abs(keyL[i]), Math.abs(keyR[i])));
      if (--this.countdown <= 0) {
        this.countdown = CONTROL_RATE;
        const base = this.freqOctaves + this.envAmount * e;
        for (let c = 0; c < 2; c++) {
          const wave = lfoAt(this.lfoShape, lfo.cycles + this.lfoPhase + c * this.lfoStereo);
          const target = Math.max(minOct, Math.min(maxOct, base + this.lfoAmount * wave));
          octaves[c] = this.fresh ? target : octaves[c] + (target - octaves[c]) * this.smoothK;
        }
        this.fresh = false;
        fl.set(Math.pow(2, octaves[0]), this.resonance, this.type, this.poles);
        fr.set(Math.pow(2, octaves[1]), this.resonance, this.type, this.poles);
      }
      lfo.next();
      const xL = inL[i], xR = inR[i];
      const yL = fl.process(driven ? Math.tanh(xL * drive) * norm : xL);
      const yR = fr.process(driven ? Math.tanh(xR * drive) * norm : xR);
      outL[i] = xL * dry + yL * wet;
      outR[i] = xR * dry + yR * wet;
    }
  }
}
