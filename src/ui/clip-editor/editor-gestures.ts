import type { Beats, Seconds } from '../../core/music-time';
import type { AudioClip } from '../../model/audio-clip';
import type { WarpMarkers } from '../../model/warp-markers';
import type { Pointer } from '../timeline/gestures';
import { snapTo } from '../timeline/geometry';
import { shiftAudioUnderMarker, withLoopSafe, withRegionSafe, type BeatAxis } from './clip-geometry';
import { dragLoop, LOOP_CURSOR, loopPartAt, type BeatRange, type LoopPart } from '../loop-drag';
import { LAYOUT } from './editor-painter';

/** Ciò che i gesti usano dell'editor. */
export interface EditorHost {
  readonly axis: BeatAxis;
  /** La clip com'è adesso nel progetto (null se l'editor è chiuso). */
  clip(): AudioClip | null;
  /** Durata del sample in secondi. */
  duration(): Seconds;
  transients(): readonly Seconds[];
  snapStep(p: Pointer): Beats | null;
  /** Applica una modifica alla clip (un passo di annullamento). */
  commit(label: string, fn: (c: AudioClip) => AudioClip): void;
  selectMarker(index: number): void;
  /** Sposta il cursore della timeline dove la clip suona il battito `content`. */
  seekContent(content: Beats): void;
  setAxis(axis: BeatAxis): void;
  invalidate(): void;
}

/** Un trascinamento nell'editor: `preview` mostra la clip come sarebbe al rilascio. */
export interface EditorGesture {
  readonly cursor: string;
  move(p: Pointer): void;
  end(p: Pointer): void;
  cancel(): void;
  preview(clip: AudioClip): AudioClip;
}

export type EditorHit =
  | { readonly kind: 'loop'; readonly part: LoopPart }
  | { readonly kind: 'flag'; readonly edge: 'start' | 'end' }
  | { readonly kind: 'ruler' }
  | { readonly kind: 'marker'; readonly index: number }
  | { readonly kind: 'transient'; readonly t: Seconds }
  | { readonly kind: 'strip' }
  | { readonly kind: 'wave' };

const MARKER_PX = 7, FLAG_PX = 8, TRANSIENT_PX = 6, CLICK_PX = 3;

/** Cosa c'è sotto il puntatore nell'editor. */
export function editorHit(host: EditorHost, clip: AudioClip, x: number, y: number): EditorHit {
  const { axis } = host;
  if (y < LAYOUT.loopBand) return { kind: 'loop', part: loopPartAt(clip.loop, x, b => axis.beatToX(b)) };
  if (y < LAYOUT.ruler) {
    if (Math.abs(axis.beatToX(clip.region.start) - x) < FLAG_PX && x >= axis.beatToX(clip.region.start) - 2) return { kind: 'flag', edge: 'start' };
    if (Math.abs(axis.beatToX(clip.region.end) - x) < FLAG_PX) return { kind: 'flag', edge: 'end' };
    return { kind: 'ruler' };
  }
  if (y >= LAYOUT.top) return { kind: 'wave' };
  if (!clip.warp.enabled) return { kind: 'strip' };
  const markers = clip.warp.markers.markers;
  let best = -1, bd = MARKER_PX;
  markers.forEach((m, i) => {
    const d = Math.abs(axis.beatToX(m.b) - x);
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0) return { kind: 'marker', index: best };
  // qui il warp è attivo: i transienti si collocano attraverso i marker
  let tr: Seconds | null = null, td = TRANSIENT_PX;
  for (const t of host.transients()) {
    const d = Math.abs(axis.beatToX(clip.warp.markers.beatOf(t)) - x);
    if (d < td) { td = d; tr = t; }
  }
  return tr !== null ? { kind: 'transient', t: tr } : { kind: 'strip' };
}

const moved = (a: Pointer, b: Pointer) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= CLICK_PX;
const snapped = (host: EditorHost, p: Pointer, b: Beats) => {
  const s = host.snapStep(p);
  return s ? snapTo(b, s) : b;
};

/** Trascinare un warp marker: cambia il battito su cui cade (l'audio si stira attorno).
 *  Con Maiusc invece l'audio scorre sotto il marker, che resta fermo sul suo battito. */
export class MarkerGesture implements EditorGesture {
  readonly cursor = 'ew-resize';
  private current: WarpMarkers;
  private dragged = false;

  constructor(
    private readonly host: EditorHost,
    private readonly base: WarpMarkers,
    private readonly index: number,
    private readonly origin: Pointer,
    /** Vero se il marker è appena stato creato da questo gesto (da un transiente). */
    private readonly created = false,
  ) {
    this.current = base;
    host.selectMarker(index);
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    const { host, base, index } = this;
    const beat = host.axis.xToBeat(p.x);
    this.current = this.origin.shift
      ? shiftAudioUnderMarker(base, index, host.axis.xToBeat(this.origin.x), beat, host.duration())
      : base.withMarkerBeat(index, snapped(host, p, beat));
    host.invalidate();
  }

  end(): void {
    if (!this.dragged && !this.created) return this.host.invalidate();
    const label = this.created && !this.dragged ? 'Aggiungi warp marker' : this.origin.shift ? 'Sposta audio sotto il marker' : 'Sposta warp marker';
    const markers = this.current;
    this.host.commit(label, c => c.withMarkers(markers));
  }

  cancel(): void {
    this.current = this.base;
    this.host.invalidate();
  }

  preview(clip: AudioClip): AudioClip {
    return this.current === clip.warp.markers ? clip : clip.withMarkers(this.current);
  }
}

/** Trascinare la bandierina di inizio o di fine della clip. */
export class FlagGesture implements EditorGesture {
  readonly cursor = 'ew-resize';
  private beat: Beats | null = null;

  constructor(private readonly host: EditorHost, private readonly edge: 'start' | 'end') {}

  move(p: Pointer): void {
    this.beat = snapped(this.host, p, this.host.axis.xToBeat(p.x));
    this.host.invalidate();
  }

  end(): void {
    if (this.beat === null) return;
    this.host.commit(this.edge === 'start' ? 'Inizio della clip' : 'Fine della clip', c => this.apply(c));
  }

  cancel(): void {
    this.beat = null;
    this.host.invalidate();
  }

  preview(clip: AudioClip): AudioClip {
    return this.beat === null ? clip : this.apply(clip);
  }

  private apply(c: AudioClip): AudioClip {
    const b = this.beat!;
    return this.edge === 'start' ? withRegionSafe(c, b, c.region.end) : withRegionSafe(c, c.region.start, b);
  }
}

/** Fascia del loop della clip: bordi, corpo e fuori come sul righello della timeline; un clic lo accende o spegne. */
export class LoopBandGesture implements EditorGesture {
  readonly cursor: string;
  private dragged = false;
  private range: BeatRange | null = null;
  private readonly anchor: Beats;

  constructor(private readonly host: EditorHost, private readonly original: BeatRange, private readonly part: LoopPart, private readonly origin: Pointer) {
    this.anchor = snapped(host, origin, host.axis.xToBeat(origin.x));
    this.cursor = part === 'body' ? 'grabbing' : LOOP_CURSOR[part];
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    this.range = dragLoop(this.part, this.original, this.anchor, snapped(this.host, p, this.host.axis.xToBeat(p.x))) ?? this.range;
    this.host.invalidate();
  }

  end(): void {
    const r = this.range;
    if (!this.dragged) return this.host.commit('Loop della clip', c => withLoopSafe(c, c.loop.start, c.loop.end, !c.loop.enabled));
    if (r) this.host.commit('Loop della clip', c => withLoopSafe(c, r.start, r.end));
  }

  cancel(): void {
    this.range = null;
    this.host.invalidate();
  }

  preview(clip: AudioClip): AudioClip {
    const r = this.range;
    return r ? withLoopSafe(clip, r.start, r.end) : clip;
  }
}

/** Sulla forma d'onda: trascinare sposta la vista, un clic porta lì il cursore della timeline. */
export class PanGesture implements EditorGesture {
  readonly cursor = 'grabbing';
  private dragged = false;
  private readonly start: BeatAxis;

  constructor(private readonly host: EditorHost, private readonly origin: Pointer) {
    this.start = host.axis;
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    this.host.setAxis(this.start.scrolled(this.start.startBeat - (p.x - this.origin.x) / this.start.pxPerBeat));
  }

  end(p: Pointer): void {
    if (!this.dragged) this.host.seekContent(this.host.axis.xToBeat(p.x));
  }

  cancel(): void { /* niente */ }

  preview(clip: AudioClip): AudioClip {
    return clip;
  }
}

/** Nessun effetto (striscia vuota): il doppio clic aggiunge un marker. */
export class IdleGesture implements EditorGesture {
  readonly cursor = 'default';
  move(): void { /* niente */ }
  end(): void { /* niente */ }
  cancel(): void { /* niente */ }
  preview(clip: AudioClip): AudioClip {
    return clip;
  }
}

/** Quale gesto inizia premendo su ciascuna cosa. */
export const editorGestureFor: { readonly [K in EditorHit['kind']]: (host: EditorHost, clip: AudioClip, hit: Extract<EditorHit, { kind: K }>, p: Pointer) => EditorGesture } = {
  loop: (h, c, hit, p) => new LoopBandGesture(h, c.loop, hit.part, p),
  flag: (h, _c, hit) => new FlagGesture(h, hit.edge),
  ruler: (h, _c, _hit, p) => new PanGesture(h, p),
  marker: (h, c, hit, p) => new MarkerGesture(h, c.warp.markers, hit.index, p),
  transient: (h, c, hit, p) => {
    // il marker nasce sul transiente e si trascina subito
    const { markers, index } = c.warp.markers.withMarkerAt(hit.t);
    return new MarkerGesture(h, markers, index, p, markers !== c.warp.markers);
  },
  strip: () => new IdleGesture(),
  wave: (h, _c, _hit, p) => new PanGesture(h, p),
};

export const editorCursor: { readonly [K in EditorHit['kind']]: (hit: Extract<EditorHit, { kind: K }>) => string } = {
  loop: hit => LOOP_CURSOR[hit.part],
  flag: () => 'ew-resize',
  ruler: () => 'pointer',
  marker: () => 'ew-resize',
  transient: () => 'copy',
  strip: () => 'default',
  wave: () => 'grab',
};
