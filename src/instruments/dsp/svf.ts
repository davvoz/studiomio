/** Uscite del filtro, nell'ordine dei tipi (Low-pass, Band-pass, High-pass). */
const OUTPUTS: readonly ((low: number, band: number, high: number) => number)[] = [
  l => l, (_l, b) => b, (_l, _b, h) => h,
];

/** Filtro a variabili di stato (topologia TPT di Zavalishin e Simper): stabile anche con il
 *  cutoff che cambia di continuo, dà passa-basso, passa-banda e passa-alto insieme. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = 2;
  private output = OUTPUTS[0];

  constructor(private readonly sampleRate: number) {}

  /** `resonance` 0..1 (vicino a 1 quasi autooscilla), `type` indice in OUTPUTS. */
  set(cutoff: number, resonance: number, type: number): void {
    const fc = Math.max(10, Math.min(cutoff, this.sampleRate * 0.45));
    const g = Math.tan((Math.PI * fc) / this.sampleRate);
    this.k = 2 - 1.96 * Math.max(0, Math.min(1, resonance));
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    this.output = OUTPUTS[type] ?? OUTPUTS[0];
  }

  process(v0: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return this.output(v2, v1, v0 - this.k * v1 - v2);
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}
