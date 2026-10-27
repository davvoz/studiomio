/* Ciò che hanno in comune i controller della session (APC40 mkII, Launchpad): il riquadro che
 * suonano (prima traccia, prima scena, larghezza e altezza), lo stato di slot, scene e blocchi da
 * cui si accendono i pad, la traccia scelta, il dispositivo che muovono, i controlli continui
 * (si applica l'ultimo valore a ogni giro, e una corsa è un solo annullamento) e i LED, mandati
 * solo quando cambiano e a raffiche limitate. Ogni controller ci mette il suo protocollo: come
 * si avvia, cosa fa ogni pulsante, di che colore è ogni LED e come lo si accende. */
import type { DeviceId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { MAX_BPM, MIN_BPM } from '../core/music-time';
import { resolveParams, visibleParamsOf, type DeviceType } from '../devices/device-type';
import { paramFromUnit, paramToUnit, type ParamSpec } from '../devices/params';
import { mappingSpec } from '../devices/rack-params';
import { effectType, instrumentType } from '../devices/registry';
import { groupSlotState, sceneState, type TrackSessionState } from '../engine/session';
import type { DeviceSettings } from '../model/device';
import type { ModTarget } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { chainItems, MACRO_MAX, macroName, macroOf, macroParam, rackName, type DeviceKey, type Rack } from '../model/rack';
import { GroupTrack, MidiTrack, type Track } from '../model/track';
import type { ClipRef } from '../store/clip-ref';
import { setEffectParam, setInstrumentParam, setTempo } from '../store/edits';
import type { Edit, ProjectStore } from '../store/project-store';
import { setMacro } from '../store/rack-edits';
import type { ControlledDevice, SessionRing, UiState } from '../ui/ui-state';

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
  /** Dove una curva che suona porta adesso un parametro (spostamento della manopola, −1 … +1),
   *  o null: anelli e fader mostrano il valore che si sente. */
  modulationAt?(owner: ChainOwner, target: ModTarget): number | null;
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
export interface ChainDevice {
  /** "instrument" per lo strumento, altrimenti l'id dell'effetto o del rack. */
  readonly key: string;
  readonly type: DeviceType;
  readonly settings: DeviceSettings;
  /** Solo gli effetti si spengono. */
  readonly enabled: boolean | null;
  readonly rack?: Rack;
}

/** Il dispositivo che le manopole muovono adesso, con i suoi parametri. */
export interface Controlled {
  readonly owner: ChainOwner;
  readonly chain: readonly ChainDevice[];
  readonly index: number;
  readonly device: ChainDevice;
  readonly bank: number;
  readonly banks: number;
  readonly params: readonly ParamSpec[];
}

/** Come si accende il pad di uno slot: spento, del colore della clip, suona, in coda. */
export type SlotLight = 'off' | 'playing' | 'queued' | { readonly clip: string };
/** Il pulsante di una scena: spento (riga vuota), suona, in coda, o del colore della scena (null: non ne ha). */
export type SceneLight = 'off' | 'playing' | 'queued' | { readonly color: string | null };
/** Un pad della mappa dei blocchi: fuori dal progetto, il riquadro, qualcosa suona, ci sono clip, vuoto. */
export type BlockLight = 'off' | 'ring' | 'playing' | 'clips' | 'empty';

export const INSTRUMENT_KEY = 'instrument';
/** Quanti parametri ha un banco del dispositivo (le 8 manopole, gli 8 fader). */
export const PARAMS_PER_BANK = 8;
/** Dopo quanto un fader fermo chiude il suo passo di annullamento. */
const MERGE_IDLE_MS = 400;
/** Dopo l'avvio il controller può mandare la posizione di fader e manopole: non deve cambiare
 *  il mixer del progetto. */
export const SETTLE_MS = 500;
/** I colpi di Tap Tempo più distanti di così ricominciano il conto. */
const TAP_RESET_MS = 2000;
/** Mentre si muove un controllo non gli si rimanda il valore (arrotondato al passo del
 *  parametro): si contenderebbero la posizione. Fermo da tanto, lo si allinea. */
const TOUCH_MS = 300;

export abstract class SessionSurface {
  /** Ultimo valore mandato a ogni LED (e anello o fader), per mandare solo i cambi. */
  protected readonly sent = new Map<string, number>();
  /** Fader e manopole arrivati dall'ultimo giro: si applica solo l'ultimo valore di ciascuno. */
  private readonly pending = new Map<string, () => void>();
  protected shift = false;
  protected masterSelected = false;
  private lastTrack: TrackId | null = null;
  /** Il dispositivo scelto in ogni catena, e il banco di parametri di ogni dispositivo. */
  protected readonly deviceIndex = new Map<ChainOwner, number>();
  protected readonly banks = new Map<string, number>();
  protected locked: ControlledDevice | null = null;
  private merging = false;
  private lastMove = 0;
  protected settleUntil = 0;
  private taps: number[] = [];
  /** Quando ogni controllo è stato mosso l'ultima volta. */
  protected readonly touched = new Map<string, number>();
  private failed = false;
  /** Scollegato: non si manda più niente. */
  protected stopped = false;

  /** Il nome nella barra di stato ("APC40", "Launchpad X"). */
  protected abstract readonly label: string;
  /** Il prefisso delle chiavi con cui si uniscono le modifiche continue. */
  protected abstract readonly mergePrefix: string;
  /** Tracce e scene del riquadro. */
  protected abstract readonly width: number;
  protected abstract readonly height: number;
  /** Messaggi al massimo per giro: ciò che avanza parte al giro dopo. */
  protected abstract readonly maxSend: number;

  constructor(
    protected readonly host: SurfaceHost,
    protected readonly out: (data: number[]) => void,
    protected readonly now: () => number = () => performance.now(),
  ) {}

  /** Il controller è appena stato collegato: comincia l'avvio. */
  abstract start(): void;
  /** Il controller se ne va (o l'app si chiude). */
  abstract stop(): void;
  /** Vero quando l'avvio è finito e il controller lavora. */
  abstract get ready(): boolean;
  /** Avanza l'avvio con un SysEx arrivato (o null, a ogni giro: per le attese). */
  protected abstract handshake(data: ArrayLike<number> | null): void;
  /** Un messaggio (non SysEx) dopo l'avvio. Vero se era un controllo continuo: i LED li
   *  aggiorna il giro, non serve farlo subito. */
  protected abstract input(kind: number, channel: number, number: number, value: number): boolean;
  /** Lo stato di ogni LED che il controller mostra adesso, per chiave (vedi noteKey e ccKey). */
  protected abstract leds(): Map<string, number>;
  /** I messaggi che accendono un LED. */
  protected abstract ledMessages(status: number, number: number, value: number): number[][];

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
        console.error(this.label, e);
        this.fail(e);
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
    let continuous = false;
    try {
      continuous = this.input(status & 0xf0, status & 0x0f, number, value);
    } catch (e) {
      this.fail(e);
    }
    if (!continuous) this.tick();
  }

  protected fail(e: unknown): void {
    this.host.say(`${this.label}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---------------------------------------------------------------- riquadro

  protected get project(): Project {
    return this.host.store.project;
  }

  protected get ring(): SessionRing {
    return this.host.ui.sessionRing ?? { track: 0, scene: 0, width: this.width, height: this.height };
  }

  /** Le colonne sono quelle della session: le tracce che si vedono (un gruppo chiuso è una colonna sola). */
  protected trackAt(col: number): Track | undefined {
    return col >= 0 && col < this.width ? this.project.visibleTracks[this.ring.track + col] : undefined;
  }

  /** Le tracce del riquadro, una per colonna (undefined dove non ce ne sono). */
  protected ringTracks(): (Track | undefined)[] {
    return Array.from({ length: this.width }, (_, c) => this.trackAt(c));
  }

  protected moveRing(dx: number, dy: number): void {
    this.setRing(this.ring.track + dx, this.ring.scene + dy);
  }

  /** Il riquadro resta dentro il progetto (se le tracce sono meno della larghezza, parte dalla prima). */
  protected setRing(track: number, scene: number): void {
    const p = this.project;
    this.host.ui.setSessionRing({
      track: clamp(track, 0, Math.max(0, p.visibleTracks.length - this.width)),
      scene: clamp(scene, 0, Math.max(0, p.scenes.length - this.height)),
      width: this.width, height: this.height,
    });
  }

  /** Il riquadro può andare in quella direzione? */
  protected canMove(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const r = this.ring, p = this.project;
    switch (direction) {
      case 'up': return r.scene > 0;
      case 'down': return r.scene + this.height < p.scenes.length;
      case 'left': return r.track > 0;
      case 'right': return r.track + this.width < p.visibleTracks.length;
    }
  }

  /** Il pad di uno slot del riquadro: lancia la clip (uno slot vuoto ferma la traccia, come un clic). */
  protected launchPad(col: number, row: number): void {
    const track = this.trackAt(col), scene = this.ring.scene + row;
    if (track && scene < this.project.scenes.length) this.host.engine.launchSlot(track.id, scene);
  }

  protected launchScene(row: number): void {
    const scene = this.ring.scene + row;
    if (scene < this.project.scenes.length) this.host.engine.launchScene(scene);
  }

  /** La mappa dei blocchi: ogni pad è un blocco grande quanto il riquadro; premerlo ci porta il riquadro. */
  protected jumpToBlock(col: number, row: number): void {
    const p = this.project;
    if (col * this.width >= p.visibleTracks.length || row * this.height >= p.scenes.length) return;
    this.setRing(col * this.width, row * this.height);
  }

  /** Lo slot di una traccia: quella che suona, quella in coda, il colore della clip, spento. */
  protected slotLight(track: Track | undefined, scene: number): SlotLight {
    if (!track || scene >= track.slots.length) return 'off';
    const { engine } = this.host;
    if (track instanceof GroupTrack) {
      // lo slot di un gruppo: dalle sue tracce, nel colore del gruppo
      const members = this.project.soundingTracks(track.id).map(t => [t, engine.sessionState(t)] as const);
      const g = groupSlotState(members, scene);
      return g.queued ? 'queued' : g.playing ? 'playing' : g.clips ? { clip: track.color } : 'off';
    }
    const st = engine.sessionState(track);
    const clip = track.slots[scene];
    if (st.queued && typeof st.queued === 'object' && st.queued.slot === scene) return 'queued';
    if (st.playing?.slot === scene) return 'playing';
    return clip ? { clip: clip.color } : 'off';
  }

  /** Il pulsante della riga `row` del riquadro: in coda se qualcosa della riga lo è, suona se
   *  suonano tutte le sue clip, del colore della scena se la riga ha clip, spento se è vuota. */
  protected sceneLight(row: number): SceneLight {
    const p = this.project, { engine } = this.host;
    const s = this.ring.scene + row;
    if (s >= p.scenes.length) return 'off';
    const scene = sceneState(p.tracks.filter(t => !(t instanceof GroupTrack)).map(t => [t, engine.sessionState(t)] as const), s);
    if (scene.queued) return 'queued';
    if (scene.playing) return 'playing';
    return scene.clips ? { color: p.scenes[s].color ?? null } : 'off';
  }

  /** Un pad della mappa dei blocchi. */
  protected blockLight(col: number, row: number): BlockLight {
    const p = this.project, ring = this.ring, w = this.width, h = this.height;
    const t0 = col * w, s0 = row * h;
    if (t0 >= p.visibleTracks.length || s0 >= p.scenes.length) return 'off';
    if (ring.track >= t0 && ring.track < t0 + w && ring.scene >= s0 && ring.scene < s0 + h) return 'ring';
    const tracks = p.visibleTracks.slice(t0, t0 + w).flatMap(t => p.soundingTracks(t.id));
    const inBlock = (s: number) => s >= s0 && s < s0 + h;
    if (tracks.some(t => { const pl = this.host.engine.sessionState(t).playing; return pl && inBlock(pl.slot); })) return 'playing';
    if (tracks.some(t => t.slots.some((c, s) => c && inBlock(s)))) return 'clips';
    return 'empty';
  }

  /** La traccia ferma, suona, o ha lo stop in coda. */
  protected stopLight(track: Track | undefined): 'off' | 'playing' | 'queued' {
    if (!track) return 'off';
    const st = this.host.engine.sessionState(track);
    return st.queued === 'stop' ? 'queued' : st.playing ? 'playing' : 'off';
  }

  // ---------------------------------------------------------------- traccia scelta

  protected selectOwner(owner: ChainOwner): void {
    const { ui } = this.host;
    this.masterSelected = owner === MASTER;
    ui.selectTrack(owner === MASTER ? null : owner);
    this.lastTrack = ui.track;
    if (this.host.detail === 'devices') this.host.openDevices(owner);
  }

  protected get selectedOwner(): ChainOwner | null {
    return this.masterSelected ? MASTER : this.host.ui.track;
  }

  // ---------------------------------------------------------------- dispositivi

  protected moveDevice(delta: number): void {
    this.locked = null;
    const c = this.controlled();
    if (!c) return;
    const index = Math.max(0, Math.min(c.chain.length - 1, c.index + delta));
    this.deviceIndex.set(c.owner, index);
    this.host.openDevices(c.owner);
    this.announce();
  }

  protected setBank(bank: number): void {
    const c = this.controlled();
    if (!c) return;
    this.banks.set(bankKey(c.owner, c.device.key), Math.max(0, Math.min(c.banks - 1, bank)));
    this.announce();
  }

  /** Nella barra di stato: quale dispositivo e quali parametri hanno i controlli (il controller non ha un display). */
  protected announce(): void {
    const c = this.controlled();
    if (!c) return;
    const names = c.params.map(p => p.label).join(', ');
    this.host.say(`${this.label} · ${c.device.type.label}${c.banks > 1 ? ` · banco ${c.bank + 1}/${c.banks}` : ''}: ${names}`);
  }

  /** Il dispositivo che i controlli muovono: quello bloccato, o quello scelto nella traccia scelta. */
  protected controlled(): Controlled | null {
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
    const all = visibleParamsOf(device.type);
    const banks = Math.max(1, Math.ceil(all.length / PARAMS_PER_BANK));
    const bank = Math.min(this.banks.get(bankKey(owner, device.key)) ?? 0, banks - 1);
    return { owner, chain, index, device, bank, banks, params: all.slice(bank * PARAMS_PER_BANK, (bank + 1) * PARAMS_PER_BANK) };
  }

  /** Lo spostamento che una curva dà adesso al parametro del dispositivo controllato (0: nessuno). */
  private offsetOf(c: Controlled, spec: ParamSpec): number {
    return this.host.engine.modulationAt?.(c.owner, { kind: 'device', device: c.device.key as DeviceId, param: spec.id }) ?? 0;
  }

  /** Dove sta il parametro del dispositivo controllato (0..1), con la curva che suona: anelli e
   *  fader mostrano il valore che si sente, come le manopole sullo schermo. */
  protected heardUnit(c: Controlled, spec: ParamSpec): number {
    const base = paramToUnit(spec, resolveParams(c.device.type, c.device.settings.params)[spec.id]);
    return clamp(base + this.offsetOf(c, spec), 0, 1);
  }

  /** Il parametro `i` del banco del dispositivo controllato, portato a `unit` (0..1): il valore
   *  che si sente, quindi con una curva che suona la manopola va dove serve perché si senta
   *  quello (niente salti). Un parametro mosso da una macro non si tocca: lo si dice. */
  protected turnParam(i: number, unit: number): void {
    const c = this.controlled(), spec = c?.params[i];
    if (!c || !spec) return;
    const v = paramFromUnit(spec, unit - this.offsetOf(c, spec));
    const { rack, key } = c.device;
    const macro = rack ? null : macroOf(this.project.racksOf(c.owner), key as DeviceKey, spec.id);
    if (macro) return this.host.say(`${this.label}: ${spec.label} lo muove la macro ${macro.index + 1} di ${rackName(macro.rack)}.`);
    const edit = rack
      ? setMacro(c.owner, rack.id, rack.macros.findIndex((_, m) => macroParam(m) === spec.id), v)
      : key === INSTRUMENT_KEY
        ? setInstrumentParam(c.owner as TrackId, spec.id, v)
        : setEffectParam(c.owner, key as DeviceId, spec.id, v);
    const id = `param-${c.owner}-${c.device.key}-${spec.id}`;
    this.later(id, () => this.move(edit, `${this.mergePrefix}-${id}`));
  }

  // ---------------------------------------------------------------- controlli continui

  /** Il controllo è già in quella posizione: non serve rimandargliela, e per un po' non lo si corregge. */
  protected touch(key: string, value: number): void {
    this.sent.set(key, value);
    this.touched.set(key, this.now());
  }

  protected later(key: string, run: () => void): void {
    this.pending.set(key, run);
  }

  private flush(): void {
    const runs = [...this.pending.values()];
    this.pending.clear();
    for (const run of runs) {
      try { run(); } catch (e) { this.fail(e); }
    }
  }

  protected tap(): void {
    const t = this.now();
    if (this.taps.length && t - this.taps.at(-1)! > TAP_RESET_MS) this.taps = [];
    this.taps = [...this.taps, t].slice(-5);
    if (this.taps.length < 2) return;
    const beat = (this.taps.at(-1)! - this.taps[0]) / (this.taps.length - 1);
    this.setBpm(60_000 / beat, `${this.mergePrefix}-tap`);
  }

  protected setBpm(bpm: number, mergeKey: string): void {
    this.move(setTempo(Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, bpm)) * 100) / 100), mergeKey);
  }

  /** Una modifica continua: i movimenti di un fader sono un solo passo di annullamento. */
  protected move(edit: Edit, mergeKey: string): void {
    this.host.store.apply(edit, { mergeKey });
    this.merging = true;
    this.lastMove = this.now();
  }

  protected apply(edit: Edit): void {
    this.host.store.apply(edit);
  }

  // ---------------------------------------------------------------- LED

  /** Calcola lo stato di ogni LED e manda quelli cambiati. */
  refresh(): void {
    const { ui } = this.host;
    if (ui.track !== this.lastTrack) {
      this.lastTrack = ui.track;
      if (ui.track) this.masterSelected = false;
    }
    const r = this.ring;
    this.setRing(r.track, r.scene); // tracce o scene tolte: il riquadro rientra
    const leds = this.leds();
    const now = this.now();
    let budget = this.maxSend;
    for (const [key, value] of leds) {
      if (this.sent.get(key) === value || now - (this.touched.get(key) ?? -Infinity) < TOUCH_MS) continue;
      if (this.muted(key)) continue;
      if (budget-- <= 0) break;
      this.send(key, value);
    }
  }

  /** Un LED che per ora non si manda (vedi Apc40.knobFeedback). */
  protected muted(_key: string): boolean {
    return false;
  }

  /** Un LED: uno o più messaggi (vedi ledMessages). */
  protected send(key: string, value: number): void {
    const [kind, channel, number] = key.split(':');
    for (const m of this.ledMessages((kind === 'n' ? 0x90 : 0xb0) | Number(channel), Number(number), value)) this.out(m);
    this.sent.set(key, value);
  }

  /** Spegne tutti i LED accesi e lascia libera la session (allo scollegamento). */
  protected darken(): void {
    for (const [key, value] of this.sent) if (value !== 0) this.send(key, 0);
    this.sent.clear();
    this.host.ui.setSessionRing(null);
    this.host.ui.setControlledDevice(null);
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

export const noteKey = (note: number, channel = 0) => `n:${channel}:${note}`;
export const ccKey = (cc: number, channel = 0) => `c:${channel}:${cc}`;
export const bankKey = (owner: ChainOwner, device: string) => `${owner}/${device}`;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** I parametri con lo zero nel mezzo (pan, guadagni ±): anello o fader che parte dal centro. */
export const bipolar = (p: ParamSpec) => p.kind === 'number' && p.min < 0 && p.max > 0;
