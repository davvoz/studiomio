/* Un filtro a variabili di stato in topologia TPT (Zavalishin), leggero: passa-basso e
 * passa-alto dello stesso campione insieme. Due in fila con Q di Butterworth fanno un
 * Linkwitz-Riley (crossover: basse + alte = suono intero). Lo usano Drive e Multibanda. */

/** Un filtro a variabili di stato (TPT) che dà passa-basso e passa-alto insieme. */
export class Tpt {
  low = 0;
  high = 0;
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = Math.SQRT2;

  set(cutoff: number, q: number, sampleRate: number): void {
    const g = Math.tan((Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  tick(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.high = v0 - this.k * v1 - v2;
  }
}
