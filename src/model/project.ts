import type { IdFactory, ProjectId, SampleId, SceneId, TrackId } from '../core/id';
import { Tempo, TimeSignature, type Beats } from '../core/music-time';
import { AudioClip } from './audio-clip';
import type { Color } from './clip';
import { deviceSampleIds, type DeviceSettings } from './device';
import type { EffectList } from './effect-list';
import { DEFAULT_LAUNCH_QUANTUM } from './launch';
import { checkRacks, NO_RACKS, pruneRacks, type DeviceKey, type RackList } from './rack';
import type { SampleRef } from './sample';
import { DEFAULT_MIXER, GroupTrack, type MixerSettings, type Track } from './track';

export interface Scene {
  readonly id: SceneId;
  readonly name: string;
  /** Colore scelto dall'utente (assente: la scena non ha colore). */
  readonly color?: Color;
}

/** Il master, come proprietario di una catena di effetti accanto alle tracce. */
export const MASTER = 'master' as const;

/** Chi ha una catena di effetti: una traccia o il master. */
export type ChainOwner = TrackId | typeof MASTER;

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
  /** Volume e mute del master (pan e solo non si usano). */
  readonly master: MixerSettings;
  /** Effetti sul mix di tutte le tracce, prima del volume del master. */
  readonly masterEffects: EffectList;
  /** I rack della catena del master (assenti: nessuno). */
  readonly masterRacks?: RackList;
  /** Quantizzazione del lancio delle clip della session (un id di LAUNCH_QUANTA). */
  readonly launchQuantization: string;
}

/** Radice del modello. Immutabile: ogni modifica restituisce un nuovo progetto che
 *  condivide con il vecchio tutte le parti non toccate (utile per annulla/ripeti e per
 *  capire cosa è cambiato confrontando i riferimenti). Garantisce le regole che
 *  coinvolgono più parti: ogni traccia ha uno slot per scena, i sample usati esistono. */
export class Project {
  private readonly props: ProjectProps;
  /** Le tracce visibili, calcolate alla prima richiesta (il progetto non cambia). */
  private visible: readonly Track[] | null = null;

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
      masterEffects: [],
      launchQuantization: DEFAULT_LAUNCH_QUANTUM,
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
  get masterEffects(): EffectList { return this.props.masterEffects; }
  get masterRacks(): RackList { return this.props.masterRacks ?? NO_RACKS; }
  get launchQuantization(): string { return this.props.launchQuantization; }

  track(id: TrackId): Track | undefined {
    return this.tracks.find(t => t.id === id);
  }

  sample(id: SampleId): SampleRef | undefined {
    return this.samples.find(s => s.id === id);
  }

  /** I nomi dei sample caricati in un dispositivo, per posto. */
  sampleNames(device: DeviceSettings): Map<string, string> {
    return new Map(Object.entries(device.samples ?? {}).flatMap(([slot, id]) => {
      const s = this.sample(id);
      return s ? [[slot, s.name] as const] : [];
    }));
  }

  /** Fine dell'ultima clip sulla timeline. */
  get arrangementEnd(): Beats {
    return this.tracks.reduce((m, t) => Math.max(m, t.arrangementEnd), 0);
  }

  /** Sample usati da almeno una clip audio. */
  /** I sample usati dalle clip audio e dai dispositivi (es. i pad della Drum Machine). */
  usedSampleIds(): Set<SampleId> {
    const clips = this.tracks.flatMap(t => t.clips).filter(c => c instanceof AudioClip).map(c => c.sample);
    const devices = [...this.tracks.flatMap(t => t.devices), ...this.masterEffects].flatMap(deviceSampleIds);
    return new Set([...clips, ...devices]);
  }

  withName(name: string): Project { return this.with({ name }); }
  withTempo(bpm: number): Project { return this.with({ tempo: new Tempo(bpm) }); }
  withSignature(signature: TimeSignature): Project { return this.with({ signature }); }
  withMaster(patch: Partial<MixerSettings>): Project { return this.with({ master: { ...this.master, ...patch } }); }
  withLaunchQuantization(id: string): Project { return this.with({ launchQuantization: id }); }

  withLoop(patch: Partial<LoopRegion>): Project {
    const loop = { ...this.loop, ...patch };
    if (!(loop.end > loop.start)) throw new RangeError('regione di loop vuota');
    return this.with({ loop });
  }

  // ---------------------------------------------------------------- effetti

  /** La catena di una traccia o del master. */
  effectsOf(owner: ChainOwner): EffectList {
    return owner === MASTER ? this.masterEffects : this.requireTrack(owner).effects;
  }

  /** I rack della catena di una traccia o del master. */
  racksOf(owner: ChainOwner): RackList {
    return owner === MASTER ? this.masterRacks : this.requireTrack(owner).racks;
  }

  /** I dispositivi della catena nell'ordine del suono ("instrument" per lo strumento). */
  chainKeys(owner: ChainOwner): readonly DeviceKey[] {
    return owner === MASTER ? this.masterEffects.map(e => e.id) : this.requireTrack(owner).chainKeys;
  }

  /** Modifica la catena di una traccia o del master (le operazioni sono in `effect-list`); gli
   *  effetti tolti escono dai loro rack. */
  updatingEffects(owner: ChainOwner, fn: (list: EffectList) => EffectList): Project {
    if (owner !== MASTER) return this.updatingTrack(owner, t => t.withEffects(fn(t.effects)));
    const masterEffects = fn(this.masterEffects);
    if (masterEffects === this.masterEffects) return this;
    return this.updatingChain(MASTER, () => ({ effects: masterEffects, racks: pruneRacks(masterEffects.map(e => e.id), this.masterRacks) }));
  }

  /** Modifica insieme effetti e rack di una catena (le operazioni sui rack sono in `rack`). */
  updatingChain(owner: ChainOwner, fn: (chain: { effects: EffectList; racks: RackList }) => { effects: EffectList; racks: RackList }): Project {
    const { effects, racks } = fn({ effects: this.effectsOf(owner), racks: this.racksOf(owner) });
    if (owner !== MASTER) return this.updatingTrack(owner, t => t.withChain(effects, racks));
    if (effects === this.masterEffects && racks === this.masterRacks) return this;
    checkRacks(effects.map(e => e.id), racks);
    return this.with({ masterEffects: effects, masterRacks: racks.length ? racks : undefined });
  }

  updatingRacks(owner: ChainOwner, fn: (racks: RackList) => RackList): Project {
    return this.updatingChain(owner, c => ({ effects: c.effects, racks: fn(c.racks) }));
  }

  // ---------------------------------------------------------------- tracce

  /** Aggiunge una traccia (in fondo, o in `index`), adattando i suoi slot alle scene. */
  addingTrack(track: Track, index = this.tracks.length): Project {
    if (this.track(track.id)) throw new Error(`traccia ${track.id} già presente`);
    const tracks = [...this.tracks];
    tracks.splice(index, 0, this.fitted(track));
    return this.with({ tracks }).validated();
  }

  /** Toglie la traccia; un gruppo se ne va con tutte le sue tracce. */
  removingTrack(id: TrackId): Project {
    const gone = new Set(this.trackBlock(this.requireTrack(id).id).map(t => t.id));
    return this.with({ tracks: this.tracks.filter(t => !gone.has(t.id)) });
  }

  /** Sposta la traccia (un gruppo con le sue tracce) in `toIndex` tra le tracce che restano;
   *  il gruppo che la contiene non cambia. */
  movingTrack(id: TrackId, toIndex: number): Project {
    this.requireTrack(id);
    const block = this.trackBlock(id), moved = new Set(block.map(t => t.id));
    const rest = this.tracks.filter(x => !moved.has(x.id));
    rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, ...block);
    return this.with({ tracks: rest }).validated();
  }

  /** Modifica una traccia; il tipo della traccia resta quello che `fn` riceve. */
  updatingTrack<T extends Track>(id: TrackId, fn: (t: T) => T): Project {
    const old = this.requireTrack(id) as T;
    const updated = fn(old);
    if (updated === old) return this;
    return this.with({ tracks: this.tracks.map(t => (t.id === id ? updated : t)) }).validated();
  }

  // ---------------------------------------------------------------- gruppi
  // Come in Live le tracce sono una lista sola: un gruppo viene subito prima delle sue tracce,
  // che stanno di seguito (anche altri gruppi, con le loro).

  /** Le tracce che si vedono (timeline, session, controller): non quelle dentro un gruppo chiuso. */
  get visibleTracks(): readonly Track[] {
    return (this.visible ??= this.tracks.filter(t => !this.groupsOf(t.id).some(g => g.folded)));
  }

  /** I gruppi che contengono la traccia, dal più vicino al più esterno. */
  groupsOf(id: TrackId): GroupTrack[] {
    const out: GroupTrack[] = [];
    for (let g = this.track(id)?.group; g; ) {
      const group = this.track(g);
      if (!(group instanceof GroupTrack)) break;
      out.push(group);
      g = group.group;
    }
    return out;
  }

  /** Vero se la traccia sta nel gruppo, anche dentro un gruppo del gruppo. */
  isInGroup(id: TrackId, group: TrackId): boolean {
    return this.groupsOf(id).some(g => g.id === group);
  }

  /** La traccia e, se è un gruppo, tutte quelle che contiene: un tratto contiguo della lista. */
  trackBlock(id: TrackId): Track[] {
    const i = this.tracks.findIndex(t => t.id === id);
    if (i < 0) return [];
    let end = i + 1;
    while (end < this.tracks.length && this.isInGroup(this.tracks[end].id, id)) end++;
    return this.tracks.slice(i, end);
  }

  /** Dove finisce il blocco della traccia: l'indice della prima traccia che non ne fa parte. */
  blockEnd(id: TrackId): number {
    return this.tracks.findIndex(t => t.id === id) + this.trackBlock(id).length;
  }

  /** Le tracce che suonano clip per `id`: la traccia stessa o, per un gruppo, le sue tracce
   *  che non sono gruppi (lanciare uno slot di un gruppo lancia la riga di queste). */
  soundingTracks(id: TrackId): Track[] {
    return this.trackBlock(id).filter(t => !(t instanceof GroupTrack));
  }

  /** Raggruppa le tracce (con ciò che contengono) nel gruppo nuovo `group`, come Ctrl+G in Live:
   *  il gruppo prende il posto della prima e sta dove stava lei; le tracce lo seguono in ordine. */
  groupingTracks(ids: Iterable<TrackId>, group: GroupTrack): Project {
    if (this.track(group.id)) throw new Error(`traccia ${group.id} già presente`);
    const chosen = new Set(ids);
    // una traccia scelta dentro un gruppo scelto va con il suo gruppo
    const roots = this.tracks.filter(t => chosen.has(t.id) && !this.groupsOf(t.id).some(g => chosen.has(g.id)));
    if (!roots.length) throw new Error('nessuna traccia da raggruppare');
    const rootIds = new Set(roots.map(t => t.id));
    const moved = new Set(roots.flatMap(t => this.trackBlock(t.id)).map(t => t.id));
    const block = this.tracks.filter(t => moved.has(t.id)).map(t => (rootIds.has(t.id) ? t.withGroup(group.id) : t));
    const tracks = this.tracks.flatMap(t =>
      (t.id === roots[0].id ? [this.fitted(group.withGroup(roots[0].group)), ...block] : moved.has(t.id) ? [] : [t]));
    return this.with({ tracks }).validated();
  }

  /** Toglie il gruppo ma non le sue tracce: restano dove sono, nel gruppo che lo conteneva. */
  ungroupingTrack(id: TrackId): Project {
    const g = this.requireTrack(id);
    if (!(g instanceof GroupTrack)) throw new TypeError(`la traccia ${g.name} non è un gruppo`);
    return this.with({ tracks: this.tracks.filter(t => t.id !== id).map(t => (t.group === id ? t.withGroup(g.group) : t)) }).validated();
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

  /** Colora la scena; senza `color` le toglie il colore. */
  recoloringScene(id: SceneId, color?: Color): Project {
    return this.with({
      scenes: this.scenes.map(s => {
        if (s.id !== id) return s;
        const { color: _, ...rest } = s;
        return color ? { ...rest, color } : rest;
      }),
    });
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

  /** Un sample si può togliere solo se nessuna clip (o dispositivo) lo usa. */
  removingSample(id: SampleId): Project {
    if (this.usedSampleIds().has(id)) throw new Error('il sample è usato da almeno una clip o un dispositivo');
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

  /** La traccia con uno slot per scena. */
  private fitted(track: Track): Track {
    let t = track;
    while (t.slots.length < this.scenes.length) t = t.insertingSlot(t.slots.length);
    while (t.slots.length > this.scenes.length) t = t.removingSlot(t.slots.length - 1);
    return t;
  }

  private validated(): Project {
    this.validate();
    return this;
  }

  private validate(): void {
    const ids = new Set<string>();
    let previous: Track | null = null;
    for (const t of this.tracks) {
      if (ids.has(t.id)) throw new Error(`traccia ${t.id} duplicata`);
      if (t.group) {
        // il gruppo viene prima e le sue tracce lo seguono: prima c'è il gruppo o un'altra sua traccia
        if (!ids.has(t.group) || !(this.track(t.group) instanceof GroupTrack)) throw new Error(`la traccia "${t.name}" è in un gruppo che non c'è`);
        if (previous!.id !== t.group && !this.isInGroup(previous!.id, t.group)) {
          throw new Error(`la traccia "${t.name}" non è di seguito alle altre del suo gruppo`);
        }
      }
      ids.add(t.id);
      previous = t;
      if (t.slots.length !== this.scenes.length) {
        throw new Error(`la traccia "${t.name}" ha ${t.slots.length} slot ma le scene sono ${this.scenes.length}`);
      }
      checkRacks(t.chainKeys, t.racks);
    }
    checkRacks(this.masterEffects.map(e => e.id), this.masterRacks);
    const known = new Set(this.samples.map(s => s.id));
    for (const id of this.usedSampleIds()) {
      if (!known.has(id)) throw new Error(`una clip o un dispositivo usa il sample ${id}, che non è nel progetto`);
    }
  }
}
