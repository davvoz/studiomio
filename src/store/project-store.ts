import { Emitter, type Unsubscribe } from '../core/emitter';
import type { IdFactory } from '../core/id';
import type { Project } from '../model/project';

export interface EditContext {
  readonly ids: IdFactory;
}

/** Una modifica del progetto: funzione pura dal progetto vecchio a quello nuovo, con il
 *  nome che compare in "Annulla …". */
export interface Edit {
  readonly label: string;
  apply(project: Project, ctx: EditContext): Project;
}

export const edit = (label: string, apply: (p: Project, ctx: EditContext) => Project): Edit => ({ label, apply });

export type ChangeCause = 'edit' | 'undo' | 'redo' | 'load';

export interface ApplyOptions {
  /** Modifiche consecutive con la stessa chiave (es. un trascinamento) diventano un solo
   *  passo di annullamento, finché non si chiama `endMerge()`. */
  readonly mergeKey?: string;
}

interface Step {
  readonly project: Project;
  readonly label: string;
}

type StoreEvents = {
  change: [project: Project, previous: Project, cause: ChangeCause];
};

/** Contenitore del progetto corrente con cronologia. Le viste leggono `project` e si
 *  iscrivono a `change`; nessuno modifica il progetto se non attraverso `apply`. */
export class ProjectStore {
  private current: Project;
  private past: Step[] = [];
  private future: Step[] = [];
  private mergeKey: string | null = null;
  private readonly events = new Emitter<StoreEvents>();
  private readonly ctx: EditContext;

  constructor(initial: Project, ids: IdFactory, private readonly historyLimit = 200) {
    this.current = initial;
    this.ctx = { ids };
  }

  get project(): Project {
    return this.current;
  }

  /** Fabbrica degli id, per chi prepara dati da inserire con una modifica (es. un sample). */
  get ids(): IdFactory {
    return this.ctx.ids;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  /** Nome della modifica che "Annulla" toglierebbe. */
  get undoLabel(): string | null { return this.past.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.future.at(-1)?.label ?? null; }

  onChange(listener: (project: Project, previous: Project, cause: ChangeCause) => void): Unsubscribe {
    return this.events.on('change', listener);
  }

  /** Applica una modifica. Se la modifica lancia un errore il progetto resta com'era. */
  apply(e: Edit, opts: ApplyOptions = {}): Project {
    const previous = this.current;
    const next = e.apply(previous, this.ctx);
    if (next === previous) return previous;
    const merging = opts.mergeKey !== undefined && opts.mergeKey === this.mergeKey;
    if (!merging) {
      this.past.push({ project: previous, label: e.label });
      if (this.past.length > this.historyLimit) this.past.shift();
    }
    this.mergeKey = opts.mergeKey ?? null;
    this.future = [];
    this.current = next;
    this.events.emit('change', next, previous, 'edit');
    return next;
  }

  /** Chiude la modifica continua in corso (es. al rilascio del mouse). */
  endMerge(): void {
    this.mergeKey = null;
  }

  undo(): void {
    this.travel(this.past, this.future, 'undo');
  }

  redo(): void {
    this.travel(this.future, this.past, 'redo');
  }

  /** Sostituisce il progetto (apertura di un file): la cronologia riparte da zero. */
  load(project: Project): void {
    const previous = this.current;
    this.current = project;
    this.past = [];
    this.future = [];
    this.mergeKey = null;
    this.events.emit('change', project, previous, 'load');
  }

  private travel(from: Step[], to: Step[], cause: 'undo' | 'redo'): void {
    const step = from.pop();
    if (!step) return;
    const previous = this.current;
    to.push({ project: previous, label: step.label });
    this.current = step.project;
    this.mergeKey = null;
    this.events.emit('change', step.project, previous, cause);
  }
}
