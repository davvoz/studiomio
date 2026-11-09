import type { InstrumentSettings } from '../../model/device';
import type { AudioGraph, AudioNodeLike } from '../audio-graph';
import type { TransportAnchor } from '../../devices/worklet/transport-clock';
import type { DeviceModulation } from '../modulation';

/** An instrument playing in the audio graph: it receives notes at precise audio context times
 *  and the track's settings when they change. */
export interface Instrument {
  readonly type: string;
  readonly output: AudioNodeLike;
  /** The parameters the clips can modulate. */
  readonly modulation?: DeviceModulation;
  /** `velocity` 1..127, times in audio context seconds. */
  play(pitch: number, velocity: number, when: number, duration: number): void;
  /** A note held by hand: starts now and plays until `release` arrives for its pitch. */
  press(pitch: number, velocity: number): void;
  release(pitch: number): void;
  /** New parameter values (same instrument type): right away, or from instant `at` of the
   *  audio context (the sound of a starting clip). */
  update(settings: InstrumentSettings, at?: number): void;
  /** The parameters of the arpeggiator in front of the instrument (see devices/arp). */
  setArp(params: Readonly<Record<string, number>>): void;
  /** The project's tempo changed (for the instrument's synced modulations). */
  setTempo?(bpm: number): void;
  stopAll(): void;
  /** For whoever plays a sample: where the voices read now (fractions of the sample). */
  playheads?(): readonly number[];
  /** Removes the notes that would start from `at` (context seconds) and closes there those that
   *  would play beyond. */
  cut(at: number): void;
  /** Removes the notes that would start from `at`; those already started play to their end
   *  (rescheduling after a change: the notes from `at` arrive again). */
  retake(at: number): void;
  dispose(): void;
}

/** Where the instruments are born: in the browser the AudioWorklet, in tests a recorder. */
export interface InstrumentHost {
  /** Prepares the graph (e.g. loads the AudioWorklet module). */
  prepare(graph: AudioGraph): Promise<void>;
  create(graph: AudioGraph, settings: InstrumentSettings, bpm: number): Instrument;
  /** Where the graph's transport is (null: stopped), for the instruments that follow the
   *  bar (the sequencer): it also applies to those created later. */
  transport?(graph: AudioGraph, anchor: TransportAnchor | null): void;
  /** Resolves when the graph's instruments have received everything that was
   *  sent to them: needed before an offline export. */
  settle(graph: AudioGraph): Promise<void>;
}
