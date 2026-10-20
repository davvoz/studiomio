/* Un filtro risonante da performance: passa-basso, passa-alto, passa-banda o notch, a 12 dB
 * (uno stadio a variabili di stato, TPT) o 24 dB per ottava (due in fila, con i Q di un
 * Butterworth del quarto ordine così senza risonanza resta piatto). La risonanza alza il Q
 * dell'ultimo stadio fino quasi all'autooscillazione. Stabile con il cutoff che si muove di
 * continuo: va bene per LFO e inviluppi. Puro: niente Web Audio. */

export const FILTER_TYPES = ['Low-pass', 'High-pass', 'Band-pass', 'Notch'] as const;
export const FILTER_TYPE = { lowPass: 0, highPass: 1, bandPass: 2, notch: 3 } as const;
export const FILTER_SLOPES = ['12 dB', '24 dB'] as const;

/** I Q degli stadi senza risonanza: un Butterworth (12 dB) e i due di un Butterworth a 4 poli (24 dB). */
const FLAT_Q_12 = Math.SQRT1_2;
const FLAT_Q_24 = [0.5412, 1.3066] as const;
/** Il Q più alto, con la risonanza al massimo. */
const MAX_Q = 25;

/** Le uscite di uno stadio, per tipo: dagli stati del filtro (v1 banda, v2 basso) e dall'ingresso. */
const OUTPUTS: readonly ((v0: number, v1: number, v2: number, k: number) => number)[] = [
  (_v0, _v1, v2) => v2,
  (v0, v1, v2, k) => v0 - k * v1 - v2,
  (_v0, v1, _v2, k) => k * v1, // guadagno 1 al centro
  (v0, v1, _v2, k) => v0 - k * v1,
];

class Stage {
  private ic1 = 0;
  private ic2 = 0;

  tick(v0: number, a1: number, a2: number, a3: number, k: number, out: number): number {
    const v3 = v0 - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (Math.abs(this.ic1) < 1e-20) this.ic1 = 0;
    if (Math.abs(this.ic2) < 1e-20) this.ic2 = 0;
    return OUTPUTS[out](v0, v1, v2, k);
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

export class MultimodeFilter {
  private readonly stages = [new Stage(), new Stage()];
  private type: number = FILTER_TYPE.lowPass;
  private poles = 2;
  private readonly k = [Math.SQRT2, Math.SQRT2];
  private readonly a1 = [1, 1];
  private readonly a2 = [0, 0];
  private readonly a3 = [0, 0];

  constructor(private readonly sampleRate: number) {}

  /** `resonance` 0..1; `type` indice in FILTER_TYPES; `poles` 2 (12 dB) o 4 (24 dB). */
  set(cutoff: number, resonance: number, type: number, poles: 2 | 4): void {
    const fc = Math.max(10, Math.min(cutoff, this.sampleRate * 0.45));
    const g = Math.tan((Math.PI * fc) / this.sampleRate);
    const r = Math.max(0, Math.min(1, resonance));
    if (poles !== this.poles) this.stages[1].reset();
    this.type = Math.max(0, Math.min(FILTER_TYPES.length - 1, Math.round(type)));
    this.poles = poles;
    const flat = poles === 4 ? FLAT_Q_24 : [FLAT_Q_12];
    for (let s = 0; s < flat.length; s++) {
      // la risonanza alza solo l'ultimo stadio, in modo esponenziale (si sente uniforme)
      const q = s === flat.length - 1 ? flat[s] * Math.pow(MAX_Q / flat[s], r * r) : flat[s];
      const k = 1 / q;
      this.k[s] = k;
      this.a1[s] = 1 / (1 + g * (g + k));
      this.a2[s] = g * this.a1[s];
      this.a3[s] = g * this.a2[s];
    }
  }

  process(x: number): number {
    const t = this.type;
    let y = this.stages[0].tick(x, this.a1[0], this.a2[0], this.a3[0], this.k[0], t);
    if (this.poles === 4) y = this.stages[1].tick(y, this.a1[1], this.a2[1], this.a3[1], this.k[1], t);
    return y;
  }

  reset(): void {
    for (const s of this.stages) s.reset();
  }
}
