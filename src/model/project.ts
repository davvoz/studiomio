import type { IdFactory, ProjectId, SampleId, SceneId, TrackId } from '../core/id';
import { Tempo, TimeSignature, type Beats } from '../core/music-time';
import { AudioClip } from './audio-clip';
import type { SampleRef } from './sample';
import { DEFAULT_MIXER, type MixerSettings, type Track } from './track';

export interface Scene {
  readonly id: SceneId;
  readonly name: string;
}

/** Regione di loop della timeline. */
export interface LoopRegion {
  readonly enabled: boolean;
  readonly start: Beats;
  readonly end: Beats;
}

export interface ProjectProps {
  readonly id: ProjectId;
  readonly name: string;
  readonly tempo: Tempo;
  readonly signature: TimeSignature;
  readonly tracks: readonly Track[];
  readonly scenes: readonly Scene[];
  readonly samples: readonly SampleRef[];
  readonly loop: LoopRegion;
  readonly master: MixerSettings;
}

/** Radice del modello. Immutabile: ogni modifica restituisce un nuovo progetto che
 *  condivide con il vecchio tutte le parti non toccate (utile per annulla/ripeti e per
 *  capire cosa è cambiato confrontando i riferimenti). Garantisce le regole che
 *  coinvolgono più parti: ogni traccia ha uno slot per scena, i sample usati esistono. */
export class Project {
  private readonly props: ProjectProps;

  private constructor(props: ProjectProps) {
    this.props = props;
  }

  static create(props: ProjectProps): Project {
    const p = new Project(props);
    p.validate();
    return p;
  }

  static empty(name: string, ids: IdFactory, sceneCount = 8): Project {
    return Project.create({
      id: ids.next('project'), name,
      tempo: new Tempo(120), signature: TimeSignature.COMMON,
      tracks: [],
      scenes: Array.from({ length: sceneCount }, (_, i) => ({ id: ids.next('scene'), name: String(i + 1) })),
      samples: [],
      loop: { enabled: false, start: 0, end: 16 },
      master: DEFAULT_MIXER,
    });
  }

  private with(patch: Partial<ProjectProps>): Project {
    return new Project({ ...this.props, ...patch });
  }

  get id(): ProjectId { return this.props.id; }
  get name(): string { return this.props.name; }
  get tempo(): Tempo { return this.props.tempo; }
  get signature(): TimeSignature { return this.props.signature; }
  get tracks(): readonly Track[] { return this.props.tracks; }
  get scenes(): readonly Scene[] { return this.props.scenes; }
  get samples(): readonly SampleRef[] { return this.props.samples; }
  get loop(): LoopRegion { return this.props.loop; }
  get master(): MixerSettings { return this.props.master; }

  track(id: TrackId): Track | undefined {
    return this.tracks.find(t => t.id === id);
  }

  sample(id: SampleId): SampleRef | undefined {
    return this.samples.find(s => s.id === id);
  }

  /** Fine dell'ultima clip sulla timeline. */
  get arrangementEnd(): Beats {
    return this.tracks.reduce((m, t) => Math.max(m, t.arrangementEnd), 0);
  }

  /** Sample usati da almeno una clip audio. */
  usedSampleIds(): Set<SampleId> {
    return new Set(this.tracks.flatMap(t => t.clips).filter(c => c instanceof AudioClip).map(c => c.sample));
  }

  withName(name: string): Project { return this.with({ name }); }
  withTempo(bpm: number): Project { return this.with({ tempo: new Tempo(bpm) }); }
  withSignature(signature: TimeSignature): Project { return this.with({ signature }); }
  withMaster(patch: Partial<MixerSettings>): Project { return this.with({ master: { ...this.master, ...patch } }); }

  withLoop(patch: Partial<LoopRegion>): Project {
    const loop = { ...this.loop, ...patch };
    if (!(loop.end > loop.start)) throw new RangeError('regione di loop vuota');
    return this.with({ loop });
  }

  // ---------------------------------------------------------------- tracce

  /** Aggiunge una traccia (in fondo, o in `index`), adattando i suoi slot alle scene. */
  addingTrack(track: Track, index = this.tracks.length): Project {
    if (this.track(track.id)) throw new Error(`traccia ${track.id} già presente`);
    let t = track;
    while (t.slots.length < this.scenes.length) t = t.insertingSlot(t.slots.length);
    while (t.slots.length > this.scenes.length) t = t.removingSlot(t.slots.length - 1);
    const tracks = [...this.tracks];
    tracks.splice(index, 0, t);
    return this.with({ tracks }).validated();
  }

  removingTrack(id: TrackId): Project {
    this.requireTrack(id);
    return this.with({ tracks: this.tracks.filter(t => t.id !== id) });
  }

  movingTrack(id: TrackId, toIndex: number): Project {
    const t = this.requireTrack(id);
    const rest = this.tracks.filter(x => x.id !== id);
    rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, t);
    return this.with({ tracks: rest });
  }

  /** Modifica una traccia; il tipo della traccia resta quello che `fn` riceve. */
  updatingTrack<T extends Track>(id: TrackId, fn: (t: T) => T): Project {
    const old = this.requireTrack(id) as T;
    const updated = fn(old);
    if (updated === old) return this;
    return this.with({ tracks: this.tracks.map(t => (t.id === id ? updated : t)) }).validated();
  }

  // ---------------------------------------------------------------- scene

  addingScene(scene: Scene, index = this.scenes.length): Project {
    const scenes = [...this.scenes];
    scenes.splice(index, 0, scene);
    return this.with({ scenes, tracks: this.tracks.map(t => t.insertingSlot(index)) });
  }

  removingScene(id: SceneId): Project {
    const index = this.scenes.findIndex(s => s.id === id);
    if (index < 0) throw new Error(`scena ${id} non trovata`);
    return this.with({
      scenes: this.scenes.filter(s => s.id !== id),
      tracks: this.tracks.map(t => t.removingSlot(index)),
    });
  }

  renamingScene(id: SceneId, name: string): Project {
    return this.with({ scenes: this.scenes.map(s => (s.id === id ? { ...s, name } : s)) });
  }

  // ---------------------------------------------------------------- sample

  addingSample(sample: SampleRef): Project {
    if (this.sample(sample.id)) throw new Error(`sample ${sample.id} già presente`);
    return this.with({ samples: [...this.samples, sample] });
  }

  updatingSample(id: SampleId, fn: (s: SampleRef) => SampleRef): Project {
    if (!this.sample(id)) throw new Error(`sample ${id} non trovato`);
    return this.with({ samples: this.samples.map(s => (s.id === id ? { ...fn(s), id } : s)) });
  }

  /** Un sample si può togliere solo se nessuna clip lo usa. */
  removingSample(id: SampleId): Project {
    if (this.usedSampleIds().has(id)) throw new Error('il sample è usato da almeno una clip');
    return this.with({ samples: this.samples.filter(s => s.id !== id) });
  }

  /** Toglie i sample che nessuna clip usa più. */
  withoutUnusedSamples(): Project {
    const used = this.usedSampleIds();
    const samples = this.samples.filter(s => used.has(s.id));
    return samples.length === this.samples.length ? this : this.with({ samples });
  }

  // ---------------------------------------------------------------- regole

  private requireTrack(id: TrackId): Track {
    const t = this.track(id);
    if (!t) throw new Error(`traccia ${id} non trovata`);
    return t;
  }

  private validated(): Project {
    this.validate();
    return this;
  }

  private validate(): void {
    const ids = new Set<string>();
    for (const t of this.tracks) {
      if (ids.has(t.id)) throw new Error(`traccia ${t.id} duplicata`);
      ids.add(t.id);
      if (t.slots.length !== this.scenes.length) {
        throw new Error(`la traccia "${t.name}" ha ${t.slots.length} slot ma le scene sono ${this.scenes.length}`);
      }
    }
    const known = new Set(this.samples.map(s => s.id));
    for (const id of this.usedSampleIds()) {
      if (!known.has(id)) throw new Error(`una clip usa il sample ${id}, che non è nel progetto`);
    }
  }
}
