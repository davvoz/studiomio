import type { Seconds } from '../../core/music-time';
import type { AudioClip } from '../../model/audio-clip';
import type { WarpMarkers } from '../../model/warp-markers';
import type { Pointer } from '../timeline/gestures';
import {
  frameCursor, frameGestureFor, frameHit, IdleGesture, moved, PanGesture, snappedBeat,
  type ClipGesture, type ClipHost, type FrameHit,
} from './clip-frame';
import { shiftAudioUnderMarker } from './clip-geometry';
import { LAYOUT } from './editor-painter';

/** Ciò che i gesti usano dell'editor audio. */
export interface EditorHost extends ClipHost<AudioClip> {
  /** La clip com'è adesso nel progetto (null se l'editor è chiuso). */
  clip(): AudioClip | null;
  /** Durata del sample in secondi. */
  duration(): Seconds;
  transients(): readonly Seconds[];
  selectMarker(index: number): void;
}

export type EditorGesture = ClipGesture<AudioClip>;

export type EditorHit =
  | FrameHit
  | { readonly kind: 'marker'; readonly index: number }
  | { readonly kind: 'transient'; readonly t: Seconds }
  | { readonly kind: 'strip' }
  | { readonly kind: 'wave' };

const MARKER_PX = 7, TRANSIENT_PX = 6;

/** Cosa c'è sotto il puntatore nell'editor. */
export function editorHit(host: EditorHost, clip: AudioClip, x: number, y: number): EditorHit {
  const { axis } = host;
  const frame = frameHit(axis, clip, x, y);
  if (frame) return frame;
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
      : base.withMarkerBeat(index, snappedBeat(host, p, beat));
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

/** Quale gesto inizia premendo su ciascuna cosa. */
export const editorGestureFor: { readonly [K in EditorHit['kind']]: (host: EditorHost, clip: AudioClip, hit: Extract<EditorHit, { kind: K }>, p: Pointer) => EditorGesture } = {
  ...frameGestureFor,
  marker: (h, c, hit, p) => new MarkerGesture(h, c.warp.markers, hit.index, p),
  transient: (h, c, hit, p) => {
    // il marker nasce sul transiente e si trascina subito
    const { markers, index } = c.warp.markers.withMarkerAt(hit.t);
    return new MarkerGesture(h, markers, index, p, markers !== c.warp.markers);
  },
  strip: () => new IdleGesture<AudioClip>(),
  wave: (h, _c, _hit, p) => new PanGesture(h, p),
};

export const editorCursor: { readonly [K in EditorHit['kind']]: (hit: Extract<EditorHit, { kind: K }>) => string } = {
  ...frameCursor,
  marker: () => 'ew-resize',
  transient: () => 'copy',
  strip: () => 'default',
  wave: () => 'grab',
};
