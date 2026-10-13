/* Lo spettro di un effetto che suona: due AnalyserNode (FFT nativa del browser) collegati
 * ai punti d'ascolto dell'effetto, prima e dopo. Se l'effetto viene ricreato (catena
 * ricostruita) il collegamento si rifà da solo alla lettura successiva. */
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
      // l'effetto vecchio può essere già stato smontato (e scollegato da tutto)
      try { (old.pre as AudioNode).disconnect(this.pre); } catch { /* già scollegato */ }
      try { (old.post as AudioNode).disconnect(this.post); } catch { /* già scollegato */ }
    }
    this.monitor = m;
    if (m) {
      (m.pre as AudioNode).connect(this.pre);
      (m.post as AudioNode).connect(this.post);
    }
  }
}
