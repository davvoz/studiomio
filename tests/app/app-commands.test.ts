import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlacementId } from '../../src/core/id';
import { AudioClip } from '../../src/model/audio-clip';
import type { Project } from '../../src/model/project';
import type { SampleRef } from '../../src/model/sample';
import { ClipRendering, barsName, consolidatedMessage } from '../../src/app/clip-rendering';
import { TimelineCommands, copiedMessage, nothingToPaste } from '../../src/app/timeline-commands';
import { Clipboard } from '../../src/store/clipboard';
import { addMidiClip, addSample, setLoopRegion } from '../../src/store/edits';
import { edit } from '../../src/store/project-store';
import { newSlotMidiClip } from '../../src/store/session-edits';
import { UiState } from '../../src/ui/ui-state';
import { sampleRef, setup } from '../helpers/fixtures';

/** Audio (0) and two MIDI tracks (1, 2): clips at 0–4 and 8–12 on track 1, at 0–4 on track 2. */
function harness() {
  const s = setup({ audio: 1, midi: 2 });
  s.store.apply(addMidiClip(s.track(1), 0, 4));
  s.store.apply(addMidiClip(s.track(1), 8, 4));
  s.store.apply(addMidiClip(s.track(2), 0, 4));
  const ui = new UiState(), clipboard = new Clipboard(), said: string[] = [], revealed: number[] = [];
  const engine = { position: 0, playing: false, seek(b: number) { this.position = b; } };
  let devicesPasted = 0;
  const timeline = new TimelineCommands({
    store: s.store, ui, clipboard, engine, reveal: b => revealed.push(b), pasteDevices: () => { devicesPasted++; }, say: t => said.push(t),
  });
  const clips = (t: number) => s.store.project.track(s.track(t))!.arrangement;
  const placed = (t: number) => clips(t).map(pl => pl.id);
  return { ...s, ui, clipboard, said, revealed, engine, timeline, clips, placed, get devicesPasted() { return devicesPasted; } };
}

describe('timeline commands: messages', () => {
  it('copy and empty paste', () => {
    expect(copiedMessage(1)).toBe('Copied 1 clip: Ctrl+V pastes it at the cursor.');
    expect(copiedMessage(3)).toBe('Copied 3 clips: Ctrl+V pastes them at the cursor.');
    const c = new Clipboard();
    expect(nothingToPaste(c)).toBe('The clipboard is empty.');
    c.content = { kind: 'notes' } as never;
    expect(nothingToPaste(c)).toMatch(/piano roll/);
  });
});

describe('TimelineCommands', () => {
  it('copy and paste at the cursor: the copies are selected and the cursor goes after them', () => {
    const h = harness();
    h.timeline.copySelection();
    expect(h.said.at(-1)).toBe('Select some clips to copy.');
    h.ui.select(h.placed(1));
    h.timeline.copySelection();
    expect(h.said.at(-1)).toMatch(/^Copied 2 clips/);
    h.engine.position = 32;
    h.timeline.paste();
    expect(h.clips(1).map(pl => pl.start)).toEqual([0, 8, 32, 40]);
    expect(h.ui.selection.size).toBe(2);
    expect(h.engine.position).toBe(44);
  });

  it('paste: devices go to the chosen track; an empty clipboard says so; no suitable track says so', () => {
    const h = harness();
    h.timeline.paste();
    expect(h.said.at(-1)).toBe('The clipboard is empty.');
    h.ui.select(h.placed(1));
    h.timeline.copySelection();
    h.timeline.pasteAt(0, 40);
    expect(h.said.at(-1)).toMatch(/^No suitable track here/);
    h.clipboard.content = { kind: 'devices' } as never;
    h.timeline.paste();
    expect(h.devicesPasted).toBe(1);
    h.timeline.pasteAt(1, 0);
  });

  it('paste while playing leaves the cursor; pasting on fewer suitable tracks says how many', () => {
    const h = harness();
    h.ui.select([...h.placed(1), ...h.placed(2)]);
    h.timeline.copySelection();
    h.engine.playing = true;
    h.timeline.pasteAt(2, 64);
    expect(h.engine.position).toBe(0);
    expect(h.said.at(-1)).toMatch(/^Pasted 2 of 3 clips/);
  });

  it('cut, duplicate and delete the selection', () => {
    const h = harness();
    h.timeline.cutSelection();
    expect(h.said.at(-1)).toBe('Select some clips to cut.');
    h.timeline.duplicateSelection();
    h.timeline.deleteSelection();
    h.ui.select([h.placed(2)[0]]);
    h.timeline.duplicateSelection();
    expect(h.clips(2)).toHaveLength(2);
    expect(h.ui.selection.has(h.placed(2)[1])).toBe(true);
    h.timeline.deleteSelection();
    expect(h.clips(2)).toHaveLength(1);
    h.ui.select(h.placed(2));
    h.timeline.cutSelection();
    expect(h.clips(2)).toHaveLength(0);
    expect(h.clipboard.clips?.items).toHaveLength(1);
  });

  it('with a time range only that is deleted, and split keeps the inside selected', () => {
    const h = harness();
    h.ui.select(h.placed(1), { start: 1, end: 2 });
    h.timeline.deleteSelection();
    expect(h.clips(1).map(pl => [pl.start, pl.length])).toEqual([[0, 1], [2, 2], [8, 4]]);
    h.ui.select(h.placed(1), { start: 9, end: 10 });
    h.timeline.splitAtCursor();
    expect(h.clips(1).map(pl => pl.start)).toEqual([0, 2, 8, 9, 10]);
    expect(h.ui.selection.size).toBe(1);
  });

  it('split at the cursor: the selected clips, or all of them', () => {
    const h = harness();
    h.engine.position = 2;
    h.timeline.splitAtCursor();
    expect(h.clips(1)).toHaveLength(3);
    expect(h.clips(2)).toHaveLength(2);
    h.ui.select([h.placed(1)[2]]);
    h.timeline.splitSelectionAt(10);
    expect(h.clips(1)).toHaveLength(4);
  });

  it('colour, select all, a new MIDI clip on the bar, the grid', () => {
    const h = harness();
    h.timeline.colorSelection('#123456');
    h.timeline.selectAll();
    expect(h.ui.selection.size).toBe(3);
    h.timeline.colorSelection('#123456');
    expect(h.clips(2)[0].clip.color).toBe('#123456');
    h.timeline.newMidiClip(h.track(2), 13);
    expect(h.clips(2).map(pl => pl.start)).toEqual([0, 12]);
    expect(h.timeline.snap(5.3)).toBe(Math.round(5.3 / h.ui.gridStep(h.ui.geometry.pxPerBeat, h.store.project.signature)) * h.ui.gridStep(h.ui.geometry.pxPerBeat, h.store.project.signature));
    h.ui.setSnap(false);
    expect(h.timeline.snap(5.3)).toBe(5.3);
  });

  it('duplicate the loop: the copies selected, the loop moved, shown and said', () => {
    const h = harness();
    h.store.apply(setLoopRegion({ start: 0, end: 4, enabled: true }));
    h.timeline.duplicateLoop();
    expect(h.store.project.loop).toMatchObject({ start: 4, end: 8 });
    expect(h.ui.selection.size).toBe(2);
    expect(h.revealed).toEqual([4]);
    expect(h.said.at(-1)).toMatch(/^Loop duplicated: it's now from /);
  });
});

describe('clip rendering', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scene names from bars', () => {
    expect(barsName({ start: 0, end: 4 }, 4)).toBe('Bar 1');
    expect(barsName({ start: 4, end: 16 }, 4)).toBe('Bars 2-4');
    expect(barsName({ start: 5, end: 5 }, 4)).toBe('Bar 2');
    expect(consolidatedMessage(1)).toBe('Clip consolidated.');
    expect(consolidatedMessage(2)).toBe('2 clips consolidated, one per track.');
  });

  /** Rendering waits for `render`; `run` keeps the work to await it. */
  function rendering(h: ReturnType<typeof harness>, render = vi.fn(async (): Promise<SampleRef> => sampleRef(h.ids)) ) {
    const work: Promise<void>[] = [];
    const r = new ClipRendering({
      store: h.store, ui: h.ui, engine: h.engine, render, say: t => h.said.push(t),
      run: action => { work.push(action()); },
    });
    return { r, render, done: () => Promise.all(work) };
  }

  it('consolidate: says how without a selection; MIDI clips of each track become one', async () => {
    const h = harness();
    const { r, render, done } = rendering(h);
    r.consolidate();
    expect(h.said.at(-1)).toBe('Select some clips to consolidate.');
    h.ui.select([...h.placed(1), ...h.placed(2)]);
    r.consolidate();
    await done();
    expect(render).not.toHaveBeenCalled();
    expect(h.clips(1)).toHaveLength(1);
    expect(h.clips(1)[0]).toHaveLength(12);
    expect(h.said.at(-1)).toBe('2 clips consolidated, one per track.');
    expect(h.ui.selection.size).toBe(2);
  });

  it('consolidate audio renders it; a second one waits for the first', async () => {
    const h = harness();
    const sample = sampleRef(h.ids);
    h.store.apply(addSample(sample));
    const place = (start: number) => h.store.apply(edit('place', (p: Project, { ids }) => p.updatingTrack(h.track(0), t =>
      t.placing({ id: ids.next('placement') as PlacementId, start, length: 8, offset: 0, clip: AudioClip.fromSample(ids.next('clip'), sample, '#fff') }, ids))));
    place(0);
    place(8);
    const { r, render, done } = rendering(h, vi.fn(async () => sample));
    h.ui.select(h.placed(0));
    r.consolidate();
    r.consolidate();
    await done();
    expect(render).toHaveBeenCalledTimes(1);
    expect(h.said).toEqual(['Consolidating the audio…', 'Clip consolidated.']);
    expect(h.clips(0)).toHaveLength(1);
  });

  it('a change during the rendering stops the consolidation', async () => {
    const h = harness();
    const sample = sampleRef(h.ids);
    h.store.apply(addSample(sample));
    h.store.apply(edit('place', (p: Project, { ids }) => p.updatingTrack(h.track(0), t =>
      t.placing({ id: ids.next('placement') as PlacementId, start: 0, length: 8, offset: 0, clip: AudioClip.fromSample(ids.next('clip'), sample, '#fff') }, ids))));
    const { r, done } = rendering(h, vi.fn(async () => {
      h.store.apply(addMidiClip(h.track(2), 20, 4));
      return sample;
    }));
    h.ui.select(h.placed(0));
    r.consolidate();
    await done();
    expect(h.said.at(-1)).toBe('The project changed during consolidation: try again.');
  });

  it('copy to the session: a scene named by its bars, a clip per track', async () => {
    const h = harness();
    const { r, done } = rendering(h);
    r.toSession();
    expect(h.said.at(-1)).toBe('Select some clips to copy to the session.');
    h.ui.select([h.placed(1)[0], h.placed(2)[0]]);
    const scenes = h.store.project.scenes.length;
    r.toSession();
    await done();
    expect(h.store.project.scenes).toHaveLength(scenes + 1);
    expect(h.store.project.scenes.at(-1)!.name).toBe('Bar 1');
    expect(h.said.at(-1)).toBe('Scene "Bar 1" at the bottom of the session, with 2 clips.');
  });

  it('a scene to the timeline at the cursor; the cursor goes to its end; an empty one says so', () => {
    const h = harness();
    const { r } = rendering(h);
    r.sceneToArrangement(1);
    expect(h.said.at(-1)).toBe('The scene is empty: there\'s nothing to copy.');
    h.store.apply(newSlotMidiClip({ track: h.track(1), slot: 1 }));
    h.engine.position = 16;
    r.sceneToArrangement(1);
    expect(h.clips(1).map(pl => pl.start)).toContain(16);
    expect(h.engine.position).toBeGreaterThan(16);
    expect(h.said.at(-1)).toMatch(/in the arrangement from bar 5 to /);
    expect(h.ui.selection.size).toBe(1);
  });
});
