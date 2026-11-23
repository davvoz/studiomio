/* What the instrument's panel decides from the project, without the DOM: the test note and what
 * a preset leaves as it is. */
import type { TrackId } from '../../core/id';
import { keptOnPreset, resolveParams, type DeviceType } from '../../devices/device-type';
import type { ParamValues } from '../../model/device';
import type { Project } from '../../model/project';
import { MidiTrack } from '../../model/track';

/** The test note: C3, or the first name the instrument gives the notes (the drum machine's kick). */
export function testPitch(project: Project, track: TrackId, type: DeviceType): number {
  const t = project.track(track);
  const names = t instanceof MidiTrack ? type.noteNames?.(resolveParams(type, t.instrument.params), project.sampleNames(t.instrument)) : undefined;
  return names?.size ? Math.min(...names.keys()) : 60;
}

/** A preset's values with what a preset doesn't change (the Sampler's zone map) as it is now. */
export function withKept(project: Project, track: TrackId, type: DeviceType, params: ParamValues): ParamValues {
  const t = project.track(track);
  return t instanceof MidiTrack ? { ...params, ...keptOnPreset(type, t.instrument.params) } : params;
}
