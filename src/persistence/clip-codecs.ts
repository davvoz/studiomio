import { asId } from '../core/id';
import { AudioClip, type WarpOptions } from '../model/audio-clip';
import type { Clip, ClipProps } from '../model/clip';
import { parseTargetKey, targetKey, type ClipEnvelope } from '../model/envelope';
import { MidiClip } from '../model/midi-clip';
import { WarpMarkers } from '../model/warp-markers';
import type { JsonObject, JsonReader } from './json-reader';

/** Conversione JSON di un tipo di clip. */
export interface ClipCodec<C extends Clip = Clip> {
  readonly kind: string;
  /** Vero se questo codec sa scrivere la clip. */
  handles(clip: Clip): clip is C;
  encode(clip: C): JsonObject;
  decode(r: JsonReader): C;
}

// -------------------------------------------------- proprietà comuni a tutte le clip

const encodeBase = (c: Clip): JsonObject => ({
  kind: c.kind, id: c.id, name: c.name, color: c.color,
  region: { start: c.region.start, end: c.region.end },
  loop: { enabled: c.loop.enabled, start: c.loop.start, end: c.loop.end },
  // le modulazioni solo se ci sono: { "mixer:volume": [[battito, valore], …] }
  ...(c.envelopes.length ? { envelopes: Object.fromEntries(c.envelopes.map(e => [targetKey(e.target), e.points.map(p => [p.beat, p.value])])) } : {}),
});

const decodeEnvelopes = (r: JsonReader): ClipEnvelope[] =>
  r.keys().map(key => ({
    target: parseTargetKey(key) ?? r.get(key).fail(`modulazione sconosciuta: ${key}`),
    points: r.array(key).map(p => {
      const [beat, value] = p.tuple(2);
      return { beat, value };
    }),
  }));

const decodeBase = (r: JsonReader): ClipProps => {
  const region = r.get('region'), loop = r.get('loop');
  return {
    id: asId(r.str('id')), name: r.str('name'), color: r.str('color'),
    region: { start: region.num('start'), end: region.num('end') },
    loop: { enabled: loop.bool('enabled'), start: loop.num('start'), end: loop.num('end') },
    envelopes: r.has('envelopes') ? decodeEnvelopes(r.get('envelopes')) : [],
  };
};

/** Il costruttore della clip valida regione e loop: l'errore riporta il percorso nel file. */
const guarded = <T>(r: JsonReader, build: () => T): T => {
  try {
    return build();
  } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) r.fail(e.message);
    throw e;
  }
};

// -------------------------------------------------- audio

const WARP_MODES = ['beats', 'tones', 'texture', 'complex', 'repitch'] as const;
const BEATS_LOOP = ['off', 'forward', 'pingpong'] as const;

const encodeWarpOptions = (o: WarpOptions): JsonObject => ({
  beats: { preserve: o.beats.preserve, loop: o.beats.loop, envelope: o.beats.envelope },
  tones: { grainMs: o.tones.grainMs },
  texture: { grainMs: o.texture.grainMs, flux: o.texture.flux },
  complex: { fftSize: o.complex.fftSize, resetOnTransients: o.complex.resetOnTransients },
});

const decodeWarpOptions = (r: JsonReader): WarpOptions => {
  const beats = r.get('beats'), tones = r.get('tones'), texture = r.get('texture'), complex = r.get('complex');
  const preserve = beats.get('preserve');
  return {
    beats: {
      preserve: typeof preserve.raw === 'number' ? preserve.asNumber() : beats.oneOf('preserve', ['transients'] as const),
      loop: beats.oneOf('loop', BEATS_LOOP),
      envelope: beats.num('envelope'),
    },
    tones: { grainMs: tones.num('grainMs') },
    texture: { grainMs: texture.num('grainMs'), flux: texture.num('flux') },
    complex: { fftSize: complex.int('fftSize'), resetOnTransients: complex.bool('resetOnTransients') },
  };
};

export const audioClipCodec: ClipCodec<AudioClip> = {
  kind: 'audio',
  handles: (c): c is AudioClip => c instanceof AudioClip,
  encode: c => ({
    ...encodeBase(c),
    sample: c.sample,
    warp: {
      enabled: c.warp.enabled, mode: c.warp.mode,
      baseBpm: c.warp.markers.baseBpm,
      // [secondo nel sample, battito] in coppie: compatto e leggibile
      markers: c.warp.markers.markers.map(m => [m.t, m.b]),
      options: encodeWarpOptions(c.warp.options),
    },
    transpose: c.transpose, detune: c.detune, gainDb: c.gainDb, reversed: c.reversed,
  }),
  decode: r => {
    const warp = r.get('warp');
    const markers = warp.array('markers').map(m => {
      const [t, b] = m.tuple(2);
      return { t, b };
    });
    return guarded(r, () => AudioClip.create({
      ...decodeBase(r),
      sample: asId(r.str('sample')),
      warp: {
        enabled: warp.bool('enabled'),
        mode: warp.oneOf('mode', WARP_MODES),
        markers: WarpMarkers.of(markers, warp.num('baseBpm')),
        options: decodeWarpOptions(warp.get('options')),
      },
      transpose: r.num('transpose'), detune: r.num('detune'), gainDb: r.num('gainDb'),
      // i progetti salvati prima del reverse non hanno il campo
      reversed: r.has('reversed') && r.bool('reversed'),
    }));
  },
};

// -------------------------------------------------- MIDI

export const midiClipCodec: ClipCodec<MidiClip> = {
  kind: 'midi',
  handles: (c): c is MidiClip => c instanceof MidiClip,
  encode: c => ({
    ...encodeBase(c),
    // [altezza, inizio, durata, velocity]: un progetto può avere migliaia di note
    notes: c.notes.map(n => [n.pitch, n.start, n.duration, n.velocity]),
  }),
  decode: r => {
    const notes = r.array('notes').map(n => {
      const [pitch, start, duration, velocity] = n.tuple(4);
      return { pitch, start, duration, velocity };
    });
    return guarded(r, () => MidiClip.create({ ...decodeBase(r), notes }));
  },
};

export const defaultClipCodecs: readonly ClipCodec[] = [audioClipCodec, midiClipCodec] as readonly ClipCodec[];
