import { asId } from '../core/id';
import { Tempo, TimeSignature } from '../core/music-time';
import type { Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import { DEFAULT_LAUNCH_QUANTUM } from '../model/launch';
import { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { DEFAULT_INSTRUMENT, type DeviceSettings, type EffectSettings } from '../model/device';
import { AudioTrack, MidiTrack, type MixerSettings, type Track, type TrackProps } from '../model/track';
import { defaultClipCodecs, type ClipCodec } from './clip-codecs';
import { JsonReader, type Json, type JsonObject } from './json-reader';

export const PROJECT_FORMAT = 'studiomio-project';
export const PROJECT_VERSION = 5;

/** Come scrivere e ricostruire un tipo di traccia. */
export interface TrackType {
  readonly kind: string;
  /** Costruisce la traccia dalle proprietà comuni; `r` dà accesso ai campi propri del tipo. */
  create(props: TrackProps<Clip>, r: JsonReader): Track;
  /** Campi propri del tipo, da aggiungere a quelli comuni. */
  encodeExtra(track: Track): JsonObject;
  /** Prototipo vuoto, usato per sapere quali clip il tipo accetta. */
  readonly accepts: (clip: Clip) => boolean;
}

const probe = (t: Track) => (clip: Clip) => t.accepts(clip);

export const defaultTrackTypes: readonly TrackType[] = [
  {
    kind: 'audio',
    create: props => AudioTrack.create(props as TrackProps<never>),
    encodeExtra: () => ({}),
    accepts: probe(AudioTrack.empty(asId('probe'), '', '', 0)),
  },
  {
    kind: 'midi',
    create: (props, r) => MidiTrack.create({ ...(props as TrackProps<never>), instrument: decodeInstrument(r.get('instrument')) }),
    encodeExtra: t => ({ instrument: encodeInstrument((t as MidiTrack).instrument) }),
    accepts: probe(MidiTrack.empty(asId('probe'), '', '', 0)),
  },
];

/** Aggiornamenti del formato: la voce N porta un file dalla versione N alla N+1. */
type Migration = (json: JsonObject) => JsonObject;
const migrations: Record<number, Migration> = {
  // 1 → 2: le tracce MIDI hanno uno strumento
  1: json => ({
    ...json,
    tracks: (json.tracks as JsonObject[]).map(t => (t.kind === 'midi' ? { ...t, instrument: encodeInstrument(DEFAULT_INSTRUMENT) } : t)),
  }),
  // 2 → 3: ogni traccia ha una catena di effetti
  2: json => ({ ...json, tracks: (json.tracks as JsonObject[]).map(t => ({ ...t, effects: [] })) }),
  // 3 → 4: anche il master ha una catena di effetti
  3: json => ({ ...json, masterEffects: [] }),
  // 4 → 5: la session ha una quantizzazione del lancio
  4: json => ({ ...json, launchQuantization: DEFAULT_LAUNCH_QUANTUM }),
};

/** Progetto ⇄ JSON. Tipi di clip e di traccia sono registri estendibili: un tipo nuovo
 *  porta il suo codec senza modificare questa classe. */
export class ProjectCodec {
  private readonly clips: Map<string, ClipCodec>;
  private readonly tracks: Map<string, TrackType>;

  constructor(clips: readonly ClipCodec[] = defaultClipCodecs, tracks: readonly TrackType[] = defaultTrackTypes) {
    this.clips = new Map(clips.map(c => [c.kind, c]));
    this.tracks = new Map(tracks.map(t => [t.kind, t]));
  }

  stringify(project: Project): string {
    return JSON.stringify(this.encode(project), null, 1);
  }

  parse(text: string): Project {
    return this.decode(JsonReader.parse(text).raw);
  }

  encode(p: Project): JsonObject {
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      id: p.id,
      name: p.name,
      tempo: p.tempo.bpm,
      signature: [p.signature.numerator, p.signature.denominator],
      loop: { enabled: p.loop.enabled, start: p.loop.start, end: p.loop.end },
      master: encodeMixer(p.master),
      masterEffects: p.masterEffects.map(encodeEffect),
      launchQuantization: p.launchQuantization,
      scenes: p.scenes.map(s => ({ id: s.id, name: s.name })),
      samples: p.samples.map(encodeSample),
      tracks: p.tracks.map(t => ({
        kind: t.kind, id: t.id, name: t.name, color: t.color,
        mixer: encodeMixer(t.mixer),
        arrangement: t.arrangement.map(pl => ({
          id: pl.id, start: pl.start, length: pl.length, offset: pl.offset, clip: this.encodeClip(pl.clip),
        })),
        slots: t.slots.map(c => (c ? this.encodeClip(c) : null)),
        effects: t.effects.map(encodeEffect),
        ...this.trackType(t.kind).encodeExtra(t),
      })),
    };
  }

  decode(json: unknown): Project {
    const r = new JsonReader(ProjectCodec.migrate(new JsonReader(json)));
    const sig = r.numbers('signature');
    if (sig.length !== 2) r.get('signature').fail('attesi [numeratore, denominatore]');
    const loop = r.get('loop');
    try {
      return Project.create({
        id: asId(r.str('id')),
        name: r.str('name'),
        tempo: new Tempo(r.num('tempo')),
        signature: new TimeSignature(sig[0], sig[1]),
        loop: { enabled: loop.bool('enabled'), start: loop.num('start'), end: loop.num('end') },
        master: decodeMixer(r.get('master')),
        masterEffects: r.array('masterEffects').map(decodeEffect),
        launchQuantization: r.str('launchQuantization'),
        scenes: r.array('scenes').map(s => ({ id: asId(s.str('id')), name: s.str('name') })),
        samples: r.array('samples').map(decodeSample),
        tracks: r.array('tracks').map(t => this.decodeTrack(t)),
      });
    } catch (e) {
      // regole del modello violate (es. slot e scene non corrispondono): errore di formato
      if (e instanceof Error && (e instanceof RangeError || e.name === 'Error')) r.fail(e.message);
      throw e;
    }
  }

  private encodeClip(c: Clip): JsonObject {
    const codec = this.clips.get(c.kind);
    if (!codec || !codec.handles(c)) throw new Error(`nessun codec per le clip "${c.kind}"`);
    return codec.encode(c);
  }

  private decodeClip(r: JsonReader): Clip {
    const kind = r.str('kind');
    const codec = this.clips.get(kind) ?? r.get('kind').fail(`tipo di clip sconosciuto: ${kind}`);
    return codec.decode(r);
  }

  private decodeTrack(r: JsonReader): Track {
    const kind = r.str('kind');
    const type = this.tracks.get(kind) ?? r.get('kind').fail(`tipo di traccia sconosciuto: ${kind}`);
    const clipFor = (cr: JsonReader): Clip => {
      const clip = this.decodeClip(cr);
      if (!type.accepts(clip)) cr.fail(`una traccia ${kind} non può contenere una clip ${clip.kind}`);
      return clip;
    };
    const arrangement: Placement[] = r.array('arrangement').map(p => ({
      id: asId(p.str('id')), start: p.num('start'), length: p.num('length'), offset: p.num('offset'),
      clip: clipFor(p.get('clip')),
    }));
    return type.create({
      id: asId(r.str('id')), name: r.str('name'), color: r.str('color'),
      mixer: decodeMixer(r.get('mixer')),
      arrangement: arrangement.sort((a, b) => a.start - b.start),
      slots: r.array('slots').map(s => (s.raw === null ? null : clipFor(s))),
      effects: r.array('effects').map(decodeEffect),
    }, r);
  }

  private trackType(kind: string): TrackType {
    const type = this.tracks.get(kind);
    if (!type) throw new Error(`nessun codec per le tracce "${kind}"`);
    return type;
  }

  private static migrate(r: JsonReader): JsonObject {
    if (r.str('format') !== PROJECT_FORMAT) r.get('format').fail('non è un progetto studiomio');
    let version = r.int('version');
    if (version > PROJECT_VERSION) r.get('version').fail(`creato da una versione più recente di studiomio (formato ${version})`);
    let json = r.raw as JsonObject;
    for (; version < PROJECT_VERSION; version++) {
      const step = migrations[version] ?? r.get('version').fail(`formato ${version} non più supportato`);
      json = { ...step(json), version: version + 1 };
    }
    return json;
  }
}

const encodeMixer = (m: MixerSettings): JsonObject => ({ volumeDb: m.volumeDb, pan: m.pan, mute: m.mute, solo: m.solo });

const decodeMixer = (r: JsonReader): MixerSettings => ({
  volumeDb: r.num('volumeDb'), pan: r.num('pan'), mute: r.bool('mute'), solo: r.bool('solo'),
});

const encodeSample = (s: SampleRef): JsonObject => ({
  id: s.id, name: s.name, file: s.file, sampleRate: s.sampleRate, channels: s.channels, frames: s.frames,
  analysis: s.analysis && {
    tempo: s.analysis.tempo, sensitivity: s.analysis.sensitivity, transients: [...s.analysis.transients] as Json[],
  },
});

const decodeSample = (r: JsonReader): SampleRef => ({
  id: asId(r.str('id')), name: r.str('name'), file: r.str('file'),
  sampleRate: r.num('sampleRate'), channels: r.int('channels'), frames: r.int('frames'),
  analysis: r.nullable('analysis', a => ({ tempo: a.num('tempo'), sensitivity: a.num('sensitivity'), transients: a.numbers('transients') })),
});

const encodeInstrument = (i: DeviceSettings): JsonObject => ({ type: i.type, preset: i.preset, params: { ...i.params } });

const decodeInstrument = (r: JsonReader): DeviceSettings => {
  const params = r.get('params');
  return {
    type: r.str('type'),
    preset: r.nullable('preset', p => p.asString()),
    params: Object.fromEntries(params.keys().map(k => [k, params.num(k)])),
  };
};

const encodeEffect = (e: EffectSettings): JsonObject => ({ id: e.id, enabled: e.enabled, ...encodeInstrument(e) });

const decodeEffect = (r: JsonReader): EffectSettings => ({ id: asId(r.str('id')), enabled: r.bool('enabled'), ...decodeInstrument(r) });
