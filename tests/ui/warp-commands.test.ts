import { describe, expect, it } from 'vitest';
import { Tempo } from '../../src/core/music-time';
import type { AudioClip } from '../../src/model/audio-clip';
import { findClip, placementRef, updateClipAt, type ClipRef } from '../../src/store/clip-ref';
import { placeSample } from '../../src/store/edits';
import type { MenuAction, MenuItem } from '../../src/ui/context-menu';
import { clipSpan } from '../../src/ui/clip-editor/clip-geometry';
import { editorMenu, type EditorMenuActions } from '../../src/ui/clip-editor/editor-menu';
import { LAYOUT } from '../../src/ui/clip-editor/editor-painter';
import { clipTransients, WarpCommands, type WarpTarget } from '../../src/ui/clip-editor/warp-commands';
import { setup } from '../helpers/fixtures';

/** An audio track with the 4 s loop (120 BPM, a transient per beat) placed at beat 0, warp on. */
function editor(opts: { beats?: number[]; crop?: 'ok' | 'fails' | 'changes' } = {}) {
  const { store, track, sampleId } = setup({ audio: 1, sample: true });
  store.apply(placeSample(track(0), sampleId, 0));
  let ref: ClipRef | null = placementRef(track(0), store.project.tracks[0].arrangement[0].id);
  const said: string[] = [], events: string[] = [];
  let selected = -1;
  const target = (): WarpTarget | null => {
    const found = ref && findClip(store.project, ref);
    const sample = found && store.project.sample((found.clip as AudioClip).sample);
    return found && sample ? { clip: found.clip as AudioClip, found, sample } : null;
  };
  const commit = (label: string, fn: (c: AudioClip) => AudioClip) => { if (ref) store.apply(updateClipAt<AudioClip>(label, ref, fn)); };
  const commands = new WarpCommands({
    store, say: t => said.push(t),
    trackBeats: async () => opts.beats ?? [],
    cropSample: async (s, from, to) => {
      if (opts.crop === 'fails') throw new Error('disk full');
      if (opts.crop === 'changes') commit('Gain', c => c.withGain(-3));
      const cropped = { ...s, id: `${s.id}-crop` as typeof s.id, name: `${s.name} crop`, frames: Math.round((to - from) * s.sampleRate) };
      return cropped;
    },
  }, {
    target, ref: () => ref, selected: () => selected,
    selectMarker: i => { selected = i; events.push(`select ${i}`); },
    forgetMarker: () => { selected = -1; events.push('forget'); },
    commit, grid: () => 0.5, refit: () => events.push('refit'),
  });
  return {
    commands, said, events, store,
    get clip() { return target()!.clip; }, get selected() { return selected; }, set selected(i: number) { selected = i; },
    close: () => { ref = null; },
    target,
  };
}

describe('audio editor commands', () => {
  it('Auto-Warp: markers on the analysed tempo, warp on, said; without analysis it says so', async () => {
    const e = editor();
    e.commands.setWarp(false);
    expect(e.clip.warp.enabled).toBe(false);
    e.commands.autoWarp();
    expect(e.clip.warp.enabled).toBe(true);
    expect(e.clip.warp.markers.globalBpm).toBeCloseTo(120, 6);
    expect(e.said).toEqual(['Auto-Warp: 120.00 BPM.']);
    expect(e.commands.analysed).toBe(true);
    e.close();
    expect(e.commands.analysed).toBe(false);
    e.commands.autoWarp();
    await e.commands.followTempo();
    expect(e.said.slice(1)).toEqual(['The sample hasn\'t been analysed.', 'The sample hasn\'t been analysed.']);
  });

  it('Follow tempo: one marker per bar from the beats, or says it found too few', async () => {
    const beats = Array.from({ length: 9 }, (_, k) => Math.round((k * 0.5) * 44100));
    const e = editor({ beats });
    await e.commands.followTempo();
    expect(e.said[0]).toMatch(/^Follow tempo: \d+ markers\.$/);
    expect(e.store.undoLabel).toBe('Follow tempo');
    const few = editor({ beats: [0] });
    await few.commands.followTempo();
    expect(few.said).toEqual(['Couldn\'t find enough beats: try Auto-Warp.']);
  });

  it('a marker added where the beat falls in the sample, chosen; outside or without warp nothing', () => {
    const e = editor();
    const before = e.clip.warp.markers.markers.length;
    e.commands.addMarkerAt(1.5);
    expect(e.clip.warp.markers.markers.length).toBe(before + 1);
    expect(e.events.at(-1)).toMatch(/^select \d+$/);
    const labels = e.store.undoLabel;
    e.commands.addMarkerAt(1.5);
    expect(e.store.undoLabel).toBe(labels);
    e.events.length = 0;
    e.commands.addMarkerAt(-3);
    e.commands.addMarkerAt(100);
    e.commands.setWarp(false);
    e.commands.addMarkerAt(1);
    expect(e.events).toEqual([]);
  });

  it('delete the chosen marker; at least two stay', () => {
    const e = editor();
    e.commands.addMarkerAt(2);
    const n = e.clip.warp.markers.markers.length;
    e.selected = 1;
    e.commands.deleteMarker();
    expect(e.clip.warp.markers.markers).toHaveLength(n - 1);
    expect(e.events.at(-1)).toBe('forget');
    for (let guard = 0; guard < 10 && e.clip.warp.markers.canRemove(0); guard++) {
      e.selected = 0;
      e.commands.deleteMarker();
    }
    expect(e.clip.warp.markers.markers).toHaveLength(2);
    e.selected = 0;
    e.commands.deleteMarker();
    expect(e.said.at(-1)).toMatch(/^At least two warp markers are needed/);
    e.selected = -1;
    e.commands.deleteMarker();
    expect(e.said).toHaveLength(2);
  });

  it('quantize, reset, 1.1.1, reverse on and off, warp on and off: one undo step each', () => {
    const e = editor();
    e.commands.addMarkerAt(1.3);
    e.commands.quantize();
    expect(e.store.undoLabel).toBe('Quantize warp markers');
    e.commands.setOrigin(1);
    expect(e.store.undoLabel).toBe('Set 1.1.1');
    e.commands.resetMarkers();
    expect(e.clip.warp.markers.markers).toHaveLength(2);
    e.commands.setReversed(true);
    expect([e.clip.reversed, e.store.undoLabel]).toEqual([true, 'Reverse']);
    e.commands.setReversed(false);
    expect([e.clip.reversed, e.store.undoLabel]).toEqual([false, 'Reverse off']);
    e.commands.setWarp(false);
    e.commands.setWarp(true);
    expect([e.clip.warp.enabled, e.store.undoLabel]).toEqual([true, 'Warp on']);
  });

  it('Crop: the region becomes a new file, the clip plays it; cancelled if the clip changed; errors said', async () => {
    const e = editor();
    await e.commands.crop();
    expect(e.store.undoLabel).toBe('Crop');
    expect(e.store.project.sample(e.clip.sample)?.name).toBe('loop crop');
    expect(e.events).toEqual(['forget', 'refit']);
    expect(e.said[0]).toMatch(/^Crop: \d+\.\d\d s in "loop crop"\.$/);
    const changed = editor({ crop: 'changes' });
    await changed.commands.crop();
    expect(changed.said).toEqual(['Crop cancelled: the clip changed in the meantime.']);
    const fails = editor({ crop: 'fails' });
    await fails.commands.crop();
    expect(fails.said).toEqual(['Crop: disk full']);
    const outside = editor();
    outside.store.apply(updateClipAt<AudioClip>('Loop', placementRef(outside.store.project.tracks[0].id, outside.store.project.tracks[0].arrangement[0].id),
      c => c.withLoop({ enabled: true, start: 40, end: 44 })));
    await outside.commands.crop();
    expect(outside.said).toEqual(['Crop: the part to keep is outside the sample.']);
    const none = editor();
    none.close();
    await none.commands.crop();
    expect(none.said).toEqual([]);
  });

  it('the transients in the clip\'s seconds; what the editor frames', () => {
    const e = editor();
    const t = e.target()!;
    expect(clipTransients(t)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(clipTransients({ ...t, sample: { ...t.sample, analysis: null } })).toEqual([]);
    const [b0, b1] = clipSpan(t.clip, 4, new Tempo(120));
    expect(b0).toBeLessThanOrEqual(t.clip.region.start);
    expect(b1).toBeCloseTo(Math.max(t.clip.region.end, t.clip.warp.markers.beatOf(4)), 9);
    const off = t.clip.withWarp({ enabled: false });
    expect(clipSpan(off, 4, new Tempo(60))).toEqual([Math.min(off.region.start, 0), Math.max(off.region.end, 4)]);
  });
});

describe('audio editor menu', () => {
  const calls: string[] = [];
  const actions = (analysed = true): EditorMenuActions => ({
    analysed,
    autoWarp: () => calls.push('autoWarp'), followTempo: async () => { calls.push('follow'); },
    quantize: () => calls.push('quantize'), resetMarkers: () => calls.push('reset'),
    setWarp: on => calls.push(`warp ${on}`), setReversed: on => calls.push(`reverse ${on}`),
    crop: async () => { calls.push('crop'); }, setOrigin: i => calls.push(`origin ${i}`),
    deleteMarker: () => calls.push('delete'), addMarkerAt: b => calls.push(`add ${b}`),
  });
  const label = (i: MenuItem) => {
    if (typeof i === 'string') return '—';
    const a = i as MenuAction;
    return a.disabled ? `(off) ${a.label}` : a.label;
  };
  const labels = (items: MenuItem[]) => items.map(label);
  const run = (items: MenuItem[]) => items.forEach(i => { if (typeof i !== 'string' && 'run' in i) i.run(); });
  const clip = () => editor().clip;

  it('on a marker: 1.1.1 and delete first (delete off if only two), then the tools', () => {
    calls.length = 0;
    const c = clip();
    const items = editorMenu(c, { kind: 'marker', index: 0 }, { y: 40, beat: () => 2 }, actions());
    expect(labels(items).slice(0, 3)).toEqual(['1.1.1 here', '(off) Delete warp marker', '—']);
    run(items);
    expect(calls).toEqual(['origin 0', 'delete', 'autoWarp', 'follow', 'quantize', 'reset', 'warp false', 'reverse true', 'crop']);
  });

  it('on the waveform with warp: a marker here (at the beat when it runs); on the ruler, or without warp, not', () => {
    calls.length = 0;
    const c = clip();
    let beat = 2;
    const wave = editorMenu(c, { kind: 'wave' }, { y: LAYOUT.ruler + 30, beat: () => beat }, actions(false));
    expect(labels(wave)).toEqual(['Add warp marker here', '—', '(off) Auto-Warp', '(off) Follow tempo', 'Quantize the warp markers', 'Reset the warp markers', '—', 'Turn warp off', 'Reverse', 'Crop to region']);
    beat = 3;
    (wave[0] as MenuAction).run();
    expect(calls).toEqual(['add 3']);
    expect(labels(editorMenu(c, { kind: 'ruler' }, { y: 5, beat: () => 0 }, actions()))[0]).toBe('Auto-Warp');
    const off = c.withWarp({ enabled: false }).withReversed(true, 4).withLoop({ enabled: true, start: 0, end: 2 });
    expect(labels(editorMenu(off, { kind: 'wave' }, { y: 80, beat: () => 0 }, actions()))).toEqual([
      'Auto-Warp', 'Follow tempo', '(off) Quantize the warp markers', '(off) Reset the warp markers', '—', 'Turn warp on', 'Remove reverse', 'Crop to loop',
    ]);
  });
});
