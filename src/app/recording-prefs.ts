/* How this computer records (remembered here: it depends on the sound card, the keyboard and the
 * player, not on the project): the latency compensation, i.e. the audio device's delay as the browser
 * reports it plus a hand correction, and whether the movements of the controls are recorded. */
import type { Beats } from '../core/music-time';
import { compensationBeats, OFFSET_MS } from '../model/record-settings';
import { readPref, writePref } from '../ui/kit/prefs';

const KEY = 'studiomio.recordOffsetMs';
const MOVES_KEY = 'studiomio.recordMoves';

/** What's read of the audio context: the delays it reports (in seconds; absent where unknown). */
export interface AudioDelays {
  readonly baseLatency?: number;
  readonly outputLatency?: number;
}

const finite = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0);

export class RecordingPrefs {
  private offset: number;
  private recordMoves: boolean;

  constructor(private readonly context: AudioDelays) {
    const saved = Number(readPref(KEY) ?? 0);
    this.offset = RecordingPrefs.clamp(saved);
    this.recordMoves = readPref(MOVES_KEY) === 'true';
  }

  private static clamp(ms: number): number {
    return Number.isFinite(ms) ? Math.max(OFFSET_MS.min, Math.min(OFFSET_MS.max, Math.round(ms))) : 0;
  }

  /** The audio device's delay, in ms (what's heard comes this much after the engine's clock). */
  get audioMs(): number {
    return Math.round((finite(this.context.baseLatency) + finite(this.context.outputLatency)) * 1000);
  }

  /** The hand correction, in ms (more: the notes go earlier). */
  get offsetMs(): number {
    return this.offset;
  }

  set offsetMs(ms: number) {
    this.offset = RecordingPrefs.clamp(ms);
    writePref(KEY, String(this.offset));
  }

  /** The movements of the controls are recorded with the notes. */
  get moves(): boolean {
    return this.recordMoves;
  }

  set moves(on: boolean) {
    this.recordMoves = on;
    writePref(MOVES_KEY, String(on));
  }

  /** The whole compensation at `bpm`, in beats. */
  beats(bpm: number): Beats {
    return compensationBeats(this.audioMs / 1000, this.offset, bpm);
  }
}
