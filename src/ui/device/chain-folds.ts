/* How the chains are shown, kept while the app is open: the racks with their devices hidden and
 * the collapsed devices, per chain. */
import type { DeviceId } from '../../core/id';
import type { ChainOwner } from '../../model/project';

export class ChainFolds {
  private readonly racks = new Set<DeviceId>();
  private readonly devices = new Set<string>();

  rackFolded(rack: DeviceId): boolean {
    return this.racks.has(rack);
  }

  toggleRack(rack: DeviceId): void {
    if (this.racks.has(rack)) this.racks.delete(rack);
    else this.racks.add(rack);
  }

  /** The closed racks, for the chain's shape (another set of closed racks: other panels). */
  get racksKey(): string {
    return [...this.racks].join(',');
  }

  deviceFolded(owner: ChainOwner, key: string): boolean {
    return this.devices.has(`${owner}/${key}`);
  }

  foldDevice(owner: ChainOwner, key: string): void {
    this.devices.add(`${owner}/${key}`);
  }

  unfoldDevice(owner: ChainOwner, key: string): void {
    this.devices.delete(`${owner}/${key}`);
  }
}
