/** White noise in −1..1 (xorshift32): fast, allocation-free and repeatable from the seed,
 *  so tests always give the same sound. */
export class Noise {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    // the seed as 32 bits (next() works on them); 0 would stay 0 forever
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return x / 0x80000000;
  }
}
