/* The processors' safety net. A non-finite sample (NaN, infinity) coming out of an engine
 * doesn't stop there: the filters, compressors and reverbs after it keep it in their
 * memory forever, all the way to the master, and the whole project goes silent. That's why every processor
 * checks its block: if it's broken it zeroes it and restarts the engine. Pure: it's also tested in
 * Node. */

/** True if the buffer has a non-finite sample (x − x is 0 only for finite numbers). */
export function hasInvalid(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) if (buf[i] - buf[i] !== 0) return true;
  return false;
}

/** `buf` if it's healthy, otherwise its copy in `spare` with zero in place of the non-finite samples. */
export function cleaned(buf: Float32Array, spare: Float32Array): Float32Array {
  if (!hasInvalid(buf)) return buf;
  for (let i = 0; i < buf.length; i++) spare[i] = buf[i] - buf[i] === 0 ? buf[i] : 0;
  return spare.subarray(0, buf.length);
}

/** When to restart a broken engine: right away the first time, then at most once every
 *  `pause` seconds (an engine breaking continuously stays silent meanwhile, instead of being recreated
 *  at every block); each restart is reported. */
export class FaultGate {
  private next = -Infinity;

  constructor(private readonly pause = 1) {}

  /** True if at second `now` it can restart. */
  restart(now: number): boolean {
    if (now < this.next) return false;
    this.next = now + this.pause;
    return true;
  }
}
