import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackId } from '../../src/core/id';
import type { EffectMonitor } from '../../src/engine/effect-chain';
import { EffectDynamics } from '../../src/app/effect-dynamics';
import { EffectSpectrum } from '../../src/app/effect-spectrum';
import { rulerMenu, timelineMenu, type TimelineActions } from '../../src/app/menus';
import type { MenuAction, MenuColors, MenuItem } from '../../src/ui/context-menu';
import type { Hit } from '../../src/ui/timeline/geometry';

/** Actions that record what they're asked. */
function actions(over: Partial<TimelineActions> = {}) {
  const called: string[] = [];
  const base = new Proxy({}, {
    get: (_t, name) => (...args: unknown[]) => { called.push([String(name), ...args.map(a => JSON.stringify(a))].join(' ')); return args[0]; },
  }) as TimelineActions;
  const a = { canPaste: true, loopEnabled: true, isMidiTrack: () => true, snap: (b: number) => Math.round(b), ...over } as TimelineActions;
  return { a: new Proxy(a, { get: (t, name) => (name in t ? t[name as keyof TimelineActions] : base[name as keyof TimelineActions]) }), called };
}

const actionsOf = (items: MenuItem[]) => items.filter((i): i is MenuAction => typeof i === 'object' && 'label' in i);
const runAll = (items: MenuItem[]) => {
  for (const i of actionsOf(items)) i.run();
  for (const i of items) if (typeof i === 'object' && 'colors' in i) (i as MenuColors).pick('#123456');
};

const track = 't1' as TrackId;
const clipHit = { kind: 'clip', zone: 'body', trackIndex: 2, track, beat: 3.4, placement: { id: 'p1', clip: { color: '#fff' } } } as unknown as Hit;

describe('the timeline menus', () => {
  it('on a clip: every command, the paste and split on the grid where clicked', () => {
    const { a, called } = actions();
    const items = timelineMenu(a, clipHit);
    expect(actionsOf(items).map(i => i.label)).toEqual([
      'Open in the editor', 'Cut', 'Copy', 'Paste here', 'Duplicate', 'Split here', 'Consolidate', 'Copy to session', 'Delete',
    ]);
    runAll(items);
    expect(called).toContain('pasteAt 2 3');
    expect(called).toContain('splitSelectionAt 3');
    expect(called).toContain('colorSelection "#123456"');
    expect(called.some(c => c.startsWith('openClip ') && c.includes('"p1"'))).toBe(true);
  });

  it('on a lane: a new MIDI clip only on MIDI tracks; paste off with nothing to paste', () => {
    const lane = { kind: 'lane', trackIndex: 1, track, beat: 2 } as Hit;
    const midi = actions();
    runAll(timelineMenu(midi.a, lane));
    expect(midi.called).toEqual(expect.arrayContaining(['newMidiClip "t1" 2', 'selectAll', 'duplicateLoop', 'addTrack "audio"', 'addTrack "midi"']));
    const audio = actions({ canPaste: false, isMidiTrack: () => false });
    const items = actionsOf(timelineMenu(audio.a, lane));
    expect(items.map(i => i.label)).not.toContain('New MIDI clip here');
    expect(items[0].disabled).toBe(true);
  });

  it('below the tracks and on the ruler', () => {
    const { a, called } = actions({ loopEnabled: false });
    runAll(timelineMenu(a, { kind: 'empty', beat: 0 }));
    const ruler = rulerMenu(a);
    expect(actionsOf(ruler)[0].checked).toBe(false);
    runAll(ruler);
    expect(called).toEqual(['selectAll', 'duplicateLoop', 'addTrack "audio"', 'addTrack "midi"', 'toggleLoop', 'duplicateLoop']);
  });
});

describe('what a playing effect shows', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A node that records its connections; `torn` throws on disconnect, as a torn-down node. */
  const node = (log: string[], name: string, torn = false) => ({
    connect: () => log.push(`${name} connect`),
    disconnect: () => {
      if (torn) throw new Error('gone');
      log.push(`${name} disconnect`);
    },
  });

  it('the spectrum follows the effect when it is recreated, and reads nothing without it', () => {
    class Analyser {
      getFloatFrequencyData(a: Float32Array) { a.fill(-60); }
    }
    vi.stubGlobal('AnalyserNode', Analyser);
    const log: string[] = [];
    let monitor: EffectMonitor | null = null;
    const s = new EffectSpectrum({ sampleRate: 48000 } as BaseAudioContext, () => monitor);
    const pre = new Float32Array(s.binCount), post = new Float32Array(s.binCount);
    expect(s.read(pre, post)).toBe(false);
    monitor = { pre: node(log, 'a.pre'), post: node(log, 'a.post') } as unknown as EffectMonitor;
    expect(s.read(pre, post)).toBe(true);
    expect(post[0]).toBe(-60);
    monitor = { pre: node(log, 'b.pre'), post: node(log, 'b.post') } as unknown as EffectMonitor;
    s.read(pre, post);
    s.dispose();
    expect(log).toEqual(['a.pre connect', 'a.post connect', 'a.pre disconnect', 'a.post disconnect', 'b.pre connect', 'b.post connect', 'b.pre disconnect', 'b.post disconnect']);
    monitor = { pre: node(log, 'c.pre', true), post: node(log, 'c.post', true) } as unknown as EffectMonitor;
    s.read(pre, post);
    expect(() => s.dispose()).not.toThrow();
    expect(s.sampleRate).toBe(48000);
  });

  it('the dynamics: the latest reading once, watching only the current effect', () => {
    const watchers: string[] = [];
    let listener: ((i: number, r: number) => void) | null = null;
    const effect = (name: string): EffectMonitor => ({
      pre: {} as never, post: {} as never,
      watch: l => { watchers.push(`${name} ${l ? 'on' : 'off'}`); listener = l; },
    });
    let monitor: EffectMonitor | null = effect('a');
    const d = new EffectDynamics(() => monitor);
    expect(d.read()).toBeNull();
    listener!(-12, 3);
    expect(d.read()).toEqual({ input: -12, reduction: 3 });
    expect(d.read()).toBeNull();
    monitor = { pre: {} as never, post: {} as never };
    d.read();
    monitor = effect('b');
    d.read();
    d.dispose();
    expect(watchers).toEqual(['a on', 'a off', 'b on', 'b off']);
  });
});
