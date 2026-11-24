/* Moving music between the timeline and the session, as in Live: consolidate the selected clips
 * into one per track (Ctrl+J), copy them to a new scene, copy a scene to the timeline. Audio
 * that must be rendered goes through `render` (the app's offline mix and project folder). */
import { oneAtATime } from '../core/async';
import type { Beats } from '../core/music-time';
import type { PlaybackEngine } from '../engine/playback-engine';
import type { Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import { MidiClip } from '../model/midi-clip';
import type { TimeRange } from '../model/note-edits';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { sceneClips, sceneLength } from '../model/scene-export';
import {
  consolidatedAudioClip, consolidatedMidiClip, consolidateSpans, placementsIn, sessionClip, withConsolidated, type Consolidated, type ConsolidateSpan,
} from '../store/consolidate';
import { edit, type ProjectStore } from '../store/project-store';
import { addedPlacements, cutOutRange } from '../store/selection-edits';
import { arrangementToScene, sceneToArrangement, type SceneClip } from '../store/session-edits';
import { resolveSelection } from '../ui/timeline/planning';
import type { UiState } from '../ui/ui-state';

/** A scene is copied for at most this many bars (if the loops only come round later, the longest is enough). */
export const SCENE_MAX_BARS = 64;

export interface ClipRenderingDeps {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: Pick<PlaybackEngine, 'position' | 'playing' | 'seek'>;
  /** The audio of the clips in the range, without the track's effects, in a new file. */
  render(source: Project, pls: readonly Placement<AudioClip>[], span: TimeRange): Promise<SampleRef>;
  /** Runs a long action, its errors in the status bar. */
  run(action: () => Promise<void>): void;
  say(text: string): void;
}

/** A new scene's name from the bars it covers: "Bar 3" or "Bars 3-5". */
export function barsName(range: TimeRange, beatsPerBar: number): string {
  const from = Math.floor(range.start / beatsPerBar) + 1, to = Math.max(from, Math.ceil(range.end / beatsPerBar));
  return from === to ? `Bar ${from}` : `Bars ${from}-${to}`;
}

export const consolidatedMessage = (n: number): string => (n === 1 ? 'Clip consolidated.' : `${n} clips consolidated, one per track.`);

/** The bar (1, 2.5…) a beat falls on, for the messages. */
const barOf = (b: Beats, beatsPerBar: number): number => +(b / beatsPerBar + 1).toFixed(2);

/** The spans' clips split at the edges of `range`: only what plays inside stays. */
function cutAt(base: Project, store: ProjectStore, spans: readonly ConsolidateSpan[], range: TimeRange): Project {
  const refs = spans.flatMap(s => placementsIn(base, s).map(pl => ({ track: s.track, id: pl.id })));
  return cutOutRange(base, store.ids, refs, range).project;
}

export class ClipRendering {
  /** A consolidation is rendering audio: another one doesn't start. */
  private busy = false;

  constructor(private readonly deps: ClipRenderingDeps) {}

  /** Starts `work` unless another one is running; nothing else starts until it ends. */
  private exclusive(work: () => Promise<void>): void {
    if (this.busy) return;
    this.busy = true;
    this.deps.run(async () => {
      try {
        await work();
      } finally {
        this.busy = false;
      }
    });
  }

  /** Consolidate (Ctrl+J), as in Live: on each track the selected clips, from the first to the
   *  last (or the selected time range), become a single clip that sounds as before. Audio is
   *  rendered without the track's effects into a new file in the project folder. */
  consolidate(): void {
    const { store, ui } = this.deps, refs = resolveSelection(store.project, ui.selection), range = ui.range;
    if (!refs.length) return this.deps.say('Select some clips to consolidate.');
    this.exclusive(async () => {
      const base = store.project, ids = store.ids;
      const spans = consolidateSpans(base, refs, range);
      // with a time range only that is consolidated: first the clips are split at its edges
      const source = range ? cutAt(base, store, spans, range) : base;
      if (spans.some(s => placementsIn(source, s).some(pl => pl.clip instanceof AudioClip))) this.deps.say('Consolidating the audio…');
      const items: Consolidated[] = [];
      await oneAtATime(spans, async span => {
        const pls = placementsIn(source, span);
        if (!pls.length) return;
        const clipId = ids.next('clip'), placement = ids.next('placement');
        if (pls[0].clip instanceof MidiClip) {
          items.push({ span, placement, clip: consolidatedMidiClip(clipId, pls as Placement<MidiClip>[], span.start, span.end) });
          return;
        }
        const audioPls = pls as Placement<AudioClip>[];
        const sample = await this.deps.render(source, audioPls, span);
        items.push({ span, placement, sample, clip: consolidatedAudioClip(clipId, audioPls, sample, source.tempo.bpm, span.start, span.end) });
      });
      if (store.project !== base) return this.deps.say('The project changed during consolidation: try again.');
      store.apply(edit('Consolidate', (_p, ctx) => withConsolidated(source, items, ctx.ids)));
      ui.select(items.map(i => i.placement));
      this.deps.say(consolidatedMessage(items.length));
    });
  }

  /** Copy to session, the opposite of "Copy to arrangement": the selected clips (or the selected
   *  time range) in a new scene at the bottom. Each track has a clip covering the whole range, so
   *  they stay in time with each other; a single clip repeating its piece stays as it is, the rest
   *  is consolidated (audio is rendered into a new file). */
  toSession(): void {
    const { store, ui } = this.deps, refs = resolveSelection(store.project, ui.selection);
    if (!refs.length) return this.deps.say('Select some clips to copy to the session.');
    this.exclusive(async () => {
      const base = store.project, ids = store.ids;
      const own = consolidateSpans(base, refs, ui.range);
      const range = { start: Math.min(...own.map(s => s.start)), end: Math.max(...own.map(s => s.end)) };
      const spans = own.map(s => ({ ...s, ...range }));
      // clips are split at the range's edges: only what plays there stays inside
      const source = cutAt(base, store, spans, range);
      const clips: SceneClip[] = [];
      await oneAtATime(spans, async span => {
        const pls = placementsIn(source, span);
        if (!pls.length) return;
        const clipId = ids.next('clip'), clip = sessionClip(clipId, pls, range.start, range.end);
        if (clip) {
          clips.push({ track: span.track, clip });
          return;
        }
        this.deps.say('Rendering the audio…');
        const audioPls = pls as Placement<AudioClip>[];
        const sample = await this.deps.render(source, audioPls, span);
        clips.push({ track: span.track, sample, clip: consolidatedAudioClip(clipId, audioPls, sample, source.tempo.bpm, range.start, range.end) });
      });
      if (store.project !== base) return this.deps.say('The project changed during rendering: try again.');
      const name = barsName(range, base.signature.beatsPerBar);
      store.apply(arrangementToScene(name, clips));
      const count = clips.length === 1 ? 'one clip' : `${clips.length} clips`;
      this.deps.say(`Scene "${name}" at the bottom of the session, with ${count}.`);
    });
  }

  /** Scene `index` into the arrangement at the cursor, as long as needed for its loops to come
   *  round. The cursor goes to its end: the next scene lines up after it. */
  sceneToArrangement(index: number): void {
    const { store, ui, engine } = this.deps;
    const p = store.project, scene = p.scenes[index], bpb = p.signature.beatsPerBar;
    const len = scene && sceneLength(sceneClips(p, index), SCENE_MAX_BARS * bpb);
    if (!len || len.length <= 0) return this.deps.say('The scene is empty: there\'s nothing to copy.');
    const at = Math.max(0, engine.position);
    store.apply(sceneToArrangement(index, at, len.length));
    ui.select(addedPlacements(p, store.project).map(r => r.id));
    if (!engine.playing) engine.seek(at + len.length);
    this.deps.say(`Scene "${scene.name}" in the arrangement from bar ${barOf(at, bpb)} to ${barOf(at + len.length, bpb)}.`);
  }
}
