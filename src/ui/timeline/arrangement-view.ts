import type { BrowserItem, LoadTarget } from '../../browser/item';
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
  LoopRegionGesture, MarqueeGesture, MoveClipsGesture, PanGesture, ResizeClipGesture, ScrubGesture,
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
  /** Doppio clic su una clip: apre il suo editor. */
  readonly openClip: (track: TrackId, placement: PlacementId) => void;
  /** File trascinati sulla timeline. */
  readonly dropFiles: (files: File[], track: TrackId | null, beat: Beats) => void;
  /** Una voce del browser lasciata su una corsia (o sotto le tracce: `track` null). */
  readonly dropItem?: (item: BrowserItem, target: LoadTarget) => void;
  /** Tasto destro: `hit` è ciò che c'è sotto, (x, y) il punto nella finestra. */
  readonly contextMenu: (hit: Hit, x: number, y: number) => void;
  /** Tasto destro sul righello, (x, y) il punto nella finestra. */
  readonly rulerMenu?: (x: number, y: number) => void;
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
  private readonly scrollbar = new TimelineScrollbar(beat => {
    this.pauseFollow();
    this.scrollTo(beat, this.geo.scrollY);
  });
  private gesture: Gesture | null = null;
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
    // il tasto centrale trascina la vista: niente scorrimento automatico del browser
    this.element.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });

    new ResizeObserver(() => {
      this.ruler.resize(rulerWrap.clientWidth, rulerWrap.clientHeight);
      this.lanes.resize(lanesWrap.clientWidth, lanesWrap.clientHeight);
      this.overlay.resize(lanesWrap.clientWidth, lanesWrap.clientHeight);
      // ridimensionare svuota i canvas: si ridisegnano subito, non al frame dopo (resterebbero
      // neri a ogni frame mentre l'area in basso si alza o si chiude)
      this.invalidate();
      this.paint();
    }).observe(lanesWrap);

    this.bindLanes(this.overlay.canvas);
    this.bindRuler(this.ruler.canvas);
    this.bindWheel(this.element);
    this.bindDrop(lanesWrap);
    deps.store.onChange(() => this.invalidate());
    deps.engine.onSessionChange(() => this.invalidate());
    // come in Live: ripremere Play riprende Segui
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

  /** Porta in vista il battito `beat` (per esempio la testina che esce dallo schermo). */
  reveal(beat: Beats): void {
    const g = this.geo, w = this.lanes.width;
    const x = g.beatToX(beat);
    if (x < 0 || x > w * 0.92) this.ui.setGeometry(g.scrolled(beat - (w * 0.1) / g.pxPerBeat, g.scrollY));
  }

  /** Porta la vista al battito `beat` (bordo sinistro) e a `y` pixel scorsi in verticale,
   *  senza andare oltre l'ultima traccia. */
  private scrollTo(beat: Beats, y: number): void {
    const g = this.geo;
    const maxY = Math.max(0, this.store.project.visibleTracks.length * g.trackHeight - this.lanes.height + 40);
    this.ui.setGeometry(g.scrolled(beat, Math.min(maxY, y)));
  }

  /** La barra sotto la timeline: si scorre fino a portare la fine del brano (o del loop,
   *  o la testina) al bordo sinistro. */
  private updateScrollbar(): void {
    const { project } = this.store, g = this.geo;
    const visible = this.lanes.width / g.pxPerBeat;
    const content = Math.max(project.arrangementEnd, project.loop.end, this.deps.engine.position);
    this.scrollbar.update({ total: Math.max(content, g.scrollBeat) + visible, start: g.scrollBeat, visible });
  }

  // ---------------------------------------------------------------- disegno

  private readonly frame = () => {
    this.paint();
    requestAnimationFrame(this.frame);
  };

  private paint(): void {
    const { project } = this.store;
    const engine = this.deps.engine;
    // durante un gesto la vista sta ferma: scorrere sotto il mouse sposterebbe ciò che si trascina
    if (engine.playing && this.ui.following && !this.gesture) this.reveal(engine.position);
    if (this.dirty) {
      this.dirty = false;
      const grid = gridStep(this.geo.pxPerBeat, project.signature);
      paintRuler(this.ruler.g, project, this.geo, this.ruler.width, this.ruler.height, grid);
      paintLanes(this.lanes.g, {
        project: this.gesture?.preview ?? project, geo: this.geo, width: this.lanes.width, height: this.lanes.height, grid,
        selection: this.ui.selection, range: this.ui.range, hidden: this.gesture?.hidden ?? new Set(), taken: engine.takenTracks, selectedTracks: this.ui.selectedTracks,
        peaks: (c: AudioClip) => this.deps.peaks.get(c.sample, c.reversed),
      });
      this.updateScrollbar();
    }
    const o = this.overlay;
    o.g.clearRect(0, 0, o.width, o.height);
    this.gesture?.paint(o.g, this.geo);
    paintPlayhead(o.g, this.geo, o.height, engine.position, engine.playing ? engine.position : null);
  }

  // ---------------------------------------------------------------- puntatore

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

  /** Mentre suona, chi sposta la vista o modifica la timeline sospende Segui (come in Live). */
  private pauseFollow(): void {
    if (this.deps.engine.playing) this.ui.pauseFollow();
  }

  /** Tasto centrale: trascinando si sposta la vista. Vero se è iniziato il gesto. */
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
      if (this.startPan(e, el)) return;
      const p = this.pointer(e, el);
      // un clic nel righello (non sulla banda del loop) sposta la testina e riprende Segui
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

  /** Rotella: scorre; con Ctrl zooma attorno al puntatore; con Maiusc scorre in orizzontale.
   *  Zoomare o scorrere in orizzontale mentre suona sospende Segui. */
  private bindWheel(el: HTMLElement): void {
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const g = this.geo;
      const r = this.lanes.canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        this.pauseFollow();
        this.ui.setGeometry(g.zoomed(g.pxPerBeat * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left));
        return;
      }
      // Maiusc+rotella: Chromium su Windows la consegna già come deltaX (con deltaY a 0)
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
    // dove cade qualcosa: la traccia sotto (null sotto le tracce) e il battito, sulla griglia
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
