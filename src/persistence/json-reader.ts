export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** File di progetto non valido; `path` indica dove (es. "tracks[2].arrangement[0].start"). */
export class ProjectFormatError extends Error {
  constructor(readonly path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ProjectFormatError';
  }
}

/** Lettura validata di un valore JSON: ogni accesso controlla il tipo e, se sbaglia,
 *  lancia un errore con il percorso del campo. */
export class JsonReader {
  constructor(private readonly value: unknown, readonly path = '') {}

  static parse(text: string): JsonReader {
    try {
      return new JsonReader(JSON.parse(text));
    } catch (e) {
      throw new ProjectFormatError('', `JSON non valido (${e instanceof Error ? e.message : e})`);
    }
  }

  get raw(): unknown {
    return this.value;
  }

  fail(message: string): never {
    throw new ProjectFormatError(this.path, message);
  }

  has(key: string): boolean {
    return this.isObject() && key in (this.value as object) && (this.value as Record<string, unknown>)[key] !== undefined;
  }

  get(key: string): JsonReader {
    if (!this.isObject()) this.fail('atteso un oggetto');
    return new JsonReader((this.value as Record<string, unknown>)[key], this.path ? `${this.path}.${key}` : key);
  }

  num(key: string): number {
    return this.expect(key, isNumber, 'atteso un numero');
  }

  int(key: string): number {
    return this.expect(key, (v): v is number => isNumber(v) && Number.isInteger(v), 'atteso un intero');
  }

  str(key: string): string {
    return this.expect(key, (v): v is string => typeof v === 'string', 'attesa una stringa');
  }

  bool(key: string): boolean {
    return this.expect(key, (v): v is boolean => typeof v === 'boolean', 'atteso vero/falso');
  }

  /** Uno dei valori ammessi. */
  oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    return this.expect(key, (v): v is T => allowed.includes(v as T), `atteso uno tra ${allowed.join(', ')}`);
  }

  array(key: string): JsonReader[] {
    const r = this.get(key);
    return r.expectSelf(Array.isArray, 'atteso un elenco').map((v, i) => new JsonReader(v, `${r.path}[${i}]`));
  }

  /** Elenco di numeri lungo `length` (es. [secondi, battito]). */
  tuple(length: number): number[] {
    return this.expectSelf((v): v is number[] => Array.isArray(v) && v.length === length && v.every(isNumber),
      `attesi ${length} numeri`);
  }

  numbers(key: string): number[] {
    return this.array(key).map(r => r.asNumber());
  }

  /** null oppure il valore letto da `read`. */
  nullable<T>(key: string, read: (r: JsonReader) => T): T | null {
    const r = this.get(key);
    return r.value === null || r.value === undefined ? null : read(r);
  }

  asNumber(): number {
    return this.expectSelf(isNumber, 'atteso un numero');
  }

  private expect<T>(key: string, guard: (v: unknown) => v is T, message: string): T {
    return this.get(key).expectSelf(guard, message);
  }

  private expectSelf<T>(guard: (v: unknown) => v is T, message: string): T {
    if (!guard(this.value)) this.fail(message);
    return this.value as T;
  }

  private isObject(): boolean {
    return typeof this.value === 'object' && this.value !== null && !Array.isArray(this.value);
  }
}
