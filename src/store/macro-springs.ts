/* Le macro molla: chiunque le muova (il mouse, un tasto, una nota o un CC della mappa MIDI, le
 * manopole dell'APC40 e dei Launchpad), lasciate tornano da sole al loro riposo, nel tempo di
 * ritorno della molla e da dovunque siano. Lasciate vuol dire: chi sa quando le si lascia (il
 * mouse, i tasti, le note) lo dice con `hold`; per gli altri (un CC, una manopola senza fine)
 * conta come lasciata una macro che non si muove da SPRING_IDLE_MS. Il ritorno non è un passo di
 * annullamento: riporta il progetto com'era. */
import type { DeviceId } from '../core/id';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { findRack, springOf } from '../model/rack';
import { edit, type ProjectStore } from './project-store';
import { setMacro } from './rack-edits';

/** Dopo quanto una macro mossa da chi non dice quando la lascia conta come lasciata. */
export const SPRING_IDLE_MS = 200;
/** Ogni quanto la molla fa un passo. */
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

/** Una macro tirata: dov'è, quando la si è mossa l'ultima volta, e da dove e quando ha
 *  cominciato a tornare (null: non torna ancora). */
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
  /** Quanti tengono ogni macro (il mouse e un tasto insieme, per esempio). */
  private readonly holders = new Map<string, number>();
  /** L'ultimo valore scritto dalla molla: quello non è qualcuno che la muove. */
  private readonly written = new Map<string, number>();
  private stopTimer: (() => void) | null = null;

  constructor(private readonly store: ProjectStore, private readonly clock: SpringClock = realClock) {
    store.onChange((p, _previous, cause) => this.changed(p, cause === 'load'));
  }

  /** Qualcuno prende (`down`) o lascia la macro: tenuta non torna; lasciata torna subito. */
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

  /** Vero se qualche molla è tirata (per i test e la diagnosi). */
  get pulling(): boolean {
    return this.pulls.size > 0;
  }

  /** Le molle lontane dal riposo che non ha spostato la molla stessa: qualcuno le ha mosse. */
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

  /** Un passo di ogni molla lasciata: in linea retta verso il riposo, in tempo per arrivarci. */
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
    this.store.apply(edit('Molla', (next, ctx) => moves.reduce(
      (q, { pull, value }) => setMacro(pull.owner, pull.rack, pull.index, value).apply(q, ctx), next)), { transient: true });
  }

  private stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }
}
