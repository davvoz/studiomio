/* The devices chosen in the open chain (a click on the name, Shift+click for a range, a click on a
 * rack's name for its devices): what Ctrl+G groups, Ctrl+C copies, Ctrl+V pastes after. Only the
 * rules, no DOM. */
import type { DeviceId } from '../../core/id';
import type { ChainOwner, Project } from '../../model/project';
import { findRack, type DeviceKey, type Rack } from '../../model/rack';

/** The device of `keys` coming last in the sound (`order`: the chain's keys); null for none (or
 *  none in the chain). */
export function lastInChain(order: readonly DeviceKey[], keys: readonly DeviceKey[]): DeviceKey | null {
  return keys.length ? order[Math.max(...keys.map(k => order.indexOf(k)))] ?? null : null;
}

const sameKeys = (a: readonly DeviceKey[], b: readonly DeviceKey[]): boolean => a.length === b.length && a.every(k => b.includes(k));

export class DeviceSelection {
  private chosen: DeviceKey[] = [];
  /** Where Shift+click extends from. */
  private anchor: DeviceKey | null = null;
  /** The rack chosen with a click on its name (its devices are the selection). */
  private rackId: DeviceId | null = null;

  constructor(private readonly project: () => Project, private readonly owner: () => ChainOwner | null) {}

  get keys(): readonly DeviceKey[] {
    return this.chosen;
  }

  includes(key: DeviceKey): boolean {
    return this.chosen.includes(key);
  }

  /** Nothing chosen (another chain, or the devices just grouped). */
  clear(): void {
    this.chosen = [];
  }

  /** Forgets the devices no longer in the chain (`order`). */
  keepIn(order: readonly DeviceKey[]): void {
    this.chosen = this.chosen.filter(k => order.includes(k));
  }

  /** The chain's keys in the order of the sound. */
  private order(): readonly DeviceKey[] {
    const owner = this.owner();
    return owner ? this.project().chainKeys(owner) : [];
  }

  /** Click on the name of a device (or of a rack, `rack`: its devices); with Shift the selection
   *  goes from the first chosen up to here. Another click on the same selection removes it. */
  click(keys: readonly DeviceKey[], extend: boolean, rack: DeviceId | null = null): void {
    const order = this.order();
    if (extend && this.anchor && order.includes(this.anchor)) {
      const ends = [this.anchor, ...keys].map(k => order.indexOf(k));
      this.chosen = order.slice(Math.min(...ends), Math.max(...ends) + 1);
      this.rackId = null;
      return;
    }
    const same = sameKeys(keys, this.chosen) && rack === this.rackId;
    this.chosen = same ? [] : [...keys];
    this.anchor = same ? null : keys[0];
    this.rackId = same ? null : rack;
  }

  /** The rack chosen with a click on its name, if the selection is still its devices. */
  chosenRack(): Rack | undefined {
    const owner = this.owner();
    const rack = owner && this.rackId ? findRack(this.project().racksOf(owner), this.rackId) : undefined;
    return rack && sameKeys(rack.devices, this.chosen) ? rack : undefined;
  }

  /** A rack's panel lights up when all its devices are chosen; of a rack chosen with a click on
   *  its name only that one, not also those it has inside. */
  rackLit(rack: Rack | undefined): boolean {
    if (!rack?.devices.every(k => this.chosen.includes(k))) return false;
    const chosen = this.chosenRack();
    return !chosen || chosen.id === rack.id;
  }

  /** The chosen device coming last in the sound (where Ctrl+V pastes). */
  last(keys: readonly DeviceKey[] = this.chosen): DeviceKey | null {
    return lastInChain(this.order(), keys);
  }
}
