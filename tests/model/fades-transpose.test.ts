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

describe('dissolvenze delle clip posate', () => {
  it('restano dentro la clip, quella in entrata ha la precedenza; quelle nulle spariscono', () => {
    const [p] = place([], pl(6, 5), sequentialIds());
    expect([p.fadeIn, p.fadeOut]).toEqual([6, 2]);
    const [q] = place([], pl(0, 1), sequentialIds());
    expect('fadeIn' in q).toBe(false);
    expect(q.fadeOut).toBe(1);
  });

  it('dividendo, ogni pezzo tiene solo la dissolvenza del suo bordo originale', () => {
    const [a, b] = split([pl(1, 2)], asId('placement-a'), 4, sequentialIds());
    expect([a.fadeIn, a.fadeOut]).toEqual([1, undefined]);
    expect([b.fadeIn, b.fadeOut]).toEqual([undefined, 2]);
  });

  it('il guadagno sale, resta pieno e scende', () => {
    const f = { start: 10, end: 18, fadeIn: 2, fadeOut: 4 };
    expect([9, 10, 11, 12, 14, 16, 18, 19].map(b => fadeGainAt(f, b))).toEqual([0, 0, 0.5, 1, 1, 0.5, 0, 0]);
  });

  it('si salvano con il progetto', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(setFades(track(0), id, { fadeIn: 0.5 }));
    store.apply(setFades(track(0), id, { fadeOut: 1 }));
    expect(store.undoLabel).toBe('Dissolvenza');
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project)).tracks[0].arrangement[0];
    expect([back.fadeIn, back.fadeOut]).toEqual([0.5, 1]);
  });
});

describe('transpose modulato', () => {
  it('è un bersaglio della clip, in semitoni', () => {
    expect(targetKey(CLIP_TRANSPOSE)).toBe('clip:transpose');
    expect(parseTargetKey('clip:transpose')).toEqual(CLIP_TRANSPOSE);
    expect(scaleOf(CLIP_TRANSPOSE)).toEqual({ min: -48, max: 48, neutral: 0 });
  });

  it('la curva suona a semitoni: tratti costanti e i semitoni che tocca', () => {
    // scalino a +5 dal battito 2, poi una rampa da 0 a 2 tra 4 e 8
    const points = [{ beat: 0, value: 0 }, { beat: 2, value: 0 }, { beat: 2, value: 5 }, { beat: 4, value: 5 }, { beat: 4, value: 0 }, { beat: 8, value: 2 }];
    const runs = steppedRuns(points, 1, 8).map(r => [r.from, r.to, r.value]);
    expect(runs).toEqual([[1, 2, 0], [2, 4, 5], [4, 5, 0], [5, 7, 1], [7, 8, 2]]);
    expect(steppedValues(points)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(steppedRuns([{ beat: 0, value: -3 }], 0, 4)).toEqual([{ from: 0, to: 4, value: -3 }]);
  });

  it('la curva del transpose si salva con la clip audio', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(updateClip<AudioClip>('curva', track(0), id, c => c.withEnvelope(CLIP_TRANSPOSE, [{ beat: 0, value: 7 }])));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project)).tracks[0].arrangement[0].clip;
    expect(back.envelope(CLIP_TRANSPOSE)?.points).toEqual([{ beat: 0, value: 7 }]);
  });
});
