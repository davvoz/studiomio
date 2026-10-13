import type { ClipId } from '../core/id';
import type { Beats } from '../core/music-time';

/** Colore in esadecimale, "#rrggbb". */
export type Color = string;

/** Parte della clip che suona, in battiti della clip. */
export interface ClipRegion {
  readonly start: Beats;
  readonly end: Beats;
}

/** Con il loop attivo la clip suona da `region.start` fino a `end`, poi ripete [start, end). */
export interface ClipLoop {
  readonly enabled: boolean;
  readonly start: Beats;
  readonly end: Beats;
}

export interface ClipProps {
  readonly id: ClipId;
  readonly name: string;
  readonly color: Color;
  readonly region: ClipRegion;
  readonly loop: ClipLoop;
}

/** Proprietà comuni di una clip, qualunque sia il contenuto (audio, note MIDI, …).
 *  Immutabile: i metodi `with…` restituiscono una copia. Ogni tipo di clip estende questa
 *  classe con il suo contenuto e dichiara il suo `kind`. */
export abstract class Clip<P extends ClipProps = ClipProps> {
  abstract readonly kind: string;
  protected readonly props: P;

  protected constructor(props: P) {
    Clip.validate(props);
    this.props = props;
  }

  /** Crea un'istanza dello stesso tipo con altre proprietà. */
  protected abstract create(props: P): this;

  protected with(patch: Partial<P>): this {
    return this.create({ ...this.props, ...patch });
  }

  get id(): ClipId { return this.props.id; }
  get name(): string { return this.props.name; }
  get color(): Color { return this.props.color; }
  get region(): ClipRegion { return this.props.region; }
  get loop(): ClipLoop { return this.props.loop; }

  withId(id: ClipId): this { return this.with({ id } as Partial<P>); }
  withName(name: string): this { return this.with({ name } as Partial<P>); }
  withColor(color: Color): this { return this.with({ color } as Partial<P>); }
  withRegion(region: ClipRegion): this { return this.with({ region } as Partial<P>); }
  withLoop(loop: ClipLoop): this { return this.with({ loop } as Partial<P>); }

  /** Durata di una riproduzione dall'inizio; Infinity se la clip è in loop. */
  get playLength(): Beats {
    return this.loop.enabled ? Infinity : this.region.end - this.region.start;
  }

  /** Battito della clip che suona `elapsed` battiti dopo l'inizio, o null se è già finita. */
  contentBeatAt(elapsed: Beats): Beats | null {
    if (elapsed < 0) return null;
    const pos = this.region.start + elapsed;
    if (!this.loop.enabled) return pos < this.region.end ? pos : null;
    if (pos < this.loop.end) return pos;
    const len = this.loop.end - this.loop.start;
    return this.loop.start + ((pos - this.loop.start) % len);
  }

  private static validate({ region, loop }: ClipProps): void {
    if (!(region.end > region.start)) throw new RangeError(`regione della clip vuota: ${region.start}–${region.end}`);
    if (!(loop.end > loop.start)) throw new RangeError(`loop della clip vuoto: ${loop.start}–${loop.end}`);
    if (loop.enabled && region.start >= loop.end) throw new RangeError('la clip parte dopo la fine del loop');
  }
}

/** Regione e loop iniziali che coprono tutto [start, end). */
export const fullRange = (start: Beats, end: Beats, loop = false): Pick<ClipProps, 'region' | 'loop'> => ({
  region: { start, end },
  loop: { enabled: loop, start, end },
});
