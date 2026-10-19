/* I Launchpad sulla session, come in Live: la griglia 8×8 lancia le clip del riquadro (le frecce
 * lo spostano), i pulsanti a destra lanciano le scene, il pulsante Session porta alla mappa dei
 * blocchi. Il resto dipende dal modello, come negli script di Live:
 *  - X: Session passa al mixer, dove i pulsanti a destra scelgono volume e pan (fader disegnati
 *    sulla griglia), stop, mute e solo (sull'ultima riga della griglia);
 *  - Mini MK3: l'ultimo pulsante a destra (Stop Solo Mute) fa girare stop, solo e mute sull'ultima riga;
 *  - Pro MK3: sotto la griglia la riga delle tracce (sceglie, o mute, solo, stop) e i modi;
 *    Volume, Pan e Device mettono i fader sulla griglia, Device con i parametri del dispositivo;
 *  - MK2: Mixer porta il mixer sulla griglia (righe di stop, mute, solo; fader di volume e pan).
 * I LED li decide il programma a ogni giro; le animazioni (pulsa, lampeggia) le fa il controller.
 * Il controller non conosce Web MIDI: riceve i messaggi con `receive` e manda con `out`. */
import { resolveParams } from '../../devices/device-type';
import { paramToUnit } from '../../devices/params';
import type { Track } from '../../model/track';
import { setMixer } from '../../store/edits';
import { dbToFader, faderToDb, knobToPan, panToKnob } from '../mixer-scale';
import { paletteIndex } from '../palette';
import { ccKey, noteKey, SessionSurface, type BlockLight, type SlotLight, type SurfaceHost } from '../session-surface';
import {
  blink, COLOR, dawMode, FADER_CHANNEL, FADER_COLOR_CHANNEL, FADER_PAGE, faderCc, faderSetup, IDENTITY_REQUEST, identityFamily,
  isMk2ChallengeResponse, layoutMessage, ledMessages, MK2_QUIT, mk2Challenge, mk2Fader, padAt, padNote, pulse, reportedLayout,
  sceneAt, sceneButton, sessionColor, SIZE, TRACK_BUTTONS, type Button, type Layout, type Model,
} from './protocol';

/** Messaggi al massimo per giro (30 ms): i Launchpad reggono bene, ma una griglia intera è
 *  meglio mandarla in due o tre giri che in una raffica sola. */
const MAX_SEND = 80;
/** Quanto si aspetta ogni risposta dell'avvio (identità, challenge) prima di andare avanti lo stesso. */
const HANDSHAKE_MS = 1000;
/** Due pressioni di Session più vicine di così sono un doppio clic (Live: 0,3 s). */
const DOUBLE_CLICK_MS = 300;

type Phase = 'identity' | 'challenge' | 'ready';

/** Cosa fanno i controlli del mixer: niente (la griglia lancia), una funzione per traccia
 *  (stop, mute, solo), o i fader sulla griglia (volume, pan, parametri del dispositivo). */
type Mode = 'none' | 'stop' | 'mute' | 'solo' | 'volume' | 'pan' | 'device';
const FADER_MODES: readonly Mode[] = ['volume', 'pan', 'device'];
type TrackMode = 'select' | 'stop' | 'mute' | 'solo';

/** I colori delle funzioni, come nello skin di Live (novation/skin.py). */
const MODE_COLOR: Readonly<Record<Exclude<Mode, 'none'>, number>> = {
  stop: COLOR.red, mute: COLOR.yellow, solo: COLOR.blue, volume: COLOR.green, pan: COLOR.orange, device: COLOR.darkBlue,
};

/** I pulsanti dei modi del mixer: X e MK2 nella colonna delle scene, dall'alto. */
const MIXER_COLUMN: readonly (Mode | 'sendA' | 'sendB' | 'arm')[] = ['volume', 'pan', 'sendA', 'sendB', 'stop', 'mute', 'solo', 'arm'];

const NOT_YET: Readonly<Partial<Record<Button | 'sendA' | 'sendB', string>>> = {
  note: 'Il modo Note', custom: 'I modi Custom', captureMidi: 'Capture MIDI', drums: 'Il modo Drums', keys: 'Il modo Keys',
  user: 'Il modo User', user1: 'Il modo User', user2: 'Il modo User', record: 'La registrazione', arm: 'Record arm',
  sends: 'Le mandate', sendA: 'Le mandate', sendB: 'Le mandate', clear: 'Clear', duplicate: 'Duplicate',
  quantize: 'La quantizzazione', fixedLength: 'Fixed length',
};

export class Launchpad extends SessionSurface {
  protected readonly label: string;
  protected readonly mergePrefix = 'lp';
  protected readonly width = SIZE;
  protected readonly height = SIZE;
  protected readonly maxSend = MAX_SEND;
  private phase: Phase = 'identity';
  private phaseAt = 0;
  private challengeSent = false;
  /** La famiglia dalla risposta d'identità (null se non è arrivata). */
  identified: readonly [number, number] | null = null;
  /** Il layout chiesto al controller (null: da mandare). */
  private layout: Layout | null = null;
  /** Il controller mostra un layout suo (note, custom…): la griglia non lancia niente. */
  private foreign = false;
  private overview = false;
  /** X e MK2: la colonna delle scene sceglie i modi del mixer. */
  private mixer = false;
  private mode: Mode = 'none';
  private sessionPressedAt = -Infinity;
  /** Il numero di ogni pulsante, e il pulsante di ogni numero. */
  private readonly buttonOf = new Map<number, Button>();

  constructor(readonly model: Model, host: SurfaceHost, out: (data: number[]) => void, now?: () => number) {
    super(host, out, now);
    this.label = model.name;
    for (const [name, n] of Object.entries(model.buttons)) this.buttonOf.set(n, name as Button);
  }

  /** Il controller è appena stato collegato: gli si chiede chi è (vedi `handshake`). */
  start(): void {
    this.stopped = false;
    this.sent.clear();
    this.touched.clear();
    this.phase = 'identity';
    this.phaseAt = this.now();
    this.layout = null;
    this.overview = false;
    this.shift = false;
    this.out([...IDENTITY_REQUEST]);
  }

  get ready(): boolean {
    return this.phase === 'ready';
  }

  /** L'avvio, come in Live: identità, poi (X, Mini, Pro) la DAW mode e il layout Session, o
   *  (MK2) la challenge e il layout Session; poi i LED. Se una risposta non arriva si va avanti lo stesso. */
  protected handshake(data: ArrayLike<number> | null): void {
    const now = this.now();
    if (this.phase === 'ready') {
      if (data) this.layoutReport(data);
      return;
    }
    if (this.phase === 'identity') {
      const family = data ? identityFamily(data) : null;
      if (family) this.identified = family;
      if (!family && now - this.phaseAt < HANDSHAKE_MS) return;
      if (family && (family[0] !== this.model.family[0] || family[1] !== this.model.family[1])) {
        console.warn(`${this.label}: la risposta d'identità è di un'altra famiglia`, family);
      }
      if (this.model.id !== 'mk2') return this.begin();
      this.phase = 'challenge';
      this.phaseAt = now;
      this.challengeSent = false;
    }
    if (!this.challengeSent) {
      this.out(mk2Challenge(Array.from({ length: 4 }, () => Math.floor(Math.random() * 128))));
      this.challengeSent = true;
      this.phaseAt = now;
      return;
    }
    if ((data && isMk2ChallengeResponse(data)) || now - this.phaseAt >= HANDSHAKE_MS) this.begin();
  }

  /** Dopo l'avvio: DAW mode, layout Session, riquadro e LED. */
  private begin(): void {
    if (this.model.id !== 'mk2') this.out(dawMode(this.model, true));
    this.phase = 'ready';
    this.foreign = false;
    this.applyLayout();
    const ring = this.host.ui.sessionRing;
    this.setRing(ring?.track ?? 0, ring?.scene ?? 0);
    this.refresh();
  }

  /** Il controller ha cambiato layout da sé (Note, Custom, le impostazioni…) o è tornato alla Session. */
  private layoutReport(data: ArrayLike<number>): void {
    const shown = reportedLayout(this.model, data);
    if (!shown) return;
    this.foreign = shown === 'other';
    // tornato da sé alla Session (il Session del Pro MK3): i fader non ci sono più
    if (shown === 'session' && this.layout !== 'session') {
      this.mode = 'none';
      this.layout = 'session';
    }
    // tornando dal layout suo il controller ha la griglia da ridisegnare
    this.sent.clear();
  }

  /** Il controller se ne va (o l'app si chiude): LED spenti e di nuovo nel suo modo. */
  stop(): void {
    this.stopped = true;
    this.darken();
    this.out(this.model.id === 'mk2' ? [...MK2_QUIT] : dawMode(this.model, false));
  }

  // ---------------------------------------------------------------- messaggi

  protected input(kind: number, channel: number, number: number, value: number): boolean {
    const note = kind === 0x90 || kind === 0x80;
    if (note || (kind === 0xb0 && channel === 0 && !this.isFader(number, channel))) {
      const pressed = kind !== 0x80 && value > 0;
      const scene = (note ? this.model.sceneKind === 'note' : this.model.sceneKind === 'cc') ? sceneAt(number) : null;
      if (note && scene === null) {
        const pad = padAt(number);
        if (pad && pressed) this.pad(pad.col, pad.row);
      } else if (scene !== null) {
        if (pressed) this.scene(scene);
      } else if (!note) {
        this.button(number, pressed);
      }
      return false;
    }
    if (kind === 0xb0 && this.isFader(number, channel)) {
      this.fader(number, value);
      return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- griglia e scene

  private pad(col: number, row: number): void {
    if (this.foreign || this.faders) return;
    if (this.overview) return this.jumpToBlock(col, row);
    const fn = this.gridFunction(row);
    if (fn) return this.trackFunction(fn, this.trackAt(col));
    this.launchPad(col, row);
  }

  /** La funzione di una riga della griglia, se non lancia clip: l'ultima riga di X e Mini nei
   *  modi stop, mute, solo; le righe del mixer del MK2. */
  private gridFunction(row: number): TrackMode | 'volumeReset' | 'panReset' | 'none' | null {
    const { id } = this.model;
    if (id === 'mk2' && this.mixer) return (['volumeReset', 'panReset', 'none', 'none', 'stop', 'mute', 'solo', 'none'] as const)[row];
    if ((id === 'x' || id === 'mini') && row === SIZE - 1 && isTrackMode(this.mode)) return this.mode;
    return null;
  }

  private trackFunction(fn: TrackMode | 'volumeReset' | 'panReset' | 'none', track: Track | undefined): void {
    if (!track) return;
    switch (fn) {
      case 'select': return this.selectOwner(track.id);
      case 'stop': return this.host.engine.stopTrack(track.id);
      case 'mute': return this.apply(setMixer(track.id, { mute: !track.mixer.mute }));
      case 'solo': return this.apply(setMixer(track.id, { solo: !track.mixer.solo }));
      case 'volumeReset': return this.apply(setMixer(track.id, { volumeDb: 0 }));
      case 'panReset': return this.apply(setMixer(track.id, { pan: 0 }));
    }
  }

  private scene(row: number): void {
    if (this.overview) return;
    const { id } = this.model;
    if (id === 'mini' && row === SIZE - 1) return this.cycleMiniMode();
    if (id === 'pro' && this.mode === 'device') {
      const dev = this.controlled();
      if (dev && row < dev.banks) this.setBank(row);
      return;
    }
    if ((id === 'x' || id === 'mk2') && this.mixer) return this.mixerColumn(row);
    this.launchScene(row);
  }

  /** X e MK2 nel mixer: i pulsanti a destra scelgono il modo (premuto di nuovo, lo lasciano). Sul
   *  MK2 gli ultimi quattro, fuori dai fader, fermano tutto e tolgono mute e solo a tutti. */
  private mixerColumn(row: number): void {
    const p = this.project, choice = MIXER_COLUMN[row];
    if (this.model.id === 'mk2' && row >= 4) {
      if (choice === 'stop') return this.host.engine.stopAllClips();
      if (choice === 'mute') return p.tracks.filter(t => t.mixer.mute).forEach(t => this.apply(setMixer(t.id, { mute: false })));
      if (choice === 'solo') return p.tracks.filter(t => t.mixer.solo).forEach(t => this.apply(setMixer(t.id, { solo: false })));
    }
    if (choice === 'sendA' || choice === 'sendB' || choice === 'arm') return this.notYet(choice);
    this.setMode(this.mode === choice ? 'none' : choice);
  }

  /** Mini MK3: Stop Solo Mute fa girare i modi dell'ultima riga, come in Live. */
  private cycleMiniMode(): void {
    const order: readonly Mode[] = ['none', 'stop', 'solo', 'mute'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  // ---------------------------------------------------------------- pulsanti

  private button(n: number, pressed: boolean): void {
    if (this.model.id === 'pro' && n >= TRACK_BUTTONS && n < TRACK_BUTTONS + SIZE) {
      if (pressed) this.trackFunction(isTrackMode(this.mode) ? this.mode : 'select', this.trackAt(n - TRACK_BUTTONS));
      return;
    }
    const b = this.buttonOf.get(n);
    if (!b) return;
    if (!pressed) return this.released(b);
    switch (b) {
      case 'up': case 'down': case 'left': case 'right': return this.arrow(b);
      case 'session': return this.sessionButton();
      case 'shift': this.shift = true; return;
      case 'mixer': return this.mk2Mixer();
      case 'play': return this.shift ? this.host.stopAndRewind() : this.host.togglePlay();
    }
    if (this.model.id === 'pro' && this.proMode(b)) return;
    const missing = NOT_YET[b];
    if (missing) this.notYet(b, missing);
  }

  private released(b: Button): void {
    if (b === 'shift') this.shift = false;
    // Pro MK3 e MK2: la mappa dei blocchi si vede finché si tiene Session
    if (b === 'session' && (this.model.id === 'pro' || this.model.id === 'mk2')) this.overview = false;
  }

  private notYet(b: Button | 'sendA' | 'sendB', what = NOT_YET[b]): void {
    if (what) this.host.say(`${this.label}: ${what} non c'è ancora in studiomio.`);
  }

  /** Le frecce spostano il riquadro di uno (di una pagina con Shift o sulla mappa dei blocchi);
   *  Pro MK3 con i parametri del dispositivo: ◂ ▸ cambiano dispositivo. */
  private arrow(b: 'up' | 'down' | 'left' | 'right'): void {
    if (this.model.id === 'pro' && this.mode === 'device') {
      if (b === 'left' || b === 'right') this.moveDevice(b === 'left' ? -1 : 1);
      return;
    }
    const step = this.overview || this.shift ? SIZE : 1;
    if (b === 'up') this.moveRing(0, -step);
    else if (b === 'down') this.moveRing(0, step);
    else if (b === 'left') this.moveRing(-step, 0);
    else this.moveRing(step, 0);
  }

  /** Session, come in Live. Se il controller mostra un layout suo, prima di tutto si torna alla
   *  Session. X: passa dal lancio al mixer e viceversa, il doppio clic apre la mappa dei blocchi
   *  (e una pressione la chiude). Mini MK3: doppio clic per la mappa. Pro MK3 e MK2: la mappa
   *  finché lo si tiene (MK2: e si torna dal mixer alla Session). */
  private sessionButton(): void {
    const now = this.now(), { id } = this.model;
    const double = now - this.sessionPressedAt < DOUBLE_CLICK_MS;
    this.sessionPressedAt = now;
    if (this.foreign) {
      this.foreign = false;
      this.layout = null;
      this.applyLayout();
      return;
    }
    if (id === 'pro' || id === 'mk2') {
      if (id === 'mk2') {
        this.mixer = false;
        this.setMode('none');
      }
      // la mappa sta sul layout Session: i fader se ne vanno
      if (this.faders) this.setMode('none');
      this.overview = true;
      return;
    }
    if (this.overview) {
      this.overview = false;
      this.sessionPressedAt = -Infinity;
      return;
    }
    if (id === 'x') {
      // il primo clic del doppio ha già cambiato modo: il secondo lo rimette, come in Live
      this.mixer = !this.mixer;
      if (!this.mixer) this.setMode('none');
    }
    if (double) {
      if (this.faders) this.setMode('none');
      this.overview = true;
    }
  }

  /** MK2: Mixer apre il mixer sulla griglia; premuto di nuovo, torna alla Session. */
  private mk2Mixer(): void {
    this.overview = false;
    this.mixer = !this.mixer || FADER_MODES.includes(this.mode);
    this.setMode('none');
  }

  /** Pro MK3: i pulsanti dei modi sotto la griglia (con Shift: annulla, ripeti, metronomo, tap
   *  tempo, come in Live). Vero se il pulsante l'ha gestito. */
  private proMode(b: Button): boolean {
    if (this.shift) {
      switch (b) {
        case 'arm': this.host.store.undo(); return true;
        case 'mute': this.host.store.redo(); return true;
        case 'solo': this.host.toggleMetronome(); return true;
        case 'sends': this.tap(); return true;
      }
      return false;
    }
    const mode: Partial<Record<Button, Mode>> = { mute: 'mute', solo: 'solo', stopClip: 'stop', volume: 'volume', pan: 'pan', device: 'device' };
    const m = mode[b];
    if (!m) return false;
    this.setMode(this.mode === m ? 'none' : m);
    if (m === 'device' && this.mode === 'device') this.announce();
    return true;
  }

  // ---------------------------------------------------------------- modi e layout

  private get faders(): boolean {
    return FADER_MODES.includes(this.mode);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    if (this.faders) this.overview = false;
    this.applyLayout();
  }

  /** Manda al controller il layout che serve (Session o una pagina di fader), se è cambiato. */
  private applyLayout(): void {
    if (!this.ready) return;
    const want: Layout = this.faders ? (this.mode as Layout) : 'session';
    if (this.layout === want) return;
    this.layout = want;
    // cambiando layout il controller ridisegna tutto: si rimanda ciò che serve
    this.sent.clear();
    const { model } = this;
    if (want !== 'session' && model.id !== 'mk2') this.out(faderSetup(model, FADER_PAGE[want], this.faderLook(want)));
    this.out(layoutMessage(model, want));
    if (want !== 'session' && model.id === 'mk2') {
      // il MK2 prende colore e posizione di ogni fader insieme, dopo il layout
      const look = this.faderLook(want), values = this.faderValues(want);
      for (let i = 0; i < SIZE; i++) {
        this.out(mk2Fader(i, want === 'pan', look.colors[i], values[i] ?? 0));
        if (values[i] !== undefined) this.sent.set(ccKey(faderCc(model, 0, i)), values[i]!);
      }
    }
  }

  /** Come sono i fader: volume verdi e verticali, pan orizzontali dal centro nel colore della
   *  traccia, parametri blu (come in Live); spenti dove non c'è niente da muovere. */
  private faderLook(layout: Layout): { horizontal: boolean; bipolar: boolean; colors: number[] } {
    const tracks = this.ringTracks();
    if (layout === 'device') {
      const dev = this.controlled();
      return { horizontal: false, bipolar: false, colors: tracks.map((_, i) => (dev?.params[i] ? COLOR.darkBlue : COLOR.off)) };
    }
    const pan = layout === 'pan';
    return { horizontal: pan, bipolar: pan, colors: tracks.map(t => (!t ? COLOR.off : pan ? paletteIndex(t.color) : COLOR.green)) };
  }

  /** La posizione di ogni fader (undefined dove non c'è niente da muovere). */
  private faderValues(layout: Layout): (number | undefined)[] {
    if (layout === 'device') {
      const dev = this.controlled();
      const values = dev ? resolveParams(dev.device.type, dev.device.settings.params) : {};
      return Array.from({ length: SIZE }, (_, i) => {
        const spec = dev?.params[i];
        return spec ? Math.round(paramToUnit(spec, values[spec.id]) * 127) : undefined;
      });
    }
    return this.ringTracks().map(t => (!t ? undefined : layout === 'pan' ? panToKnob(t.mixer.pan) : dbToFader(t.mixer.volumeDb)));
  }

  // ---------------------------------------------------------------- fader

  private isFader(cc: number, channel: number): boolean {
    if (!this.faders) return false;
    const { model } = this;
    const page = model.id === 'pro' ? FADER_PAGE[this.mode as Layout] : 0;
    const first = faderCc(model, page, 0);
    return channel === (model.id === 'mk2' ? 0 : FADER_CHANNEL) && cc >= first && cc < first + SIZE;
  }

  private fader(cc: number, value: number): void {
    const { model } = this;
    const page = model.id === 'pro' ? FADER_PAGE[this.mode as Layout] : 0;
    const i = cc - faderCc(model, page, 0);
    this.touch(ccKey(cc, model.id === 'mk2' ? 0 : FADER_CHANNEL), value);
    if (this.mode === 'device') return this.turnParam(i, value / 127);
    const track = this.trackAt(i);
    if (!track) return;
    if (this.mode === 'volume') this.later(`vol-${track.id}`, () => this.move(setMixer(track.id, { volumeDb: faderToDb(value) }), `lp-vol-${track.id}`));
    else this.later(`pan-${track.id}`, () => this.move(setMixer(track.id, { pan: knobToPan(value) }), `lp-pan-${track.id}`));
  }

  // ---------------------------------------------------------------- LED

  protected ledMessages(status: number, number: number, value: number): number[][] {
    return ledMessages(status, number, value);
  }

  /** Il pulsante Session di X e Mini MK3 ha i suoi due colori, mandati con un SysEx. */
  protected override send(key: string, value: number): void {
    if (key !== SESSION_KEY) return super.send(key, value);
    this.out(sessionColor(this.model, value >> 7, value & 0x7f));
    this.sent.set(key, value);
  }

  protected leds(): Map<string, number> {
    const { model } = this;
    const leds = new Map<string, number>();
    const tracks = this.ringTracks();
    const button = (b: Button, color: number) => {
      const n = model.buttons[b];
      if (n !== undefined) leds.set(ccKey(n), color);
    };
    const sceneKey = (row: number) => (model.sceneKind === 'cc' ? ccKey(sceneButton(row)) : noteKey(sceneButton(row)));

    // la griglia: i fader li disegna il controller, il resto lo si accende da qui
    if (this.faders) {
      const values = this.faderValues(this.mode as Layout), look = this.faderLook(this.mode as Layout);
      const page = model.id === 'pro' ? FADER_PAGE[this.mode as Layout] : 0;
      for (let i = 0; i < SIZE; i++) {
        const cc = faderCc(model, page, i);
        if (model.id === 'mk2') {
          if (values[i] !== undefined) leds.set(ccKey(cc), values[i]!);
          continue;
        }
        leds.set(ccKey(cc, FADER_CHANNEL), values[i] ?? 0);
        leds.set(ccKey(cc, FADER_COLOR_CHANNEL), look.colors[i]);
      }
    } else {
      for (let row = 0; row < SIZE; row++) {
        const fn = this.overview ? null : this.gridFunction(row);
        for (let col = 0; col < SIZE; col++) {
          leds.set(noteKey(padNote(col, row)), this.overview ? blockColor(this.blockLight(col, row))
            : fn ? functionColor(fn, tracks[col], this.host.ui.track, this.stopLight(tracks[col]))
              : padColor(this.slotLight(tracks[col], this.ring.scene + row)));
        }
      }
    }

    // la colonna a destra
    for (let row = 0; row < SIZE; row++) leds.set(sceneKey(row), this.sceneColor(row));

    // navigazione
    const nav = (b: 'up' | 'down' | 'left' | 'right') => button(b, this.overview || this.canMove(b) ? COLOR.whiteHalf : COLOR.off);
    if (model.id === 'pro' && this.mode === 'device') {
      const dev = this.controlled();
      button('up', COLOR.off);
      button('down', COLOR.off);
      button('left', dev && dev.index > 0 ? COLOR.darkBlueHalf : COLOR.off);
      button('right', dev && dev.index < dev.chain.length - 1 ? COLOR.darkBlueHalf : COLOR.off);
    } else {
      nav('up'); nav('down'); nav('left'); nav('right');
    }

    // il pulsante Session: X e Mini col SysEx, gli altri con il loro LED
    if (model.id === 'x' || model.id === 'mini') {
      const [active, inactive] = this.overview ? [COLOR.blue, COLOR.whiteHalf] : this.mixer ? [COLOR.cream, COLOR.whiteHalf] : [COLOR.paleGreenHalf, COLOR.whiteHalf];
      leds.set(SESSION_KEY, active * 128 + inactive);
    } else if (model.id === 'mk2') {
      button('session', this.mixer ? COLOR.whiteHalf : COLOR.paleGreenHalf);
      button('mixer', this.mixer ? COLOR.cream : COLOR.whiteHalf);
      button('user1', COLOR.off);
      button('user2', COLOR.off);
    }

    if (model.id === 'x') button('captureMidi', COLOR.off);
    if (model.id === 'pro') this.proLeds(leds, button, tracks);

    // la mano blu: solo il Pro MK3, con i parametri del dispositivo sui fader
    const dev = model.id === 'pro' && this.mode === 'device' ? this.controlled() : null;
    this.host.ui.setControlledDevice(dev ? { owner: dev.owner, device: dev.device.key } : null);
    return leds;
  }

  /** Un pulsante della colonna a destra. */
  private sceneColor(row: number): number {
    const { id } = this.model;
    if (this.overview) return COLOR.off;
    if (id === 'mini' && row === SIZE - 1) return this.mode === 'none' ? COLOR.whiteHalf : MODE_COLOR[this.mode as Exclude<Mode, 'none'>];
    if (id === 'pro' && this.mode === 'device') {
      const dev = this.controlled();
      return !dev || row >= dev.banks ? COLOR.off : row === dev.bank ? COLOR.darkBlue : COLOR.whiteHalf;
    }
    if ((id === 'x' || id === 'mk2') && this.mixer) {
      const choice = MIXER_COLUMN[row];
      if (id === 'mk2' && row >= 4) {
        const p = this.project, playing = p.tracks.some(t => this.host.engine.sessionState(t).playing);
        if (choice === 'stop') return playing ? COLOR.red : COLOR.redHalf;
        if (choice === 'mute') return p.tracks.some(t => t.mixer.mute) ? COLOR.yellow : COLOR.yellowHalf;
        if (choice === 'solo') return p.tracks.some(t => t.mixer.solo) ? COLOR.blue : COLOR.blueHalf;
      }
      if (choice === 'sendA' || choice === 'sendB' || choice === 'arm') return COLOR.off;
      return this.mode === choice ? MODE_COLOR[choice as Exclude<Mode, 'none'>] : COLOR.whiteHalf;
    }
    const s = this.sceneLight(row);
    return s === 'queued' ? blink(COLOR.green) : s === 'off' ? COLOR.off : s.color ? paletteIndex(s.color) : COLOR.green;
  }

  /** Pro MK3: la riga delle tracce, i modi, il trasporto. */
  private proLeds(leds: Map<string, number>, button: (b: Button, color: number) => void, tracks: (Track | undefined)[]): void {
    const fn: TrackMode = isTrackMode(this.mode) ? this.mode : 'select';
    tracks.forEach((t, c) => leds.set(ccKey(TRACK_BUTTONS + c), functionColor(fn, t, this.host.ui.track, this.stopLight(t))));
    const lit = (m: Exclude<Mode, 'none'>) => (this.mode === m ? MODE_COLOR[m] : COLOR.whiteHalf);
    button('arm', COLOR.off);
    button('mute', lit('mute'));
    button('solo', lit('solo'));
    button('volume', lit('volume'));
    button('pan', lit('pan'));
    button('sends', COLOR.off);
    button('device', lit('device'));
    button('stopClip', lit('stop'));
    button('shift', COLOR.whiteHalf);
    button('play', this.host.engine.playing ? COLOR.green : COLOR.whiteHalf);
    for (const b of ['record', 'clear', 'duplicate', 'quantize', 'fixedLength'] as const) button(b, COLOR.off);
  }

  /** Lo stato dei modi, per i messaggi e il report. */
  get state(): string {
    return [this.overview && 'mappa dei blocchi', this.mixer && 'mixer', this.mode !== 'none' && this.mode, this.foreign && 'layout del controller']
      .filter(Boolean).join(', ') || 'session';
  }
}

const SESSION_KEY = 's:session';

const isTrackMode = (m: Mode): m is 'stop' | 'mute' | 'solo' => m === 'stop' || m === 'mute' || m === 'solo';

/** Il pad di uno slot, come in Live sui Launchpad: la clip che suona pulsa verde, quella in coda
 *  lampeggia verde, le altre hanno il loro colore, gli slot vuoti sono spenti. */
function padColor(light: SlotLight): number {
  if (light === 'queued') return blink(COLOR.green);
  if (light === 'playing') return pulse(COLOR.green);
  return light === 'off' ? COLOR.off : paletteIndex(light.clip);
}

/** La mappa dei blocchi, come in Live: bianco il riquadro, verde che pulsa se qualcosa suona,
 *  azzurro se ci sono clip, spento se è vuoto. */
function blockColor(light: BlockLight): number {
  switch (light) {
    case 'off': case 'empty': return COLOR.off;
    case 'ring': return COLOR.offWhite;
    case 'playing': return pulse(COLOR.green);
    case 'clips': return COLOR.lightBlueHalf;
  }
}

/** Il pulsante di una traccia in una funzione, coi colori di Live: stop rosso (lampeggia se lo stop
 *  è in coda, tenue se è ferma), mute giallo acceso se la traccia suona, solo blu, scelta bianca. */
function functionColor(fn: TrackMode | 'volumeReset' | 'panReset' | 'none', t: Track | undefined, selected: string | null, stop: 'off' | 'playing' | 'queued'): number {
  if (!t) return COLOR.off;
  switch (fn) {
    case 'select': return t.id === selected ? COLOR.white : COLOR.whiteHalf;
    case 'stop': return stop === 'queued' ? blink(COLOR.red) : stop === 'playing' ? COLOR.red : COLOR.redHalf;
    case 'mute': return t.mixer.mute ? COLOR.yellowHalf : COLOR.yellow;
    case 'solo': return t.mixer.solo ? COLOR.blue : COLOR.blueHalf;
    case 'volumeReset': return COLOR.greenHalf;
    case 'panReset': return COLOR.orangeHalf;
    case 'none': return COLOR.off;
  }
}
