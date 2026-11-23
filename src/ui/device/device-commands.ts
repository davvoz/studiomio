/* What the device view's commands do on the open chain: copy, cut, paste, duplicate, group into a
 * rack and ungroup it. Only the decisions: the changes are the store's edits, the messages go to
 * the status bar. */
import type { DeviceId } from '../../core/id';
import type { ChainOwner } from '../../model/project';
import { rackOf, type DeviceKey } from '../../model/rack';
import type { Clipboard } from '../../store/clipboard';
import { copyDevices, copyRack, pasteDevices, removeDevices, type CopiedDevices } from '../../store/device-clipboard';
import type { Edit, ProjectStore } from '../../store/project-store';
import { groupDevices, removeRack, ungroupRack } from '../../store/rack-edits';
import type { DeviceSelection } from './device-selection';

export interface DeviceCommandDeps {
  readonly store: ProjectStore;
  readonly clipboard?: Clipboard;
  readonly say?: (text: string) => void;
}

/** What the clipboard got, with what to do next. */
export function copiedMessage(content: CopiedDevices): string {
  const n = (content.instrument ? 1 : 0) + content.effects.length;
  let copied = n > 1 ? `${n} devices copied` : 'Device copied';
  if (content.rack) copied = `Rack «${content.rack.name}» copied`;
  return `${copied}: choose a track and press Ctrl+V to paste it there.`;
}

export class DeviceCommands {
  /** `chosenChanged`: after a grouping, the view shows the selection again. */
  constructor(
    private readonly deps: DeviceCommandDeps,
    private readonly selection: DeviceSelection,
    private readonly owner: () => ChainOwner | null,
    private readonly chosenChanged: () => void,
  ) {}

  /** A change that may not be allowed: the reason goes in the status bar. */
  guard(edit: Edit): boolean {
    try {
      this.deps.store.apply(edit);
      return true;
    } catch (e) {
      this.deps.say?.(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** The devices `keys` (or the whole rack `rack`) of the chain, ready for the clipboard. */
  content(owner: ChainOwner, keys: readonly DeviceKey[], rack: DeviceId | null): CopiedDevices | null {
    const p = this.deps.store.project;
    return rack ? copyRack(p, owner, rack) : copyDevices(p, owner, keys);
  }

  /** What's chosen now, ready for the clipboard. */
  private chosenContent(): CopiedDevices | null {
    const owner = this.owner();
    return owner ? this.content(owner, this.selection.keys, this.selection.chosenRack()?.id ?? null) : null;
  }

  copy(content: CopiedDevices | null): boolean {
    if (!content || !this.deps.clipboard) return false;
    this.deps.clipboard.content = content;
    this.deps.say?.(copiedMessage(content));
    return true;
  }

  cut(owner: ChainOwner, keys: readonly DeviceKey[], rack: DeviceId | null, content: CopiedDevices | null): void {
    if (this.copy(content)) this.guard(rack ? removeRack(owner, rack) : removeDevices(owner, keys));
  }

  paste(content: CopiedDevices | null, owner: ChainOwner, after: DeviceKey | null): void {
    if (content) this.guard(pasteDevices(content, owner, after));
  }

  /** Ctrl+C: the devices chosen with a click on the name. */
  copySelection(): void {
    if (!this.copy(this.chosenContent())) this.deps.say?.('Choose a device with a click on the name, then Ctrl+C.');
  }

  cutSelection(): void {
    const owner = this.owner(), keys = this.selection.keys;
    if (owner && keys.length) this.cut(owner, keys, this.selection.chosenRack()?.id ?? null, this.chosenContent());
  }

  pasteSelection(): void {
    const owner = this.owner();
    if (!owner) return;
    const content = this.deps.clipboard?.devices ?? null;
    if (!content) return this.deps.say?.('The clipboard has no devices.');
    this.paste(content, owner, this.selection.last());
  }

  duplicateSelection(): void {
    const owner = this.owner();
    if (owner && this.selection.keys.length) this.paste(this.chosenContent(), owner, this.selection.last());
  }

  /** Ctrl+G: the chosen devices (or `keys`) into a new rack. */
  groupSelection(keys: readonly DeviceKey[] = this.selection.keys): void {
    const owner = this.owner();
    if (!owner) return;
    if (!keys.length) return this.deps.say?.('Choose the devices to group: click on the name, Shift+click for more than one; then Ctrl+G.');
    if (this.guard(groupDevices(owner, keys))) this.selection.clear();
    this.chosenChanged();
  }

  /** Ctrl+Shift+G: ungroups the rack of the chosen devices. */
  ungroupSelection(): void {
    const owner = this.owner(), keys = this.selection.keys;
    const rack = owner && keys.length ? this.selection.chosenRack() ?? rackOf(this.deps.store.project.racksOf(owner), keys[0]) : undefined;
    if (!owner || !rack) return this.deps.say?.('Choose a rack (click on its name), then Ctrl+Shift+G to ungroup it.');
    this.guard(ungroupRack(owner, rack.id));
  }
}

/** Ctrl+key on the chosen devices. */
export const DEVICE_KEYS: Readonly<Record<string, (c: DeviceCommands) => void>> = {
  c: c => c.copySelection(),
  x: c => c.cutSelection(),
  v: c => c.pasteSelection(),
  d: c => c.duplicateSelection(),
};
