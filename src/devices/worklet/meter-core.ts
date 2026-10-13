/** Valori di un misuratore, in quest'ordine: picco sinistro e destro, media dei quadrati
 *  sinistra e destra. Lo scrive l'AudioWorklet, lo legge (e azzera i picchi) l'interfaccia. */
export const METER_VALUES = 4;

/** Costante di tempo della media dei quadrati, in secondi: l'RMS scende di circa 36 dB al secondo. */
const RMS_TIME = 0.12;

/** Misura un blocco alla volta: il picco si accumula in `out` finché chi legge non lo azzera,
 *  la media dei quadrati scorre con la costante RMS_TIME. */
export class MeterCore {
  private msL = 0;
  private msR = 0;

  constructor(private readonly sampleRate: number, private readonly out: Float32Array) {}

  process(left: Float32Array, right: Float32Array, n: number): void {
    let pl = 0, pr = 0, sl = 0, sr = 0;
    for (let i = 0; i < n; i++) {
      const l = left[i], r = right[i];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      sl += l * l;
      sr += r * r;
    }
    const d = Math.exp(-n / (RMS_TIME * this.sampleRate));
    this.msL = flush(this.msL * d + (sl / n) * (1 - d));
    this.msR = flush(this.msR * d + (sr / n) * (1 - d));
    const out = this.out;
    if (pl > out[0]) out[0] = pl;
    if (pr > out[1]) out[1] = pr;
    out[2] = this.msL;
    out[3] = this.msR;
  }
}

const flush = (x: number) => (x < 1e-30 ? 0 : x);
