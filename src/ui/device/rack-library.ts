/* The racks saved for all the projects, from a rack's panel: saving it (it takes the name it's saved
 * with, as in Live), updating or deleting the one with its name, opening their folder. */
import { deviceAt } from '../../devices/rack-params';
import { userRacks } from '../../devices/user-racks';
import type { ChainOwner } from '../../model/project';
import { findRack, rackName, type Rack } from '../../model/rack';
import { captureRack, type RackPreset } from '../../model/rack-preset';
import { renameRack, springsAtRest } from '../../store/rack-edits';
import type { ProjectStore } from '../../store/project-store';
import type { MenuItem } from '../context-menu';

/** Where the racks are kept (the app's: `userRacks`). */
export interface RackShelf {
  has(name: string): boolean;
  save(rack: RackPreset): Promise<void>;
  remove(name: string): Promise<void>;
  readonly canReveal: boolean;
  reveal(): Promise<void>;
}

export interface RackLibraryOptions {
  readonly store: ProjectStore;
  readonly owner: ChainOwner;
  readonly rack: Rack;
  readonly say?: (text: string) => void;
  readonly shelf?: RackShelf;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class RackLibrary {
  private readonly shelf: RackShelf;

  constructor(private readonly o: RackLibraryOptions) {
    this.shelf = o.shelf ?? userRacks;
  }

  /** The header's items: save (`ask` asks the name), update or delete the saved rack with this name, the folder. */
  menu(ask: () => void): MenuItem[] {
    const name = rackName(this.o.rack);
    const saved = this.shelf.has(name);
    return [
      { label: 'Save the rack…', run: () => ask() },
      { label: `Update the saved rack «${name}»`, disabled: !saved, run: () => void this.save(name) },
      { label: `Delete the saved rack «${name}»`, disabled: !saved, run: () => void this.remove(name) },
      ...(this.shelf.canReveal ? [{ label: 'Open the racks folder', run: () => void this.shelf.reveal().catch(e => this.o.say?.(message(e))) }] : []),
    ];
  }

  /** Saves the rack as it is now; the rack takes the name it's saved with. */
  async save(name: string): Promise<void> {
    const { store, owner, rack, say } = this.o;
    const existed = this.shelf.has(name);
    try {
      await this.shelf.save(captureRack(springsAtRest(store.project), owner, rack.id, name));
    } catch (e) {
      say?.(`Couldn't save the rack «${name}»: ${message(e)}`);
      return;
    }
    const now = findRack(store.project.racksOf(owner), rack.id);
    if (now && now.name !== name) store.apply(renameRack(owner, rack.id, name));
    // the samples are project files: only the parameters remain in the saved rack
    const samples = rack.devices.some(k => deviceAt(store.project, owner, k)?.samples);
    const note = samples ? ' The loaded samples aren\'t in the saved rack.' : '';
    say?.(existed ? `Rack «${name}» updated.${note}` : `Rack «${name}» saved: you'll find it in the browser, in all projects.${note}`);
  }

  async remove(name: string): Promise<void> {
    try {
      await this.shelf.remove(name);
    } catch (e) {
      this.o.say?.(`Couldn't delete the rack «${name}»: ${message(e)}`);
      return;
    }
    this.o.say?.(`Saved rack «${name}» deleted (the one in the project stays).`);
  }
}
