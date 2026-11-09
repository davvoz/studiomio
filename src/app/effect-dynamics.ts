/* What a playing dynamics effect is doing, for its panel: the processor reports it about 30
 * times a second while someone is looking. If the effect is recreated (chain rebuilt) it
 * reattaches by itself at the next read. */
import type { EffectMonitor } from '../engine/effect-chain';
import type { DynamicsReading, DynamicsTap } from '../ui/device/displays';

export class EffectDynamics implements DynamicsTap {
  private monitor: EffectMonitor | null = null;
  private latest: DynamicsReading | null = null;

  constructor(private readonly find: () => EffectMonitor | null) {}

  read(): DynamicsReading | null {
    const m = this.find();
    if (m !== this.monitor) this.attach(m);
    const reading = this.latest;
    this.latest = null;
    return reading;
  }

  dispose(): void {
    this.attach(null);
  }

  private attach(m: EffectMonitor | null): void {
    this.monitor?.watch?.(null);
    this.monitor = m;
    m?.watch?.((input, reduction) => { this.latest = { input, reduction }; });
  }
}
