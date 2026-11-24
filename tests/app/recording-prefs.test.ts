// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { RecordingPrefs } from '../../src/app/recording-prefs';

beforeEach(() => localStorage.clear());

describe('recording prefs', () => {
  it('the audio device\'s delay from the context (unknown parts count 0), in ms', () => {
    expect(new RecordingPrefs({ baseLatency: 0.01, outputLatency: 0.0125 }).audioMs).toBe(23);
    expect(new RecordingPrefs({ baseLatency: 0.005 }).audioMs).toBe(5);
    expect(new RecordingPrefs({ baseLatency: Number.NaN, outputLatency: undefined }).audioMs).toBe(0);
  });

  it('the hand correction is remembered on this computer, within its limits', () => {
    const a = new RecordingPrefs({});
    expect(a.offsetMs).toBe(0);
    a.offsetMs = 30.4;
    expect(a.offsetMs).toBe(30);
    expect(new RecordingPrefs({}).offsetMs).toBe(30);
    a.offsetMs = 999;
    expect(a.offsetMs).toBe(200);
    a.offsetMs = -999;
    expect(a.offsetMs).toBe(-50);
    a.offsetMs = Number.NaN;
    expect(a.offsetMs).toBe(0);
    localStorage.setItem('studiomio.recordOffsetMs', 'nonsense');
    expect(new RecordingPrefs({}).offsetMs).toBe(0);
  });

  it('the whole compensation in beats at the tempo', () => {
    const l = new RecordingPrefs({ baseLatency: 0.02, outputLatency: 0 });
    l.offsetMs = 10;
    expect(l.beats(120)).toBeCloseTo(0.06, 12);
  });

  it('whether the movements are recorded is remembered too (off at first)', () => {
    const a = new RecordingPrefs({});
    expect(a.moves).toBe(false);
    a.moves = true;
    expect(new RecordingPrefs({}).moves).toBe(true);
    a.moves = false;
    expect(new RecordingPrefs({}).moves).toBe(false);
  });
});
