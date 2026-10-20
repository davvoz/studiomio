/* Il nastro degli effetti che giocano con il tempo (Tape Stop, Reverse, e domani Scratch e
 * Vinyl): un buffer circolare che registra sempre l'ingresso e una testina che lo rilegge dove
 * e alla velocità che si vuole (più piano, ferma, all'indietro). Le posizioni sono campioni
 * assoluti: 0 è il primo campione registrato, `written − 1` l'ultimo, cioè il suono di adesso.
 * Quando la testina salta, la lettura vecchia continua per pochi millisecondi e sfuma in quella
 * nuova: niente click. Puro: niente Web Audio. */

export class TapeBuffer {
  private left: Float32Array;
  private right: Float32Array;
  /** Quanti campioni sono stati registrati. */
  written = 0;

  constructor(frames: number) {
    this.left = new Float32Array(Math.max(16, Math.ceil(frames)));
    this.right = new Float32Array(this.left.length);
  }

  get size(): number {
    return this.left.length;
  }

  /** Fa spazio ad almeno `frames` campioni di passato, tenendo quelli che ci sono. */
  ensure(frames: number): void {
    const need = Math.ceil(frames) + 8, size = this.size;
    if (need <= size) return;
    const grow = (old: Float32Array) => {
      const b = new Float32Array(need);
      const kept = Math.min(this.written, size);
      for (let k = this.written - kept; k < this.written; k++) b[k % need] = old[k % size];
      return b;
    };
    this.left = grow(this.left);
    this.right = grow(this.right);
  }

  write(l: number, r: number): void {
    const i = this.written % this.size;
    this.left[i] = l;
    this.right[i] = r;
    this.written++;
  }

  /** Il suono alla posizione `pos` (anche fra due campioni: interpolazione di Hermite) in
   *  out[0] e out[1]. Prima dell'inizio, o più indietro di quanto il nastro ricordi, è silenzio. */
  read(pos: number, out: Float32Array): void {
    const last = this.written - 1, first = this.written - this.size;
    const i = Math.floor(pos), t = pos - i;
    if (i < Math.max(0, first) || i > last) {
      out[0] = out[1] = 0;
      return;
    }
    if (t === 0) {
      const k = i % this.size;
      out[0] = this.left[k];
      out[1] = this.right[k];
      return;
    }
    // i vicini fuori dal nastro valgono come il campione più vicino che c'è
    const at = (j: number) => Math.max(Math.max(0, first), Math.min(last, j)) % this.size;
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    out[0] = hermite(this.left[a], this.left[b], this.left[c], this.left[d], t);
    out[1] = hermite(this.right[a], this.right[b], this.right[c], this.right[d], t);
  }
}

function hermite(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

const HALF_PI = Math.PI / 2;

/** Una testina sul nastro. `jump` la sposta altrove sfumando: la lettura di prima continua per
 *  la sua strada e si spegne in `fade` campioni, mentre quella nuova sale (a potenza costante). */
export class TapeReader {
  /** Dove legge adesso. */
  pos = 0;
  private oldPos = 0;
  private oldStep = 0;
  private left = 0;
  private length = 1;
  private readonly tmp = new Float32Array(2);

  constructor(private readonly fade: number) {}

  /** Sta ancora sfumando da un salto. */
  get fading(): boolean {
    return this.left > 0;
  }

  /** Salta a `pos`; la lettura vecchia continua ad andare di `oldStep` campioni per campione e
   *  si spegne in `fade` campioni. */
  jump(pos: number, oldStep: number, fade = this.fade): void {
    this.oldPos = this.pos;
    this.oldStep = oldStep;
    this.left = this.length = Math.max(1, fade);
    this.pos = pos;
  }

  /** Legge in out[0..1] dove si trova (con la sfumatura, se c'è), poi avanza di `step`. */
  read(tape: TapeBuffer, step: number, out: Float32Array): void {
    tape.read(this.pos, out);
    if (this.left > 0) {
      const a = this.left / this.length, tmp = this.tmp;
      tape.read(this.oldPos, tmp);
      const gOld = Math.sin(a * HALF_PI), gNew = Math.cos(a * HALF_PI);
      out[0] = out[0] * gNew + tmp[0] * gOld;
      out[1] = out[1] * gNew + tmp[1] * gOld;
      this.oldPos += this.oldStep;
      this.left--;
    }
    this.pos += step;
  }
}
