import { Emitter, type Unsubscribe } from '../core/emitter';
import type { PlacementId, TrackId } from '../core/id';
import { sameTarget, type KeyTarget } from '../model/key-map';
import type { TimeRange } from '../model/note-edits';
import { sameMidiTarget, type MidiTarget } from '../model/midi-map';
import type { ChainOwner } from '../model/project';
import { TimelineGeometry } from './timeline/geometry';

type UiEvents = { change: [] };

/** The session box a controller (the APC40, a Launchpad) plays: first track and first scene,
 *  width and height (Live's "red box"). */
export interface SessionRing {
  readonly track: number;
  readonly scene: number;
  readonly width: number;
  readonly height: number;
}

/** The device the controller's knobs move (Live's "blue hand"): the chain and
 *  the device, "instrument" for the instrument or the effect's id. */
export interface ControlledDevice {
  readonly owner: ChainOwner;
  readonly device: string;
}

/** Interface state that isn't part of the project (and so isn't undone):
 *  zoom, scrolling, selection, chosen track, grid snapping, "Follow". */
export class UiState {
  private _geometry = new TimelineGeometry();
  private _selection: ReadonlySet<PlacementId> = new Set();
  private _range: TimeRange | null = null;
  private _track: TrackId | null = null;
  private _tracks: ReadonlySet<TrackId> = new Set();
  private _snap = true;
  private _follow = true;
  private _followPaused = false;
  private _ring: SessionRing | null = null;
  private _controlled: ControlledDevice | null = null;
  private _keyMapping = false;
  private _keyTarget: KeyTarget | null = null;
  private _midiMapping = false;
  private _midiTarget: MidiTarget | null = null;
  private _keyboardTracks: ReadonlySet<TrackId> = new Set();
  private readonly events = new Emitter<UiEvents>();

  get geometry(): TimelineGeometry { return this._geometry; }
  get selection(): ReadonlySet<PlacementId> { return this._selection; }
  /** The time range drawn with the box inside the selected clips (Live's time
   *  selection): dragging or deleting it acts only there. Null if the clips are selected whole. */
  get range(): TimeRange | null { return this._range; }
  /** The chosen track: highlighted in the arrangement and in the session. */
  get track(): TrackId | null { return this._track; }
  /** The chosen tracks (Shift and Ctrl+click add some, Ctrl+G groups them); `track` is always there. */
  get selectedTracks(): ReadonlySet<TrackId> { return this._tracks; }
  get snap(): boolean { return this._snap; }
  /** "Follow": while playing, the arrangement scrolls to keep the playhead in view. */
  get follow(): boolean { return this._follow; }
  /** Follow is on but suspended: the user moved the view or is editing (as in Live).
   *  It resumes at the next play, with a click on the ruler or on the button. */
  get followPaused(): boolean { return this._follow && this._followPaused; }
  get following(): boolean { return this._follow && !this._followPaused; }
  /** The connected controller's box, or null if there isn't one. */
  get sessionRing(): SessionRing | null { return this._ring; }
  get controlledDevice(): ControlledDevice | null { return this._controlled; }
  /** "KEY" on (Ctrl+K): a click on a macro or a parameter chooses it, the key pressed
   *  afterwards moves it. Meanwhile the mapped keys don't play. */
  get keyMapping(): boolean { return this._keyMapping; }
  /** The target chosen with KEY on, waiting for its key. */
  get keyTarget(): KeyTarget | null { return this._keyTarget; }
  /** The MIDI tracks playing with the computer keyboard (see app/note-keyboard). */
  get keyboardTracks(): ReadonlySet<TrackId> { return this._keyboardTracks; }
  /** "MIDI" on (Ctrl+M): a click on a macro, a parameter or a mixer control
   *  chooses it, the MIDI control moved afterwards moves it. Meanwhile the mapped controls move nothing. */
  get midiMapping(): boolean { return this._midiMapping; }
  /** The target chosen with MIDI on, waiting for its control. */
  get midiTarget(): MidiTarget | null { return this._midiTarget; }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  setGeometry(g: TimelineGeometry): void {
    this._geometry = g;
    this.events.emit('change');
  }

  select(ids: Iterable<PlacementId>, range: TimeRange | null = null): void {
    this._selection = new Set(ids);
    this._range = range && range.end > range.start ? range : null;
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

  /** Shift+click: the tracks from the chosen one up to `id`, in the order `order` (the chosen one
   *  stays the fixed point). Ctrl+click: adds or removes `id`. */
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

  toggleKeyboardTrack(id: TrackId): void {
    const next = new Set(this._keyboardTracks);
    if (!next.delete(id)) next.add(id);
    this._keyboardTracks = next;
    this.events.emit('change');
  }

  /** The tracks that are gone stop listening to the keyboard. */
  keepKeyboardTracks(alive: (id: TrackId) => boolean): void {
    const next = [...this._keyboardTracks].filter(alive);
    if (next.length === this._keyboardTracks.size) return;
    this._keyboardTracks = new Set(next);
    this.events.emit('change');
  }

  /** KEY and MIDI aren't on together. */
  setKeyMapping(on: boolean): void {
    if (on === this._keyMapping) return;
    this._keyMapping = on;
    this._keyTarget = null;
    if (on) this.stopMidiMapping();
    this.events.emit('change');
  }

  setMidiMapping(on: boolean): void {
    if (on === this._midiMapping) return;
    this._midiMapping = on;
    this._midiTarget = null;
    if (on) {
      this._keyMapping = false;
      this._keyTarget = null;
    }
    this.events.emit('change');
  }

  private stopMidiMapping(): void {
    this._midiMapping = false;
    this._midiTarget = null;
  }

  chooseMidiTarget(t: MidiTarget | null): void {
    const c = this._midiTarget;
    if (!this._midiMapping || c === t || (c && t && sameMidiTarget(c, t))) return;
    this._midiTarget = t;
    this.events.emit('change');
  }

  chooseKeyTarget(t: KeyTarget | null): void {
    const c = this._keyTarget;
    if (!this._keyMapping || c === t || (c && t && sameTarget(c, t))) return;
    this._keyTarget = t;
    this.events.emit('change');
  }

  setControlledDevice(d: ControlledDevice | null): void {
    const c = this._controlled;
    if (c === d || (c && d && c.owner === d.owner && c.device === d.device)) return;
    this._controlled = d;
    this.events.emit('change');
  }
}

/** A click on a track (header, session column): chooses it; with Shift or Ctrl
 *  it widens the selection. `order` gives the order of the visible tracks. Right click on an
 *  already chosen track leaves the selection as it is (the menu applies to all). */
export function clickTrack(ui: UiState, id: TrackId, e: MouseEvent, order: () => readonly TrackId[]): void {
  if (e.button === 2 && ui.selectedTracks.has(id)) return;
  if (e.shiftKey) ui.extendTrackSelection(id, 'range', order());
  else if (e.ctrlKey || e.metaKey) ui.extendTrackSelection(id, 'toggle', order());
  else ui.selectTrack(id);
}
