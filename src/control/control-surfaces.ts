/* I controller MIDI collegati al computer: per ora l'Akai APC40 mkII, riconosciuto dal nome
 * della porta. Basta collegarlo (anche ad app aperta): lo si mette in Ableton mode e lo si lega
 * alla session, senza mappature da fare. Web MIDI con il SysEx c'è in Chrome ed Edge: la prima
 * volta il browser chiede il permesso (pulsante 🎛), poi all'avvio si collega da solo. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import { Apc40, type SurfaceHost } from './apc40/apc40';
import { PORT_NAME } from './apc40/protocol';
import { IDENTITY_REQUEST, Liveness } from './liveness';

/** Ogni quanto si aggiornano i LED (lampeggi a tempo) e si applicano fader e manopole. */
const TICK_MS = 30;
/** Ogni quanto si controlla che il controller parli ancora. */
const WATCH_MS = 500;
/** Quante volte si riaprono le porte di un controller muto prima di arrendersi. */
const MAX_REVIVALS = 2;

type SurfaceEvents = { change: [] };

interface Connection {
  readonly controller: Apc40;
  /** Tutte le porte d'ingresso col nome del controller: su Windows (soprattutto con il nuovo
   *  stack MIDI) lo stesso apparecchio può comparire con più porte, e non si sa quale parla. */
  readonly inputs: readonly MIDIInput[];
  readonly output: MIDIOutput;
  /** Gli id delle porte, per capire se sono cambiate. */
  readonly ports: string;
  readonly liveness: Liveness;
  readonly stopTimers: () => void;
}

/** Un messaggio MIDI in esadecimale, per il monitor. */
const hex = (data: ArrayLike<number>) => Array.from(data, b => b.toString(16).padStart(2, '0')).join(' ');

export class ControlSurfaces {
  private access: MIDIAccess | null = null;
  private apc: Connection | null = null;
  private connecting = false;
  /** Porte cambiate mentre ci si collegava: si ricontrolla alla fine. */
  private rescan = false;
  /** Monitor MIDI: dalla console, `studiomio.surfaces.log = true` stampa ogni messaggio. */
  log = false;
  private feedback = true;
  /** Dalla console, `studiomio.surfaces.watchdog = true`: dopo un po' di silenzio si chiede al
   *  controller chi è, per accorgersi se si è bloccato. Spento di serie: Live non lo fa, e un
   *  APC40 mkII alimentato solo dall'USB si è bloccato anche con queste sole richieste. */
  watchdog = false;
  /** Volte di fila in cui si sono riaperte le porte perché il controller non rispondeva. */
  private revivals = 0;
  private gaveUp = false;
  /** Il controller ha già risposto alla richiesta d'identità (vale anche dopo aver riaperto le porte). */
  private answersIdentity = false;
  private readonly events = new Emitter<SurfaceEvents>();

  constructor(private readonly host: SurfaceHost) {}

  /** Vero se il browser ha Web MIDI. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get enabled(): boolean {
    return this.access !== null;
  }

  /** Il nome del controller collegato, o null. */
  get connected(): string | null {
    return this.apc ? this.apc.output.name ?? 'APC40 mkII' : null;
  }

  /** Dalla console, `studiomio.surfaces.knobFeedback = false`: alle manopole non si manda più
   *  niente (anelli di LED fermi). Per capire se è quel traffico a bloccare il controller. */
  get knobFeedback(): boolean {
    return this.feedback;
  }

  set knobFeedback(on: boolean) {
    this.feedback = on;
    if (this.apc) this.apc.controller.knobFeedback = on;
  }

  /** Le porte MIDI che il browser vede (per capire cosa non va dalla console). */
  ports(): { input: string[]; output: string[] } {
    const list = (ports: Iterable<MIDIPort>) => [...ports].map(p => `${p.name} [${p.id}] ${p.state}/${p.connection}`);
    return { input: list(this.access?.inputs.values() ?? []), output: list(this.access?.outputs.values() ?? []) };
  }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** All'avvio: se il permesso c'è già, si collega senza chiedere niente. */
  async autoStart(): Promise<void> {
    if (!this.supported || !navigator.permissions) return;
    try {
      const status = await navigator.permissions.query({ name: 'midi', sysex: true } as PermissionDescriptor);
      if (status.state === 'granted') await this.enable();
    } catch {
      // il browser non sa dire se c'è il permesso: si aspetta il pulsante
    }
  }

  /** Chiede l'accesso al MIDI (con il SysEx, per accendere l'Ableton mode) e cerca i controller. */
  async enable(): Promise<void> {
    if (!this.supported) throw new Error('questo browser non ha Web MIDI: per i controller serve Chrome o Edge');
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => void this.scan();
      // chiudendo la pagina il controller torna in modo generico, con i LED spenti
      window.addEventListener('pagehide', () => this.disconnect());
    }
    await this.scan();
    if (!this.apc) this.host.say('Controller: nessun APC40 mkII collegato. Collegalo quando vuoi, si attiva da solo.');
    this.events.emit('change');
  }

  /** Porte cambiate (un controller collegato o staccato): si collega o si scollega. */
  private async scan(): Promise<void> {
    const access = this.access;
    if (!access) return;
    if (this.connecting) {
      this.rescan = true;
      return;
    }
    const matching = <P extends MIDIPort>(ports: Iterable<P>) =>
      [...ports].filter(p => p.state === 'connected' && PORT_NAME.test(p.name ?? ''));
    const inputs = matching(access.inputs.values()), output = matching(access.outputs.values())[0];
    const ports = [output?.id, ...inputs.map(p => p.id)].join('|');
    if (this.apc?.ports === ports) return;
    if (this.apc) this.disconnect();
    if (!inputs.length || !output) return;
    this.connecting = true;
    try {
      await output.open();
      const controller = new Apc40(this.host, data => {
        if (this.log) console.log(`MIDI → ${hex(data)}`);
        try { output.send(data); } catch { /* staccato proprio adesso */ }
      });
      // si ascoltano tutte le porte d'ingresso dell'APC; una occupata da un altro programma non blocca le altre
      const liveness = new Liveness(performance.now(), this.answersIdentity);
      const opened: MIDIInput[] = [];
      for (const input of inputs) {
        try {
          await input.open();
          input.onmidimessage = e => {
            if (!e.data) return;
            if (this.log) console.log(`MIDI ← ${input.name} [${input.id}]: ${hex(e.data)}`);
            liveness.heard(performance.now(), e.data);
            this.recovered();
            controller.receive(e.data);
          };
          opened.push(input);
        } catch (e) {
          console.warn(`Controller: non riesco ad aprire l'ingresso ${input.name} [${input.id}]`, e);
        }
      }
      if (!opened.length) throw new Error("nessuna porta d'ingresso si apre");
      controller.knobFeedback = this.feedback;
      const tick = setInterval(() => controller.tick(), TICK_MS);
      const watch = setInterval(() => this.watch(connection), WATCH_MS);
      const connection: Connection = {
        controller, inputs: opened, output, ports, liveness,
        stopTimers: () => { clearInterval(tick); clearInterval(watch); },
      };
      this.apc = connection;
      controller.start(); // chiede l'identità: la risposta fa partire l'avvio (e dice che il controller la conosce)
      console.info('Controller collegato', { output: `${output.name} [${output.id}]`, inputs: opened.map(p => `${p.name} [${p.id}]`) });
      if (!this.revivals) this.host.say(`${output.name ?? 'APC40 mkII'} collegato: la griglia suona il riquadro rosso della session.`);
    } catch (e) {
      this.host.say(`Controller: non riesco ad aprire ${output.name ?? "l'APC40"} (lo sta usando un altro programma?). ${e instanceof Error ? e.message : ''}`);
    } finally {
      this.connecting = false;
      this.events.emit('change');
    }
    if (this.rescan) {
      this.rescan = false;
      await this.scan();
    }
  }

  private disconnect(): void {
    const c = this.apc;
    if (!c) return;
    this.drop(c);
    c.controller.stop();
    this.host.say('APC40 scollegato.');
    this.events.emit('change');
  }

  /** Smette di ascoltare e di aggiornare il controller (senza mandargli niente). */
  private drop(c: Connection): void {
    if (this.apc === c) this.apc = null;
    this.answersIdentity ||= c.liveness.watching;
    c.stopTimers();
    for (const input of c.inputs) input.onmidimessage = null;
  }

  /** Il controller parla ancora? Se non risponde più, si chiudono e riaprono le porte: se era
   *  il collegamento MIDI a essersi incantato basta questo; se è il controller, va riacceso. */
  private watch(c: Connection): void {
    if (!this.watchdog) return;
    const action = c.liveness.check(performance.now());
    if (action === 'ping') {
      if (this.log) console.log(`MIDI → ${hex(IDENTITY_REQUEST)} (richiesta d'identità)`);
      try { c.output.send(IDENTITY_REQUEST); } catch { /* staccato */ }
      return;
    }
    if (action !== 'silent' || this.gaveUp) return;
    if (this.revivals >= MAX_REVIVALS) {
      this.gaveUp = true;
      console.warn(`Controller: ${c.output.name} non risponde nemmeno riaprendo le porte`);
      this.host.say(`${c.output.name ?? "L'APC40"} non risponde più: spegnilo e riaccendilo, si ricollega da solo.`);
      return;
    }
    this.revivals++;
    console.warn(`Controller: ${c.output.name} non risponde, riapro le porte (tentativo ${this.revivals})`);
    void this.reopen(c);
  }

  private async reopen(c: Connection): Promise<void> {
    this.drop(c);
    await Promise.allSettled([...c.inputs.map(p => p.close()), c.output.close()]);
    await this.scan();
  }

  /** È arrivato qualcosa: se il controller era muto, è tornato. */
  private recovered(): void {
    if (!this.revivals && !this.gaveUp) return;
    console.info(`Controller: risponde di nuovo (dopo ${this.revivals} riaperture delle porte)`);
    this.host.say(`${this.apc?.output.name ?? 'APC40'} ripreso.`);
    this.revivals = 0;
    this.gaveUp = false;
  }
}
