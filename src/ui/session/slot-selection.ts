/* The chosen slots of the session: the cursor (the slot the keyboard moves and that's pasted onto),
 * all the chosen slots, and the anchor Shift extends from. Only the rules, no DOM: the view draws
 * the selection and reacts to `onPick`. */
import type { TrackId } from '../../core/id';
import type { Project } from '../../model/project';
import type { SlotRef } from '../../store/session-edits';

export const slotKey = (track: TrackId, slot: number): string => `${track}:${slot}`;
const keyOf = (r: SlotRef): string => slotKey(r.track, r.slot);
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** Where the cursor of slot `s` goes when the scene at `from` is moved to `to`: it stays on its clip. */
export function slotAfterSceneMove(s: number, from: number, to: number): number {
  if (s === from) return to;
  if (s > from && s <= to) return s - 1;
  if (s < from && s >= to) return s + 1;
  return s;
}

/** The slots just below the block `refs` covers (where Duplicate puts the copies). */
export function belowBlock(refs: readonly SlotRef[]): SlotRef[] {
  const slots = refs.map(r => r.slot);
  const height = Math.max(...slots) - Math.min(...slots) + 1;
  return refs.map(r => ({ ...r, slot: r.slot + height }));
}

export class SlotSelection {
  /** The cursor's slot. */
  private cursorRef: SlotRef | null = null;
  /** All the chosen slots (the cursor included), by key. */
  private readonly picked = new Map<string, SlotRef>();
  /** The slot Shift extends the selection from. */
  private anchor: SlotRef | null = null;

  /** `onPick`: after every choice, with the new cursor. */
  constructor(private readonly project: () => Project, private readonly onPick: (cursor: SlotRef) => void = () => {}) {}

  get cursor(): SlotRef | null {
    return this.cursorRef;
  }

  get size(): number {
    return this.picked.size;
  }

  has(ref: SlotRef): boolean {
    return this.picked.has(keyOf(ref));
  }

  /** The chosen slots that have a clip. */
  clips(): SlotRef[] {
    const p = this.project();
    return [...this.picked.values()].filter(r => p.track(r.track)?.slots[r.slot]);
  }

  /** The clips a drag from `from` carries along: the chosen ones, if `from` is among them. */
  carried(from: SlotRef): SlotRef[] {
    return this.has(from) ? this.clips() : [from];
  }

  /** A single slot: the cursor, and from there the selection extends. */
  select(ref: SlotRef): void {
    this.anchor = ref;
    this.pick([ref]);
  }

  /** Chooses these slots; the cursor is `cursor`. Shift's starting point doesn't change. */
  pick(refs: readonly SlotRef[], cursor: SlotRef = refs[0]): void {
    this.cursorRef = cursor;
    this.picked.clear();
    for (const r of refs) this.picked.set(keyOf(r), r);
    this.picked.set(keyOf(cursor), cursor);
    this.onPick(cursor);
  }

  /** Moves only the cursor, onto a slot already chosen (the others stay chosen). */
  moveCursor(ref: SlotRef): void {
    this.cursorRef = ref;
  }

  /** The rectangle of slots between `from` and `to`: the cursor goes on `to`. */
  pickRange(from: SlotRef, to: SlotRef): void {
    const tracks = this.project().visibleTracks;
    const a = tracks.findIndex(t => t.id === from.track), b = tracks.findIndex(t => t.id === to.track);
    if (a < 0 || b < 0) return this.select(to);
    const top = Math.min(from.slot, to.slot), bottom = Math.max(from.slot, to.slot);
    const refs = tracks.slice(Math.min(a, b), Math.max(a, b) + 1)
      .flatMap(t => Array.from({ length: bottom - top + 1 }, (_, i) => ({ track: t.id, slot: top + i })));
    this.anchor = from;
    this.pick(refs, to);
  }

  /** Shift+click on `ref`: from the anchor (or the cursor) to `ref`. */
  extendTo(ref: SlotRef): void {
    this.pickRange(this.anchor ?? this.cursorRef ?? ref, ref);
  }

  /** Ctrl+click: the slot enters or leaves the selection. */
  toggle(ref: SlotRef): void {
    const key = keyOf(ref);
    if (!this.picked.has(key)) {
      this.anchor = ref;
      return this.pick([...this.picked.values(), ref], ref);
    }
    const rest = [...this.picked.values()].filter(r => keyOf(r) !== key);
    if (rest.length) this.pick(rest, rest.at(-1));
  }

  /** The arrows: the cursor moves by columns and rows, inside the grid (the first slot if there's none). */
  move(dx: number, dy: number): void {
    const p = this.project(), s = this.cursorRef, tracks = p.visibleTracks;
    if (!tracks.length) return;
    const col = s ? Math.max(0, tracks.findIndex(t => t.id === s.track)) : 0;
    const c = clamp(col + dx, 0, tracks.length - 1);
    const slot = clamp((s?.slot ?? 0) + (s ? dy : 0), 0, p.scenes.length - 1);
    this.select({ track: tracks[c].id, slot });
  }

  /** Shift+arrows: the rectangle from the anchor widens with the cursor. */
  extend(dx: number, dy: number): void {
    const p = this.project(), s = this.cursorRef, tracks = p.visibleTracks;
    if (!s) return this.move(dx, dy);
    const c = clamp(tracks.findIndex(t => t.id === s.track) + dx, 0, tracks.length - 1);
    this.pickRange(this.anchor ?? s, { track: tracks[c].id, slot: clamp(s.slot + dy, 0, p.scenes.length - 1) });
  }

  /** Ctrl+A: all the clips of the grid. */
  selectAll(): void {
    const refs = this.project().visibleTracks.flatMap(t => t.slots.flatMap((c, slot) => (c ? [{ track: t.id, slot }] : [])));
    if (refs.length) this.pick(refs, this.cursorRef ?? refs[0]);
  }

  /** After the scene at `from` moved to `to`: the cursor follows its clip. */
  followSceneMove(from: number, to: number): void {
    const s = this.cursorRef;
    if (s) this.select({ ...s, slot: slotAfterSceneMove(s.slot, from, to) });
  }

  /** Forgets the slots that are no longer in the grid (a track hidden or removed, a scene deleted). */
  prune(): void {
    const p = this.project(), tracks = p.visibleTracks, rows = p.scenes.length;
    const inGrid = (r: SlotRef) => r.slot < rows && tracks.some(t => t.id === r.track);
    if (this.cursorRef && !inGrid(this.cursorRef)) this.cursorRef = null;
    for (const [key, r] of this.picked) if (!inGrid(r)) this.picked.delete(key);
  }
}
