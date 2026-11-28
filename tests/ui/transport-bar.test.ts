// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackEngine } from '../../src/engine/playback-engine';
import { setLoopRegion } from '../../src/store/edits';
import type { Commands } from '../../src/ui/keymap';
import { FIXED_GRIDS } from '../../src/ui/timeline/geometry';
import { TransportBar } from '../../src/ui/transport-bar';
import { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  // happy-dom has no Option constructor
  vi.stubGlobal('Option', function (text: string, value: string) {
    return Object.assign(document.createElement('option'), { text, value });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function bar() {
  const { store } = setup();
  const ui = new UiState();
  const listeners: (() => void)[] = [];
  const engine = { playing: false, metronomeOn: false, position: 0, onStateChange: (f: () => void) => listeners.push(f) };
  const changed: (() => void)[] = [];
  const recording = { overdub: false, onChange: (f: () => void) => { changed.push(f); return () => undefined; } };
  const arrangement = { recording: false, onChange: (f: () => void) => { changed.push(f); return () => undefined; } };
  const commands = {
    togglePlay: vi.fn(), toggleLoop: vi.fn(), toggleMetronome: vi.fn(), toggleOverdub: vi.fn(), toggleArrangementRecord: vi.fn(), recordingSettings: vi.fn(), toggleFollow: vi.fn(), toggleKeyMap: vi.fn(),
    toggleMidiMap: vi.fn(), toggleTriplet: vi.fn(), stopAndRewind: vi.fn(),
  };
  const t = new TransportBar(store, ui, engine as unknown as PlaybackEngine, commands as unknown as Commands, recording, arrangement);
  document.body.append(t.element);
  const button = (title: string) => [...t.element.querySelectorAll('button')].find(b => b.title.startsWith(title))!;
  const bpm = t.element.querySelector<HTMLInputElement>('input[type=number]')!;
  const grid = t.element.querySelector<HTMLSelectElement>('select.grid')!;
  return {
    t, store, ui, engine, commands, button, bpm, grid, recording, arrangement,
    engineChanged: () => listeners.forEach(f => f()), recordingChanged: () => changed.forEach(f => f()),
  };
}

describe('transport bar', () => {
  it('each button runs its command', () => {
    const { button, commands } = bar();
    const titles: [string, keyof typeof commands][] = [
      ['Play / Stop', 'togglePlay'], ['Stop and return', 'stopAndRewind'], ['Loop', 'toggleLoop'], ['Metronome', 'toggleMetronome'], ['Overdub', 'toggleOverdub'],
      ['Arrangement Record', 'toggleArrangementRecord'],
      ['Follow', 'toggleFollow'], ['Map the computer keyboard', 'toggleKeyMap'], ['Map any controller', 'toggleMidiMap'], ['Triplet', 'toggleTriplet'],
    ];
    for (const [title, command] of titles) {
      button(title).click();
      expect(commands[command], title).toHaveBeenCalledOnce();
    }
  });

  it('shows the state: playing, loop, metronome, mappings, follow (and when it\'s paused)', () => {
    const { button, engine, ui, store, engineChanged } = bar();
    const play = button('Play / Stop');
    expect(play.textContent).toBe('▶');
    Object.assign(engine, { playing: true, metronomeOn: true });
    engineChanged();
    expect(play.textContent).toBe('❚❚');
    expect(play.classList.contains('on')).toBe(true);
    expect(button('Metronome').classList.contains('on')).toBe(true);
    ui.setKeyMapping(true);
    expect(button('Map the computer keyboard').classList.contains('on')).toBe(true);
    ui.setMidiMapping(true);
    expect(button('Map any controller').classList.contains('on')).toBe(true);
    store.apply(setLoopRegion({ enabled: true }));
    expect(button('Loop').classList.contains('on')).toBe(true);
    ui.setFollow(true);
    const follow = button('Follow the playhead');
    expect(follow.classList.contains('on')).toBe(true);
    ui.pauseFollow();
    expect(follow.classList.contains('paused')).toBe(true);
    expect(follow.title).toContain('Follow is paused');
  });

  it('the overdub button lights up while overdub is on', () => {
    const { button, recording, recordingChanged } = bar();
    const overdub = button('Overdub');
    expect(overdub.textContent).toBe('●');
    expect(overdub.classList.contains('on')).toBe(false);
    recording.overdub = true;
    recordingChanged();
    expect(overdub.classList.contains('on')).toBe(true);
  });

  it('● Rec (Arrangement Record) lights up while recording onto the timeline', () => {
    const { button, arrangement, recordingChanged } = bar();
    const rec = button('Arrangement Record');
    expect(rec.textContent).toBe('● Rec');
    expect(rec.classList.contains('on')).toBe(false);
    arrangement.recording = true;
    recordingChanged();
    expect(rec.classList.contains('on')).toBe(true);
  });

  it('the right click on ● or ● Rec opens the recording settings', () => {
    const { button, commands } = bar();
    for (const title of ['Overdub', 'Arrangement Record']) {
      const right = new MouseEvent('contextmenu', { cancelable: true });
      button(title).dispatchEvent(right);
      expect(right.defaultPrevented).toBe(true);
    }
    expect(commands.recordingSettings).toHaveBeenCalledTimes(2);
  });

  it('the tempo: a valid value is applied (two decimals), a wrong one restored; Enter leaves the field', () => {
    const { bpm, store } = bar();
    expect(bpm.value).toBe('120');
    bpm.value = '133.333';
    bpm.dispatchEvent(new Event('change'));
    expect(store.project.tempo.bpm).toBe(133.33);
    bpm.value = '5';
    bpm.dispatchEvent(new Event('change'));
    expect(store.project.tempo.bpm).toBe(133.33);
    expect(bpm.value).toBe('133.33');
    bpm.focus();
    expect(document.activeElement).toBe(bpm);
    bpm.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(document.activeElement).toBe(bpm);
    // while typing the field isn't overwritten
    bpm.value = '14';
    store.apply(setLoopRegion({ enabled: true }));
    expect(bpm.value).toBe('14');
    bpm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.activeElement).not.toBe(bpm);
  });

  it('the grid: adaptive (with its density) or fixed, and the triplets', () => {
    const { grid, ui, button } = bar();
    expect(grid.options).toHaveLength(FIXED_GRIDS.length + 1);
    expect(grid.value).toBe('adaptive');
    grid.value = '1';
    grid.dispatchEvent(new Event('change'));
    expect(ui.grid.fixed).toBe(1);
    grid.value = 'adaptive';
    grid.dispatchEvent(new Event('change'));
    expect(ui.grid.fixed).toBeNull();
    ui.setGrid({ ...ui.grid, density: 1, triplet: true });
    expect(grid.options[0].text).toBe('Adaptive +1');
    expect(button('Triplet').classList.contains('on')).toBe(true);
    ui.setGrid({ ...ui.grid, fixed: 3 });
    expect(grid.value).toBe('3');
  });

  it('the position follows the engine at each frame; groups are added at the far right', () => {
    const { t, engine } = bar();
    const pos = t.element.querySelector('.pos')!;
    const start = pos.textContent;
    engine.position = 4;
    frames.shift()!(0);
    expect(pos.textContent).not.toBe(start);
    expect(frames).toHaveLength(1);
    const extra = document.createElement('button');
    t.addGroup(extra);
    expect(t.element.lastElementChild!.classList.contains('end')).toBe(true);
    expect(t.element.lastElementChild!.firstChild).toBe(extra);
  });
});
