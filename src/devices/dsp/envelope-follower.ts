/* Un inseguitore d'inviluppo: quanto è forte il suono adesso (il picco, 0..1 e oltre), con un
 * attacco e un rilascio. Muove un parametro con il suono: il filtro dell'Auto Filter che si
 * apre sui colpi. Puro: niente Web Audio. */

export class EnvelopeFollower {
  value = 0;
  private attack = 1;
  private release = 1;

  constructor(private readonly sampleRate: number) {}

  /** Attacco e rilascio in secondi (il tempo per fare circa due terzi della strada). */
  set(attack: number, release: number): void {
    this.attack = 1 - Math.exp(-1 / (Math.max(1e-5, attack) * this.sampleRate));
    this.release = 1 - Math.exp(-1 / (Math.max(1e-5, release) * this.sampleRate));
  }

  /** Il livello dopo il campione `x` (per lo stereo: il più forte dei due canali). */
  process(x: number): number {
    const a = Math.abs(x), v = this.value;
    const next = v + (a > v ? this.attack : this.release) * (a - v);
    return (this.value = next < 1e-12 ? 0 : next);
  }
}
