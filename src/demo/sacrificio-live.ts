/* "Sacrificio": techno dura e scura a 150 BPM in La frigio (La minore con il Si bemolle). Intro,
 * drop, bridge, drop modificato, outro.
 *
 * Il suono di oggi, fatto con i pezzi di studiomio e i sample dell'utente:
 *   Cassa     una cassa industriale tutta distorta, portata in La;
 *   Rumble    la stessa cassa dentro un riverbero tutto bagnato, poi distorta e chiusa da un
 *             passa-basso, e schiacciata a ogni colpo dalla pompa: il rombo che riempie tra una
 *             cassa e l'altra (come si fa davvero, non con un synth);
 *   Lead      il gancio: un supersaw (Analog con 7 copie scordate e aperte) che suona un riff
 *             in La frigio, spinto dalla Multibanda;
 *   Stab      gli accordi corti in levare del drop modificato, supersaw anche loro;
 *   Accordi   lo strato lungo: La minore, Si bemolle, Sol minore, La minore (i–♭II–vii–i);
 *   Cori      il bordone "atmos" in La minore, il coro alzato di due semitoni (La con il Si
 *             bemolle sopra), il mostro nel vuoto;
 *   Voci      gli stacchi parlati ("kill", "sacrifice", "ho visto qualcosa dentro di lei") e i
 *             sussurri, lanciati nel riverbero.
 * La pompa del sidechain è fatta con le modulazioni di volume; il master è EQ, Multibanda
 * leggera, Compressore colla e Limiter. Il montaggio è in live-builder.ts; i file, in
 * scripts/build-sacrificio-live.ts. */
import type { Beats } from '../core/music-time';
import { DETECTOR } from '../devices/effects/compressor/compressor';
import { SHAPE } from '../devices/effects/drive/drive';
import { bandParam } from '../devices/effects/eq/eq';
import { VOICE_MODE } from '../devices/instruments/analog/analog';
import type { ParamValues } from '../model/device';
import type { Note } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import type { ProjectStore } from '../store/project-store';
import {
  buildLive, clip, compressor, delay, drive, effectParam, eq, instrumentParam, limiter, lowCut, multiband, reverb, VOLUME,
  type LiveSpec, type ModSpec, type PadSound, type SceneSpec, type TrackSpec,
} from './live-builder';
import { acid, BAR, bars, curve, duck, repeat, roll, steps } from './patterns';

export const SACRIFICIO_LIVE_BPM = 150;

/** I suoni che il live usa, per ruolo (chi costruisce il progetto dà il file di ognuno). */
export const SACRIFICIO_LIVE_SOUNDS = [
  'kick', 'kickAlt', 'clap', 'clapLayer', 'hatOpen', 'hatClosed', 'ride', 'hatMetal',
  'metalHit', 'strangeHit', 'plingHit', 'metalShot',
  'atmos', 'choir', 'monster',
  'kill', 'sacrifice', 'dentro', 'whisper', 'whisper2', 'darkness', 'openFire',
  'impact', 'riser', 'reverseNoise', 'down', 'downDisto', 'obscure',
] as const;

export type SacrificioLiveSound = (typeof SACRIFICIO_LIVE_SOUNDS)[number];

type TrackKey = 'kick' | 'rumble' | 'clap' | 'hats' | 'perc' | 'lead' | 'stab' | 'chords' | 'choir' | 'vox' | 'fx';

// ------------------------------------------------------------------ i kit

const KITS = {
  // la cassa è un La#1 distorto: un semitono giù, in La
  kick: [{ sound: 'kick', tune: -1, decay: 0.3 }, { sound: 'kickAlt', decay: 0.28, level: -1 }],
  rumble: [{ sound: 'kick', tune: -1, decay: 0.34 }],
  clap: [
    { sound: 'clap', level: 0 },
    { sound: 'clapLayer', decay: 0.2, tone: 58, level: -6 },
    { sound: 'clap', decay: 0.1, tone: 56, level: -5 },
  ],
  hats: [
    { sound: 'hatOpen', decay: 0.22, choke: 1, pan: 12, level: 0 },
    { sound: 'hatClosed', decay: 0.07, choke: 1, pan: 12, level: -3 },
    { sound: 'ride', tone: 60, pan: -18, level: -6 },
    { sound: 'hatMetal', decay: 0.5, pan: -25, level: 6 },
  ],
  perc: [
    { sound: 'metalHit', decay: 0.6, pan: -30, level: -2 },
    { sound: 'strangeHit', pan: 25, level: -4 },
    { sound: 'plingHit', pan: 35, level: 6 },
    { sound: 'metalShot', decay: 0.7, tone: 60, pan: -15, level: -2 },
  ],
  choir: [
    { sound: 'atmos', level: 6 },
    { sound: 'choir', tune: 2, level: 2 },
    { sound: 'monster', level: 6 },
  ],
  vox: [
    { sound: 'kill', level: 0 },
    { sound: 'sacrifice', level: -3 },
    { sound: 'dentro', level: 6, snap: 20 },
    { sound: 'whisper', level: -2 },
    { sound: 'whisper2', level: 2 },
    { sound: 'darkness', level: 0 },
    { sound: 'openFire', level: 6 },
    // "kill" corto, per gli stutter
    { sound: 'kill', decay: 0.12, level: -1 },
  ],
  fx: [
    { sound: 'impact', level: 0 },
    { sound: 'riser', level: -2 },
    { sound: 'reverseNoise', level: 6 },
    { sound: 'down', level: -4 },
    { sound: 'downDisto', level: -6 },
    { sound: 'obscure', level: -4 },
  ],
} satisfies Record<string, readonly PadSound<SacrificioLiveSound>[]>;

const CLAP = { main: 0, layer: 1, roll: 2 } as const;
const HATS = { open: 0, closed: 1, ride: 2, metal: 3 } as const;
const PERC = { metal: 0, strange: 1, pling: 2, shot: 3 } as const;
const CHOIR = { atmos: 0, choir: 1, monster: 2 } as const;
const VOX = { kill: 0, sacrifice: 1, dentro: 2, whisper: 3, whisper2: 4, darkness: 5, openFire: 6, killShort: 7 } as const;
const FX = { impact: 0, riser: 1, reverseNoise: 2, down: 3, downDisto: 4, obscure: 5 } as const;

// ------------------------------------------------------------------ i suoni di Analog

const ANALOG_SOUNDS = {
  // il gancio: supersaw con l'ottava sopra, filtro che si apre a ogni nota
  lead: {
    oscA: 0, oscB: 0, oscBSemi: 12, oscBFine: 0, mix: 35, unison: 7, detune: 28, spread: 85, voiceMode: VOICE_MODE.poly,
    cutoff: 1800, resonance: 25, filterEnv: 45, fDecay: 0.25, fSustain: 30, keyTrack: 50,
    attack: 0.002, decay: 0.3, sustain: 70, release: 0.15, velocity: 30, volume: 2,
  },
  // gli stab: corti, larghissimi, l'ottava sotto per il corpo
  stab: {
    oscA: 0, oscB: 0, oscBSemi: -12, oscBFine: 0, mix: 40, unison: 7, detune: 35, spread: 100, voiceMode: VOICE_MODE.poly,
    cutoff: 3000, resonance: 15, filterEnv: 40, fDecay: 0.12, fSustain: 10, keyTrack: 30,
    attack: 0.001, decay: 0.24, sustain: 0, release: 0.12, velocity: 30, volume: 0,
  },
  // lo strato lungo: lento ad aprirsi, si muove appena
  chords: {
    oscA: 0, oscB: 0, oscBFine: 9, mix: 50, unison: 5, detune: 20, spread: 100, voiceMode: VOICE_MODE.poly,
    cutoff: 900, resonance: 10, filterEnv: 20, fAttack: 1.2, fDecay: 2, fSustain: 60, fRelease: 2,
    attack: 0.8, decay: 1, sustain: 85, release: 2, lfoRate: 0.2, lfoCutoff: 10, velocity: 20, volume: -16,
  },
} satisfies Record<string, ParamValues>;

// ------------------------------------------------------------------ tracce ed effetti

/** Il filtro del rumble: via sotto 35 Hz e sopra 220 (resta il rombo, non il riverbero). */
const RUMBLE_FILTER = { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: 35, [bandParam(7, 'on')]: 1, [bandParam(7, 'freq')]: 220 };

const TRACKS: readonly TrackSpec<SacrificioLiveSound, TrackKey>[] = [
  {
    key: 'kick', name: 'Cassa', volumeDb: -7, kit: KITS.kick,
    effects: [
      compressor('Punch', { threshold: -12, ratio: 3, attack: 15, release: 50, auto: 0 }),
      // la cassa si taglia da sola (come un clipper): picchi giù, corpo su, e il master respira
      limiter('Taglio cassa', { gain: 6, ceiling: -3, release: 15, lookahead: 0.5, truePeak: 0 }),
    ],
  },
  {
    key: 'rumble', name: 'Rumble', volumeDb: -8, kit: KITS.rumble,
    effects: [
      reverb('Stanza buia', { size: 70, decay: 2.2, predelay: 0, diffusion: 90, damping: 3000, lowCut: 30, width: 0, mix: 100 }),
      drive('Rombo', { shape: SHAPE.tube, drive: 22, bias: 15, low: 0, tone: 900 }),
      eq('Filtro rumble', RUMBLE_FILTER),
    ],
  },
  {
    key: 'clap', name: 'Clap', volumeDb: -1, kit: KITS.clap,
    effects: [lowCut(180), compressor('Punch', { threshold: -16, ratio: 4, attack: 10, release: 80, auto: 0 }), reverb('Sala', { size: 80, decay: 2.4, predelay: 15, damping: 6000, lowCut: 400, mix: 24 })],
  },
  { key: 'hats', name: 'Piatti', volumeDb: -9, kit: KITS.hats, effects: [lowCut(450), reverb('Stanza', { size: 35, decay: 0.8, mix: 12 })] },
  {
    key: 'perc', name: 'Percussioni', volumeDb: -9, kit: KITS.perc,
    effects: [lowCut(250), delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 40, lowCut: 500, highCut: 6000, mix: 22 }), reverb('Sala', { size: 70, decay: 2, mix: 18 })],
  },
  {
    key: 'lead', name: 'Lead', volumeDb: 0, analog: ANALOG_SOUNDS.lead,
    effects: [
      drive('Calda', { shape: SHAPE.tube, drive: 9, bias: 15, low: 60, tone: 14000 }),
      multiband('Lead aggressivo', { depth: 70, time: 30, input: 3, low: -3, high: 1 }),
      lowCut(180),
      delay('Eco 1/8.', { division: 7, pingPong: 1, feedback: 35, lowCut: 400, highCut: 7000, mix: 16 }),
      reverb('Sala', { size: 80, decay: 2.6, predelay: 20, damping: 7000, lowCut: 300, mix: 20 }),
    ],
  },
  {
    key: 'stab', name: 'Stab', volumeDb: 0, analog: ANALOG_SOUNDS.stab,
    effects: [multiband('Denso', { depth: 60, time: 30 }), lowCut(150), reverb('Piatto', { size: 60, decay: 1.4, predelay: 5, damping: 9000, lowCut: 300, mix: 20 })],
  },
  {
    key: 'chords', name: 'Accordi', volumeDb: -7, analog: ANALOG_SOUNDS.chords,
    effects: [lowCut(200), reverb('Coda lunga', { size: 95, decay: 6, predelay: 30, damping: 5000, lowCut: 300, mix: 45 })],
  },
  { key: 'choir', name: 'Cori', volumeDb: -10, kit: KITS.choir, effects: [lowCut(90), reverb('Sala', { size: 90, decay: 4.5, predelay: 25, damping: 5000, lowCut: 200, mix: 35 })] },
  {
    key: 'vox', name: 'Voci', volumeDb: -6, kit: KITS.vox,
    effects: [
      lowCut(150),
      compressor('Voce', { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms, auto: 0, makeup: 3 }),
      delay('Eco 1/4.', { division: 9, pingPong: 1, feedback: 38, lowCut: 400, highCut: 4500, mix: 18 }),
      reverb('Lancio voce', { size: 90, decay: 4.5, predelay: 60, damping: 5000, lowCut: 300, mix: 26 }),
    ],
  },
  { key: 'fx', name: 'FX', volumeDb: -9, kit: KITS.fx, effects: [lowCut(40), reverb('Sala', { size: 85, decay: 3, predelay: 20, lowCut: 150, mix: 22 })] },
];

// ------------------------------------------------------------------ le parti

/** Le note dello strato e degli stab (MIDI): La minore, Si bemolle, Sol minore, La minore. */
const PROGRESSION: readonly (readonly number[])[] = [[57, 60, 64], [58, 62, 65], [55, 58, 62], [57, 60, 64]];

/** Le note di un riff supersaw un po' più lunghe del gate della 303: corpo, non staccato. */
const legato = (notes: readonly Note[]): Note[] => notes.map(n => ({ ...n, duration: n.duration + 0.1 }));

/** Il gancio: due battute in La frigio, ripetute (la seconda volta chiude in basso). */
const HOOK = legato(acid(`
  a4 . a4 c5    . a4 bb4 .    a4 . g4 .    e4 - f4 - |
  a4 . a4 c5    . a4 bb4 .    d5 - c5 -    bb4 - g4 - |
  a4 . a4 c5    . a4 bb4 .    a4 . g4 .    e4 - f4 - |
  a4 . a4 c5    . a4 bb4 .    g4 - f4 -    e4 - - -`));
/** Il gancio del drop modificato: un'ottava sopra nelle battute pari, più tirato. */
const HOOK_HIGH = legato(acid(`
  a4 . a4 c5    . a4 bb4 .    a4 . g4 .    e4 - f4 - |
  a5 . a5 c6    . a5 bb5 .    d6 - c6 -    bb5 - g5 - |
  a4 . a4 c5    . a4 bb4 .    a4 . g4 .    e4 - f4 - |
  a5 . a5 c6    . a5 bb5 .    g5 - a5 -    bb5 - c6 -`));
/** Il gancio lento del bridge: le stesse note, in ottavi e lunghe. */
const HOOK_SLOW = acid(`
  a4 - - -   - - - -   c5 - - -   bb4 - - - |
  a4 - - -   - - - -   g4 - - -   f4 - - - |
  a4 - - -   - - - -   c5 - - -   d5 - - - |
  e5 - - -   - - - -   - - - -    - - - -`);

/** Lo strato: un accordo per battuta, lungo. */
const CHORDS: Note[] = PROGRESSION.flatMap((c, k) => c.map(pitch => ({ pitch, start: k * BAR, duration: BAR, velocity: 90 })));
/** Gli stab: gli accordi un'ottava sopra in levare, corti (il passo "ta" del drop modificato). */
const STABS: Note[] = PROGRESSION.flatMap((c, k) => [0.5, 1.5, 2.5, 3.5].flatMap(off =>
  c.map(pitch => ({ pitch: pitch + 12, start: k * BAR + off, duration: 0.2, velocity: off === 3.5 ? 110 : 96 }))));

const PARTS = {
  kick: bars(0, 'X...x...x...x...', 4, 'X...x...x...x.x.'),
  kickMod: [...bars(0, 'X...x...x...x...', 4, 'X...x...x.x.x.xx'), ...bars(1, '..............o.', 4, '................')],
  /** La cassa della salita: sei battute in quarti, poi ottavi, poi sedicesimi. */
  kickBuild: [...bars(0, 'x...x...x...x...', 6), ...steps(0, 'x.x.x.x.x.x.x.x.', 24), ...steps(0, 'xxxxxxxxxxxxxxxx', 28)],
  clap: [...bars(CLAP.main, '....X.......X...', 4), ...bars(CLAP.layer, '....x.......x...', 4)],
  hats: [...bars(HATS.open, '..X...X...X...X.', 4), ...bars(HATS.closed, 'xo.oxo.oxo.oxo.o', 4)],
  hatsIntro: bars(HATS.closed, '..x...x...x...x.', 4, '..x...x...x.x.x.'),
  hatsFull: [...bars(HATS.open, '..X...X...X...X.', 4), ...bars(HATS.closed, 'xo.oxo.oxo.oxo.o', 4), ...bars(HATS.ride, 'x.x.x.x.x.x.x.x.', 4), ...steps(HATS.metal, 'x', 12)],
  perc: [...bars(PERC.metal, '......x.........', 4), ...bars(PERC.strange, '...x......x..x..', 4), ...steps(PERC.pling, '..........x.....', 12)],
  percFull: [...bars(PERC.metal, '......x.......x.', 4), ...bars(PERC.strange, '...x......x..x..', 4), ...bars(PERC.shot, 'x...............', 4, '........x.......')],
  /** Il rullo della salita: ottavi, sedicesimi, trentaduesimi. */
  clapRoll: [...roll(CLAP.roll, 0, 16, 0.5, [70, 90]), ...roll(CLAP.roll, 8, 16, 0.25, [90, 110]), ...roll(CLAP.roll, 12, 32, 0.125, [105, 127])],
};

/** Le casse di una clip lunga `length` (una a battito, per la pompa). */
const beats = (length: Beats) => Array.from({ length }, (_, k) => k);
/** La pompa: giù sulla cassa, su prima della prossima. */
const pump = (length: Beats, depth: number, release: Beats): ModSpec => ({ target: VOLUME, points: duck(beats(length), depth, release) });
const CUTOFF = instrumentParam('cutoff');

// ------------------------------------------------------------------ clip e scene

const C = {
  kick: clip('Cassa', PARTS.kick, 16),
  // il rumble: la stessa cassa; la pompa lo spegne sul colpo e lo fa risalire nel battito
  rumble: clip('Rumble', PARTS.kick, 16, [pump(16, 0, 0.9)]),
  clap: clip('Clap', PARTS.clap, 16),
  hats: clip('Piatti', PARTS.hats, 16),
  hatsFull: clip('Piatti pieni', PARTS.hatsFull, 16),
  perc: clip('Perc', PARTS.perc, 16),
  percFull: clip('Perc piene', PARTS.percFull, 16),
  hook: clip('Gancio', HOOK, 16, [pump(16, 0.7, 0.4)]),
  chords: clip('Accordi', CHORDS, 16, [pump(16, 0.6, 0.6)]),
  stabs: clip('Stab', STABS, 16, [pump(16, 0.5, 0.35)]),
  impact: clip('Impatto', steps(FX.impact, 'X'), 64),
};

const SCENES: readonly SceneSpec<TrackKey>[] = [
  {
    name: 'Intro', bars: 16, clips: {
      // la cassa dell'intro due dB sotto: il drop deve entrare
      kick: clip('Cassa intro', PARTS.kick, 16, [{ target: VOLUME, points: curve([0, 0.8]) }]),
      hats: clip('Piatti intro', PARTS.hatsIntro, 16), perc: C.perc,
      // il rumble entra a metà e cresce: il drop deve arrivare più grosso
      rumble: clip('Rumble che cresce', repeat(PARTS.kick, 16, 4), 64, [{ target: VOLUME, points: duck(beats(64), 0, 0.9).map(p => ({ ...p, value: p.value * (0.55 + 0.3 * (p.beat / 64)) })) }]),
      choir: clip('Bordone', [...steps(CHOIR.atmos, 'x'), ...steps(CHOIR.atmos, 'x', 16), ...steps(CHOIR.atmos, 'x', 32), ...steps(CHOIR.atmos, 'x', 48)], 64),
      vox: clip('Ho visto', [...steps(VOX.dentro, 'x', 0), ...steps(VOX.whisper, 'x', 24), ...steps(VOX.dentro, 'x', 32), ...steps(VOX.whisper2, 'x', 56)], 64),
      // il gancio arriva chiuso nelle seconde otto battute e si apre
      lead: clip('Gancio chiuso', repeat(HOOK, 16, 4).filter(n => n.start >= 32), 64, [{ target: CUTOFF, points: curve([32, -0.35], [64, -0.1]) }, pump(64, 0.7, 0.4)]),
      fx: clip('Discesa', steps(FX.down, 'x', 0), 64),
    },
  },
  {
    name: 'Drop', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, clap: C.clap, hats: C.hats, perc: C.perc, lead: C.hook, chords: C.chords,
      vox: clip('Kill', [...steps(VOX.sacrifice, 'x', 0), ...steps(VOX.kill, 'X', 15)], 16),
      fx: C.impact,
    },
  },
  {
    name: 'Drop +', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, clap: C.clap, hats: C.hatsFull, perc: C.percFull, lead: C.hook, chords: C.chords,
      choir: clip('Coro', steps(CHOIR.choir, 'x'), 32, [pump(32, 0.6, 0.6)]),
      vox: clip('Kill kill', [...steps(VOX.killShort, 'x.x.', 14), ...steps(VOX.kill, 'X', 15)], 16),
      fx: clip('Oscuro', steps(FX.obscure, 'x', 60), 64),
    },
  },
  {
    name: 'Bridge', bars: 8, clips: {
      // niente cassa: il bordone, il coro, lo strato lungo e il gancio lento nel riverbero
      choir: clip('Coro e bordone', [...steps(CHOIR.atmos, 'x'), ...steps(CHOIR.choir, 'x'), ...steps(CHOIR.atmos, 'x', 16), ...steps(CHOIR.monster, 'x', 24)], 32),
      chords: clip('Accordi aperti', repeat(CHORDS, 16, 2), 32, [{ target: CUTOFF, points: curve([0, 0], [32, 0.15]) }]),
      lead: clip('Gancio lento', repeat(HOOK_SLOW, 16, 2), 32, [{ target: CUTOFF, points: curve([0, -0.2], [32, 0.05]) }]),
      vox: clip('Sussurri', [...steps(VOX.whisper, 'x', 2), ...steps(VOX.darkness, 'x', 12), ...steps(VOX.whisper2, 'x', 18), ...steps(VOX.dentro, 'x', 24)], 32),
      perc: clip('Metallo', steps(PERC.shot, 'x', 0), 32),
      fx: clip('Discesa distorta', steps(FX.downDisto, 'x'), 32),
    },
  },
  {
    name: 'Salita', bars: 8, clips: {
      // la cassa torna, accelera; il rullo e il rumore al contrario portano al drop
      kick: clip('Cassa che sale', PARTS.kickBuild, 32),
      clap: clip('Rullo', PARTS.clapRoll, 16, [{ target: instrumentParam('p3tune'), points: curve([0, 0], [16, 0.25]) }]),
      hats: clip('Piatti intro', PARTS.hatsIntro, 16),
      chords: clip('Accordi', repeat(CHORDS, 16, 2), 32, [{ target: CUTOFF, points: curve([0, 0.1], [32, 0.3]) }]),
      lead: clip('Gancio che si apre', repeat(HOOK, 16, 2), 32, [{ target: CUTOFF, points: curve([0, -0.3], [32, 0.08]) }]),
      // il riser dura 3,4 battute: parte in modo da finire sul drop; il rumore al contrario nelle ultime due
      fx: clip('Salita', [...steps(FX.riser, 'x', 18.25), ...steps(FX.reverseNoise, 'x', 26)], 32),
      vox: clip('Open fire', steps(VOX.openFire, 'X', 30), 32),
    },
  },
  {
    name: 'Drop modificato', bars: 16, clips: {
      kick: clip('Cassa modificata', PARTS.kickMod, 16), rumble: C.rumble, clap: C.clap, hats: C.hatsFull, perc: C.percFull,
      lead: clip('Gancio alto', HOOK_HIGH, 16, [pump(16, 0.7, 0.4)]), stab: C.stabs,
      vox: clip('Kill tre volte', [...steps(VOX.sacrifice, 'x', 0), ...steps(VOX.killShort, 'x.x.x...', 14), ...steps(VOX.kill, 'X', 15.5)], 16),
      fx: C.impact,
    },
  },
  {
    name: 'Drop modificato +', bars: 16, clips: {
      kick: clip('Cassa modificata', PARTS.kickMod, 16), clap: C.clap, hats: C.hatsFull, perc: C.percFull,
      // il rumble più sporco: il Drive sale lungo il giro
      rumble: clip('Rumble sporco', PARTS.kick, 16, [pump(16, 0, 0.9), { target: effectParam(1, 'drive'), points: curve([0, 0.05], [16, 0.2]) }]),
      lead: clip('Gancio alto', HOOK_HIGH, 16, [pump(16, 0.7, 0.4)]), stab: C.stabs, chords: C.chords,
      choir: clip('Coro', steps(CHOIR.choir, 'x'), 32, [pump(32, 0.6, 0.6)]),
      vox: clip('Kill kill', [...steps(VOX.killShort, 'x.x.', 14), ...steps(VOX.kill, 'X', 15)], 16),
    },
  },
  {
    name: 'Outro', bars: 16, clips: {
      kick: C.kick, rumble: C.rumble, hats: clip('Piatti intro', PARTS.hatsIntro, 16), perc: C.perc,
      lead: clip('Gancio che si chiude', repeat(HOOK, 16, 2), 32, [{ target: CUTOFF, points: curve([0, -0.05], [32, -0.4]) }, pump(32, 0.7, 0.4)]),
      choir: clip('Bordone', [...steps(CHOIR.atmos, 'x'), ...steps(CHOIR.atmos, 'x', 16), ...steps(CHOIR.monster, 'x', 32)], 64),
      vox: clip('Ultima frase', steps(VOX.dentro, 'x', 32), 64),
      fx: clip('Discesa', steps(FX.down, 'x'), 64),
    },
  },
];

export const SACRIFICIO_LIVE: LiveSpec<SacrificioLiveSound, TrackKey> = {
  name: 'Sacrificio',
  bpm: SACRIFICIO_LIVE_BPM,
  master: {
    volumeDb: 0,
    effects: [
      lowCut(25),
      multiband('Densità', { depth: 30, time: 55, upward: 50 }),
      compressor('Colla', { threshold: -14, ratio: 2, knee: 10, attack: 30, release: 150, scHp: 90, auto: 0, makeup: 1 }),
      limiter('Master', { gain: 10, ceiling: -0.5, release: 50, lookahead: 2 }),
    ],
  },
  tracks: TRACKS,
  scenes: SCENES,
  // intro, drop, bridge (con la sua salita), drop modificato, outro
  arrangement: [0, 1, 2, 3, 4, 5, 6, 7],
};

/** Costruisce il live nel progetto (vuoto) dello store. */
export function buildSacrificioLive(store: ProjectStore, sounds: Readonly<Record<SacrificioLiveSound, SampleRef>>): void {
  buildLive(store, SACRIFICIO_LIVE, sounds);
}
