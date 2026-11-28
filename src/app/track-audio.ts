/* The timeline's tracks as audio, with their effects (see model/track-render.ts):
 * - export: one WAV file per track in the mix (the stems; not the muted ones), as heard in the mix but
 *   without the master's effects, all as long as the mix's export so they line up, into a new folder
 *   inside the one chosen;
 * - render into the project (Freeze and Flatten): each track becomes a new audio track below it
 *   (store/bounce-edits.ts), its file in the project folder.
 * The files are 32-bit float: without the master's limiter a track can go over 0 dB, and it must not clip. */
import { oneAtATime } from '../core/async';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { encodeWav } from '../dsp/codec/wav';
import { trimSilence } from '../engine/offline-mix';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { renderableTracks, stemTracks, trackRenderProject, trackSpan } from '../model/track-render';
import type { Track } from '../model/track';
import type { Directory } from '../persistence/directory';
import { safeFileName } from '../persistence/project-folder';
import { bouncedTracks, bouncedName, type Bounced } from '../store/bounce-edits';
import type { ProjectStore } from '../store/project-store';

/** Seconds computed past a track's last clip for a render into the project: the silence is then cut. */
const BOUNCE_TAIL = 8;

export interface TrackAudioDeps {
  readonly store: ProjectStore;
  readonly sampleRate: () => number;
  /** The offline mixdown of [from, to) of `project`. */
  render(from: Beats, to: Beats, project: Project, tailSeconds?: number): Promise<Float32Array[]>;
  /** A new audio file in the project folder. */
  addAudio(name: string, data: { channels: Float32Array[]; sampleRate: number }, wav: Uint8Array): Promise<SampleRef>;
  /** Lets the user choose a folder (throws if they don't). */
  pickFolder(): Promise<Directory>;
  readonly projectName: () => string;
  /** Runs a long action, its errors in the status bar. */
  run(action: () => Promise<void>): void;
  say(text: string): void;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** A file name for each track: its name as the disk accepts it, numbered in the tracks' order (so they
 *  line up in another program, and two tracks with the same name don't collide). */
export function stemNames(tracks: readonly Track[]): string[] {
  const width = String(tracks.length).length;
  return tracks.map((t, i) => `${String(i + 1).padStart(width, '0')} ${safeFileName(t.name)}.wav`);
}

/** How many numbered folder names are tried before one with the time. */
const FOLDER_TRIES = 50;

/** A folder name not used yet inside `dir`: `name`, then `name 2`, `name 3`… */
async function freshFolder(dir: Directory, name: string): Promise<string> {
  const candidates = Array.from({ length: FOLDER_TRIES }, (_, i) => (i === 0 ? name : `${name} ${i + 1}`));
  const contents = await Promise.all(candidates.map(c => dir.list(c)));
  return candidates[contents.findIndex(files => !files.length)] ?? `${name} ${Date.now()}`;
}

export class TrackAudio {
  /** A render is running: another one doesn't start. */
  private busy = false;

  constructor(private readonly deps: TrackAudioDeps) {}

  /** Starts `work` unless another render is running. */
  private exclusive(work: () => Promise<void>): void {
    if (this.busy) return this.deps.say('Another render is running: wait for it to finish.');
    this.busy = true;
    this.deps.run(async () => {
      try {
        await work();
      } finally {
        this.busy = false;
      }
    });
  }

  /** File › Export the tracks: the loop region if it's on, otherwise the whole timeline (as the mix). */
  exportStems(): void {
    const p = this.deps.store.project, tracks = stemTracks(p);
    const muted = renderableTracks(p).length - tracks.length;
    const [from, to] = p.loop.enabled ? [p.loop.start, p.loop.end] : [0, p.arrangementEnd];
    if (!tracks.length || to <= from) return this.deps.say('Nothing to export: no track in the mix has clips on the timeline.');
    this.exclusive(async () => {
      const dir = await this.deps.pickFolder();
      const folder = await freshFolder(dir, `${this.deps.projectName()} - tracks`);
      const names = stemNames(tracks), sr = this.deps.sampleRate();
      await oneAtATime(tracks, async (t, i) => {
        this.deps.say(`Exporting the tracks: ${i + 1} of ${tracks.length}, "${t.name}"…`);
        const mix = await this.deps.render(from, to, trackRenderProject(p, t.id, 'stem'));
        await dir.writeBytes(`${folder}/${names[i]}`, new Uint8Array(encodeWav(mix, sr, 32)));
      });
      const skipped = muted ? `; ${plural(muted, 'muted track', 'muted tracks')} left out` : '';
      this.deps.say(`${plural(tracks.length, 'track', 'tracks')} exported into "${dir.name}/${folder}" (WAV 32-bit float, without the master's effects${skipped}).`);
    });
  }

  /** The tracks a render of `ids` covers: a group stands for its tracks; only those with clips. */
  private tracksOf(ids: Iterable<TrackId>): Track[] {
    const p = this.deps.store.project, wanted = new Set<TrackId>();
    for (const id of ids) for (const t of p.soundingTracks(id)) wanted.add(t.id);
    return renderableTracks(p).filter(t => wanted.has(t.id));
  }

  /** Renders tracks `ids` (all those with clips without) into new audio tracks below them. */
  bounce(ids?: Iterable<TrackId>): void {
    const p = this.deps.store.project, tracks = ids ? this.tracksOf(ids) : renderableTracks(p);
    if (!tracks.length) return this.deps.say('Nothing to render: the track has no clips on the timeline.');
    this.exclusive(async () => {
      const items: Bounced[] = [], sr = this.deps.sampleRate();
      await oneAtATime(tracks, async (t, i) => {
        this.deps.say(`Rendering to audio: ${i + 1} of ${tracks.length}, "${t.name}"…`);
        const span = trackSpan(t)!;
        const mix = await this.deps.render(span.start, span.end, trackRenderProject(p, t.id, 'bounce'), BOUNCE_TAIL);
        const channels = trimSilence(mix, Math.round(p.tempo.secondsAt(span.end - span.start) * sr));
        const sample = await this.deps.addAudio(`${bouncedName(t.name)}.wav`, { channels, sampleRate: sr }, new Uint8Array(encodeWav(channels, sr, 32)));
        const length = p.tempo.beatAt(channels[0].length / sr);
        items.push({ source: t.id, sample, start: span.start, length });
      });
      this.deps.store.apply(bouncedTracks(items));
      const what = items.length === 1 ? `"${tracks[0].name}" is now an audio track` : `${items.length} tracks are now audio tracks`;
      this.deps.say(`${what}, right below; the original is muted (unmute it to go back).`);
    });
  }
}
