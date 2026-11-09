import type { PlacementId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { placementEnd } from '../../model/arrangement';
import { setFades, setLoopRegion } from '../../store/edits';
import type { TimeRange } from '../../model/note-edits';
import type { LoopRegion, Project } from '../../model/project';
import { edit } from '../../store/project-store';
import { dragLoop, LOOP_CURSOR, loopPartAt, type LoopPart } from '../loop-drag';
import type { ProjectStore } from '../../store/project-store';
import {
  addedPlacements, cutOutRange, findPlacement, relocate, resizeMany, type PlacementRef, type Relocation, type ResizePlan,
} from '../../store/selection-edits';
import type { UiState } from '../ui-state';
import { placementsInBox, snapTo, type Hit, type TimelineGeometry } from './geometry';
import { paintBox, paintGhost } from './painters';
import { planMove, planResizeMany, resolveSelection, snappedDelta } from './planning';

export interface Pointer {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
  /** Alt: no snapping to the grid. */
  readonly alt: boolean;
  /** Ctrl/Cmd: copy instead of move. */
  readonly ctrl: boolean;
}

/** What a gesture can use of the view. */
export interface GestureHost {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly geo: TimelineGeometry;
  /** Snap step for this pointer, or null if snapping is off. */
  snapStep(p: Pointer): Beats | null;
  seek(beat: Beats): void;
  invalidate(): void;
}

/** A drag in progress. The preview is drawn over the timeline; the project changes
 *  only on release, with a single change (a single undo step). */
export interface Gesture {
  readonly cursor: string;
  /** Clips not to draw in their place during the preview. */
  readonly hidden: ReadonlySet<PlacementId>;
  /** The project to draw in place of the real one during the preview (e.g. split clips). */
  readonly preview?: Project | null;
  move(p: Pointer): void;
  end(p: Pointer): void;
  cancel(): void;
  paint(g: CanvasRenderingContext2D, geo: TimelineGeometry): void;
}

const CLICK_PX = 3;
const NONE: ReadonlySet<PlacementId> = new Set();

const snapped = (host: GestureHost, p: Pointer, beat: Beats) => {
  const step = host.snapStep(p);
  return Math.max(0, step ? snapTo(beat, step) : beat);
};

/** Dragging clips: moves (or copies, with Ctrl) the whole selection, also onto other tracks.
 *  If the selected time range is grabbed, as in Live the clips are split at its edges and
 *  only that is moved: the split is visible right away, but enters the project only on release. */
export class MoveClipsGesture implements Gesture {
  readonly cursor = 'grabbing';
  private plan: Relocation[] = [];
  private moved = false;
  private copy = false;
  private readonly startBeat: Beats;
  private readonly base: Project;
  private readonly range: TimeRange | null;
  /** The project moved from (split, if a range is dragged) and the clips that move. */
  private source: Project;
  private refs: PlacementRef[] = [];
  private hiddenIds: ReadonlySet<PlacementId> = NONE;

  constructor(private readonly host: GestureHost, private readonly hit: Extract<Hit, { kind: 'clip' }>, private readonly origin: Pointer) {
    const { ui } = host;
    const id = hit.placement.id, r = ui.range;
    if (origin.shift) ui.toggle(id);
    // outside the selected range the whole clip is taken
    else if (!ui.selection.has(id) || (r && (hit.beat < r.start || hit.beat >= r.end))) ui.select([id]);
    this.range = ui.range;
    this.startBeat = host.geo.xToBeat(origin.x);
    this.base = this.source = host.store.project;
  }

  get hidden(): ReadonlySet<PlacementId> {
    return this.moved && !this.copy ? this.hiddenIds : NONE;
  }

  get preview(): Project | null {
    return this.moved && this.source !== this.base ? this.source : null;
  }

  move(p: Pointer): void {
    if (!this.moved && Math.abs(p.x - this.origin.x) + Math.abs(p.y - this.origin.y) < CLICK_PX) return;
    const { host, hit, range } = this;
    if (!this.moved) this.begin();
    this.moved = true;
    this.copy = p.ctrl;
    const grabbed = range ? Math.max(hit.placement.start, range.start) : hit.placement.start;
    const delta = snappedDelta(grabbed, host.geo.xToBeat(p.x) - this.startBeat, host.snapStep(p));
    const dTracks = host.geo.trackIndexAt(p.y) - hit.trackIndex;
    this.plan = planMove(this.source, this.refs, delta, dTracks, this.copy);
    host.invalidate();
  }

  end(): void {
    const { host, source } = this;
    // a click just selects: the cursor moves only from the ruler, playback isn't interrupted
    if (!this.moved) return;
    const changed = this.plan.some(m => m.copy || m.to !== m.track || m.start !== source.track(m.track)?.placement(m.id)?.start);
    // back at the starting point the range doesn't detach
    if (!changed || host.store.project !== this.base) return host.invalidate();
    const label = this.copy ? 'Copy clip' : 'Move clip';
    host.store.apply(edit(label, (_p, ctx) => relocate(label, this.plan).apply(source, ctx)));
    if (this.copy) host.ui.select(addedPlacements(source, host.store.project).map(r => r.id));
    else if (this.range) host.ui.select(this.refs.map(r => r.id));
  }

  cancel(): void {
    this.plan = [];
    this.moved = false;
    this.source = this.base;
    this.host.invalidate();
  }

  paint(g: CanvasRenderingContext2D, geo: TimelineGeometry): void {
    const project = this.source;
    const index = new Map(project.visibleTracks.map((t, i) => [t.id, i]));
    for (const m of this.plan) {
      const pl = project.track(m.track)?.placement(m.id);
      if (pl) paintGhost(g, geo, index.get(m.to)!, m.start, m.start + pl.length, pl.clip.color);
    }
  }

  /** At the start of the drag: the clips to move (the pieces of the range, if any). */
  private begin(): void {
    const { host, range } = this;
    const selected = resolveSelection(this.base, host.ui.selection);
    if (range) ({ project: this.source, pieces: this.refs } = cutOutRange(this.base, host.store.ids, selected, range));
    else this.refs = selected;
    this.hiddenIds = new Set(this.refs.map(r => r.id));
  }
}

/** Dragging an edge: shortens or lengthens the clip (on the left it also moves the start of the content).
 *  If the clip is in the selection all the selected clips are resized, as in Live. */
export class ResizeClipGesture implements Gesture {
  readonly cursor = 'ew-resize';
  readonly hidden: ReadonlySet<PlacementId>;
  private plan: ResizePlan[] = [];
  private readonly refs: PlacementRef[];
  private readonly base: Project;

  constructor(private readonly host: GestureHost, private readonly hit: Extract<Hit, { kind: 'clip' }>) {
    const { ui } = host, id = hit.placement.id;
    this.base = host.store.project;
    // the selected time range doesn't count: the whole clips are taken
    ui.select(ui.selection.has(id) ? ui.selection : [id]);
    this.refs = resolveSelection(this.base, ui.selection);
    this.hidden = new Set(this.refs.map(r => r.id));
  }

  move(p: Pointer): void {
    const { host, hit } = this;
    const beat = snapped(host, p, host.geo.xToBeat(p.x));
    const minLength = host.snapStep(p) ?? 1 / 16;
    this.plan = planResizeMany(this.base, this.refs, hit.placement, hit.zone as 'start' | 'end', beat, Math.min(minLength, 1));
    host.invalidate();
  }

  end(): void {
    const changed = this.plan.filter(r => {
      const pl = findPlacement(this.base, r)!;
      return r.start !== pl.start || r.end !== placementEnd(pl);
    });
    if (!changed.length) return this.host.invalidate();
    this.host.store.apply(resizeMany(changed));
  }

  cancel(): void {
    this.plan = [];
    this.host.invalidate();
  }

  paint(g: CanvasRenderingContext2D, geo: TimelineGeometry): void {
    const index = new Map(this.base.visibleTracks.map((t, i) => [t.id, i]));
    const edges = new Map(this.plan.map(r => [r.id, r]));
    for (const r of this.refs) {
      const pl = findPlacement(this.base, r), row = index.get(r.track);
      if (!pl || row === undefined) continue;
      const e = edges.get(r.id) ?? { start: pl.start, end: placementEnd(pl) };
      paintGhost(g, geo, row, e.start, e.end, pl.clip.color);
    }
  }
}

/** Dragging a handle at the top of an audio clip: the fade-in (on the left) or
 *  fade-out (on the right), free from the grid as in Live. It's heard right away; it stays a single undo
 *  step. */
export class FadeGesture implements Gesture {
  readonly cursor = 'col-resize';
  readonly hidden = NONE;
  private moved = false;

  constructor(private readonly host: GestureHost, private readonly hit: Extract<Hit, { kind: 'clip' }>) {
    host.ui.select([hit.placement.id]);
  }

  move(p: Pointer): void {
    const { host, hit } = this, pl = hit.placement;
    const beat = host.geo.xToBeat(p.x), len = pl.length;
    const clamp = (b: Beats, max: Beats) => Math.max(0, Math.min(max, b));
    const fades = hit.zone === 'fadeIn'
      ? { fadeIn: clamp(beat - pl.start, len - (pl.fadeOut ?? 0)) }
      : { fadeOut: clamp(placementEnd(pl) - beat, len - (pl.fadeIn ?? 0)) };
    this.moved = true;
    host.store.apply(setFades(hit.track, pl.id, fades), { mergeKey: 'fade-drag' });
  }

  end(): void {
    if (this.moved) this.host.store.endMerge();
  }

  cancel(): void {
    this.host.store.endMerge();
  }

  paint(): void { /* the fade is visible on the clip */ }
}

/** Dragging in empty space: box selection, with the edges on the grid. If the box takes
 *  the clips only partly, that time range stays selected (as in Live): dragging it
 *  detaches it from the clip. A click without dragging removes the selection (the cursor moves only from the ruler). */
export class MarqueeGesture implements Gesture {
  readonly cursor = 'crosshair';
  readonly hidden = NONE;
  private current: Pointer;

  constructor(private readonly host: GestureHost, private readonly origin: Pointer) {
    this.current = origin;
  }

  move(p: Pointer): void {
    this.current = p;
    if (this.dragged) this.selectBox();
  }

  end(p: Pointer): void {
    this.current = p;
    if (this.dragged) this.selectBox();
    else if (!p.shift) this.host.ui.select([]);
    this.host.invalidate();
  }

  cancel(): void {
    this.host.invalidate();
  }

  paint(g: CanvasRenderingContext2D, geo: TimelineGeometry): void {
    if (!this.dragged) return;
    const r = this.span();
    paintBox(g, geo.beatToX(r.start), this.origin.y, geo.beatToX(r.end), this.current.y);
  }

  private selectBox(): void {
    const { geo, store, ui } = this.host;
    const r = this.span();
    const refs = placementsInBox(store.project, r.start, r.end, geo.trackIndexAt(this.origin.y), geo.trackIndexAt(this.current.y));
    const partial = refs.some(ref => {
      const pl = findPlacement(store.project, ref)!;
      return pl.start < r.start || placementEnd(pl) > r.end;
    });
    ui.select(refs.map(ref => ref.id), partial ? r : null);
  }

  /** The box's time range, snapped to the grid. */
  private span(): TimeRange {
    const { geo } = this.host;
    const a = snapped(this.host, this.current, geo.xToBeat(this.origin.x));
    const b = snapped(this.host, this.current, geo.xToBeat(this.current.x));
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  private get dragged(): boolean {
    return Math.abs(this.current.x - this.origin.x) + Math.abs(this.current.y - this.origin.y) >= CLICK_PX;
  }
}

/** In the ruler's top band: from the edges the loop lengthens or shortens keeping the
 *  other end still, from the body it's moved, outside a new one is drawn; a click turns it on or off. */
export class LoopRegionGesture implements Gesture {
  readonly cursor: string;
  readonly hidden = NONE;
  private moved = false;
  private readonly anchor: Beats;
  private readonly part: LoopPart;
  private readonly original: LoopRegion;

  constructor(private readonly host: GestureHost, private readonly origin: Pointer) {
    this.anchor = snapped(host, origin, host.geo.xToBeat(origin.x));
    this.original = host.store.project.loop;
    this.part = loopPartAt(this.original, origin.x, b => host.geo.beatToX(b));
    this.cursor = this.part === 'body' ? 'grabbing' : LOOP_CURSOR[this.part];
  }

  move(p: Pointer): void {
    if (!this.moved && Math.abs(p.x - this.origin.x) < CLICK_PX) return;
    this.moved = true;
    const r = dragLoop(this.part, this.original, this.anchor, snapped(this.host, p, this.host.geo.xToBeat(p.x)), 0);
    if (!r) return;
    // during the drag the loop really changes (it's heard right away), in a single undo step
    this.host.store.apply(setLoopRegion({ enabled: true, ...r }), { mergeKey: 'loop-drag' });
  }

  end(): void {
    const { store } = this.host;
    if (!this.moved) store.apply(setLoopRegion({ enabled: !store.project.loop.enabled }));
    store.endMerge();
  }

  cancel(): void {
    this.host.store.endMerge();
  }

  paint(): void { /* the loop is visible on the ruler */ }
}

/** Middle button dragged: the view follows the hand, back and forth and up and down. */
export class PanGesture implements Gesture {
  readonly cursor = 'grabbing';
  readonly hidden = NONE;
  private readonly start: TimelineGeometry;

  constructor(host: GestureHost, private readonly origin: Pointer, private readonly scrollTo: (beat: Beats, y: number) => void) {
    this.start = host.geo;
  }

  move(p: Pointer): void {
    const g = this.start;
    this.scrollTo(g.scrollBeat - (p.x - this.origin.x) / g.pxPerBeat, g.scrollY - (p.y - this.origin.y));
  }

  end(): void { /* niente */ }
  cancel(): void { /* niente */ }
  paint(): void { /* niente */ }
}

/** In the ruler's lower part: moves the playhead (also by dragging). */
export class ScrubGesture implements Gesture {
  readonly cursor = 'text';
  readonly hidden = NONE;

  constructor(private readonly host: GestureHost, origin: Pointer) {
    this.move(origin);
  }

  move(p: Pointer): void {
    this.host.seek(snapped(this.host, p, this.host.geo.xToBeat(p.x)));
  }

  end(): void { /* niente */ }
  cancel(): void { /* niente */ }
  paint(): void { /* niente */ }
}
