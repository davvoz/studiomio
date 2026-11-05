/* Cosa fa un effetto di dinamica che suona, per il suo pannello: il processore lo dice circa 30
 * volte al secondo finché qualcuno guarda. Se l'effetto viene ricreato (catena ricostruita) ci si
 * riattacca da soli alla lettura successiva. */
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
