import { describe, expect, it } from 'vitest';
import { instrumentType } from '../../../src/devices/registry';
import { DEFAULT_INSTRUMENT } from '../../../src/model/device';
import { setInstrument } from '../../../src/store/edits';
import { testPitch, withKept } from '../../../src/ui/device/device-params';
import { setup } from '../../helpers/fixtures';

describe('instrument panel params', () => {
  it('the test note is C3, or the lowest named note (the cymbals\' closed hat)', () => {
    const { store, track } = setup({ midi: 1, audio: 1 });
    const midi = track(1);
    store.apply(setInstrument(midi, { ...DEFAULT_INSTRUMENT, type: 'analog', preset: null }));
    expect(testPitch(store.project, midi, instrumentType('analog')!)).toBe(60);
    store.apply(setInstrument(midi, { ...DEFAULT_INSTRUMENT, type: 'cymbals', preset: null }));
    expect(testPitch(store.project, midi, instrumentType('cymbals')!)).toBe(42);
    expect(testPitch(store.project, track(0), instrumentType('cymbals')!)).toBe(60);
  });

  it('a preset keeps what the instrument says it doesn\'t change (the Sampler\'s root and zones)', () => {
    const { store, track } = setup({ midi: 1, audio: 1 });
    const midi = track(1), sampler = instrumentType('sampler')!;
    store.apply(setInstrument(midi, { ...DEFAULT_INSTRUMENT, type: 'sampler', preset: null, params: { root: 48, gain: 3 } }));
    expect(withKept(store.project, midi, sampler, { root: 60, gain: 0 })).toEqual({ root: 48, gain: 0 });
    expect(withKept(store.project, track(0), sampler, { root: 60 })).toEqual({ root: 60 });
    store.apply(setInstrument(midi, { ...DEFAULT_INSTRUMENT, type: 'analog', preset: null, params: { cutoff: 1 } }));
    expect(withKept(store.project, midi, instrumentType('analog')!, { cutoff: 5 })).toEqual({ cutoff: 5 });
  });
});
