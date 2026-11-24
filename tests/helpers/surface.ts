/* For the controllers' tests: the recording into the slots as the controllers see it. */
import type { TrackId } from '../../src/core/id';
import type { SurfaceRecorder } from '../../src/control/session-surface';
import type { SlotRef } from '../../src/store/session-edits';

/** Records the toggles; a toggle starts recording into the slot or (on a recording track) ends the take at once. */
export class FakeRecorder implements SurfaceRecorder {
  readonly calls: string[] = [];
  readonly slots = new Map<TrackId, number>();
  overdub = false;

  recordingSlot(track: TrackId): number | null {
    return this.slots.get(track) ?? null;
  }

  toggle(ref: SlotRef): void {
    this.calls.push(`record ${ref.track} ${ref.slot}`);
    if (this.slots.has(ref.track)) this.slots.delete(ref.track);
    else this.slots.set(ref.track, ref.slot);
  }

  toggleOverdub(): void {
    this.calls.push('overdub');
    this.overdub = !this.overdub;
  }
}
