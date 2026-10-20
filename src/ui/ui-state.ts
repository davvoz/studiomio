import { Emitter, type Unsubscribe } from '../core/emitter';
import type { PlacementId, TrackId } from '../core/id';
import type { ChainOwner } from '../model/project';
import { TimelineGeometry } from './timeline/geometry';

type UiEvents = { change: [] };

/** Il riquadro della session che un controller (l'APC40, un Launchpad) suona: prima traccia e prima scena,
 *  larghezza e altezza (il "riquadro rosso" di Live). */
export interface SessionRing {
  readonly track: number;
  readonly scene: number;
  readonly width: number;
  readonly height: number;
}

/** Il dispositivo che le manopole del controller muovono (la "mano blu" di Live): la catena e
 *  il dispositivo, "instrument" per lo strumento o l'id dell'effetto. */
export interface ControlledDevice {
  readonly owner: ChainOwner;
  readonly device: string;
}

/** Stato dell'interfaccia che non fa parte del progetto (e quindi non si annulla):
 *  zoom, scorrimento, selezione, traccia scelta, aggancio alla griglia, "Segui". */
export class UiState {
  private _geometry = new TimelineGeometry();
  private _selection: ReadonlySet<PlacementId> = new Set();
  private _track: TrackId | null = null;
  private _tracks: ReadonlySet<TrackId> = new Set();
  private _snap = true;
  private _follow = true;
  private _followPaused = false;
  private _ring: SessionRing | null = null;
  private _controlled: ControlledDevice | null = null;
  private readonly events = new Emitter<UiEvents>();

  get geometry(): TimelineGeometry { return this._geometry; }
  get selection(): ReadonlySet<PlacementId> { return this._selection; }
  /** La traccia scelta: evidenziata nell'arrangement e nella session. */
  get track(): TrackId | null { return this._track; }
  /** Le tracce scelte (Maiusc e Ctrl+clic ne aggiungono, Ctrl+G le raggruppa); c'è sempre `track`. */
  get selectedTracks(): ReadonlySet<TrackId> { return this._tracks; }
  get snap(): boolean { return this._snap; }
  /** "Segui": mentre suona, l'arrangement scorre per tenere in vista la testina. */
  get follow(): boolean { return this._follow; }
  /** Segui è acceso ma sospeso: l'utente ha spostato la vista o sta modificando (come in Live).
   *  Riprende al prossimo play, con un clic sul righello o sul pulsante. */
  get followPaused(): boolean { return this._follow && this._followPaused; }
  get following(): boolean { return this._follow && !this._followPaused; }
  /** Il riquadro del controller collegato, o null se non ce n'è. */
  get sessionRing(): SessionRing | null { return this._ring; }
  get controlledDevice(): ControlledDevice | null { return this._controlled; }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  setGeometry(g: TimelineGeometry): void {
    this._geometry = g;
    this.events.emit('change');
  }

  select(ids: Iterable<PlacementId>): void {
    this._selection = new Set(ids);
    this.events.emit('change');
  }

  toggle(id: PlacementId): void {
    const s = new Set(this._selection);
    if (s.has(id)) s.delete(id); else s.add(id);
    this.select(s);
  }

  selectTrack(id: TrackId | null): void {
    if (id === this._track && this._tracks.size === (id ? 1 : 0)) return;
    this._track = id;
    this._tracks = new Set(id ? [id] : []);
    this.events.emit('change');
  }

  /** Maiusc+clic: le tracce da quella scelta fino a `id`, nell'ordine `order` (quella scelta
   *  resta il punto fermo). Ctrl+clic: aggiunge o toglie `id`. */
  extendTrackSelection(id: TrackId, mode: 'range' | 'toggle', order: readonly TrackId[]): void {
    const from = this._track ? order.indexOf(this._track) : -1, to = order.indexOf(id);
    if (mode === 'range' && from >= 0 && to >= 0) {
      this._tracks = new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else if (this._tracks.has(id) && this._tracks.size > 1) {
      this._tracks = new Set([...this._tracks].filter(t => t !== id));
      if (this._track === id) this._track = [...this._tracks].at(-1)!;
    } else {
      this._tracks = new Set([...this._tracks, id]);
      this._track = id;
    }
    this.events.emit('change');
  }

  setSnap(on: boolean): void {
    this._snap = on;
    this.events.emit('change');
  }

  setFollow(on: boolean): void {
    if (on === this._follow && !this._followPaused) return;
    this._follow = on;
    this._followPaused = false;
    this.events.emit('change');
  }

  pauseFollow(): void {
    if (!this.following) return;
    this._followPaused = true;
    this.events.emit('change');
  }

  resumeFollow(): void {
    if (!this.followPaused) return;
    this._followPaused = false;
    this.events.emit('change');
  }

  setSessionRing(ring: SessionRing | null): void {
    const r = this._ring;
    if (r === ring || (r && ring && r.track === ring.track && r.scene === ring.scene && r.width === ring.width && r.height === ring.height)) return;
    this._ring = ring;
    this.events.emit('change');
  }

  setControlledDevice(d: ControlledDevice | null): void {
    const c = this._controlled;
    if (c === d || (c && d && c.owner === d.owner && c.device === d.device)) return;
    this._controlled = d;
    this.events.emit('change');
  }
}

/** Un clic su una traccia (intestazione, colonna della session): la sceglie; con Maiusc o Ctrl
 *  allarga la scelta. `order` dà l'ordine delle tracce che si vedono. Il tasto destro su una
 *  traccia già scelta lascia la scelta com'è (il menu vale per tutte). */
export function clickTrack(ui: UiState, id: TrackId, e: MouseEvent, order: () => readonly TrackId[]): void {
  if (e.button === 2 && ui.selectedTracks.has(id)) return;
  if (e.shiftKey) ui.extendTrackSelection(id, 'range', order());
  else if (e.ctrlKey || e.metaKey) ui.extendTrackSelection(id, 'toggle', order());
  else ui.selectTrack(id);
}
