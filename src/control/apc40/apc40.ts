/* L'APC40 mkII sulla session, come in Live: la griglia 8×5 lancia le clip del riquadro rosso
 * (le frecce lo spostano), i pulsanti di scena lanciano le righe, sotto ci sono stop, selezione,
 * mute (activator) e solo di ogni traccia, i fader e il master; le manopole in alto fanno il pan,
 * le 8 manopole "Device Control" muovono i parametri del dispositivo scelto (la "mano blu"),
 * a banchi di 8. I LED li decide il programma, a ogni giro: colore delle clip, verde che pulsa
 * per quella che suona, lampeggio a tempo per quella in coda; si manda solo ciò che cambia.
 * Il controller non conosce Web MIDI: riceve i messaggi con `receive` e manda con `out`. */
import type { DeviceId, TrackId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { MAX_BPM, MIN_BPM } from '../../core/music-time';
import { paramsOf, resolveParams, type DeviceType } from '../../devices/device-type';
import { paramFromUnit, paramToUnit, type ParamSpec } from '../../devices/params';
import { mappingSpec } from '../../devices/rack-params';
import { effectType, instrumentType } from '../../devices/registry';
import { groupSlotState, type TrackSessionState } from '../../engine/session';
import type { DeviceSettings } from '../../model/device';
import { MASTER, type ChainOwner, type Project } from '../../model/project';
import { chainItems, MACRO_MAX, macroName, macroOf, macroParam, rackName, type DeviceKey, type Rack } from '../../model/rack';
import { GroupTrack, MidiTrack, type Track } from '../../model/track';
import { slotRef, type ClipRef } from '../../store/clip-ref';
import {
  setEffectEnabled, setEffectParam, setInstrumentParam, setMasterMixer, setMixer, setTempo,
} from '../../store/edits';
import type { Edit, ProjectStore } from '../../store/project-store';
import { setMacro } from '../../store/rack-edits';
import type { ControlledDevice, SessionRing, UiState } from '../../ui/ui-state';
import {
  CC, COLOR, dongleChallenge, faderToDb, IDENTITY_REQUEST, identityDeviceId, introduction, isDongleResponse, knobToPan, ledMessages,
  MODE, NOTE, ON, padAt, padNote, paletteIndex, panToKnob, relative, RING, SCENES, STOP_LED, TRACKS, TRIGGERED,
} from './protocol';

/** Ciò che il controller usa del motore (PlaybackEngine lo è già). */
export interface SurfaceEngine {
  readonly playing: boolean;
  readonly position: Beats;
  readonly metronomeOn: boolean;
  launchSlot(track: TrackId, slot: number): void;
  launchScene(index: number): void;
  stopTrack(track: TrackId): void;
  stopAllClips(): void;
  sessionState(track: Track): TrackSessionState;
}

/** Cosa mostra l'area in basso dell'app. */
export type DetailView = 'devices' | 'clip' | null;

/** L'app vista dal controller. */
export interface SurfaceHost {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: SurfaceEngine;
  togglePlay(): void;
  stopAndRewind(): void;
  toggleMetronome(): void;
  openDevices(owner: ChainOwner): void;
  openClip(ref: ClipRef): void;
  readonly detail: DetailView;
  closeDetail(): void;
  say(text: string): void;
}

/** Il dispositivo di una catena, come lo vedono le manopole. Un rack è un dispositivo con 8
 *  parametri, le sue macro, e viene prima dei suoi dispositivi (come in Live). */
interface ChainDevice {
  /** "instrument" per lo strumento, altrimenti l'id dell'effetto o del rack. */
  readonly key: string;
  readonly type: DeviceType;
  readonly settings: DeviceSettings;
  /** Solo gli effetti si spengono. */
  readonly enabled: boolean | null;
  readonly rack?: Rack;
}

/** Il dispositivo che le manopole muovono adesso, con i suoi parametri. */
interface Controlled {
  readonly owner: ChainOwner;
  readonly chain: readonly ChainDevice[];
  readonly index: number;
  readonly device: ChainDevice;
  readonly bank: number;
  readonly banks: number;
  readonly params: readonly ParamSpec[];
}

export const INSTRUMENT_KEY = 'instrument';
const KNOBS = 8;
/** Dopo quanto un fader fermo chiude il suo passo di annullamento. */
const MERGE_IDLE_MS = 400;
/** Dopo la presentazione il controller può mandare la posizione di fader e manopole: non
 *  deve cambiare il mixer del progetto. */
const SETTLE_MS = 500;
/** I colpi di Tap Tempo più distanti di così ricominciano il conto. */
const TAP_RESET_MS = 2000;
/** Mentre si gira una manopola non le si rimanda il valore (arrotondato al passo del
 *  parametro): si contenderebbero la posizione, e l'APC si ingolfa. Ferma da tanto, la si allinea. */
const TOUCH_MS = 300;
/** Messaggi al massimo per giro: l'APC40 mkII elabora il MIDI lentamente, a raffiche si
 *  blocca. Ciò che avanza parte al giro dopo. */
const MAX_SEND = 32;
/** Quanto si aspetta ogni risposta dell'avvio (identità, challenge) prima di andare avanti lo stesso. */
const HANDSHAKE_MS = 1000;
/** Live manda la challenge due dei suoi giri (100 ms) dopo la presentazione. */
const CHALLENGE_DELAY_MS = 200;

/** L'avvio, come in Live: si chiede l'identità, ci si presenta, si fa la challenge, poi si lavora. */
type Phase = 'identity' | 'challenge' | 'ready';

const NOT_YET: Readonly<Record<number, string>> = {
  [NOTE.recordArm]: 'Record arm', [NOTE.record]: 'La registrazione', [NOTE.session]: 'La registrazione nella session',
  [NOTE.crossfadeAssign]: 'Il crossfader', [NOTE.sends]: 'Le mandate', [NOTE.user]: 'Il modo User',
  [NOTE.nudgeMinus]: 'Il nudge', [NOTE.nudgePlus]: 'Il nudge',
};

export class Apc40 {
  /** Ultimo valore mandato a ogni LED (e anello di manopola), per mandare solo i cambi. */
  private readonly sent = new Map<string, number>();
  /** Fader e manopole arrivati dall'ultimo giro: si applica solo l'ultimo valore di ciascuno. */
  private readonly pending = new Map<string, () => void>();
  private tempoSteps = 0;
  private shift = false;
  private bankMode = false;
  private masterSelected = false;
  private lastTrack: TrackId | null = null;
  /** Il dispositivo scelto in ogni catena, e il banco di parametri di ogni dispositivo. */
  private readonly deviceIndex = new Map<ChainOwner, number>();
  private readonly banks = new Map<string, number>();
  private locked: ControlledDevice | null = null;
  private merging = false;
  private lastMove = 0;
  private settleUntil = 0;
  private taps: number[] = [];
  /** Quando ogni manopola è stata girata l'ultima volta. */
  private readonly touched = new Map<string, number>();
  private failed = false;
  /** Spento: alle manopole non si manda niente (né valori né tipo dell'anello). Per capire se
   *  un controller si blocca per i messaggi delle manopole. */
  knobFeedback = true;
  /** Scollegato: non si manda più niente. */
  private stopped = false;
  private phase: Phase = 'identity';
  private phaseAt = 0;
  private challengeSent = false;
  /** Il device ID del controller, dalla sua risposta d'identità (Live fa lo stesso). */
  private device = 0;

  constructor(
    private readonly host: SurfaceHost,
    private readonly out: (data: number[]) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Il controller è appena stato collegato: gli si chiede chi è (vedi `handshake`). */
  start(): void {
    this.stopped = false;
    this.sent.clear();
    this.touched.clear();
    this.phase = 'identity';
    this.phaseAt = this.now();
    this.out([...IDENTITY_REQUEST]);
  }

  /** Vero quando l'avvio è finito e il controller lavora. */
  get ready(): boolean {
    return this.phase === 'ready';
  }

  /** Avanza l'avvio: presentazione (Ableton mode) col device ID avuto, challenge, poi i LED. Se
   *  una risposta non arriva si va avanti lo stesso. */
  private handshake(data: ArrayLike<number> | null): void {
    const now = this.now();
    if (this.phase === 'identity') {
      const id = data ? identityDeviceId(data) : null;
      if (id === null && now - this.phaseAt < HANDSHAKE_MS) return;
      this.device = id ?? 0;
      this.out(introduction(MODE.ableton, this.device));
      this.phase = 'challenge';
      this.phaseAt = now;
      this.challengeSent = false;
      return;
    }
    if (this.phase !== 'challenge') return;
    if (!this.challengeSent) {
      if (now - this.phaseAt < CHALLENGE_DELAY_MS) return;
      const random = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo));
      this.out(dongleChallenge(this.device, random(0, 2_000_000), random(2_000_001, 4_000_000)));
      this.challengeSent = true;
      this.phaseAt = now;
      return;
    }
    if (!(data && isDongleResponse(data)) && now - this.phaseAt < HANDSHAKE_MS) return;
    this.phase = 'ready';
    this.settleUntil = now + SETTLE_MS;
    const ring = this.host.ui.sessionRing;
    this.setRing(ring?.track ?? 0, ring?.scene ?? 0);
    this.refresh();
  }

  /** Il controller se ne va (o l'app si chiude): LED spenti e di nuovo in modo generico. */
  stop(): void {
    this.stopped = true;
    for (const [key, value] of this.sent) if (value !== 0) this.send(key, 0);
    this.sent.clear();
    this.out(introduction(MODE.generic, this.device));
    this.host.ui.setSessionRing(null);
    this.host.ui.setControlledDevice(null);
  }

  /** Un giro: applica fader e manopole arrivati, chiude le modifiche continue ferme, aggiorna i LED. */
  tick(): void {
    if (this.stopped) return;
    if (!this.ready) return this.handshake(null);
    try {
      this.flush();
      if (this.merging && this.now() - this.lastMove > MERGE_IDLE_MS) {
        this.merging = false;
        this.host.store.endMerge();
      }
      this.refresh();
      this.failed = false;
    } catch (e) {
      // un errore non deve ripetersi a ogni giro nella barra di stato
      if (!this.failed) {
        console.error('APC40', e);
        this.host.say(`APC40: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.failed = true;
    }
  }

  /** Un messaggio MIDI dal controller. */
  receive(data: ArrayLike<number>): void {
    if (this.stopped) return;
    if (data[0] === 0xf0) return this.handshake(data);
    if (!this.ready) return; // come Live: i controlli lavorano dopo l'avvio
    const [status, number, value = 0] = Array.from(data);
    const kind = status & 0xf0, channel = status & 0x0f;
    try {
      if (kind === 0x90 && value > 0) this.press(number, channel);
      else if (kind === 0x80 || kind === 0x90) this.release(number);
      else if (kind === 0xb0) this.control(number, channel, value);
      else return;
    } catch (e) {
      this.host.say(`APC40: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (kind !== 0xb0) this.tick();
  }

  // ---------------------------------------------------------------- pulsanti

  private press(note: number, channel: number): void {
    const { engine } = this.host;
    const p = this.project;
    const pad = padAt(note);
    if (pad) return this.shift ? this.jumpToBlock(pad.col, pad.row) : this.launchPad(pad.col, pad.row);
    if (note >= NOTE.sceneLaunch && note < NOTE.sceneLaunch + SCENES) {
      const scene = this.ring.scene + note - NOTE.sceneLaunch;
      if (scene < p.scenes.length) engine.launchScene(scene);
      return;
    }
    const track = this.trackAt(channel);
    switch (note) {
      case NOTE.clipStop: if (track) engine.stopTrack(track.id); return;
      case NOTE.trackSelect: if (track) this.selectOwner(track.id); return;
      case NOTE.activator: if (track) this.apply(setMixer(track.id, { mute: !track.mixer.mute })); return;
      case NOTE.solo: if (track) this.apply(setMixer(track.id, { solo: !track.mixer.solo })); return;
      case NOTE.master: return this.selectOwner(MASTER);
      case NOTE.stopAllClips: return engine.stopAllClips();
      case NOTE.shift: this.shift = true; return;
      case NOTE.bank: this.bankMode = !this.bankMode; return;
      case NOTE.up: return this.moveRing(0, -this.step(SCENES));
      case NOTE.down: return this.moveRing(0, this.step(SCENES));
      case NOTE.left: return this.moveRing(-this.step(TRACKS), 0);
      case NOTE.right: return this.moveRing(this.step(TRACKS), 0);
      case NOTE.play: return this.shift ? this.host.stopAndRewind() : this.host.togglePlay();
      case NOTE.metronome: return this.host.toggleMetronome();
      case NOTE.tapTempo: return this.tap();
      case NOTE.pan: return;
      case NOTE.deviceLeft: return this.moveDevice(-1);
      case NOTE.deviceRight: return this.moveDevice(1);
      case NOTE.bankLeft: return this.moveBank(-1);
      case NOTE.bankRight: return this.moveBank(1);
      case NOTE.deviceOnOff: return this.toggleDevice();
      case NOTE.deviceLock: return this.toggleLock();
      case NOTE.clipDeviceView: return this.toggleClipDevice();
      case NOTE.detailView: return this.toggleDetail();
    }
    const missing = NOT_YET[note];
    if (missing) this.host.say(`APC40: ${missing} non c'è ancora in studiomio.`);
  }

  private release(note: number): void {
    if (note === NOTE.shift) this.shift = false;
  }

  /** Con Shift (o con Bank acceso) le frecce spostano il riquadro di una pagina intera. */
  private step(page: number): number {
    return this.shift || this.bankMode ? page : 1;
  }

  private launchPad(col: number, row: number): void {
    const track = this.trackAt(col), scene = this.ring.scene + row;
    // uno slot vuoto ferma la traccia, come un clic sullo slot vuoto
    if (track && scene < this.project.scenes.length) this.host.engine.launchSlot(track.id, scene);
  }

  /** Shift + griglia: ogni pad è un blocco di 8 tracce × 5 scene; premerlo ci porta il riquadro. */
  private jumpToBlock(col: number, row: number): void {
    const p = this.project;
    if (col * TRACKS >= p.visibleTracks.length || row * SCENES >= p.scenes.length) return;
    this.setRing(col * TRACKS, row * SCENES);
  }

  private selectOwner(owner: ChainOwner): void {
    const { ui } = this.host;
    this.masterSelected = owner === MASTER;
    ui.selectTrack(owner === MASTER ? null : owner);
    this.lastTrack = ui.track;
    if (this.host.detail === 'devices') this.host.openDevices(owner);
  }

  private tap(): void {
    const t = this.now();
    if (this.taps.length && t - this.taps.at(-1)! > TAP_RESET_MS) this.taps = [];
    this.taps = [...this.taps, t].slice(-5);
    if (this.taps.length < 2) return;
    const beat = (this.taps.at(-1)! - this.taps[0]) / (this.taps.length - 1);
    this.setBpm(60_000 / beat, 'apc-tap');
  }

  // ---------------------------------------------------------------- dispositivi

  private moveDevice(delta: number): void {
    this.locked = null;
    const c = this.controlled();
    if (!c) return;
    const index = Math.max(0, Math.min(c.chain.length - 1, c.index + delta));
    this.deviceIndex.set(c.owner, index);
    this.host.openDevices(c.owner);
    this.announce();
  }

  private moveBank(delta: number): void {
    const c = this.controlled();
    if (!c) return;
    this.banks.set(bankKey(c.owner, c.device.key), Math.max(0, Math.min(c.banks - 1, c.bank + delta)));
    this.announce();
  }

  private toggleDevice(): void {
    const c = this.controlled();
    if (c?.device.enabled === null || !c) return;
    this.apply(setEffectEnabled(c.owner, c.device.key as DeviceId, !c.device.enabled));
  }

  private toggleLock(): void {
    const c = this.controlled();
    this.locked = this.locked || !c ? null : { owner: c.owner, device: c.device.key };
    if (c) this.host.say(this.locked ? `APC40: manopole bloccate su ${c.device.type.label}.` : 'APC40: le manopole seguono la traccia scelta.');
  }

  /** Clip/Device View: dai dispositivi alla clip della traccia scelta, e viceversa. */
  private toggleClipDevice(): void {
    const owner = this.selectedOwner;
    if (!owner) return;
    if (this.host.detail !== 'devices' || owner === MASTER) return this.host.openDevices(owner);
    const ref = this.clipToShow(owner);
    if (ref) this.host.openClip(ref);
    else this.host.say('APC40: la traccia non ha clip nella session.');
  }

  /** Detail View: mostra o nasconde l'area in basso. */
  private toggleDetail(): void {
    if (this.host.detail) return this.host.closeDetail();
    const owner = this.selectedOwner ?? this.project.tracks[0]?.id;
    if (owner) this.host.openDevices(owner);
  }

  /** La clip da aprire: quella che suona, o la prima nel riquadro, o la prima della traccia. */
  private clipToShow(id: TrackId): ClipRef | null {
    const track = this.project.track(id);
    if (!track) return null;
    const playing = this.host.engine.sessionState(track).playing;
    const r = this.ring;
    const inRing = track.slots.findIndex((c, s) => c && s >= r.scene && s < r.scene + SCENES);
    const slot = playing?.slot ?? (inRing >= 0 ? inRing : track.slots.findIndex(c => c));
    const clip = slot >= 0 ? track.slots[slot] : null;
    return clip ? slotRef(id, clip.id) : null;
  }

  /** Nella barra di stato: quale dispositivo e quali parametri hanno le manopole (l'APC non ha un display). */
  private announce(): void {
    const c = this.controlled();
    if (!c) return;
    const names = c.params.map(p => p.label).join(', ');
    this.host.say(`APC40 · ${c.device.type.label}${c.banks > 1 ? ` · banco ${c.bank + 1}/${c.banks}` : ''}: ${names}`);
  }

  private get selectedOwner(): ChainOwner | null {
    return this.masterSelected ? MASTER : this.host.ui.track;
  }

  /** Il dispositivo che le manopole muovono: quello bloccato, o quello scelto nella traccia scelta. */
  private controlled(): Controlled | null {
    const p = this.project;
    const lock = this.locked;
    if (lock) {
      const chain = chainOf(p, lock.owner);
      const index = chain.findIndex(d => d.key === lock.device);
      if (index >= 0) return this.describe(lock.owner, chain, index);
      this.locked = null;
    }
    const owner = this.selectedOwner;
    if (!owner) return null;
    const chain = chainOf(p, owner);
    if (!chain.length) return null;
    return this.describe(owner, chain, Math.min(this.deviceIndex.get(owner) ?? 0, chain.length - 1));
  }

  private describe(owner: ChainOwner, chain: readonly ChainDevice[], index: number): Controlled {
    const device = chain[index];
    const all = paramsOf(device.type);
    const banks = Math.max(1, Math.ceil(all.length / KNOBS));
    const bank = Math.min(this.banks.get(bankKey(owner, device.key)) ?? 0, banks - 1);
    return { owner, chain, index, device, bank, banks, params: all.slice(bank * KNOBS, bank * KNOBS + KNOBS) };
  }

  // ---------------------------------------------------------------- controlli continui

  private control(cc: number, channel: number, value: number): void {
    if (cc === CC.tempo) {
      this.tempoSteps += relative(value) * (this.shift ? 0.1 : 1);
      return;
    }
    if (this.now() < this.settleUntil) return;
    if (cc === CC.trackFader) {
      const track = this.trackAt(channel);
      if (track) this.later(`vol-${track.id}`, () => this.move(setMixer(track.id, { volumeDb: faderToDb(value) }), `apc-vol-${track.id}`));
    } else if (cc === CC.masterFader) {
      this.later('master', () => this.move(setMasterMixer({ volumeDb: faderToDb(value) }), 'apc-master'));
    } else if (cc >= CC.trackKnob && cc < CC.trackKnob + TRACKS) {
      const track = this.trackAt(cc - CC.trackKnob);
      this.touch(cc, value);
      if (track) this.later(`pan-${track.id}`, () => this.move(setMixer(track.id, { pan: knobToPan(value) }), `apc-pan-${track.id}`));
    } else if (cc >= CC.deviceKnob && cc < CC.deviceKnob + KNOBS) {
      const c = this.controlled(), spec = c?.params[cc - CC.deviceKnob];
      this.touch(cc, value);
      if (!c || !spec) return;
      const v = paramFromUnit(spec, value / 127);
      const { rack, key } = c.device;
      const macro = rack ? null : macroOf(this.project.racksOf(c.owner), key as DeviceKey, spec.id);
      if (macro) return this.host.say(`APC40: ${spec.label} lo muove la macro ${macro.index + 1} di ${rackName(macro.rack)}.`);
      const edit = rack
        ? setMacro(c.owner, rack.id, rack.macros.findIndex((_, i) => macroParam(i) === spec.id), v)
        : key === INSTRUMENT_KEY
          ? setInstrumentParam(c.owner as TrackId, spec.id, v)
          : setEffectParam(c.owner, key as DeviceId, spec.id, v);
      this.later(`param-${c.owner}-${c.device.key}-${spec.id}`, () => this.move(edit, `apc-param-${c.owner}-${c.device.key}-${spec.id}`));
    }
    // crossfader e livello del cue: studiomio non li ha ancora
  }

  /** La manopola è già in quella posizione: non serve rimandargliela, e per un po' non la si corregge. */
  private touch(cc: number, value: number): void {
    this.sent.set(ccKey(cc), value);
    this.touched.set(ccKey(cc), this.now());
  }

  private later(key: string, run: () => void): void {
    this.pending.set(key, run);
  }

  private flush(): void {
    const runs = [...this.pending.values()];
    this.pending.clear();
    if (this.tempoSteps) {
      const steps = this.tempoSteps;
      this.tempoSteps = 0;
      this.setBpm(this.project.tempo.bpm + steps, 'apc-tempo');
    }
    for (const run of runs) {
      try { run(); } catch (e) { this.host.say(`APC40: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  private setBpm(bpm: number, mergeKey: string): void {
    this.move(setTempo(Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, bpm)) * 100) / 100), mergeKey);
  }

  /** Una modifica continua: i movimenti di un fader sono un solo passo di annullamento. */
  private move(edit: Edit, mergeKey: string): void {
    this.host.store.apply(edit, { mergeKey });
    this.merging = true;
    this.lastMove = this.now();
  }

  private apply(edit: Edit): void {
    this.host.store.apply(edit);
  }

  // ---------------------------------------------------------------- riquadro

  private get project(): Project {
    return this.host.store.project;
  }

  private get ring(): SessionRing {
    return this.host.ui.sessionRing ?? { track: 0, scene: 0, width: TRACKS, height: SCENES };
  }

  /** Le colonne sono quelle della session: le tracce che si vedono (un gruppo chiuso è una colonna sola). */
  private trackAt(col: number): Track | undefined {
    return col < TRACKS ? this.project.visibleTracks[this.ring.track + col] : undefined;
  }

  private moveRing(dx: number, dy: number): void {
    this.setRing(this.ring.track + dx, this.ring.scene + dy);
  }

  /** Il riquadro resta dentro il progetto (se le tracce sono meno di 8, parte dalla prima). */
  private setRing(track: number, scene: number): void {
    const p = this.project;
    this.host.ui.setSessionRing({
      track: clamp(track, 0, Math.max(0, p.visibleTracks.length - TRACKS)),
      scene: clamp(scene, 0, Math.max(0, p.scenes.length - SCENES)),
      width: TRACKS, height: SCENES,
    });
  }

  // ---------------------------------------------------------------- LED

  /** Calcola lo stato di ogni LED e manda quelli cambiati. */
  refresh(): void {
    const { ui, engine } = this.host;
    const p = this.project;
    if (ui.track !== this.lastTrack) {
      this.lastTrack = ui.track;
      if (ui.track) this.masterSelected = false;
    }
    const r = this.ring;
    this.setRing(r.track, r.scene); // tracce o scene tolte: il riquadro rientra
    const ring = this.ring;
    const leds = new Map<string, number>();
    // acceso = 127 come in Live; i lampeggi li fa il controller (niente traffico a tempo da qui)
    const note = (n: number, v: number | boolean, channel = 0) => leds.set(noteKey(n, channel), typeof v === 'boolean' ? (v ? ON : 0) : v);

    const tracks = Array.from({ length: TRACKS }, (_, c) => p.visibleTracks[ring.track + c]);
    const states = tracks.map(t => (t ? engine.sessionState(t) : null));
    const queuedSlot = (st: TrackSessionState | null) => (st?.queued && typeof st.queued === 'object' ? st.queued.slot : -1);

    // la griglia
    for (let row = 0; row < SCENES; row++) {
      for (let col = 0; col < TRACKS; col++) {
        note(padNote(col, row), this.shift
          ? this.overviewColor(p, col, row, ring)
          : this.padColor(tracks[col], states[col], ring.scene + row));
      }
    }
    // scene (pulsanti RGB): verdi se la riga ha clip, lampeggiano se qualcosa della riga è in coda
    for (let i = 0; i < SCENES; i++) {
      const s = ring.scene + i;
      const row = s < p.scenes.length ? p.tracks.map(t => t.slots[s]) : [];
      const queued = p.tracks.some(t => t.slots[s] && queuedSlot(engine.sessionState(t)) === s);
      note(NOTE.sceneLaunch + i, queued ? TRIGGERED(COLOR.green) : row.some(c => c) ? COLOR.green : COLOR.off);
    }
    // per traccia
    tracks.forEach((t, c) => {
      const st = states[c];
      note(NOTE.clipStop, st?.queued === 'stop' ? STOP_LED.blink : st?.playing ? STOP_LED.on : STOP_LED.off, c);
      note(NOTE.trackSelect, !!t && !this.masterSelected && t.id === ui.track, c);
      note(NOTE.activator, !!t && !t.mixer.mute, c);
      note(NOTE.solo, !!t?.mixer.solo, c);
      note(NOTE.recordArm, false, c);
      note(NOTE.crossfadeAssign, 0, c);
    });
    note(NOTE.master, this.masterSelected);
    note(NOTE.stopAllClips, p.tracks.some(t => engine.sessionState(t).playing));
    // trasporto e navigazione
    note(NOTE.play, engine.playing);
    note(NOTE.metronome, engine.metronomeOn);
    note(NOTE.record, false);
    note(NOTE.session, false);
    note(NOTE.up, ring.scene > 0);
    note(NOTE.down, ring.scene + SCENES < p.scenes.length);
    note(NOTE.left, ring.track > 0);
    note(NOTE.right, ring.track + TRACKS < p.visibleTracks.length);
    note(NOTE.bank, this.bankMode);
    note(NOTE.pan, true);
    note(NOTE.sends, false);
    note(NOTE.user, false);
    // manopole sopra le tracce: il pan
    tracks.forEach((t, c) => {
      leds.set(ccKey(CC.trackRing + c), t ? RING.pan : RING.off);
      leds.set(ccKey(CC.trackKnob + c), t ? panToKnob(t.mixer.pan) : 0);
    });
    // il dispositivo controllato
    const dev = this.controlled();
    ui.setControlledDevice(dev ? { owner: dev.owner, device: dev.device.key } : null);
    const values = dev ? resolveParams(dev.device.type, dev.device.settings.params) : {};
    for (let i = 0; i < KNOBS; i++) {
      const spec = dev?.params[i];
      leds.set(ccKey(CC.deviceRing + i), spec ? (bipolar(spec) ? RING.pan : RING.volume) : RING.off);
      leds.set(ccKey(CC.deviceKnob + i), spec ? Math.round(paramToUnit(spec, values[spec.id]) * 127) : 0);
    }
    note(NOTE.deviceLeft, !!dev && dev.index > 0);
    note(NOTE.deviceRight, !!dev && dev.index < dev.chain.length - 1);
    note(NOTE.bankLeft, !!dev && dev.bank > 0);
    note(NOTE.bankRight, !!dev && dev.bank < dev.banks - 1);
    note(NOTE.deviceOnOff, !!dev && dev.device.enabled !== false);
    note(NOTE.deviceLock, this.locked !== null);
    note(NOTE.clipDeviceView, this.host.detail === 'devices');
    note(NOTE.detailView, this.host.detail !== null);

    const now = this.now();
    let budget = MAX_SEND;
    for (const [key, value] of leds) {
      if (this.sent.get(key) === value || now - (this.touched.get(key) ?? -Infinity) < TOUCH_MS) continue;
      if (!this.knobFeedback && key.startsWith('c:')) continue;
      if (budget-- <= 0) break;
      this.send(key, value);
    }
  }

  /** Il pad di uno slot, come in Live: quella che suona è verde fisso, quella in coda lampeggia
   *  verde, le altre clip hanno il loro colore, gli slot vuoti sono spenti. */
  private padColor(track: Track | undefined, st: TrackSessionState | null, scene: number): number {
    if (!track || !st || scene >= track.slots.length) return COLOR.off;
    if (track instanceof GroupTrack) {
      // lo slot di un gruppo: dalle sue tracce, nel colore del gruppo
      const members = this.project.soundingTracks(track.id).map(t => [t, this.host.engine.sessionState(t)] as const);
      const g = groupSlotState(members, scene);
      return g.queued ? TRIGGERED(COLOR.green) : g.playing ? COLOR.green : g.clips ? paletteIndex(track.color) : COLOR.off;
    }
    const clip = track.slots[scene];
    if (st.queued && typeof st.queued === 'object' && st.queued.slot === scene) return TRIGGERED(COLOR.green);
    if (st.playing?.slot === scene) return COLOR.green;
    return clip ? paletteIndex(clip.color) : COLOR.off;
  }

  /** Shift tenuto: la mappa dei blocchi. Bianco dov'è il riquadro, verde se qualcosa suona,
   *  ambra se ci sono clip, appena acceso se è vuoto. */
  private overviewColor(p: Project, col: number, row: number, ring: SessionRing): number {
    const t0 = col * TRACKS, s0 = row * SCENES;
    if (t0 >= p.visibleTracks.length || s0 >= p.scenes.length) return COLOR.off;
    if (ring.track >= t0 && ring.track < t0 + TRACKS && ring.scene >= s0 && ring.scene < s0 + SCENES) return COLOR.white;
    const tracks = p.visibleTracks.slice(t0, t0 + TRACKS).flatMap(t => p.soundingTracks(t.id));
    const inBlock = (s: number) => s >= s0 && s < s0 + SCENES;
    if (tracks.some(t => { const pl = this.host.engine.sessionState(t).playing; return pl && inBlock(pl.slot); })) return COLOR.green;
    if (tracks.some(t => t.slots.some((c, s) => c && inBlock(s)))) return COLOR.amber;
    return COLOR.dim;
  }

  /** Un LED: un messaggio, o due per un'animazione (vedi rgbLed). */
  private send(key: string, value: number): void {
    const [kind, channel, number] = key.split(':');
    for (const m of ledMessages((kind === 'n' ? 0x90 : 0xb0) | Number(channel), Number(number), value)) this.out(m);
    this.sent.set(key, value);
  }
}

/** I dispositivi di una catena, nell'ordine in cui il suono li attraversa; ogni rack prima dei suoi. */
export function chainOf(p: Project, owner: ChainOwner): ChainDevice[] {
  const devices = new Map<DeviceKey, ChainDevice>();
  if (owner !== MASTER) {
    const track = p.track(owner);
    if (!track) return [];
    const instrument = track instanceof MidiTrack ? instrumentType(track.instrument.type) : undefined;
    if (track instanceof MidiTrack && instrument) devices.set(INSTRUMENT_KEY, { key: INSTRUMENT_KEY, type: instrument, settings: track.instrument, enabled: null });
  }
  for (const e of p.effectsOf(owner)) {
    const type = effectType(e.type);
    if (type) devices.set(e.id, { key: e.id, type, settings: e, enabled: e.enabled });
  }
  const one = (k: DeviceKey) => devices.get(k) ?? [];
  return chainItems(p.chainKeys(owner), p.racksOf(owner))
    .flatMap(item => (item.kind === 'device' ? one(item.key) : [rackDevice(p, owner, item.rack), ...item.rack.devices.flatMap(one)]));
}

/** Un rack come dispositivo per le manopole: le 8 macro sono i suoi parametri. */
function rackDevice(p: Project, owner: ChainOwner, rack: Rack): ChainDevice {
  const params = rack.macros.map((m, i) => ({
    kind: 'number' as const, id: macroParam(i), min: 0, max: MACRO_MAX, default: 0,
    label: macroName(m, i, x => mappingSpec(p, owner, x)?.label),
  }));
  const type: DeviceType = { type: 'rack', label: rackName(rack), sections: [{ label: 'Macro', params }], presets: [] };
  const settings: DeviceSettings = { type: 'rack', preset: null, params: Object.fromEntries(rack.macros.map((m, i) => [macroParam(i), m.value])) };
  return { key: rack.id, type, settings, enabled: null, rack };
}

const noteKey = (note: number, channel: number) => `n:${channel}:${note}`;
const ccKey = (cc: number, channel = 0) => `c:${channel}:${cc}`;
const bankKey = (owner: ChainOwner, device: string) => `${owner}/${device}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** I parametri con lo zero nel mezzo (pan, guadagni ±) hanno l'anello che parte dal centro. */
const bipolar = (p: ParamSpec) => p.kind === 'number' && p.min < 0 && p.max > 0;
