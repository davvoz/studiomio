import type { PlacementId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { placementEnd, type Placement } from '../../model/arrangement';
import { resizePlacement, setLoopRegion } from '../../store/edits';
import type { TimeRange } from '../../model/note-edits';
import type { LoopRegion, Project } from '../../model/project';
import { edit } from '../../store/project-store';
import { dragLoop, LOOP_CURSOR, loopPartAt, type LoopPart } from '../loop-drag';
import type { ProjectStore } from '../../store/project-store';
import { addedPlacements, cutOutRange, findPlacement, relocate, type PlacementRef, type Relocation } from '../../store/selection-edits';
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
  /** Il progetto da disegnare al posto di quello vero durante l'anteprima (es. clip divise). */
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

/** Trascinare clip: sposta (o copia, con Ctrl) tutta la selezione, anche su altre tracce.
 *  Se si prende il tratto di tempo selezionato, come in Live le clip si dividono ai suoi bordi e
 *  si sposta solo quello: la divisione si vede subito, ma entra nel progetto solo al rilascio. */
export class MoveClipsGesture implements Gesture {
  readonly cursor = 'grabbing';
  private plan: Relocation[] = [];
  private moved = false;
  private copy = false;
  private readonly startBeat: Beats;
  private readonly base: Project;
  private readonly range: TimeRange | null;
  /** Il progetto da cui si sposta (diviso, se si trascina un tratto) e le clip che si spostano. */
  private source: Project;
  private refs: PlacementRef[] = [];
  private hiddenIds: ReadonlySet<PlacementId> = NONE;

  constructor(private readonly host: GestureHost, private readonly hit: Extract<Hit, { kind: 'clip' }>, private readonly origin: Pointer) {
    const { ui } = host;
    const id = hit.placement.id, r = ui.range;
    if (origin.shift) ui.toggle(id);
    // fuori dal tratto selezionato si prende la clip intera
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
    // un clic seleziona e basta: il cursore si sposta solo dal righello, la riproduzione non si interrompe
    if (!this.moved) return;
    const changed = this.plan.some(m => m.copy || m.to !== m.track || m.start !== source.track(m.track)?.placement(m.id)?.start);
    // tornati al punto di partenza il tratto non si stacca
    if (!changed || host.store.project !== this.base) return host.invalidate();
    const label = this.copy ? 'Copia clip' : 'Sposta clip';
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

  /** All'inizio del trascinamento: le clip da spostare (i pezzi del tratto, se c'è). */
  private begin(): void {
    const { host, range } = this;
    const selected = resolveSelection(this.base, host.ui.selection);
    if (range) ({ project: this.source, pieces: this.refs } = cutOutRange(this.base, host.store.ids, selected, range));
    else this.refs = selected;
    this.hiddenIds = new Set(this.refs.map(r => r.id));
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

/** Trascinare nel vuoto: selezione a riquadro, con i bordi sulla griglia. Se il riquadro prende
 *  le clip solo in parte, resta selezionato quel tratto di tempo (come in Live): trascinarlo lo
 *  stacca dalla clip. Un clic senza trascinare toglie la selezione (il cursore si sposta solo dal righello). */
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

  /** Il tratto di tempo del riquadro, agganciato alla griglia. */
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

/** Tasto centrale trascinato: la vista segue la mano, avanti e indietro e su e giù. */
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
