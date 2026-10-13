/* Come si muove un misuratore sullo schermo: scala dei dB e "balistica" (il picco scende
 * piano, il valore massimo resta fermo un attimo, il clip resta acceso finché non lo si
 * azzera). Funzioni pure e una classe senza DOM, così si provano nei test. */
import type { MeterReading } from '../../engine/meters';

/** Sotto questo livello il misuratore è vuoto. */
export const FLOOR_DB = -70;
/** Velocità di discesa del picco, in dB al secondo. */
const FALL_DB_PER_S = 24;
/** Per quanto il segno del massimo resta fermo prima di riunirsi al picco, in secondi. */
const HOLD_S = 1.5;

export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** La scala dei misuratori (simile alla IEC 60268-18 delle DAW): più spazio vicino allo 0,
 *  poco per i livelli molto bassi. Coppie (dB, posizione 0..1), +6 dB in cima. */
const SCALE: readonly (readonly [db: number, pos: number])[] = [
  [FLOOR_DB, 0], [-60, 0.04], [-50, 0.09], [-40, 0.17], [-30, 0.28], [-20, 0.43],
  [-12, 0.58], [-6, 0.71], [0, 0.86], [6, 1],
];

/** Posizione (0 in basso, 1 in cima) di un livello in dB. */
export function meterPosition(db: number): number {
  if (!(db > FLOOR_DB)) return 0;
  for (let i = 1; i < SCALE.length; i++) {
    const [d1, p1] = SCALE[i];
    if (db <= d1) {
      const [d0, p0] = SCALE[i - 1];
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
    }
  }
  return 1;
}

/** Lo stato mostrato di un misuratore stereo, aggiornato a ogni fotogramma. */
export class Ballistics {
  readonly peak = [FLOOR_DB, FLOOR_DB];
  readonly rms = [FLOOR_DB, FLOOR_DB];
  readonly hold = [FLOOR_DB, FLOOR_DB];
  private readonly holdAge = [0, 0];
  /** Il picco più alto dall'ultimo azzeramento (il numero del master). */
  max = FLOOR_DB;
  /** Il segnale ha toccato 0 dBFS dall'ultimo azzeramento. */
  clip = false;

  update(r: MeterReading, dt: number): void {
    const fall = FALL_DB_PER_S * dt;
    for (const c of [0, 1]) {
      const p = Math.max(FLOOR_DB, gainToDb(r.peak[c]));
      this.peak[c] = Math.max(p, this.peak[c] - fall);
      this.rms[c] = Math.max(FLOOR_DB, gainToDb(r.rms[c]));
      if (p >= this.hold[c]) {
        this.hold[c] = p;
        this.holdAge[c] = 0;
      } else if ((this.holdAge[c] += dt) > HOLD_S) this.hold[c] = this.peak[c]; // finita l'attesa, segue il picco
      this.max = Math.max(this.max, p);
      if (r.peak[c] >= 1) this.clip = true;
    }
  }

  /** Vero se non c'è niente da mostrare (tutto a fondo scala). */
  get idle(): boolean {
    return [...this.peak, ...this.rms, ...this.hold].every(v => v <= FLOOR_DB);
  }

  resetClip(): void {
    this.clip = false;
    this.max = FLOOR_DB;
  }
}
