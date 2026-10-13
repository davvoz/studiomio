import { Emitter, type Unsubscribe } from '../core/emitter';
import type { PlacementId } from '../core/id';
import { TimelineGeometry } from './timeline/geometry';

type UiEvents = { change: [] };

/** Stato dell'interfaccia che non fa parte del progetto (e quindi non si annulla):
 *  zoom, scorrimento, selezione, aggancio alla griglia. */
export class UiState {
  private _geometry = new TimelineGeometry();
  private _selection: ReadonlySet<PlacementId> = new Set();
  private _snap = true;
  private readonly events = new Emitter<UiEvents>();

  get geometry(): TimelineGeometry { return this._geometry; }
  get selection(): ReadonlySet<PlacementId> { return this._selection; }
  get snap(): boolean { return this._snap; }

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

  setSnap(on: boolean): void {
    this._snap = on;
    this.events.emit('change');
  }
}
