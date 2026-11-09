import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { PlacementId, TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import type { AudioClip } from '../../model/audio-clip';
import { addMidiClip } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import type { UiState } from '../ui-state';
import type { PeakStore } from '../waveform';
import { gridStep, hitTest, snapTo, type ClipZone, type Hit } from './geometry';
import {
  FadeGesture, LoopRegionGesture, MarqueeGesture, MoveClipsGesture, PanGesture, ResizeClipGesture, ScrubGesture,
  type Gesture, type GestureHost, type Pointer,
} from './gestures';
import { TimelineScrollbar } from './scrollbar';
import { acceptBrowserDrops } from '../browser/browser-drag';
import { LOOP_CURSOR, loopPartAt } from '../loop-drag';
import { Surface } from '../surface';
import { paintLanes, paintPlayhead, paintRuler, RULER_LOOP_BAND } from './painters';

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

type HitKey = `clip:${ClipZone}` | 'lane' | 'empty';
const keyOf = (h: Hit): HitKey => (h.kind === 'clip' ? `clip:${h.zone}` : h.kind);

/** Which gesture starts by pressing on each thing. */
const gestureFor: Readonly<Record<HitKey, (host: GestureHost, hit: Hit, p: Pointer) => Gesture>> = {
  'clip:body': (h, hit, p) => new MoveClipsGesture(h, hit as Extract<Hit, { kind: 'clip' }>, p),
  'clip:start': (h, hit) => new ResizeClipGesture(h, hit as Extract<Hit, { kind: 'clip' }>),
  'clip:end': (h, hit) => new ResizeClipGesture(h, hit as Extract<Hit, { kind: 'clip' }>),
  'clip:fadeIn': (h, hit) => new FadeGesture(h, hit as Extract<Hit, { kind: 'clip' }>),
  'clip:fadeOut': (h, hit) => new FadeGesture(h, hit as Extract<Hit, { kind: 'clip' }>),
  lane: (h, _hit, p) => new MarqueeGesture(h, p),
  empty: (h, _hit, p) => new MarqueeGesture(h, p),
};

const hoverCursor: Readonly<Record<HitKey, string>> = {
  'clip:body': 'grab', 'clip:start': 'ew-resize', 'clip:end': 'ew-resize', 'clip:fadeIn': 'col-resize', 'clip:fadeOut': 'col-resize',
  lane: 'default', empty: 'default',
};

/** The timeline: ruler with loop and playhead, lanes with the clips, mouse gestures. */
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
    return this.ui.snap && !p.alt ? gridStep(this.geo.pxPerBeat, this.store.project.signature) : null;
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
    const g = this.geo, w = this.lanes.width;
    const x = g.beatToX(beat);
    if (x < 0 || x > w * 0.92) this.ui.setGeometry(g.scrolled(beat - (w * 0.1) / g.pxPerBeat, g.scrollY));
  }

  /** Brings the view to beat `beat` (left edge) and `y` pixels scrolled vertically,
   *  without going past the last track. */
  private scrollTo(beat: Beats, y: number): void {
    const g = this.geo;
    const maxY = Math.max(0, this.store.project.visibleTracks.length * g.trackHeight - this.lanes.height + 40);
    this.ui.setGeometry(g.scrolled(beat, Math.min(maxY, y)));
  }

  /** The bar under the timeline: it scrolls up to bringing the end of the piece (or of the loop,
   *  or the playhead) to the left edge. */
  private updateScrollbar(): void {
    const { project } = this.store, g = this.geo;
    const visible = this.lanes.width / g.pxPerBeat;
    const content = Math.max(project.arrangementEnd, project.loop.end, this.deps.engine.position);
    this.scrollbar.update({ total: Math.max(content, g.scrollBeat) + visible, start: g.scrollBeat, visible });
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
      const grid = gridStep(this.geo.pxPerBeat, project.signature);
      paintRuler(this.ruler.g, project, this.geo, this.ruler.width, this.ruler.height, grid);
      paintLanes(this.lanes.g, {
        project: this.gesture?.preview ?? project, geo: this.geo, width: this.lanes.width, height: this.lanes.height, grid,
        selection: this.ui.selection, range: this.ui.range, hovered: this.hovered, hidden: this.gesture?.hidden ?? new Set(), taken: engine.takenTracks, selectedTracks: this.ui.selectedTracks,
        peaks: (c: AudioClip) => this.deps.peaks.get(c.sample, c.reversed),
      });
      this.updateScrollbar();
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

  /** Middle button: dragging moves the view. True if the gesture started. */
  private startPan(e: PointerEvent, el: HTMLElement): boolean {
    if (e.button !== 1) return false;
    this.pauseFollow();
    this.startGesture(e, el, p => new PanGesture(this, p, (beat, y) => this.scrollTo(beat, y)), 1);
    return true;
  }

  private bindLanes(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (this.startPan(e, el)) return;
      if (e.button === 0) this.pauseFollow();
      const p = this.pointer(e, el);
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      if (hit.kind === 'clip' || hit.kind === 'lane') this.ui.selectTrack(hit.track);
      this.startGesture(e, el, pp => gestureFor[keyOf(hit)](this, hit, pp));
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointer(e, el);
      if (this.gesture) {
        this.gesture.move(p);
        return;
      }
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      el.style.cursor = hoverCursor[keyOf(hit)];
      this.hover(hit.kind === 'clip' ? hit.placement.id : null);
    });
    el.addEventListener('pointerleave', () => this.hover(null));
    this.bindGestureEnd(el);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const p = this.pointer(e, el);
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      // right click on an unselected clip: it becomes the selection, as in Live
      if (hit.kind === 'clip' && !this.ui.selection.has(hit.placement.id)) this.ui.select([hit.placement.id]);
      this.deps.contextMenu(hit, e.clientX, e.clientY);
    });
    el.addEventListener('dblclick', e => {
      const p = this.pointer(e, el);
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      if (hit.kind === 'clip') this.deps.openClip(hit.track, hit.placement.id);
      else if (hit.kind === 'lane' && this.store.project.track(hit.track)?.kind === 'midi') {
        // double click on an empty MIDI track: a one-bar clip
        const bar = this.store.project.signature.beatsPerBar;
        this.store.apply(addMidiClip(hit.track, Math.floor(hit.beat / bar) * bar, bar));
      }
    });
  }

  private bindRuler(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (this.startPan(e, el)) return;
      const p = this.pointer(e, el);
      // a click in the ruler (not on the loop band) moves the playhead and resumes Follow
      if (e.button === 0 && p.y >= RULER_LOOP_BAND + 2) this.ui.resumeFollow();
      this.startGesture(e, el, pp => (p.y < RULER_LOOP_BAND + 2 ? new LoopRegionGesture(this, pp) : new ScrubGesture(this, pp)));
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointer(e, el);
      if (this.gesture) this.gesture.move(p);
      else el.style.cursor = p.y < RULER_LOOP_BAND + 2 ? LOOP_CURSOR[loopPartAt(this.store.project.loop, p.x, b => this.geo.beatToX(b))] : 'text';
    });
    this.bindGestureEnd(el);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!this.gesture) this.deps.rulerMenu?.(e.clientX, e.clientY);
    });
  }

  /** Wheel: scrolls; with Ctrl it zooms around the pointer; with Shift it scrolls horizontally.
   *  Zooming or scrolling horizontally while playing suspends Follow. It also applies to the column
   *  of the tracks, which scrolls together with the lanes (there the zoom anchors to the left edge). */
  bindWheel(el: HTMLElement): void {
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const g = this.geo;
      const r = this.lanes.canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        this.pauseFollow();
        this.ui.setGeometry(g.zoomed(g.pxPerBeat * Math.exp(-e.deltaY * 0.0025), Math.max(0, e.clientX - r.left)));
        return;
      }
      // Shift+wheel: Chromium on Windows already delivers it as deltaX (with deltaY at 0)
      const dx = e.shiftKey ? e.deltaX || e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
      if (dx) this.pauseFollow();
      this.scrollTo(g.scrollBeat + dx / g.pxPerBeat, g.scrollY + dy);
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
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const track = this.store.project.visibleTracks[this.geo.trackIndexAt(y)];
      const step = gridStep(this.geo.pxPerBeat, this.store.project.signature);
      return { track: track?.id ?? null, beat: Math.max(0, snapTo(this.geo.xToBeat(x), step)) };
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
