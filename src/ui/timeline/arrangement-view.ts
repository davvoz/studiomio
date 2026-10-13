import type { PlacementId, TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import type { AudioClip } from '../../model/audio-clip';
import { addMidiClip } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import type { UiState } from '../ui-state';
import type { PeakStore } from '../waveform';
import { gridStep, hitTest, snapTo, type Hit } from './geometry';
import {
  LoopRegionGesture, MarqueeGesture, MoveClipsGesture, ResizeClipGesture, ScrubGesture,
  type Gesture, type GestureHost, type Pointer,
} from './gestures';
import { LOOP_CURSOR, loopPartAt } from '../loop-drag';
import { Surface } from '../surface';
import { paintLanes, paintPlayhead, paintRuler, RULER_LOOP_BAND } from './painters';

export interface ArrangementDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: PlaybackEngine;
  readonly peaks: PeakStore;
  /** Doppio clic su una clip: apre il suo editor. */
  readonly openClip: (track: TrackId, placement: PlacementId) => void;
  /** File trascinati sulla timeline. */
  readonly dropFiles: (files: File[], track: TrackId | null, beat: Beats) => void;
  /** Tasto destro: `hit` è ciò che c'è sotto, (x, y) il punto nella finestra. */
  readonly contextMenu: (hit: Hit, x: number, y: number) => void;
}

type HitKey = 'clip:body' | 'clip:start' | 'clip:end' | 'lane' | 'empty';
const keyOf = (h: Hit): HitKey => (h.kind === 'clip' ? `clip:${h.zone}` : h.kind);

/** Quale gesto inizia premendo su ciascuna cosa. */
const gestureFor: Readonly<Record<HitKey, (host: GestureHost, hit: Hit, p: Pointer) => Gesture>> = {
  'clip:body': (h, hit, p) => new MoveClipsGesture(h, hit as Extract<Hit, { kind: 'clip' }>, p),
  'clip:start': (h, hit) => new ResizeClipGesture(h, hit as Extract<Hit, { kind: 'clip' }>),
  'clip:end': (h, hit) => new ResizeClipGesture(h, hit as Extract<Hit, { kind: 'clip' }>),
  lane: (h, _hit, p) => new MarqueeGesture(h, p),
  empty: (h, _hit, p) => new MarqueeGesture(h, p),
};

const hoverCursor: Readonly<Record<HitKey, string>> = {
  'clip:body': 'grab', 'clip:start': 'ew-resize', 'clip:end': 'ew-resize', lane: 'default', empty: 'default',
};

/** La timeline: righello con loop e testina, corsie con le clip, gesti del mouse. */
export class ArrangementView implements GestureHost {
  readonly element: HTMLElement;
  readonly store: ProjectStore;
  readonly ui: UiState;
  private readonly ruler = new Surface('ruler');
  private readonly lanes = new Surface('lanes');
  private readonly overlay = new Surface('overlay');
  private gesture: Gesture | null = null;
  private dirty = true;
  /** Mentre suona, la vista scorre per tenere in vista la testina. */
  followPlayhead = true;

  constructor(private readonly deps: ArrangementDeps) {
    this.store = deps.store;
    this.ui = deps.ui;
    this.element = document.createElement('div');
    this.element.className = 'arrangement-body';
    const rulerWrap = Object.assign(document.createElement('div'), { className: 'ruler-wrap' });
    const lanesWrap = Object.assign(document.createElement('div'), { className: 'lanes-wrap' });
    rulerWrap.append(this.ruler.canvas);
    lanesWrap.append(this.lanes.canvas, this.overlay.canvas);
    this.element.append(rulerWrap, lanesWrap);

    new ResizeObserver(() => {
      this.ruler.resize(rulerWrap.clientWidth, rulerWrap.clientHeight);
      this.lanes.resize(lanesWrap.clientWidth, lanesWrap.clientHeight);
      this.overlay.resize(lanesWrap.clientWidth, lanesWrap.clientHeight);
      this.invalidate();
    }).observe(lanesWrap);

    this.bindLanes(this.overlay.canvas);
    this.bindRuler(this.ruler.canvas);
    this.bindWheel(this.element);
    this.bindDrop(lanesWrap);
    deps.store.onChange(() => this.invalidate());
    deps.engine.onSessionChange(() => this.invalidate());
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

  /** Porta in vista il battito `beat` (per esempio la testina che esce dallo schermo). */
  reveal(beat: Beats): void {
    const g = this.geo, w = this.lanes.width;
    const x = g.beatToX(beat);
    if (x < 0 || x > w * 0.92) this.ui.setGeometry(g.scrolled(beat - (w * 0.1) / g.pxPerBeat, g.scrollY));
  }

  // ---------------------------------------------------------------- disegno

  private readonly frame = () => {
    const { project } = this.store;
    const engine = this.deps.engine;
    if (engine.playing && this.followPlayhead) this.reveal(engine.position);
    if (this.dirty) {
      this.dirty = false;
      const grid = gridStep(this.geo.pxPerBeat, project.signature);
      paintRuler(this.ruler.g, project, this.geo, this.ruler.width, this.ruler.height, grid);
      paintLanes(this.lanes.g, {
        project, geo: this.geo, width: this.lanes.width, height: this.lanes.height, grid,
        selection: this.ui.selection, hidden: this.gesture?.hidden ?? new Set(), taken: engine.takenTracks,
        peaks: (c: AudioClip) => this.deps.peaks.get(c.sample),
      });
    }
    const o = this.overlay;
    o.g.clearRect(0, 0, o.width, o.height);
    this.gesture?.paint(o.g, this.geo);
    paintPlayhead(o.g, this.geo, o.height, engine.position, engine.playing ? engine.position : null);
    requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------------- puntatore

  private pointer(e: PointerEvent | MouseEvent, el: HTMLElement): Pointer {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private startGesture(e: PointerEvent, el: HTMLElement, make: (p: Pointer) => Gesture): void {
    if (e.button !== 0) return;
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

  private bindLanes(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      const p = this.pointer(e, el);
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      this.startGesture(e, el, pp => gestureFor[keyOf(hit)](this, hit, pp));
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointer(e, el);
      if (this.gesture) {
        this.gesture.move(p);
        return;
      }
      el.style.cursor = hoverCursor[keyOf(hitTest(this.store.project, this.geo, p.x, p.y))];
    });
    this.bindGestureEnd(el);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const p = this.pointer(e, el);
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      // tasto destro su una clip non selezionata: diventa la selezione, come in Live
      if (hit.kind === 'clip' && !this.ui.selection.has(hit.placement.id)) this.ui.select([hit.placement.id]);
      this.deps.contextMenu(hit, e.clientX, e.clientY);
    });
    el.addEventListener('dblclick', e => {
      const p = this.pointer(e, el);
      const hit = hitTest(this.store.project, this.geo, p.x, p.y);
      if (hit.kind === 'clip') this.deps.openClip(hit.track, hit.placement.id);
      else if (hit.kind === 'lane' && this.store.project.track(hit.track)?.kind === 'midi') {
        // doppio clic su una traccia MIDI vuota: una clip di una battuta
        const bar = this.store.project.signature.beatsPerBar;
        this.store.apply(addMidiClip(hit.track, Math.floor(hit.beat / bar) * bar, bar));
      }
    });
  }

  private bindRuler(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      const p = this.pointer(e, el);
      this.startGesture(e, el, pp => (p.y < RULER_LOOP_BAND + 2 ? new LoopRegionGesture(this, pp) : new ScrubGesture(this, pp)));
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointer(e, el);
      if (this.gesture) this.gesture.move(p);
      else el.style.cursor = p.y < RULER_LOOP_BAND + 2 ? LOOP_CURSOR[loopPartAt(this.store.project.loop, p.x, b => this.geo.beatToX(b))] : 'text';
    });
    this.bindGestureEnd(el);
  }

  /** Rotella: scorre; con Ctrl zooma attorno al puntatore; con Maiusc scorre in orizzontale. */
  private bindWheel(el: HTMLElement): void {
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const g = this.geo;
      const r = this.lanes.canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        this.ui.setGeometry(g.zoomed(g.pxPerBeat * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left));
        return;
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
      const maxY = Math.max(0, this.store.project.tracks.length * g.trackHeight - this.lanes.height + 40);
      this.ui.setGeometry(g.scrolled(g.scrollBeat + dx / g.pxPerBeat, Math.min(maxY, g.scrollY + dy)));
    }, { passive: false });
  }

  private bindDrop(el: HTMLElement): void {
    el.addEventListener('dragover', e => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const track = this.store.project.tracks[this.geo.trackIndexAt(y)];
      const step = gridStep(this.geo.pxPerBeat, this.store.project.signature);
      this.deps.dropFiles(files, track?.id ?? null, Math.max(0, snapTo(this.geo.xToBeat(x), step)));
    });
  }
}
