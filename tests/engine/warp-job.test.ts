import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { Tempo } from '../../src/core/music-time';
import { WarpRenderer } from '../../src/dsp/stretch/warp-renderer';
import { clipRender } from '../../src/engine/warp-job';
import { AudioClip } from '../../src/model/audio-clip';
import { WarpMarkers } from '../../src/model/warp-markers';
import { drumLoop } from '../helpers/signals';
import { sampleRef } from '../helpers/fixtures';

const ids = sequentialIds();
const sample = sampleRef(ids); // 4 s a 120 BPM
const clip = AudioClip.fromSample(ids.next('clip'), sample, '#fff');

describe('from the clip to the warp job', () => {
  it('at the sample\'s own tempo the map is the identity', () => {
    const { job, startBeat } = clipRender(clip, sample, new Tempo(120));
    expect(startBeat).toBe(0);
    expect(job.points).toEqual([[0, 0], [176400, 176400]]);
    expect(job.outLength).toBe(176400);
    expect(job.settings).toEqual({ mode: 'complex', fftSize: 4096, transients: sample.analysis!.transients.map(t => t * 44100) });
  });

  it('at another tempo the duration scales, the inner markers become points', () => {
    const c = clip.withMarkers(clip.warp.markers.withMarkerAt(1).markers.withMarkerBeat(1, 3)); // 1 s → beat 3
    const { job } = clipRender(c, sample, new Tempo(60));
    expect(job.points).toEqual([[0, 0], [3 * 44100, 44100], [8 * 44100, 4 * 44100]]);
  });

  it('the first hit not at the start: the render starts before beat 0', () => {
    const c = clip.withMarkers(WarpMarkers.straight(120, 4, 0.5));
    const { job, startBeat } = clipRender(c, sample, new Tempo(120));
    expect(startBeat).toBe(-1);
    expect(job.points[job.points.length - 1]).toEqual([176400, 176400]);
  });

  it('settings of each mode from the clip\'s options', () => {
    const t = new Tempo(120);
    const mode = (m: AudioClip) => clipRender(m, sample, t).job.settings;
    expect(mode(clip.withWarp({ mode: 'repitch' }))).toEqual({ mode: 'repitch' });
    expect(mode(clip.withWarp({ mode: 'tones' }))).toEqual({ mode: 'tones', grainMs: 50 });
    expect(mode(clip.withWarp({ mode: 'texture' }))).toEqual({ mode: 'texture', grainMs: 80, flux: 0.2 });
    expect(mode(clip.withWarpOptions('complex', { resetOnTransients: false }))).toMatchObject({ transients: null });
    const grid = mode(clip.withWarp({ mode: 'beats' }).withWarpOptions('beats', { preserve: 1 }));
    // one slice per beat: 8 beats in 4 s
    expect(grid).toMatchObject({ mode: 'beats', slices: [0, 1, 2, 3, 4, 5, 6, 7].map(b => b * 22050) });
    expect(clipRender(clip.withTranspose(2).withDetune(-50), sample, t).job.transpose).toBe(1.5);
  });

  it('the job really renders: 2 bars at 120 brought to 96 BPM', () => {
    const audio = { channels: drumLoop(2, 120), sampleRate: 44100 };
    const s = { ...sample, frames: audio.channels[0].length };
    const c = AudioClip.fromSample(clip.id, s, '#fff');
    const { job } = clipRender(c, s, new Tempo(96));
    const out = new WarpRenderer().render(audio, job);
    expect(out[0].length).toBe(Math.round(audio.channels[0].length * 120 / 96));
  });

  it('reverse: the job reads the sample backwards, with the transients mirrored', () => {
    const r = clip.withReversed(true, 4);
    const { job } = clipRender(r, sample, new Tempo(120));
    expect(job.reverse).toBe(true);
    expect(job.points).toEqual([[0, 0], [176400, 176400]]);
    const sr = 44100, transients = sample.analysis!.transients;
    expect(job.settings).toMatchObject({ transients: transients.map(t => (4 - t) * sr).reverse() });
    // the straight clips don't change render key
    expect(clipRender(clip, sample, new Tempo(120)).job).not.toHaveProperty('reverse');
  });

  it('the renderer reverses the audio', () => {
    const ramp = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
    const job = { points: [[0, 0], [1000, 1000]] as [number, number][], outLength: 1000, transpose: 0, settings: { mode: 'repitch' as const } };
    const out = new WarpRenderer().render({ channels: [ramp], sampleRate: 44100 }, { ...job, reverse: true });
    expect(out[0][0]).toBeCloseTo(0.999, 3);
    expect(out[0][999]).toBeCloseTo(0, 3);
    expect(ramp[0]).toBe(0); // the sample isn't touched
  });

  it('rejects clips without warp or with the wrong sample', () => {
    expect(() => clipRender(clip.withWarp({ enabled: false }), sample, new Tempo(120))).toThrow(/doesn't use warp/);
    expect(() => clipRender(clip, sampleRef(ids), new Tempo(120))).toThrow(/sample/);
  });
});
