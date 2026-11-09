/* The spectrum of a playing effect: two AnalyserNodes (the browser's native FFT) connected
 * to the effect's listening points, before and after. If the effect is recreated (chain
 * rebuilt) the connection is redone by itself at the next read. */
import type { EffectMonitor } from '../engine/effect-chain';
import type { SpectrumTap } from '../ui/device/displays';

const FFT_SIZE = 8192;

export class EffectSpectrum implements SpectrumTap {
  readonly sampleRate: number;
  readonly binCount = FFT_SIZE / 2;
  private readonly pre: AnalyserNode;
  private readonly post: AnalyserNode;
  private monitor: EffectMonitor | null = null;

  constructor(ctx: BaseAudioContext, private readonly find: () => EffectMonitor | null) {
    this.sampleRate = ctx.sampleRate;
    const analyser = () => new AnalyserNode(ctx, { fftSize: FFT_SIZE, smoothingTimeConstant: 0.75, minDecibels: -140, maxDecibels: 0 });
    this.pre = analyser();
    this.post = analyser();
  }

  read(pre: Float32Array<ArrayBuffer>, post: Float32Array<ArrayBuffer>): boolean {
    const m = this.find();
    if (m !== this.monitor) this.attach(m);
    if (!m) return false;
    this.pre.getFloatFrequencyData(pre);
    this.post.getFloatFrequencyData(post);
    return true;
  }

  dispose(): void {
    this.attach(null);
  }

  private attach(m: EffectMonitor | null): void {
    const old = this.monitor;
    if (old) {
      // the old effect may already have been torn down (and disconnected from everything)
      try { (old.pre as AudioNode).disconnect(this.pre); } catch { /* already disconnected */ }
      try { (old.post as AudioNode).disconnect(this.post); } catch { /* already disconnected */ }
    }
    this.monitor = m;
    if (m) {
      (m.pre as AudioNode).connect(this.pre);
      (m.post as AudioNode).connect(this.post);
    }
  }
}
