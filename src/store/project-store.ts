import { Emitter, type Unsubscribe } from '../core/emitter';
import type { IdFactory } from '../core/id';
import type { Project } from '../model/project';

export interface EditContext {
  readonly ids: IdFactory;
}

/** A project edit: pure function from the old project to the new one, with the
 *  name appearing in "Undo …". */
export interface Edit {
  readonly label: string;
  apply(project: Project, ctx: EditContext): Project;
}

export const edit = (label: string, apply: (p: Project, ctx: EditContext) => Project): Edit => ({ label, apply });

export type ChangeCause = 'edit' | 'undo' | 'redo' | 'load';

export interface ApplyOptions {
  /** Consecutive edits with the same key (e.g. a drag) become a single
   *  undo step, until `endMerge()` is called. */
  readonly mergeKey?: string;
  /** A change that undoes itself (a button held down and then released): it doesn't become an
   *  undo step and doesn't remove those to redo. */
  readonly transient?: boolean;
}

interface Step {
  readonly project: Project;
  readonly label: string;
}

type StoreEvents = {
  change: [project: Project, previous: Project, cause: ChangeCause];
};

/** Container of the current project with history. The views read `project` and
 *  subscribe to `change`; nobody changes the project except through `apply`. */
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

  /** Id factory, for whoever prepares data to insert with an edit (e.g. a sample). */
  get ids(): IdFactory {
    return this.ctx.ids;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  /** Name of the edit "Undo" would remove. */
  get undoLabel(): string | null { return this.past.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.future.at(-1)?.label ?? null; }

  onChange(listener: (project: Project, previous: Project, cause: ChangeCause) => void): Unsubscribe {
    return this.events.on('change', listener);
  }

  /** Applies an edit. If the edit throws an error the project stays as it was. */
  apply(e: Edit, opts: ApplyOptions = {}): Project {
    const previous = this.current;
    const next = e.apply(previous, this.ctx);
    if (next === previous) return previous;
    if (opts.transient) {
      this.current = next;
      this.events.emit('change', next, previous, 'edit');
      return next;
    }
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

  /** Closes the continuous edit in progress (e.g. on mouse release). */
  endMerge(): void {
    this.mergeKey = null;
  }

  undo(): void {
    this.travel(this.past, this.future, 'undo');
  }

  redo(): void {
    this.travel(this.future, this.past, 'redo');
  }

  /** Replaces the project (opening a file): the history restarts from zero. */
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
