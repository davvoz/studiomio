/* The spring macros: whoever moves them (the mouse, a key, a note or a CC of the MIDI map, the
 * knobs of the APC40 and the Launchpads), once released they return by themselves to their rest, in the spring's
 * return time and from wherever they are. Released means: whoever knows when they're let go (the
 * mouse, the keys, the notes) says so with `hold`; for the others (a CC, an endless knob)
 * a macro that hasn't moved for SPRING_IDLE_MS counts as released. The return isn't an undo
 * step: it brings the project back as it was. */
import type { DeviceId } from '../core/id';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { findRack, springOf } from '../model/rack';
import { edit, type ProjectStore } from './project-store';
import { setMacro } from './rack-edits';

/** After how long a macro moved by someone who doesn't say when they let it go counts as released. */
export const SPRING_IDLE_MS = 200;
/** How often the spring takes a step. */
const FRAME_MS = 15;

export interface SpringClock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

const realClock: SpringClock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

/** A pulled macro: where it is, when it was last moved, and from where and when it
 *  started to return (null: it isn't returning yet). */
interface Pull {
  readonly owner: ChainOwner;
  readonly rack: DeviceId;
  readonly index: number;
  touched: number;
  from: { readonly value: number; readonly at: number } | null;
}

const keyOf = (owner: ChainOwner, rack: DeviceId, index: number) => `${owner}|${rack}|${index}`;

export class MacroSprings {
  private readonly pulls = new Map<string, Pull>();
  /** How many hold each macro (the mouse and a key together, for example). */
  private readonly holders = new Map<string, number>();
  /** The last value written by the spring: that's not someone moving it. */
  private readonly written = new Map<string, number>();
  private stopTimer: (() => void) | null = null;

  constructor(private readonly store: ProjectStore, private readonly clock: SpringClock = realClock) {
    store.onChange((p, _previous, cause) => this.changed(p, cause === 'load'));
  }

  /** Someone takes (`down`) or releases the macro: held it doesn't return; released it returns right away. */
  hold(owner: ChainOwner, rack: DeviceId, index: number, down: boolean): void {
    const k = keyOf(owner, rack, index);
    const n = (this.holders.get(k) ?? 0) + (down ? 1 : -1);
    if (n > 0) this.holders.set(k, n);
    else this.holders.delete(k);
    const pull = this.pulls.get(k);
    if (!pull || this.holders.has(k)) return;
    pull.from = null;
    pull.touched = this.clock.now() - SPRING_IDLE_MS;
  }

  /** True if some spring is pulled (for tests and diagnosis). */
  get pulling(): boolean {
    return this.pulls.size > 0;
  }

  /** The springs away from rest that the spring itself didn't move: someone moved them. */
  private changed(p: Project, loaded: boolean): void {
    if (loaded) {
      this.pulls.clear();
      this.holders.clear();
      this.written.clear();
    }
    const now = this.clock.now(), seen = new Set<string>();
    for (const owner of [...p.channels.map(t => t.id), MASTER] as ChainOwner[]) {
      for (const r of p.racksOf(owner)) {
        r.macros.forEach((m, index) => {
          const s = springOf(m);
          if (!s || m.value === s.rest) return;
          const k = keyOf(owner, r.id, index);
          seen.add(k);
          if (this.written.get(k) === m.value) return;
          this.written.delete(k);
          const pull = this.pulls.get(k);
          if (pull) {
            pull.touched = now;
            pull.from = null;
          } else {
            this.pulls.set(k, { owner, rack: r.id, index, touched: now, from: null });
          }
        });
      }
    }
    for (const k of this.pulls.keys()) {
      if (seen.has(k)) continue;
      this.pulls.delete(k);
      this.written.delete(k);
    }
    if (this.pulls.size && !this.stopTimer) this.stopTimer = this.clock.every(FRAME_MS, () => this.step());
    else if (!this.pulls.size) this.stop();
  }

  /** One step of each released spring: in a straight line towards rest, in time to get there. */
  private step(): void {
    const p = this.store.project, now = this.clock.now();
    const moves: { pull: Pull; value: number }[] = [];
    for (const [k, pull] of this.pulls) {
      if (this.holders.has(k)) {
        pull.touched = now;
        pull.from = null;
        continue;
      }
      const m = findRack(p.racksOf(pull.owner), pull.rack)?.macros[pull.index];
      const s = m && springOf(m);
      if (!m || !s) continue;
      if (!pull.from) {
        if (now - pull.touched < SPRING_IDLE_MS) continue;
        pull.from = { value: m.value, at: now };
      }
      const ms = s.sync ? p.tempo.secondsAt(s.time) * 1000 : s.time;
      const t = Math.min(1, (now - pull.from.at) / ms);
      const value = t >= 1 ? s.rest : pull.from.value + (s.rest - pull.from.value) * t;
      this.written.set(k, value);
      moves.push({ pull, value });
    }
    if (!moves.length) return;
    this.store.apply(edit('Spring', (next, ctx) => moves.reduce(
      (q, { pull, value }) => setMacro(pull.owner, pull.rack, pull.index, value).apply(q, ctx), next)), { transient: true });
  }

  private stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }
}
