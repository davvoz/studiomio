/* What the mouse does on the timeline, without the DOM: the gesture and the cursor for what's
 * under the pointer, the pan, where a dropped file falls, the clip a double click creates. */
import type { TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { Project } from '../../model/project';
import { LOOP_CURSOR, loopPartAt, type BeatRange } from '../loop-drag';
import { snapTo, type ClipZone, type Hit, type TimelineGeometry } from './geometry';
import {
  FadeGesture, MarqueeGesture, MoveClipsGesture, ResizeClipGesture, type Gesture, type GestureHost, type Pointer,
} from './gestures';
import type { RulerZone } from './painters';

type HitKey = `clip:${ClipZone}` | 'lane' | 'empty';
const keyOf = (h: Hit): HitKey => (h.kind === 'clip' ? `clip:${h.zone}` : h.kind);
type ClipHit = Extract<Hit, { kind: 'clip' }>;

/** Which gesture starts by pressing on each thing. */
const GESTURES: Readonly<Record<HitKey, (host: GestureHost, hit: Hit, p: Pointer) => Gesture>> = {
  'clip:body': (h, hit, p) => new MoveClipsGesture(h, hit as ClipHit, p),
  'clip:start': (h, hit) => new ResizeClipGesture(h, hit as ClipHit),
  'clip:end': (h, hit) => new ResizeClipGesture(h, hit as ClipHit),
  'clip:fadeIn': (h, hit) => new FadeGesture(h, hit as ClipHit),
  'clip:fadeOut': (h, hit) => new FadeGesture(h, hit as ClipHit),
  lane: (h, _hit, p) => new MarqueeGesture(h, p),
  empty: (h, _hit, p) => new MarqueeGesture(h, p),
};

const HOVER_CURSORS: Readonly<Record<HitKey, string>> = {
  'clip:body': 'grab', 'clip:start': 'ew-resize', 'clip:end': 'ew-resize', 'clip:fadeIn': 'col-resize', 'clip:fadeOut': 'col-resize',
  lane: 'default', empty: 'default',
};

/** The gesture pressing on `hit` starts: move, resize or fade a clip, or select a range. */
export const gestureFor = (host: GestureHost, hit: Hit, p: Pointer): Gesture => GESTURES[keyOf(hit)](host, hit, p);

/** The cursor over `hit`. */
export const hoverCursor = (hit: Hit): string => HOVER_CURSORS[keyOf(hit)];

/** The ruler's cursor: zoom over the numbers, text over the scrub strip, the loop's edges elsewhere. */
export function rulerCursor(zone: RulerZone, loop: BeatRange, x: number, beatToX: (b: Beats) => number): string {
  if (zone === 'numbers') return 'zoom-in';
  if (zone === 'scrub') return 'text';
  return LOOP_CURSOR[loopPartAt(loop, x, beatToX)];
}

/** The mouse buttons, as the view reads them. */
export interface Press {
  readonly button: number;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

/** The middle button, or Ctrl+Alt with the left one as in Live (no middle button on a touchpad), moves the view. */
export const isPan = (e: Press): boolean => e.button === 1 || (e.button === 0 && e.ctrl && e.alt);

/** Where something dropped at (x, y) of the lanes falls: the track underneath (null below the
 *  tracks) and the beat, on the grid `step`. */
export function dropPlace(p: Project, g: TimelineGeometry, step: Beats, x: number, y: number): { track: TrackId | null; beat: Beats } {
  const track = p.visibleTracks[g.trackIndexAt(y)];
  return { track: track?.id ?? null, beat: Math.max(0, snapTo(g.xToBeat(x), step)) };
}

/** Double click on an empty MIDI lane: the one-bar clip it creates there (null elsewhere). */
export function newClipAt(p: Project, hit: Hit): { track: TrackId; start: Beats; length: Beats } | null {
  if (hit.kind !== 'lane' || p.track(hit.track)?.kind !== 'midi') return null;
  const bar = p.signature.beatsPerBar;
  return { track: hit.track, start: Math.floor(hit.beat / bar) * bar, length: bar };
}
