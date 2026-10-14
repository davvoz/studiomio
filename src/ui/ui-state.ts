import { Emitter, type Unsubscribe } from '../core/emitter';
import type { PlacementId, TrackId } from '../core/id';
import type { ChainOwner } from '../model/project';
import { TimelineGeometry } from './timeline/geometry';

type UiEvents = { change: [] };

/** Il riquadro della session che un controller (l'APC40) suona: prima traccia e prima scena,
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
 *  zoom, scorrimento, selezione, traccia scelta, aggancio alla griglia. */
export class UiState {
  private _geometry = new TimelineGeometry();
  private _selection: ReadonlySet<PlacementId> = new Set();
  private _track: TrackId | null = null;
  private _snap = true;
  private _ring: SessionRing | null = null;
  private _controlled: ControlledDevice | null = null;
  private readonly events = new Emitter<UiEvents>();

  get geometry(): TimelineGeometry { return this._geometry; }
  get selection(): ReadonlySet<PlacementId> { return this._selection; }
  /** La traccia scelta: evidenziata nell'arrangement e nella session. */
  get track(): TrackId | null { return this._track; }
  get snap(): boolean { return this._snap; }
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
    if (id === this._track) return;
    this._track = id;
    this.events.emit('change');
  }

  setSnap(on: boolean): void {
    this._snap = on;
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
