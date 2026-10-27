/* L'APC40 mkII sulla session, come in Live: la griglia 8×5 lancia le clip del riquadro rosso
 * (le frecce lo spostano), i pulsanti di scena lanciano le righe, sotto ci sono stop, selezione,
 * mute (activator) e solo di ogni traccia, i fader e il master; le manopole in alto fanno il pan,
 * le 8 manopole "Device Control" muovono i parametri del dispositivo scelto (la "mano blu"),
 * a banchi di 8. I LED li decide il programma, a ogni giro: colore delle clip, verde per quella
 * che suona, lampeggio per quella in coda (lo fa il controller); si manda solo ciò che cambia.
 * Il controller non conosce Web MIDI: riceve i messaggi con `receive` e manda con `out`. */
import type { DeviceId, TrackId } from '../../core/id';
import { MASTER } from '../../model/project';
import { slotRef, type ClipRef } from '../../store/clip-ref';
import { setEffectEnabled, setMasterMixer, setMixer } from '../../store/edits';
import {
  bipolar, ccKey, noteKey, PARAMS_PER_BANK, SessionSurface, SETTLE_MS, type BlockLight, type SlotLight,
} from '../session-surface';
import {
  CC, COLOR, dongleChallenge, faderToDb, IDENTITY_REQUEST, identityDeviceId, introduction, isDongleResponse, knobToPan, ledMessages,
  MODE, NOTE, ON, padAt, padNote, paletteIndex, panToKnob, PULSING, relative, RING, SCENES, STOP_LED, TRACKS, TRIGGERED,
} from './protocol';

export { INSTRUMENT_KEY, type DetailView, type SurfaceEngine, type SurfaceHost } from '../session-surface';

/** Messaggi al massimo per giro: l'APC40 mkII elabora il MIDI lentamente, a raffiche si
 *  blocca. Ciò che avanza parte al giro dopo. */
const MAX_SEND = 32;
/** Quanto si aspetta ogni risposta dell'avvio (identità, challenge) prima di andare avanti lo stesso. */
const HANDSHAKE_MS = 1000;
/** Live manda la challenge due dei suoi giri (100 ms) dopo la presentazione. */
const CHALLENGE_DELAY_MS = 200;
/** Dopo quanto si rimandano gli anelli delle manopole Device a un dispositivo appena scelto: il
 *  controller può perdere quelli mandati subito (si spengono, finché il valore non cambia). */
const RINGS_AGAIN_MS = 250;

/** L'avvio, come in Live: si chiede l'identità, ci si presenta, si fa la challenge, poi si lavora. */
type Phase = 'identity' | 'challenge' | 'ready';

const NOT_YET: Readonly<Record<number, string>> = {
  [NOTE.recordArm]: 'Record arm', [NOTE.record]: 'La registrazione', [NOTE.session]: 'La registrazione nella session',
  [NOTE.crossfadeAssign]: 'Il crossfader', [NOTE.sends]: 'Le mandate', [NOTE.user]: 'Il modo User',
  [NOTE.nudgeMinus]: 'Il nudge', [NOTE.nudgePlus]: 'Il nudge',
};

export class Apc40 extends SessionSurface {
  protected readonly label = 'APC40';
  protected readonly mergePrefix = 'apc';
  protected readonly width = TRACKS;
  protected readonly height = SCENES;
  protected readonly maxSend = MAX_SEND;
  private tempoSteps = 0;
  private bankMode = false;
  /** Spento: alle manopole non si manda niente (né valori né tipo dell'anello). Per capire se
   *  un controller si blocca per i messaggi delle manopole. */
  knobFeedback = true;
  private phase: Phase = 'identity';
  private phaseAt = 0;
  private challengeSent = false;
  /** Il device ID del controller, dalla sua risposta d'identità (Live fa lo stesso). */
  private device = 0;
  /** Il dispositivo (e banco) delle manopole Device l'ultima volta, e quando rimandarne gli anelli. */
  private ringsOf = '';
  private ringsAgainAt = Infinity;

  /** Il controller è appena stato collegato: gli si chiede chi è (vedi `handshake`). */
  start(): void {
    this.stopped = false;
    this.sent.clear();
    this.touched.clear();
    this.ringsOf = '';
    this.phase = 'identity';
    this.phaseAt = this.now();
    this.out([...IDENTITY_REQUEST]);
  }

  get ready(): boolean {
    return this.phase === 'ready';
  }

  /** Avanza l'avvio: presentazione (Ableton mode) col device ID avuto, challenge, poi i LED. Se
   *  una risposta non arriva si va avanti lo stesso. */
  protected handshake(data: ArrayLike<number> | null): void {
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
    this.darken();
    this.out(introduction(MODE.generic, this.device));
  }

  protected input(kind: number, channel: number, number: number, value: number): boolean {
    if (kind === 0x90 && value > 0) this.press(number, channel);
    else if (kind === 0x80 || kind === 0x90) this.release(number);
    else if (kind === 0xb0) this.control(number, channel, value);
    return kind !== 0x80 && kind !== 0x90;
  }

  // ---------------------------------------------------------------- pulsanti

  private press(note: number, channel: number): void {
    const { engine } = this.host;
    const pad = padAt(note);
    if (pad) return this.shift ? this.jumpToBlock(pad.col, pad.row) : this.launchPad(pad.col, pad.row);
    if (note >= NOTE.sceneLaunch && note < NOTE.sceneLaunch + SCENES) return this.launchScene(note - NOTE.sceneLaunch);
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
    // scelta una traccia (o il master), gli anelli si rimandano anche dopo il rilascio
    if (note === NOTE.trackSelect || note === NOTE.master) this.ringsAgainAt = this.now() + RINGS_AGAIN_MS;
  }

  /** Con Shift (o con Bank acceso) le frecce spostano il riquadro di una pagina intera. */
  private step(page: number): number {
    return this.shift || this.bankMode ? page : 1;
  }

  // ---------------------------------------------------------------- dispositivi

  private moveBank(delta: number): void {
    const c = this.controlled();
    if (c) this.setBank(c.bank + delta);
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

  // ---------------------------------------------------------------- controlli continui

  private control(cc: number, channel: number, value: number): void {
    if (cc === CC.tempo) {
      this.tempoSteps += relative(value) * (this.shift ? 0.1 : 1);
      this.later('tempo', () => {
        const steps = this.tempoSteps;
        this.tempoSteps = 0;
        if (steps) this.setBpm(this.project.tempo.bpm + steps, 'apc-tempo');
      });
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
      this.touch(ccKey(cc), value);
      if (track) this.later(`pan-${track.id}`, () => this.move(setMixer(track.id, { pan: knobToPan(value) }), `apc-pan-${track.id}`));
    } else if (cc >= CC.deviceKnob && cc < CC.deviceKnob + PARAMS_PER_BANK) {
      this.touch(ccKey(cc), value);
      this.turnParam(cc - CC.deviceKnob, value / 127);
    }
    // crossfader e livello del cue: studiomio non li ha ancora
  }

  // ---------------------------------------------------------------- LED

  protected override muted(key: string): boolean {
    return !this.knobFeedback && key.startsWith('c:');
  }

  protected ledMessages(status: number, number: number, value: number): number[][] {
    return ledMessages(status, number, value);
  }

  protected leds(): Map<string, number> {
    const { ui, engine } = this.host;
    const p = this.project;
    const ring = this.ring;
    const leds = new Map<string, number>();
    // acceso = 127 come in Live; i lampeggi li fa il controller (niente traffico a tempo da qui)
    const note = (n: number, v: number | boolean, channel = 0) => leds.set(noteKey(n, channel), typeof v === 'boolean' ? (v ? ON : 0) : v);
    const tracks = this.ringTracks();

    // la griglia
    for (let row = 0; row < SCENES; row++) {
      for (let col = 0; col < TRACKS; col++) {
        note(padNote(col, row), this.shift ? overviewColor(this.blockLight(col, row)) : padColor(this.slotLight(tracks[col], ring.scene + row)));
      }
    }
    // scene (pulsanti RGB): se la riga ha clip, del colore della scena (verdi se non ne ha);
    // lampeggiano se qualcosa della riga è in coda, pulsano verdi se suonano tutte le sue clip
    for (let i = 0; i < SCENES; i++) {
      const s = this.sceneLight(i);
      note(NOTE.sceneLaunch + i, s === 'queued' ? TRIGGERED(COLOR.green) : s === 'playing' ? PULSING(COLOR.green) : s === 'off' ? COLOR.off : s.color ? paletteIndex(s.color) : COLOR.green);
    }
    // per traccia
    tracks.forEach((t, c) => {
      const stop = this.stopLight(t);
      note(NOTE.clipStop, stop === 'queued' ? STOP_LED.blink : stop === 'playing' ? STOP_LED.on : STOP_LED.off, c);
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
    note(NOTE.up, this.canMove('up'));
    note(NOTE.down, this.canMove('down'));
    note(NOTE.left, this.canMove('left'));
    note(NOTE.right, this.canMove('right'));
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
    this.ringsAgain(dev ? `${dev.owner}/${dev.device.key}/${dev.bank}` : '');
    for (let i = 0; i < PARAMS_PER_BANK; i++) {
      const spec = dev?.params[i];
      leds.set(ccKey(CC.deviceRing + i), spec ? (bipolar(spec) ? RING.pan : RING.volume) : RING.off);
      leds.set(ccKey(CC.deviceKnob + i), dev && spec ? Math.round(this.heardUnit(dev, spec) * 127) : 0);
    }
    note(NOTE.deviceLeft, !!dev && dev.index > 0);
    note(NOTE.deviceRight, !!dev && dev.index < dev.chain.length - 1);
    note(NOTE.bankLeft, !!dev && dev.bank > 0);
    note(NOTE.bankRight, !!dev && dev.bank < dev.banks - 1);
    note(NOTE.deviceOnOff, !!dev && dev.device.enabled !== false);
    note(NOTE.deviceLock, this.locked !== null);
    note(NOTE.clipDeviceView, this.host.detail === 'devices');
    note(NOTE.detailView, this.host.detail !== null);
    return leds;
  }

  /** Cambiato il dispositivo delle manopole (`shown`), poco dopo i suoi anelli (tipo e valore) si
   *  rimandano tutti, anche quelli che non sono cambiati: l'APC40 può aver perso i primi, e un
   *  anello perso resterebbe spento finché il suo valore non cambia. */
  private ringsAgain(shown: string): void {
    if (shown !== this.ringsOf) {
      this.ringsOf = shown;
      this.ringsAgainAt = this.now() + RINGS_AGAIN_MS;
    } else if (this.now() >= this.ringsAgainAt) {
      this.ringsAgainAt = Infinity;
      for (let i = 0; i < PARAMS_PER_BANK; i++) {
        this.sent.delete(ccKey(CC.deviceRing + i));
        this.sent.delete(ccKey(CC.deviceKnob + i));
      }
    }
  }
}

/** Il pad di uno slot, come in Live: quella che suona è verde fisso, quella in coda lampeggia
 *  verde, le altre clip hanno il loro colore, gli slot vuoti sono spenti. */
function padColor(light: SlotLight): number {
  if (light === 'queued') return TRIGGERED(COLOR.green);
  if (light === 'playing') return COLOR.green;
  return light === 'off' ? COLOR.off : paletteIndex(light.clip);
}

/** Shift tenuto: la mappa dei blocchi. Bianco dov'è il riquadro, verde se qualcosa suona,
 *  ambra se ci sono clip, appena acceso se è vuoto. */
function overviewColor(light: BlockLight): number {
  switch (light) {
    case 'off': return COLOR.off;
    case 'ring': return COLOR.white;
    case 'playing': return COLOR.green;
    case 'clips': return COLOR.amber;
    case 'empty': return COLOR.dim;
  }
}
