/* The tape of the effects that play with time (Tape Stop, Reverse, and tomorrow Scratch and
 * Vinyl): a circular buffer always recording the input and a head reading it back wherever
 * and at whatever speed you like (slower, stopped, backwards). The positions are absolute
 * samples: 0 is the first recorded sample, `written − 1` the last, i.e. the sound of now.
 * When the head jumps, the old reading continues for a few milliseconds and fades into the
 * new one: no clicks. Pure: no Web Audio. */

export class TapeBuffer {
  private left: Float32Array;
  private right: Float32Array;
  /** How many samples have been recorded. */
  written = 0;

  constructor(frames: number) {
    this.left = new Float32Array(Math.max(16, Math.ceil(frames)));
    this.right = new Float32Array(this.left.length);
  }

  get size(): number {
    return this.left.length;
  }

  /** Makes room for at least `frames` samples of past, keeping the ones there. */
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

  /** The sound at position `pos` (also between two samples: Hermite interpolation) into
   *  out[0] and out[1]. Before the start, or further back than the tape remembers, it's silence. */
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
    // neighbours outside the tape count as the nearest sample there is
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

/** A head on the tape. `jump` moves it elsewhere with a fade: the previous reading continues on
 *  its way and dies out in `fade` samples, while the new one rises (at constant power). */
export class TapeReader {
  /** Where it reads now. */
  pos = 0;
  private oldPos = 0;
  private oldStep = 0;
  private left = 0;
  private length = 1;
  private readonly tmp = new Float32Array(2);

  constructor(private readonly fade: number) {}

  /** It's still fading from a jump. */
  get fading(): boolean {
    return this.left > 0;
  }

  /** Jumps to `pos`; the old reading keeps going at `oldStep` samples per sample and
   *  dies out in `fade` samples. */
  jump(pos: number, oldStep: number, fade = this.fade): void {
    this.oldPos = this.pos;
    this.oldStep = oldStep;
    this.left = this.length = Math.max(1, fade);
    this.pos = pos;
  }

  /** Reads into out[0..1] where it is (with the fade, if any), then advances by `step`. */
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
