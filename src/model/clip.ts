import type { ClipId } from '../core/id';
import type { Beats } from '../core/music-time';
import { sameTarget, withEnvelope, type ClipEnvelope, type EnvelopePoint, type ModTarget } from './envelope';

/** Colour in hexadecimal, "#rrggbb". */
export type Color = string;

/** Part of the clip that plays, in clip beats. */
export interface ClipRegion {
  readonly start: Beats;
  readonly end: Beats;
}

/** With the loop active the clip plays from `region.start` up to `end`, then repeats [start, end). */
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
  /** The modulations (clip envelopes); if missing, none. */
  readonly envelopes?: readonly ClipEnvelope[];
}

const NO_ENVELOPES: readonly ClipEnvelope[] = [];

/** Properties common to a clip, whatever the content (audio, MIDI notes, …).
 *  Immutable: the `with…` methods return a copy. Each clip kind extends this
 *  class with its content and declares its `kind`. */
export abstract class Clip<P extends ClipProps = ClipProps> {
  abstract readonly kind: string;
  protected readonly props: P;

  protected constructor(props: P) {
    Clip.validate(props);
    this.props = props;
  }

  /** Creates an instance of the same kind with other properties. */
  protected abstract create(props: P): this;

  protected with(patch: Partial<P>): this {
    return this.create({ ...this.props, ...patch });
  }

  get id(): ClipId { return this.props.id; }
  get name(): string { return this.props.name; }
  get color(): Color { return this.props.color; }
  get region(): ClipRegion { return this.props.region; }
  get loop(): ClipLoop { return this.props.loop; }
  get envelopes(): readonly ClipEnvelope[] { return this.props.envelopes ?? NO_ENVELOPES; }

  /** A target's modulation, if the clip has it. */
  envelope(target: ModTarget): ClipEnvelope | undefined {
    return this.envelopes.find(e => sameTarget(e.target, target));
  }

  withId(id: ClipId): this { return this.with({ id } as Partial<P>); }
  withName(name: string): this { return this.with({ name } as Partial<P>); }
  withColor(color: Color): this { return this.with({ color } as Partial<P>); }
  withRegion(region: ClipRegion): this { return this.with({ region } as Partial<P>); }
  withLoop(loop: ClipLoop): this { return this.with({ loop } as Partial<P>); }
  withEnvelopes(envelopes: readonly ClipEnvelope[]): this { return this.with({ envelopes } as Partial<P>); }
  /** The target's modulation with these points (without points the modulation disappears). */
  withEnvelope(target: ModTarget, points: readonly EnvelopePoint[]): this {
    return this.withEnvelopes(withEnvelope(this.envelopes, target, points));
  }

  /** Length of a playback from the start; Infinity if the clip is looping. */
  get playLength(): Beats {
    return this.loop.enabled ? Infinity : this.region.end - this.region.start;
  }

  /** The clip beat playing `elapsed` beats after the start, or null if it has already ended. */
  contentBeatAt(elapsed: Beats): Beats | null {
    if (elapsed < 0) return null;
    const pos = this.region.start + elapsed;
    if (!this.loop.enabled) return pos < this.region.end ? pos : null;
    if (pos < this.loop.end) return pos;
    const len = this.loop.end - this.loop.start;
    return this.loop.start + ((pos - this.loop.start) % len);
  }

  private static validate({ region, loop }: ClipProps): void {
    if (!(region.end > region.start)) throw new RangeError(`empty clip region: ${region.start}–${region.end}`);
    if (!(loop.end > loop.start)) throw new RangeError(`empty clip loop: ${loop.start}–${loop.end}`);
    if (loop.enabled && region.start >= loop.end) throw new RangeError('the clip starts after the end of the loop');
  }
}

/** Initial region and loop covering all of [start, end). */
export const fullRange = (start: Beats, end: Beats, loop = false): Pick<ClipProps, 'region' | 'loop'> => ({
  region: { start, end },
  loop: { enabled: loop, start, end },
});
