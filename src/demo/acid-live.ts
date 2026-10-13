/* "Acido crudo": un piccolo live hard acid a 150 BPM in La, fatto per suonare nella session.
 * Le batterie sono i sample dell'utente sui pad di quattro Drum Machine (cassa, clap e
 * rullanti, piatti, percussioni) più una per gli effetti (riser, crash, sirena); le linee acid
 * sono due Analog a una voce con slide e accenti, distorte dal Drive; il rumble è un seno che
 * rotola sui sedicesimi in levare, tra una cassa e l'altra, saturato.
 *
 * Le parti si scrivono come si programma una drum machine o una 303 (vedi patterns.ts),
 * le dieci scene sono le sezioni del live e la timeline ne tiene una "registrazione" di circa
 * 4 minuti, le stesse clip una dopo l'altra. I sample arrivano già pronti (SampleRef):
 * chi costruisce il progetto li copia nella cartella (vedi scripts/build-acid-live.ts). */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { DELAY } from '../devices/effects/delay/delay';
import { DRIVE, SHAPE } from '../devices/effects/drive/drive';
import { bandParam, EQ } from '../devices/effects/eq/eq';
import { ANALOG, VOICE_MODE } from '../devices/instruments/analog/analog';
import { DRUMS, MODEL, padNote, padParam, padSlot } from '../devices/instruments/drums/drums';
import { INSTRUMENT_DEVICE, type EnvelopePoint, type ModTarget } from '../model/envelope';
import { MidiClip, type Note } from '../model/midi-clip';
import { acid, BAR, bars, curve, repeat, steps } from './patterns';
import type { EffectSettings, ParamValues } from '../model/device';
import { MASTER } from '../model/project';
import type { SampleRef } from '../model/sample';
import {
  addEffect, addScene, addTrack, loadEffectPreset, renameProject, renameTrack, setInstrument, setInstrumentSamples,
  setMasterMixer, setMixer, setSlot, setTempo,
} from '../store/edits';
import { edit, type ProjectStore } from '../store/project-store';
import { renameScene } from '../store/session-edits';

export const ACID_LIVE_BPM = 150;

/** I suoni che il live usa, per ruolo (chi costruisce il progetto dà il file di ognuno). */
export const ACID_LIVE_SOUNDS = [
  'kick', 'kickHard', 'kickDeep',
  'clap', 'snare', 'snareRoll',
  'hatClosed', 'hatOpen', 'ride', 'hatAlt',
  'perc', 'metal', 'tom', 'stab',
  'crash', 'blast', 'siren', 'riser', 'downlifter', 'sweepUp', 'laser',
] as const;

export type AcidLiveSound = (typeof ACID_LIVE_SOUNDS)[number];

// ------------------------------------------------------------------ le parti

/** I pad di ogni Drum Machine, per nome. */
const KICK = { main: 0, hard: 1, deep: 2 } as const;
const CLAP = { clap: 0, snare: 1, roll: 2 } as const;
const HATS = { closed: 0, open: 1, ride: 2, alt: 3 } as const;
const PERC = { perc: 0, metal: 1, tom: 2, stab: 3 } as const;
const FX = { crash: 0, blast: 1, siren: 2, riser: 3, downlifter: 4, sweepUp: 5, laser: 6 } as const;

const A1 = 33;

const PARTS = {
  kickDeep: bars(KICK.deep, 'x...x...x...x...', 4),
  kick: bars(KICK.main, 'X...x...x...x...', 4, 'X...x...x...x.o.'),
  // il martello: la cassa dura sotto la principale, e un rullo di casse a fine giro
  kickHammer: [...bars(KICK.main, 'X...x...x...x...', 4, 'X...x...x.x.xxxx'), ...bars(KICK.hard, 'x...x...x...x...', 4, 'x...x...x.......')],
  /** Il rumble: un seno che rotola in levare, dopo il corpo della cassa (che sta nei primi
   *  250 ms del battito: lì il rumble la coprirebbe). */
  rumble: repeat([0.5, 0.75].map((at, k) => ({ pitch: A1, start: at, duration: 0.2, velocity: [120, 104][k] })), 1, 16),
  rumbleHammer: repeat([0.375, 0.5, 0.75].map((at, k) => ({ pitch: k === 2 ? A1 + 12 : A1, start: at, duration: k ? 0.2 : 0.1, velocity: [90, 127, 104][k] })), 1, 16),
  clap: [...bars(CLAP.clap, '....X.......X...', 4), ...bars(CLAP.snare, '....x.......x...', 4, '....x.......x.oo')],
  clapHammer: [...bars(CLAP.clap, '....X.......X...', 4), ...bars(CLAP.snare, '....x.....o.x..o', 4, '....x.....o.xoxx')],
  /** Il rullo del break: da quarti a sedicesimi in 8 battute, sempre più forte. */
  snareRoll: [
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(b => ({ pitch: padNote(CLAP.roll), start: b, duration: 0.25, velocity: 60 + b * 2 })),
    ...Array.from({ length: 16 }, (_, k) => ({ pitch: padNote(CLAP.roll), start: 8 + k * 0.5, duration: 0.25, velocity: 76 + k })),
    ...Array.from({ length: 32 }, (_, k) => ({ pitch: padNote(CLAP.roll), start: 16 + k * 0.25, duration: 0.2, velocity: 92 + k * 0.6 })),
    ...Array.from({ length: 32 }, (_, k) => ({ pitch: padNote(CLAP.roll), start: 24 + k * 0.25, duration: 0.2, velocity: 112 + k * 0.5 })),
  ],
  hatsIntro: bars(HATS.closed, '..x...x...x...x.', 4),
  hats: bars(HATS.closed, 'o.x.o.x.o.x.o.xo', 4),
  /** Pieni: aperti in levare, chiusi sui sedicesimi intorno (lo choke ferma l'aperto). */
  hatsFull: [...bars(HATS.open, '..x...x...x...x.', 4), ...bars(HATS.closed, 'oo.ooo.ooo.ooo.o', 4)],
  hatsDrop: [...bars(HATS.open, '..x...x...x...x.', 4), ...bars(HATS.closed, 'oo.ooo.ooo.ooo.o', 4), ...bars(HATS.ride, 'x...x...x...x...', 4)],
  hatsHammer: [...bars(HATS.alt, 'xoXoxoXoxoXoxoXo', 4), ...bars(HATS.ride, '..x...x...x...x.', 4)],
  perc: [...bars(PERC.perc, '...x..x....x.x..', 4), ...bars(PERC.metal, '................', 4, '..............x.')],
  percFull: [...bars(PERC.perc, '...x..x....x.x..', 4), ...bars(PERC.metal, '.......x........', 4), ...bars(PERC.stab, '................', 4, 'x...............')],
  /** Il tom che spinge nell'ultima battuta del break. */
  tomFill: steps(PERC.tom, 'x.......x...x.x.' + 'x.x.x.x.xxxxxxxx', 6 * BAR),
};

/** Le linee acid, in La: tonica, ottave, la terza minore e la seconda bemolle che graffia. */
const ACID = {
  intro: repeat(acid(`
    A2 a2 a3~ g3   a2 .  C3 a2   a2 A3 .  a2   eb3~ e3 a2 g2 |
    A2 a2 a3~ g3   a2 .  C3 a2   bb2~ a2 . A3   a2 c3 E3~ g3`), 8, 4),
  full: repeat(acid(`
    A2 A3 a2 a2~   c3 a2 G3 a2   A2 a2~ bb2 a2  E3 a2 a3~ g3 |
    A2 a2 C3~ a2   a3 .  a2 G3   a2 A3 a2 eb3   e3~ a2 C3 g2`), 8, 4),
  hammer: repeat(acid(`
    A2 a2 A3 a2    a2 A2 a3 a2   A2 a2 A3 a2    G2~ a2 C3 a2 |
    A2 a2 A3 a2    a2 A2 a3 a2   A2 a2 A3 a2    E3~ eb3 a2 A3`), 8, 4),
  /** La seconda: quadra, un'ottava sopra, ipnotica. */
  lead: repeat(acid(`
    A3 .  a3 c4~   a3 .  G3 .    a3 e4~ eb4 .   A3 .  c4 . |
    A3 .  a3 c4~   a3 .  G3 a3   .  A4~ g4 e4   .  C4 bb3~ a3`), 8, 4),
};

// ------------------------------------------------------------------ i suoni

/** I pad di una Drum Machine: suono, intonazione, decay, livello, pan, choke. */
interface PadSound {
  readonly sound: AcidLiveSound;
  readonly tune?: number;
  readonly decay?: number;
  readonly tone?: number;
  readonly snap?: number;
  readonly level?: number;
  readonly pan?: number;
  readonly choke?: number;
}

const KITS: Readonly<Record<string, readonly PadSound[]>> = {
  // le casse di partenza sono quasi in Sol#: un semitono su, in La come il rumble
  kick: [
    { sound: 'kick', tune: 1, decay: 0.36, snap: 15 },
    { sound: 'kickHard', decay: 0.32, tone: 62, level: -8 },
    { sound: 'kickDeep', tune: 1, level: -1 },
  ],
  clap: [
    { sound: 'clap', level: 0 },
    { sound: 'snare', decay: 0.3, tone: 58, level: -7, pan: 8 },
    { sound: 'snareRoll', tone: 60, level: -4 },
  ],
  hats: [
    { sound: 'hatClosed', decay: 0.12, choke: 1, pan: 12, level: -3 },
    { sound: 'hatOpen', decay: 0.3, choke: 1, pan: 12, level: -4 },
    { sound: 'ride', tone: 62, pan: -18, level: -9 },
    { sound: 'hatAlt', decay: 0.09, tone: 60, pan: -10, level: -6 },
  ],
  perc: [
    { sound: 'perc', pan: -25, level: 0 },
    { sound: 'metal', decay: 0.7, tone: 58, pan: 30, level: -6 },
    { sound: 'tom', tune: 0, level: -2 },
    { sound: 'stab', decay: 0.8, pan: 20, level: -5 },
  ],
  fx: [
    { sound: 'crash', tone: 57, level: 0 },
    { sound: 'blast', level: -4 },
    { sound: 'siren', tone: 62, decay: 4, level: -12, pan: -15 },
    { sound: 'riser', level: 6 },
    { sound: 'downlifter', level: -4 },
    { sound: 'sweepUp', level: -5 },
    { sound: 'laser', decay: 1.6, tone: 60, level: -10, pan: 25 },
  ],
};

/** I parametri dei pad Sample di un kit. */
const kitParams = (kit: readonly PadSound[]): Record<string, number> =>
  Object.fromEntries(kit.flatMap((p, i) => [
    [padParam(i, 'model'), MODEL.sample], [padParam(i, 'tune'), p.tune ?? 0], [padParam(i, 'decay'), p.decay ?? 12],
    [padParam(i, 'tone'), p.tone ?? 50], [padParam(i, 'snap'), p.snap ?? 0], [padParam(i, 'level'), p.level ?? 0],
    [padParam(i, 'pan'), p.pan ?? 0], [padParam(i, 'choke'), p.choke ?? 0],
  ]));

const ANALOG_SOUNDS = {
  rumble: {
    oscA: 3, mix: 0, voiceMode: VOICE_MODE.poly, cutoff: 260, resonance: 10, filterEnv: 25, keyTrack: 0, fDecay: 0.1, fSustain: 0,
    attack: 0.003, decay: 0.12, sustain: 35, release: 0.05, velocity: 45, volume: -3,
  },
  acid: {
    oscA: 0, mix: 0, voiceMode: VOICE_MODE.legato, glide: 55, accent: 80, cutoff: 480, resonance: 86, filterEnv: 72, keyTrack: 20,
    fDecay: 0.2, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.04, velocity: 35, volume: -8,
  },
  lead: {
    oscA: 1, mix: 0, voiceMode: VOICE_MODE.legato, glide: 70, accent: 85, cutoff: 650, resonance: 84, filterEnv: 62, keyTrack: 25,
    fDecay: 0.26, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.04, velocity: 35, volume: -11,
  },
} satisfies Record<string, ParamValues>;

/** Un effetto con i suoi parametri (sopra i predefiniti del tipo). */
interface EffectSpec {
  readonly type: string;
  readonly label: string;
  readonly name: string;
  readonly params: ParamValues;
}

const drive = (name: string, params: ParamValues): EffectSpec => ({ type: DRIVE.type, label: DRIVE.label, name, params });
const delay = (name: string, params: ParamValues): EffectSpec => ({ type: DELAY.type, label: DELAY.label, name, params });
/** Un EQ che taglia sotto `freq` (lascia i bassi alla cassa e al rumble). */
const lowCut = (freq: number): EffectSpec => ({
  type: EQ.type, label: EQ.label, name: `Taglio ${freq} Hz`, params: { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: freq },
});

// ------------------------------------------------------------------ tracce e scene

type TrackKey = 'kick' | 'rumble' | 'acid' | 'lead' | 'clap' | 'hats' | 'perc' | 'fx';

interface TrackSpec {
  readonly key: TrackKey;
  readonly name: string;
  readonly volumeDb: number;
  readonly pan?: number;
  /** Un kit di Drum Machine o un suono di Analog. */
  readonly kit?: readonly PadSound[];
  readonly analog?: ParamValues;
  readonly effects: readonly EffectSpec[];
}

const TRACKS: readonly TrackSpec[] = [
  { key: 'kick', name: 'Cassa', volumeDb: -2, kit: KITS.kick, effects: [drive('Crudo', { shape: SHAPE.hard, drive: 10, color: 20, low: 70, split: 110, tone: 15000, mix: 45 })] },
  {
    key: 'rumble', name: 'Rumble', volumeDb: -4, analog: ANALOG_SOUNDS.rumble,
    effects: [drive('Rumble', { shape: SHAPE.tube, drive: 22, bias: 20, low: 25, split: 80, tone: 1400 })],
  },
  {
    key: 'acid', name: 'Acido', volumeDb: -3, analog: ANALOG_SOUNDS.acid,
    effects: [
      drive('Acido crudo', { shape: SHAPE.hard, drive: 18, bias: 12, color: 25, low: 15, split: 150, tone: 9000 }),
      lowCut(90),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 38, lowCut: 300, highCut: 4500, mix: 16 }),
    ],
  },
  {
    key: 'lead', name: 'Acido 2', volumeDb: -6, pan: 0.1, analog: ANALOG_SOUNDS.lead,
    effects: [
      drive('Fuzz', { shape: SHAPE.fuzz, drive: 22, low: 40, tone: 7500, mix: 80 }),
      lowCut(160),
      delay('Eco 1/16.', { division: 4, pingPong: 1, feedback: 32, lowCut: 400, highCut: 5000, mix: 14 }),
    ],
  },
  {
    key: 'clap', name: 'Clap', volumeDb: -4, kit: KITS.clap,
    effects: [lowCut(150), delay('Spazio', { division: 5, feedback: 18, lowCut: 500, highCut: 6000, mix: 10 })],
  },
  { key: 'hats', name: 'Piatti', volumeDb: -8, kit: KITS.hats, effects: [lowCut(300)] },
  { key: 'perc', name: 'Percussioni', volumeDb: -3, kit: KITS.perc, effects: [lowCut(200), delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 42, lowCut: 500, mix: 22 })] },
  { key: 'fx', name: 'FX', volumeDb: -4, kit: KITS.fx, effects: [lowCut(120), delay('Dub', { division: 9, pingPong: 1, feedback: 55, lowCut: 300, highCut: 2500, mix: 18 })] },
];

/** Cosa muove una modulazione: come nel modello, o un effetto della traccia per posizione
 *  nella catena (l'id lo riceve quando la traccia nasce). */
type ModSpecTarget = ModTarget | { readonly kind: 'effect'; readonly index: number; readonly param: string };

/** Una clip della session: note, lunghezza del giro e (a scelta) modulazioni. */
interface ClipSpec {
  readonly name: string;
  readonly notes: readonly Note[];
  readonly length: Beats;
  readonly mods?: readonly { readonly target: ModSpecTarget; readonly points: readonly EnvelopePoint[] }[];
}

const clip = (name: string, notes: readonly Note[], length: Beats, mods: ClipSpec['mods'] = []): ClipSpec => ({ name, notes, length, mods });

/** Un parametro dello strumento, o di un effetto della traccia (per posizione nella catena). */
const instrumentParam = (param: string): ModTarget => ({ kind: 'device', device: INSTRUMENT_DEVICE, param });
const effectParam = (index: number, param: string): ModSpecTarget => ({ kind: 'effect', index, param });
const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };

interface SceneSpec {
  readonly name: string;
  /** Quante battute dura la sezione nella "registrazione" sulla timeline. */
  readonly bars: number;
  readonly clips: Partial<Record<TrackKey, ClipSpec>>;
}

const CUTOFF = instrumentParam('cutoff'), RESONANCE = instrumentParam('resonance');

/** Le clip che tornano in più scene. */
const C = {
  kick: clip('Cassa', PARTS.kick, 16),
  rumble: clip('Rumble', PARTS.rumble, 16),
  clap: clip('Clap', PARTS.clap, 16),
  hatsFull: clip('Piatti pieni', PARTS.hatsFull, 16),
  hatsDrop: clip('Piatti drop', PARTS.hatsDrop, 16),
  perc: clip('Perc', PARTS.perc, 16),
  percFull: clip('Perc piene', PARTS.percFull, 16),
  acidFull: clip('Acido pieno', ACID.full, 32, [
    { target: CUTOFF, points: curve([0, 0], [8, 0.18], [16, 0.02], [24, 0.26], [32, 0.04]) },
    { target: RESONANCE, points: curve([0, 0], [24, 0.08], [32, 0]) },
  ]),
  lead: clip('Acido 2', ACID.lead, 32, [{ target: CUTOFF, points: curve([0, -0.05], [16, 0.16], [32, -0.05]) }]),
};

const SCENES: readonly SceneSpec[] = [
  {
    name: 'Intro', bars: 16, clips: {
      kick: clip('Cassa fonda', PARTS.kickDeep, 16),
      hats: clip('Piatti intro', PARTS.hatsIntro, 16),
      fx: clip('Sirena', steps(FX.siren, 'x'), 64),
    },
  },
  { name: 'Cassa e rumble', bars: 16, clips: { kick: C.kick, rumble: C.rumble, hats: clip('Piatti', PARTS.hats, 16), perc: C.perc } },
  {
    name: 'Entra l\'acido', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: clip('Piatti', PARTS.hats, 16), perc: C.perc, clap: C.clap,
      // il filtro si apre piano in 8 battute
      acid: clip('Acido entra', ACID.intro, 32, [{ target: CUTOFF, points: curve([0, -0.16], [32, 0.12]) }]),
    },
  },
  { name: 'Acido pieno', bars: 16, clips: { kick: C.kick, rumble: C.rumble, hats: C.hatsFull, perc: C.percFull, clap: C.clap, acid: C.acidFull } },
  {
    name: 'Break', bars: 8, clips: {
      // niente cassa: l'acido risuona e si apre, il rullo sale (anche d'intonazione), il riser arriva al drop
      acid: clip('Acido break', ACID.intro, 32, [
        { target: CUTOFF, points: curve([0, -0.2], [24, 0.22], [32, 0.3]) },
        { target: RESONANCE, points: curve([0, 0.1], [32, 0.12]) },
      ]),
      clap: clip('Rullo', PARTS.snareRoll, 32, [{ target: instrumentParam(padParam(CLAP.roll, 'tune')), points: curve([0, 0], [16, 0.04], [32, 0.25]) }]),
      perc: clip('Tom', PARTS.tomFill, 32),
      // il riser dura 27 battiti e mezzo: parte in modo da finire sul drop
      fx: clip('Riser', [{ pitch: padNote(FX.riser), start: 4.5, duration: 0.25, velocity: 120 }], 32),
    },
  },
  {
    name: 'Drop', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: C.hatsDrop, perc: C.percFull, clap: C.clap, acid: C.acidFull, lead: C.lead,
      fx: clip('Crash', [...steps(FX.crash, 'X'), ...steps(FX.blast, 'x')], 64),
    },
  },
  {
    name: 'Acido 2', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: C.hatsFull, perc: C.perc, clap: C.clap,
      // la seconda linea da sola; nell'ultima battuta l'eco si alza e la lancia
      lead: clip('Acido 2 solo', ACID.lead, 32, [
        { target: CUTOFF, points: curve([0, 0], [16, 0.2], [28, 0.05], [32, 0.25]) },
        { target: effectParam(2, 'mix'), points: curve([0, 0], [28, 0], [28, 0.3], [32, 0.3]) },
      ]),
      fx: clip('Laser', [{ pitch: padNote(FX.laser), start: 60, duration: 0.25, velocity: 110 }], 64),
    },
  },
  {
    name: 'Martello', bars: 16, clips: {
      kick: clip('Cassa martello', PARTS.kickHammer, 16),
      rumble: clip('Rumble martello', PARTS.rumbleHammer, 16),
      hats: clip('Piatti martello', PARTS.hatsHammer, 16),
      clap: clip('Clap martello', PARTS.clapHammer, 16),
      perc: C.percFull,
      // l'acido più basso e più sporco: il Drive sale a scalini, il filtro con lui
      acid: clip('Acido martello', ACID.hammer, 32, [
        { target: CUTOFF, points: curve([0, 0.04], [8, 0.04], [8, 0.12], [16, 0.12], [16, 0.08], [24, 0.08], [24, 0.2], [32, 0.2]) },
        { target: effectParam(0, 'drive'), points: curve([0, 0], [16, 0.12], [32, 0.3]) },
      ]),
    },
  },
  {
    name: 'Break 2', bars: 8, clips: {
      acid: clip('Acido sospeso', ACID.full, 32, [
        { target: CUTOFF, points: curve([0, 0.1], [16, -0.15], [32, 0.25]) },
        { target: effectParam(2, 'feedback'), points: curve([0, 0.3], [32, 0.3]) },
      ]),
      lead: clip('Acido 2 lontano', ACID.lead, 32, [{ target: VOLUME, points: curve([0, 0.35], [32, 0.8]) }]),
      hats: clip('Ride', bars(HATS.ride, 'x...x...x...x...', 8), 32),
      // la discesa dopo il drop, poi la salita che porta al prossimo
      fx: clip('Discesa e salita', [
        { pitch: padNote(FX.downlifter), start: 0, duration: 0.25, velocity: 115 },
        { pitch: padNote(FX.sweepUp), start: 16, duration: 0.25, velocity: 120 },
      ], 32),
    },
  },
  {
    name: 'Outro', bars: 16, clips: {
      kick: clip('Cassa fonda', PARTS.kickDeep, 16),
      hats: clip('Piatti', PARTS.hats, 16),
      perc: C.perc,
      // l'acido si chiude e si spegne in 16 battute
      acid: clip('Acido via', repeat(ACID.intro, 32, 2), 64, [
        { target: CUTOFF, points: curve([0, 0.05], [64, -0.25]) },
        { target: VOLUME, points: curve([0, 1], [48, 0.7], [64, 0]) },
      ]),
    },
  },
];

/** L'ordine delle scene nella "registrazione" sulla timeline: il secondo break riporta al drop. */
const ARRANGEMENT: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 5, 9];

// ------------------------------------------------------------------ montaggio

/** Il bersaglio vero di una modulazione: l'effetto per posizione diventa il suo id. */
function resolveTarget(target: ModSpecTarget, effects: readonly EffectSettings[]): ModTarget {
  if (target.kind !== 'effect') return target;
  const fx = effects[target.index];
  if (!fx) throw new Error(`la traccia non ha l'effetto ${target.index + 1}`);
  return { kind: 'device', device: fx.id, param: target.param };
}

/** Costruisce il live nel progetto (vuoto) dello store. */
export function buildAcidLive(store: ProjectStore, sounds: Readonly<Record<AcidLiveSound, SampleRef>>): void {
  store.apply(renameProject('Acido crudo'));
  store.apply(setTempo(ACID_LIVE_BPM));
  // il master ha margine (le tracce sono tante e forti) e un Drive a nastro leggero che
  // incolla e tiene i picchi
  store.apply(setMasterMixer({ volumeDb: 0 }));
  store.apply(addEffect(MASTER, DRIVE.type, DRIVE.label));
  const glue = store.project.masterEffects.at(-1)!.id;
  store.apply(loadEffectPreset(MASTER, glue, 'Colla', { shape: SHAPE.tape, drive: 3, low: 0, tone: 20000 }));
  while (store.project.scenes.length < SCENES.length) store.apply(addScene());
  SCENES.forEach((s, i) => store.apply(renameScene(store.project.scenes[i].id, s.name)));

  const ids = new Map<TrackKey, TrackId>();
  for (const spec of TRACKS) {
    store.apply(addTrack('midi'));
    const track = store.project.tracks.at(-1)!.id;
    ids.set(spec.key, track);
    store.apply(renameTrack(track, spec.name));
    store.apply(setMixer(track, { volumeDb: spec.volumeDb, ...(spec.pan ? { pan: spec.pan } : {}) }));
    if (spec.kit) {
      store.apply(setInstrument(track, { type: DRUMS.type, preset: null, params: { volume: 0, velocity: 60, ...kitParams(spec.kit) } }));
      const kit = spec.kit;
      store.apply(setInstrumentSamples(track, Object.fromEntries(kit.map((p, i) => [padSlot(i), sounds[p.sound]]))));
    } else {
      store.apply(setInstrument(track, { type: ANALOG.type, preset: null, params: { ...spec.analog } }));
    }
    for (const fx of spec.effects) {
      store.apply(addEffect(track, fx.type, fx.label));
      const id = store.project.track(track)!.effects.at(-1)!.id;
      store.apply(loadEffectPreset(track, id, fx.name, fx.params));
    }
  }

  // le clip della session, e la stessa clip riusata nella "registrazione"
  const clipOf = (key: TrackKey, spec: ClipSpec): MidiClip => {
    const track = store.project.track(ids.get(key)!)!;
    let c = MidiClip.empty(store.ids.next('clip'), spec.name, track.color, spec.length).withNotes(spec.notes);
    for (const m of spec.mods ?? []) c = c.withEnvelope(resolveTarget(m.target, track.effects), m.points);
    return c;
  };
  SCENES.forEach((scene, i) => {
    for (const [key, spec] of Object.entries(scene.clips) as [TrackKey, ClipSpec][]) store.apply(setSlot(ids.get(key)!, i, clipOf(key, spec)));
  });

  let at = 0;
  for (const index of ARRANGEMENT) {
    const scene = SCENES[index], length = scene.bars * BAR, start = at;
    store.apply(edit(`Sezione ${scene.name}`, (p, { ids: idf }) => Object.entries(scene.clips).reduce((next, [key, spec]) => {
      const c = clipOf(key as TrackKey, spec);
      return next.updatingTrack(ids.get(key as TrackKey)!, t => t.placing({ id: idf.next('placement'), clip: c, start, length, offset: 0 }, idf));
    }, p)));
    at += length;
  }
}
