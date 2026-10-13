import { sequentialIds, type IdFactory, type SampleId, type TrackId } from '../../src/core/id';
import type { SampleRef } from '../../src/model/sample';
import { Project } from '../../src/model/project';
import { ProjectStore } from '../../src/store/project-store';
import { addSample, addTrack } from '../../src/store/edits';

/** Sample finto: 2 battute a 120 BPM (4 s) a 44,1 kHz, con un transiente per battito. */
export function sampleRef(ids: IdFactory, over: Partial<SampleRef> = {}): SampleRef {
  return {
    id: ids.next('sample'), name: 'loop', file: 'audio/loop.wav',
    sampleRate: 44100, channels: 2, frames: 4 * 44100,
    analysis: { tempo: 120, sensitivity: 0.5, transients: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
    ...over,
  };
}

/** Store con un progetto vuoto, id prevedibili e (a scelta) tracce e un sample. */
export function setup(opts: { audio?: number; midi?: number; sample?: boolean } = {}) {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('Prova', ids, 4), ids);
  for (let i = 0; i < (opts.audio ?? 0); i++) store.apply(addTrack('audio'));
  for (let i = 0; i < (opts.midi ?? 0); i++) store.apply(addTrack('midi'));
  let sample: SampleRef | null = null;
  if (opts.sample) {
    sample = sampleRef(ids);
    store.apply(addSample(sample));
  }
  const track = (i: number): TrackId => store.project.tracks[i].id;
  return { ids, store, track, sampleId: sample?.id as SampleId };
}
