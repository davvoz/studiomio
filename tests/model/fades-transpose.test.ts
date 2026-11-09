import { describe, expect, it } from 'vitest';
import { asId, sequentialIds } from '../../src/core/id';
import { place, split, type Placement } from '../../src/model/arrangement';
import type { AudioClip } from '../../src/model/audio-clip';
import { fullRange } from '../../src/model/clip';
import { CLIP_TRANSPOSE, parseTargetKey, scaleOf, steppedRuns, steppedValues, targetKey } from '../../src/model/envelope';
import { MidiClip } from '../../src/model/midi-clip';
import { fadeGainAt } from '../../src/engine/track-content';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { placeSample, setFades, updateClip } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

const clip = MidiClip.create({ id: asId('clip-x'), name: 'x', color: '#fff', ...fullRange(0, 8, true), notes: [] });
const pl = (fadeIn?: number, fadeOut?: number): Placement => ({ id: asId('placement-a'), clip, start: 0, length: 8, offset: 0, fadeIn, fadeOut });

describe('fades of the placed clips', () => {
  it('they stay inside the clip, the fade-in has priority; the zero ones disappear', () => {
    const [p] = place([], pl(6, 5), sequentialIds());
    expect([p.fadeIn, p.fadeOut]).toEqual([6, 2]);
    const [q] = place([], pl(0, 1), sequentialIds());
    expect('fadeIn' in q).toBe(false);
    expect(q.fadeOut).toBe(1);
  });

  it('splitting, each piece keeps only the fade of its original edge', () => {
    const [a, b] = split([pl(1, 2)], asId('placement-a'), 4, sequentialIds());
    expect([a.fadeIn, a.fadeOut]).toEqual([1, undefined]);
    expect([b.fadeIn, b.fadeOut]).toEqual([undefined, 2]);
  });

  it('the gain rises, stays full and falls', () => {
    const f = { start: 10, end: 18, fadeIn: 2, fadeOut: 4 };
    expect([9, 10, 11, 12, 14, 16, 18, 19].map(b => fadeGainAt(f, b))).toEqual([0, 0, 0.5, 1, 1, 0.5, 0, 0]);
  });

  it('they\'re saved with the project', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(setFades(track(0), id, { fadeIn: 0.5 }));
    store.apply(setFades(track(0), id, { fadeOut: 1 }));
    expect(store.undoLabel).toBe('Fade');
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project)).tracks[0].arrangement[0];
    expect([back.fadeIn, back.fadeOut]).toEqual([0.5, 1]);
  });
});

describe('modulated transpose', () => {
  it('it\'s a target of the clip, in semitones', () => {
    expect(targetKey(CLIP_TRANSPOSE)).toBe('clip:transpose');
    expect(parseTargetKey('clip:transpose')).toEqual(CLIP_TRANSPOSE);
    expect(scaleOf(CLIP_TRANSPOSE)).toEqual({ min: -48, max: 48, neutral: 0 });
  });

  it('the curve plays in semitones: constant stretches and the semitones it touches', () => {
    // step to +5 from beat 2, then a ramp from 0 to 2 between 4 and 8
    const points = [{ beat: 0, value: 0 }, { beat: 2, value: 0 }, { beat: 2, value: 5 }, { beat: 4, value: 5 }, { beat: 4, value: 0 }, { beat: 8, value: 2 }];
    const runs = steppedRuns(points, 1, 8).map(r => [r.from, r.to, r.value]);
    expect(runs).toEqual([[1, 2, 0], [2, 4, 5], [4, 5, 0], [5, 7, 1], [7, 8, 2]]);
    expect(steppedValues(points)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(steppedRuns([{ beat: 0, value: -3 }], 0, 4)).toEqual([{ from: 0, to: 4, value: -3 }]);
  });

  it('the transpose curve is saved with the audio clip', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(updateClip<AudioClip>('curve', track(0), id, c => c.withEnvelope(CLIP_TRANSPOSE, [{ beat: 0, value: 7 }])));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project)).tracks[0].arrangement[0].clip;
    expect(back.envelope(CLIP_TRANSPOSE)?.points).toEqual([{ beat: 0, value: 7 }]);
  });
});
