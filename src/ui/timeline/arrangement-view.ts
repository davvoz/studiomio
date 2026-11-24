import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { PlacementId, TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import type { AudioClip } from '../../model/audio-clip';
import type { TimeRange } from '../../model/note-edits';
import { addMidiClip } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { Surface } from '../kit/canvas';
import type { UiState } from '../ui-state';
import type { PeakStore } from '../waveform';
import { geometryShowing, hitTest, type Hit } from './geometry';
import type { Pointer } from '../kit/pointer';
import { LoopRegionGesture, PanGesture, RulerZoomGesture, ScrubGesture, type Gesture, type GestureHost } from './gestures';
import { dropPlace, gestureFor, hoverCursor, isPan, newClipAt, rulerCursor } from './lane-actions';
import { paintLanes, paintPlayhead, paintRuler, rulerZoneAt, type RulerZone } from './painters';
import { TimelineScrollbar } from './scrollbar';
import { ZoomHistory, fitRange, revealing, scrollbarRange, scrolledWithin, selectionSpan, wheelMove } from './timeline-nav';

export interface ArrangementDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: PlaybackEngine;
  readonly peaks: PeakStore;
  /** Double click on a clip: opens its editor. */
  readonly openClip: (track: TrackId, placement: PlacementId) => void;
  /** Files dragged onto the timeline. */
  readonly dropFiles: (files: File[], track: TrackId | null, beat: Beats) => void;
  /** A browser item dropped on a lane (or below the tracks: `track` null). */
  readonly dropItem?: (item: BrowserItem, target: LoadTarget) => void;
  /** Right click: `hit` is what's underneath, (x, y) the point in the window. */
  readonly contextMenu: (hit: Hit, x: number, y: number) => void;
  /** Right click on the ruler, (x, y) the point in the window. */
  readonly rulerMenu?: (x: number, y: number) => void;
}

/** The timeline: ruler with loop and playhead, lanes with the clips, mouse gestures.
 *  This file draws, measures and wires the events: what the mouse does is in lane-actions, the
 *  scrolling and zooming in timeline-nav, the gestures in gestures, the drawing in painters. */
export class ArrangementView implements GestureHost {
  readonly element: HTMLElement;
  readonly store: ProjectStore;
  readonly ui: UiState;
  private readonly ruler = new Surface('ruler');
  private readonly lanes = new Surface('lanes');
  private readonly overlay = new Surface('overlay');
  private readonly scrollbar = new TimelineScrollbar(beat => {
    this.pauseFollow();
    this.scrollTo(beat, this.geo.scrollY);
  });
  private gesture: Gesture | null = null;
  /** The views before each Z or W, for X (zoom back), as in Live. */
  private readonly zoomHistory = new ZoomHistory();
  /** The clip under the pointer (shows the fade handles). */
  private hovered: PlacementId | null = null;
  private dirty = true;

  constructor(private readonly deps: ArrangementDeps) {
    this.store = deps.store;
    this.ui = deps.ui;
    this.element = document.createElement('div');
    this.element.className = 'arrangement-body';
    const rulerWrap = Object.assign(document.createElement('div'), { className: 'ruler-wrap' });
    const lanesWrap = Object.assign(document.createElement('div'), { className: 'lanes-wrap' });
    rulerWrap.append(this.ruler.canvas);
    lanesWrap.append(this.lanes.canvas, this.overlay.canvas);
    this.element.append(rulerWrap, lanesWrap, this.scrollbar.element);
    // the middle button drags the view: no automatic scrolling by the browser
    this.element.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });

    new ResizeObserver(() => {
      this.ruler.resize(rulerWrap.clientWidth, rulerWrap.clientHeight);
      this.lanes.resize(lanesWrap.clientWidth, lanesWrap.clientHeight);
      this.overlay.resize(lanesWrap.clientWidth, lanesWrap.clientHeight);
      // resizing empties the canvases: they're redrawn right away, not at the next frame (they'd stay
      // black at every frame while the bottom area rises or closes)
      this.invalidate();
      this.paint();
    }).observe(lanesWrap);

    this.bindLanes(this.overlay.canvas);
    this.bindRuler(this.ruler.canvas);
    this.bindWheel(this.element);
    this.bindDrop(lanesWrap);
    deps.store.onChange(() => this.invalidate());
    deps.engine.onSessionChange(() => this.invalidate());
    // as in Live: pressing Play again resumes Follow
    deps.engine.onStateChange(playing => { if (playing) this.ui.resumeFollow(); });
    deps.ui.onChange(() => this.invalidate());
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- GestureHost

  get geo() {
    return this.ui.geometry;
  }

  snapStep(p: Pointer): Beats | null {
    return this.ui.snap && !p.alt ? this.grid() : null;
  }

  seek(beat: Beats): void {
    this.deps.engine.seek(beat);
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Brings beat `beat` into view (for example the playhead leaving the screen). */
  reveal(beat: Beats): void {
    const g = revealing(this.geo, beat, this.lanes.width);
    if (g) this.ui.setGeometry(g);
  }

  /** Brings the view to beat `beat` (left edge) and `y` pixels scrolled vertically,
   *  without going past the last track. */
  private scrollTo(beat: Beats, y: number): void {
    this.ui.setGeometry(scrolledWithin(this.store.project, this.geo, beat, y, this.lanes.height));
  }

  /** The grid at the current zoom. */
  private grid(): Beats {
    return this.ui.gridStep(this.geo.pxPerBeat, this.store.project.signature);
  }

  // ---------------------------------------------------------------- drawing

  private readonly frame = () => {
    this.paint();
    requestAnimationFrame(this.frame);
  };

  private paint(): void {
    const { project } = this.store;
    const engine = this.deps.engine;
    // during a gesture the view stays still: scrolling under the mouse would move what's being dragged
    if (engine.playing && this.ui.following && !this.gesture) this.reveal(engine.position);
    if (this.dirty) {
      this.dirty = false;
      const grid = this.grid();
      paintRuler(this.ruler.g, project, this.geo, this.ruler.width, this.ruler.height, grid);
      paintLanes(this.lanes.g, {
        project: this.gesture?.preview ?? project, geo: this.geo, width: this.lanes.width, height: this.lanes.height, grid,
        selection: this.ui.selection, range: this.ui.range, hovered: this.hovered, hidden: this.gesture?.hidden ?? new Set(), taken: engine.takenTracks, selectedTracks: this.ui.selectedTracks,
        peaks: (c: AudioClip) => this.deps.peaks.get(c.sample, c.reversed),
      });
      this.scrollbar.update(scrollbarRange(project, this.geo, this.lanes.width, engine.position));
    }
    const o = this.overlay;
    o.g.clearRect(0, 0, o.width, o.height);
    this.gesture?.paint(o.g, this.geo);
    paintPlayhead(o.g, this.geo, o.height, engine.position, engine.playing ? engine.position : null);
  }

  // ---------------------------------------------------------------- pointer

  private pointer(e: PointerEvent | MouseEvent, el: HTMLElement): Pointer {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  /** What's under the pointer on the lanes. */
  private hitAt(e: MouseEvent, el: HTMLElement): Hit {
    const p = this.pointer(e, el);
    return hitTest(this.store.project, this.geo, p.x, p.y);
  }

  private startGesture(e: PointerEvent, el: HTMLElement, make: (p: Pointer) => Gesture, button = 0): void {
    if (e.button !== button) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const p = this.pointer(e, el);
    this.gesture = make(p);
    el.style.cursor = this.gesture.cursor;
    this.invalidate();
  }

  private bindGestureEnd(el: HTMLElement): void {
    el.addEventListener('pointerup', e => {
      const g = this.gesture;
      if (!g) return;
      this.gesture = null;
      g.end(this.pointer(e, el));
      el.style.cursor = '';
      this.invalidate();
    });
    el.addEventListener('pointercancel', () => {
      this.gesture?.cancel();
      this.gesture = null;
    });
  }

  private hover(id: PlacementId | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.invalidate();
  }

  /** While playing, whoever moves the view or edits the timeline suspends Follow (as in Live). */
  private pauseFollow(): void {
    if (this.deps.engine.playing) this.ui.pauseFollow();
  }

  /** Dragging with the middle button, or with Ctrl+Alt, moves the view. True if the gesture started. */
  private startPan(e: PointerEvent, el: HTMLElement): boolean {
    if (!isPan({ button: e.button, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })) return false;
    this.pauseFollow();
    this.startGesture(e, el, p => new PanGesture(this, p, (beat, y) => this.scrollTo(beat, y)), e.button);
    return true;
  }

  private bindLanes(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (this.startPan(e, el)) return;
      if (e.button === 0) this.pauseFollow();
      const hit = this.hitAt(e, el);
      if (hit.kind === 'clip' || hit.kind === 'lane') this.ui.selectTrack(hit.track);
      this.startGesture(e, el, p => gestureFor(this, hit, p));
    });
    el.addEventListener('pointermove', e => {
      if (this.gesture) {
        this.gesture.move(this.pointer(e, el));
        return;
      }
      const hit = this.hitAt(e, el);
      el.style.cursor = hoverCursor(hit);
      this.hover(hit.kind === 'clip' ? hit.placement.id : null);
    });
    el.addEventListener('pointerleave', () => this.hover(null));
    this.bindGestureEnd(el);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const hit = this.hitAt(e, el);
      // right click on an unselected clip: it becomes the selection, as in Live
      if (hit.kind === 'clip' && !this.ui.selection.has(hit.placement.id)) this.ui.select([hit.placement.id]);
      this.deps.contextMenu(hit, e.clientX, e.clientY);
    });
    el.addEventListener('dblclick', e => {
      const hit = this.hitAt(e, el);
      if (hit.kind === 'clip') return this.deps.openClip(hit.track, hit.placement.id);
      // double click on an empty MIDI track: a one-bar clip
      const clip = newClipAt(this.store.project, hit);
      if (clip) this.store.apply(addMidiClip(clip.track, clip.start, clip.length));
    });
  }

  private bindRuler(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (this.startPan(e, el)) return;
      const zone = rulerZoneAt(this.pointer(e, el).y);
      // a click in the scrub area moves the playhead and resumes Follow
      if (e.button === 0 && zone === 'scrub') this.ui.resumeFollow();
      this.startGesture(e, el, p => this.rulerGesture(zone, p));
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointer(e, el);
      if (this.gesture) this.gesture.move(p);
      else el.style.cursor = rulerCursor(rulerZoneAt(p.y), this.store.project.loop, p.x, b => this.geo.beatToX(b));
    });
    this.bindGestureEnd(el);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!this.gesture) this.deps.rulerMenu?.(e.clientX, e.clientY);
    });
  }

  private rulerGesture(zone: RulerZone, p: Pointer): Gesture {
    if (zone === 'loop') return new LoopRegionGesture(this, p);
    if (zone === 'scrub') return new ScrubGesture(this, p);
    return new RulerZoomGesture(this, p, g => {
      this.pauseFollow();
      this.ui.setGeometry(g);
    }, beat => {
      this.ui.resumeFollow();
      this.seek(beat);
    });
  }

  // ---------------------------------------------------------------- zoom commands (Live's Z, X, W)

  /** Z: the time selection (or the selected clips) fills the view. False if nothing is selected. */
  zoomToSelection(): boolean {
    const span = selectionSpan(this.store.project, this.ui.range, this.ui.selection);
    if (span) this.show(span);
    return span !== null;
  }

  /** W: the whole piece in view, up to the end of the last clip (or of the loop). */
  zoomToFit(): void {
    this.show(fitRange(this.store.project));
  }

  /** X: back to the view before the last Z or W. False if there's none. */
  zoomBack(): boolean {
    const g = this.zoomHistory.pop();
    if (g) this.ui.setGeometry(g);
    return g !== undefined;
  }

  private show(range: TimeRange): void {
    this.pauseFollow();
    this.zoomHistory.push(this.geo);
    this.ui.setGeometry(geometryShowing(this.geo, range.start, range.end, this.lanes.width));
  }

  /** Wheel: scrolls; with Ctrl it zooms around the pointer; with Shift it scrolls horizontally.
   *  Zooming or scrolling horizontally while playing suspends Follow. It also applies to the column
   *  of the tracks, which scrolls together with the lanes (there the zoom anchors to the left edge). */
  bindWheel(el: HTMLElement): void {
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = this.lanes.canvas.getBoundingClientRect();
      const move = wheelMove(this.geo, { deltaX: e.deltaX, deltaY: e.deltaY, zoom: e.ctrlKey || e.metaKey, shift: e.shiftKey, x: e.clientX - r.left });
      if (move.kind === 'zoom') {
        this.pauseFollow();
        this.ui.setGeometry(move.geometry);
        return;
      }
      if (move.horizontal) this.pauseFollow();
      this.scrollTo(move.beat, move.y);
    }, { passive: false });
  }

  private bindDrop(el: HTMLElement): void {
    el.addEventListener('dragover', e => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    // where something falls: the track underneath (null below the tracks) and the beat, on the grid
    const place = (e: DragEvent) => {
      const r = el.getBoundingClientRect();
      return dropPlace(this.store.project, this.geo, this.grid(), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('drop', e => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const { track, beat } = place(e);
      this.deps.dropFiles(files, track, beat);
    });
    const dropItem = this.deps.dropItem;
    if (dropItem) acceptBrowserDrops(el, (item, e) => dropItem(item, { kind: 'lane', ...place(e) }));
  }
}
