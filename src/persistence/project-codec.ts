import { asId } from '../core/id';
import { SAMPLER, upgradeZoneTune } from '../devices/instruments/sampler/sampler';
import { Tempo, TimeSignature } from '../core/music-time';
import type { Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import type { KeyMap, KeyTarget } from '../model/key-map';
import { DEFAULT_LAUNCH_QUANTUM } from '../model/launch';
import { checkMidiMap, MIXER_CONTROLS, type MidiMap, type MidiMapping, type MidiTarget, type MixerControl } from '../model/midi-map';
import { Project, type ChainOwner } from '../model/project';
import { MACRO_MODES, springFor, type DeviceKey, type Macro, type MacroMode, type MacroSpring, type Rack, type RackList } from '../model/rack';
import type { SampleRef } from '../model/sample';
import { DEFAULT_INSTRUMENT, type DeviceSettings, type EffectSettings } from '../model/device';
import { AudioTrack, BusTrack, GroupTrack, MidiTrack, type MixerSettings, type Sends, type Track, type TrackProps } from '../model/track';
import { decodeEnvelopes, defaultClipCodecs, encodeEnvelopes, type ClipCodec } from './clip-codecs';
import { JsonReader, type Json, type JsonObject } from './json-reader';

export const PROJECT_FORMAT = 'studiomio-project';
export const PROJECT_VERSION = 12;

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
  {
    kind: 'group',
    create: (props, r) => GroupTrack.create({ ...(props as TrackProps<never>), folded: r.has('folded') && r.bool('folded') }),
    encodeExtra: (t): JsonObject => ((t as GroupTrack).folded ? { folded: true } : {}),
    accepts: probe(GroupTrack.empty(asId('probe'), '', '', 0)),
  },
  {
    kind: 'bus',
    create: (props, r) => BusTrack.create({ ...(props as TrackProps<never>), folded: r.has('folded') && r.bool('folded') }),
    encodeExtra: (t): JsonObject => ((t as BusTrack).folded ? { folded: true } : {}),
    accepts: probe(BusTrack.empty(asId('probe'), '', '')),
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
  // 5 → 6: le clip possono avere modulazioni (campo facoltativo: non cambia nulla)
  5: json => json,
  // 6 → 7: i dispositivi possono suonare sample del progetto (campo facoltativo)
  6: json => json,
  // 7 → 8: le catene possono avere dei rack con le macro (campo facoltativo)
  7: json => json,
  // 8 → 9: le tracce possono stare in un gruppo (campo facoltativo, e il tipo "group")
  8: json => json,
  // 9 → 10: un effetto può ascoltare un'altra traccia, il sidechain (campo facoltativo)
  9: json => json,
  // 10 → 11: i bus (campo facoltativo) e le mandate delle tracce verso i bus (campo facoltativo)
  10: json => json,
  // 11 → 12: le zone del Sampler non hanno più Tune e Fine: vanno nel Transpose e Detune della zona
  11: json => ({
    ...json,
    tracks: (json.tracks as JsonObject[]).map(t => {
      const inst = t.instrument as JsonObject | undefined;
      if (!inst || inst.type !== SAMPLER.type) return t;
      const params = upgradeZoneTune(inst.params as Record<string, number>, inst.samples as JsonObject | undefined);
      return { ...t, instrument: { ...inst, params } };
    }),
  }),
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
      ...encodeRacks('masterRacks', p.masterRacks),
      ...(p.masterAutomation.length ? { masterAutomation: encodeEnvelopes(p.masterAutomation) } : {}),
      launchQuantization: p.launchQuantization,
      scenes: p.scenes.map(s => ({ id: s.id, name: s.name, ...(s.color ? { color: s.color } : {}) })),
      samples: p.samples.map(encodeSample),
      tracks: p.tracks.map(t => this.encodeTrack(t)),
      // senza bus il file resta come lo scrivevano le versioni di prima
      ...(p.buses.length ? { buses: p.buses.map(b => this.encodeTrack(b)) } : {}),
      ...encodeKeyMap(p.keyMap),
      ...encodeMidiMap(p.midiMap),
    };
  }

  private encodeTrack(t: Track): JsonObject {
    return {
      kind: t.kind, id: t.id, name: t.name, color: t.color,
      ...(t.group ? { group: t.group } : {}),
      mixer: encodeMixer(t.mixer),
      ...(Object.keys(t.sends).length ? { sends: { ...t.sends } as JsonObject } : {}),
      arrangement: t.arrangement.map(pl => ({
        id: pl.id, start: pl.start, length: pl.length, offset: pl.offset,
        ...(pl.fadeIn ? { fadeIn: pl.fadeIn } : {}), ...(pl.fadeOut ? { fadeOut: pl.fadeOut } : {}),
        clip: this.encodeClip(pl.clip),
      })),
      slots: t.slots.map(c => (c ? this.encodeClip(c) : null)),
      effects: t.effects.map(encodeEffect),
      ...encodeRacks('racks', t.racks),
      ...this.trackType(t.kind).encodeExtra(t),
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
        masterRacks: decodeRacks(r, 'masterRacks'),
        masterAutomation: r.has('masterAutomation') ? decodeEnvelopes(r.get('masterAutomation')) : undefined,
        launchQuantization: r.str('launchQuantization'),
        scenes: r.array('scenes').map(s => ({ id: asId(s.str('id')), name: s.str('name'), ...(s.has('color') ? { color: s.str('color') } : {}) })),
        samples: r.array('samples').map(decodeSample),
        tracks: r.array('tracks').map(t => this.decodeTrack(t)),
        buses: r.has('buses') ? r.array('buses').map(b => this.decodeTrack(b) as BusTrack) : undefined,
        keyMap: r.has('keyMap') ? r.array('keyMap').map(decodeKeyMapping) : undefined,
        midiMap: r.has('midiMap') ? decodeMidiMap(r) : undefined,
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
      ...(p.has('fadeIn') ? { fadeIn: p.num('fadeIn') } : {}), ...(p.has('fadeOut') ? { fadeOut: p.num('fadeOut') } : {}),
      clip: clipFor(p.get('clip')),
    }));
    return type.create({
      id: asId(r.str('id')), name: r.str('name'), color: r.str('color'),
      group: r.has('group') ? asId<'track'>(r.str('group')) : undefined,
      mixer: decodeMixer(r.get('mixer')),
      sends: r.has('sends') ? decodeSends(r.get('sends')) : undefined,
      arrangement: arrangement.sort((a, b) => a.start - b.start),
      slots: r.array('slots').map(s => (s.raw === null ? null : clipFor(s))),
      effects: r.array('effects').map(decodeEffect),
      racks: decodeRacks(r, 'racks'),
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

const decodeSends = (r: JsonReader): Sends => Object.fromEntries(r.keys().map(k => [k, r.num(k)]));

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

const encodeInstrument = (i: DeviceSettings): JsonObject => ({
  type: i.type, preset: i.preset, params: { ...i.params },
  ...(i.samples ? { samples: { ...i.samples } } : {}),
});

const decodeInstrument = (r: JsonReader): DeviceSettings => {
  const params = r.get('params');
  const samples = r.has('samples') ? r.get('samples') : null;
  return {
    type: r.str('type'),
    preset: r.nullable('preset', p => p.asString()),
    params: Object.fromEntries(params.keys().map(k => [k, params.num(k)])),
    ...(samples ? { samples: Object.fromEntries(samples.keys().map(k => [k, asId<'sample'>(samples.str(k))])) } : {}),
  };
};

const encodeEffect = (e: EffectSettings): JsonObject => ({
  id: e.id, enabled: e.enabled, ...encodeInstrument(e), ...(e.sidechain ? { sidechain: e.sidechain } : {}),
});

const decodeEffect = (r: JsonReader): EffectSettings => ({
  id: asId(r.str('id')), enabled: r.bool('enabled'), ...decodeInstrument(r),
  ...(r.has('sidechain') ? { sidechain: asId<'track'>(r.str('sidechain')) } : {}),
});

/** I rack si scrivono solo se ci sono. */
const encodeRacks = (field: string, racks: RackList): JsonObject => (racks.length ? {
  [field]: racks.map(rk => ({
    id: rk.id, name: rk.name, devices: [...rk.devices],
    macros: rk.macros.map(m => ({
      name: m.name, value: m.value, mappings: m.mappings.map(x => ({ ...x })), ...(m.mode && m.mode !== 'knob' ? { mode: m.mode } : {}),
      ...(m.mode === 'spring' && m.spring ? { spring: { ...m.spring } } : {}),
    })),
  })),
} : {});

const decodeRacks = (r: JsonReader, field: string): RackList | undefined =>
  (r.has(field) ? r.array(field).map(decodeRack) : undefined);

const decodeRack = (r: JsonReader): Rack => ({
  id: asId(r.str('id')),
  name: r.nullable('name', n => n.asString()),
  devices: r.array('devices').map(d => d.asString() as DeviceKey),
  macros: r.array('macros').map((m): Macro => ({
    name: m.nullable('name', n => n.asString()),
    value: m.num('value'),
    mappings: m.array('mappings').map(x => ({ device: x.str('device') as DeviceKey, param: x.str('param'), min: x.num('min'), max: x.num('max') })),
    // interruttori, pulsanti e molle (le manopole non scrivono il tipo); un tipo sconosciuto è una manopola
    ...(m.has('mode') && MACRO_MODES.some(([mode]) => mode === m.str('mode')) ? { mode: m.str('mode') as MacroMode } : {}),
    ...(m.has('mode') && m.str('mode') === 'spring' && m.has('spring')
      ? { spring: decodeSpring(m.get('spring')) } : {}),
  })),
});

const decodeSpring = (s: JsonReader): MacroSpring => springFor(s.num('rest'), s.num('time'), s.bool('sync'));

/** La tastiera si scrive solo se è mappata (e solo ciò che vale: rack e dispositivi che ci sono). */
const encodeKeyMap = (map: KeyMap): JsonObject => (map.length ? {
  keyMap: map.map(({ key, target }): JsonObject => ({ key, ...encodeTarget(target) })),
} : {});

const decodeKeyMapping = (r: JsonReader): { key: string; target: KeyTarget } => {
  const target = decodeTarget(r);
  if (target.kind !== 'macro' && target.kind !== 'param') return r.get('kind').fail(`mappatura della tastiera sconosciuta: ${target.kind}`);
  return { key: r.str('key'), target };
};

/** Il MIDI come la tastiera: il controllo (tipo, canale, numero) accanto al bersaglio. */
const encodeMidiMap = (map: MidiMap): JsonObject => (map.length ? {
  midiMap: map.map(({ control: c, target }): JsonObject => ({ type: c.type, channel: c.channel, number: c.number, ...encodeTarget(target) })),
} : {});

const decodeMidiMap = (r: JsonReader): MidiMap => {
  const map = r.array('midiMap').map((m): MidiMapping => {
    const type = m.str('type');
    if (type !== 'cc' && type !== 'note') return m.get('type').fail(`controllo MIDI sconosciuto: ${type}`);
    return { control: { type, channel: m.int('channel'), number: m.int('number') }, target: decodeTarget(m) };
  });
  checkMidiMap(map);
  return map;
};

const encodeTarget = (t: MidiTarget): JsonObject => {
  switch (t.kind) {
    case 'macro': return { kind: t.kind, owner: t.owner, rack: t.rack, index: t.index };
    case 'param': return { kind: t.kind, owner: t.owner, device: t.device, param: t.param };
    case 'mixer': return { kind: t.kind, owner: t.owner, mixer: t.control };
    case 'send': return { kind: t.kind, owner: t.owner, bus: t.bus };
  }
};

const decodeTarget = (r: JsonReader): MidiTarget => {
  const owner = r.str('owner') as ChainOwner;
  const kind = r.str('kind');
  if (kind === 'macro') return { kind, owner, rack: asId(r.str('rack')), index: r.int('index') };
  if (kind === 'param') return { kind, owner, device: r.str('device') as DeviceKey, param: r.str('param') };
  if (kind === 'mixer') {
    const control = r.str('mixer') as MixerControl;
    if (!MIXER_CONTROLS.includes(control)) return r.get('mixer').fail(`controllo del mixer sconosciuto: ${control}`);
    return { kind, owner, control };
  }
  if (kind === 'send') return { kind, owner: asId(owner), bus: asId(r.str('bus')) };
  return r.get('kind').fail(`mappatura sconosciuta: ${kind}`);
};
