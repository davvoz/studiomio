import type { PlacementId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { placementEnd, type Placement } from '../../model/arrangement';
import { resizePlacement, setLoopRegion } from '../../store/edits';
import type { LoopRegion } from '../../model/project';
import { dragLoop, LOOP_CURSOR, loopPartAt, type LoopPart } from '../loop-drag';
import type { ProjectStore } from '../../store/project-store';
import { addedPlacements, relocate, type Relocation } from '../../store/selection-edits';
import type { UiState } from '../ui-state';
import { placementsInBox, snapTo, type Hit, type TimelineGeometry } from './geometry';
import { paintBox, paintGhost } from './painters';
import { planMove, planResize, resolveSelection, snappedDelta } from './planning';

export interface Pointer {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
  /** Alt: niente aggancio alla griglia. */
  readonly alt: boolean;
  /** Ctrl/Cmd: copia invece di spostare. */
  readonly ctrl: boolean;
}

/** Ciò che un gesto può usare della vista. */
export interface GestureHost {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly geo: TimelineGeometry;
  /** Passo di aggancio per questo puntatore, o null se l'aggancio è spento. */
  snapStep(p: Pointer): Beats | null;
  seek(beat: Beats): void;
  invalidate(): void;
}

/** Un trascinamento in corso. L'anteprima si disegna sopra la timeline; il progetto cambia
 *  solo al rilascio, con un'unica modifica (un solo passo di annullamento). */
export interface Gesture {
  readonly cursor: string;
  /** Clip da non disegnare al loro posto durante l'anteprima. */
  readonly hidden: ReadonlySet<PlacementId>;
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

/** Trascinare clip: sposta (o copia, con Ctrl) tutta la selezione, anche su altre tracce. */
export class MoveClipsGesture implements Gesture {
  readonly cursor = 'grabbing';
  private plan: Relocation[] = [];
  private moved = false;
  private copy = false;
  private readonly startBeat: Beats;
  private readonly hiddenIds: Set<PlacementId>;

  constructor(private readonly host: GestureHost, private readonly hit: Extract<Hit, { kind: 'clip' }>, private readonly origin: Pointer) {
    const { ui } = host;
    if (origin.shift) ui.toggle(hit.placement.id);
    else if (!ui.selection.has(hit.placement.id)) ui.select([hit.placement.id]);
    this.startBeat = host.geo.xToBeat(origin.x);
    this.hiddenIds = new Set(ui.selection);
  }

  get hidden(): ReadonlySet<PlacementId> {
    return this.moved && !this.copy ? this.hiddenIds : NONE;
  }

  move(p: Pointer): void {
    if (!this.moved && Math.abs(p.x - this.origin.x) + Math.abs(p.y - this.origin.y) < CLICK_PX) return;
    this.moved = true;
    this.copy = p.ctrl;
    const { host, hit } = this;
    const project = host.store.project;
    const delta = snappedDelta(hit.placement.start, host.geo.xToBeat(p.x) - this.startBeat, host.snapStep(p));
    const dTracks = host.geo.trackIndexAt(p.y) - hit.trackIndex;
    this.plan = planMove(project, resolveSelection(project, host.ui.selection), delta, dTracks, this.copy);
    host.invalidate();
  }

  end(): void {
    const { host } = this;
    // un clic seleziona e basta: il cursore si sposta solo dal righello, la riproduzione non si interrompe
    if (!this.moved) return;
    const changed = this.plan.some(m => m.copy || m.to !== m.track || m.start !== host.store.project.track(m.track)?.placement(m.id)?.start);
    if (!changed) return host.invalidate();
    const before = host.store.project;
    host.store.apply(relocate(this.copy ? 'Copia clip' : 'Sposta clip', this.plan));
    if (this.copy) host.ui.select(addedPlacements(before, host.store.project).map(r => r.id));
  }

  cancel(): void {
    this.plan = [];
    this.moved = false;
    this.host.invalidate();
  }

  paint(g: CanvasRenderingContext2D, geo: TimelineGeometry): void {
    const project = this.host.store.project;
    const index = new Map(project.tracks.map((t, i) => [t.id, i]));
    for (const m of this.plan) {
      const pl = project.track(m.track)?.placement(m.id);
      if (pl) paintGhost(g, geo, index.get(m.to)!, m.start, m.start + pl.length, pl.clip.color);
    }
  }
}

/** Trascinare un bordo: accorcia o allunga la clip (a sinistra sposta anche l'inizio del contenuto). */
export class ResizeClipGesture implements Gesture {
  readonly cursor = 'ew-resize';
  readonly hidden: ReadonlySet<PlacementId>;
  private edges: { start: Beats; end: Beats } | null = null;
  private readonly placement: Placement;

  constructor(private readonly host: GestureHost, private readonly hit: Extract<Hit, { kind: 'clip' }>) {
    this.placement = hit.placement;
    this.hidden = new Set([hit.placement.id]);
    host.ui.select([hit.placement.id]);
  }

  move(p: Pointer): void {
    const { host } = this;
    const beat = snapped(host, p, host.geo.xToBeat(p.x));
    const minLength = host.snapStep(p) ?? 1 / 16;
    this.edges = planResize(this.placement, this.hit.zone as 'start' | 'end', beat, Math.min(minLength, 1));
    host.invalidate();
  }

  end(): void {
    const e = this.edges;
    if (!e || (e.start === this.placement.start && e.end === placementEnd(this.placement))) return this.host.invalidate();
    this.host.store.apply(resizePlacement(this.hit.track, this.placement.id, e));
  }

  cancel(): void {
    this.edges = null;
    this.host.invalidate();
  }

  paint(g: CanvasRenderingContext2D, geo: TimelineGeometry): void {
    const e = this.edges ?? { start: this.placement.start, end: placementEnd(this.placement) };
    paintGhost(g, geo, this.hit.trackIndex, e.start, e.end, this.placement.clip.color);
  }
}

/** Trascinare nel vuoto: selezione a riquadro. Un clic senza trascinare toglie la selezione
 *  (il cursore si sposta solo dal righello). */
export class MarqueeGesture implements Gesture {
  readonly cursor = 'crosshair';
  readonly hidden = NONE;
  private current: Pointer;

  constructor(private readonly host: GestureHost, private readonly origin: Pointer) {
    this.current = origin;
  }

  move(p: Pointer): void {
    this.current = p;
    const { geo, store, ui } = this.host;
    if (!this.dragged) return;
    const refs = placementsInBox(store.project, geo.xToBeat(this.origin.x), geo.xToBeat(p.x), geo.trackIndexAt(this.origin.y), geo.trackIndexAt(p.y));
    ui.select(refs.map(r => r.id));
  }

  end(p: Pointer): void {
    this.current = p;
    const { host } = this;
    if (!this.dragged && !p.shift) host.ui.select([]);
    host.invalidate();
  }

  cancel(): void {
    this.host.invalidate();
  }

  paint(g: CanvasRenderingContext2D): void {
    if (this.dragged) paintBox(g, this.origin.x, this.origin.y, this.current.x, this.current.y);
  }

  private get dragged(): boolean {
    return Math.abs(this.current.x - this.origin.x) + Math.abs(this.current.y - this.origin.y) >= CLICK_PX;
  }
}

/** Nella fascia alta del righello: dai bordi si allunga o accorcia il loop tenendo fermo
 *  l'altro estremo, dal corpo lo si sposta, fuori se ne disegna uno nuovo; un clic lo accende o spegne. */
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
    // durante il trascinamento il loop cambia davvero (si sente subito), in un solo passo di annullamento
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

  paint(): void { /* il loop si vede sul righello */ }
}

/** Nella parte bassa del righello: sposta la testina (anche trascinando). */
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
