/* I controller MIDI collegati al computer: per ora l'Akai APC40 mkII, riconosciuto dal nome
 * della porta. Basta collegarlo (anche ad app aperta): lo si mette in Ableton mode e lo si lega
 * alla session, senza mappature da fare. Web MIDI con il SysEx c'è in Chrome ed Edge: la prima
 * volta il browser chiede il permesso (pulsante 🎛), poi all'avvio si collega da solo. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import { Apc40, type SurfaceHost } from './apc40/apc40';
import { PORT_NAME } from './apc40/protocol';

/** Ogni quanto si aggiornano i LED (lampeggi a tempo) e si applicano fader e manopole. */
const TICK_MS = 30;

type SurfaceEvents = { change: [] };

interface Connection {
  readonly controller: Apc40;
  /** Tutte le porte d'ingresso col nome del controller: su Windows (soprattutto con il nuovo
   *  stack MIDI) lo stesso apparecchio può comparire con più porte, e non si sa quale parla. */
  readonly inputs: readonly MIDIInput[];
  readonly output: MIDIOutput;
  /** Gli id delle porte, per capire se sono cambiate. */
  readonly ports: string;
  readonly stopTimer: () => void;
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
      const opened: MIDIInput[] = [];
      for (const input of inputs) {
        try {
          await input.open();
          input.onmidimessage = e => {
            if (!e.data) return;
            if (this.log) console.log(`MIDI ← ${input.name} [${input.id}]: ${hex(e.data)}`);
            controller.receive(e.data);
          };
          opened.push(input);
        } catch (e) {
          console.warn(`Controller: non riesco ad aprire l'ingresso ${input.name} [${input.id}]`, e);
        }
      }
      if (!opened.length) throw new Error("nessuna porta d'ingresso si apre");
      const id = setInterval(() => controller.tick(), TICK_MS);
      this.apc = { controller, inputs: opened, output, ports, stopTimer: () => clearInterval(id) };
      controller.start();
      console.info('Controller collegato', { output: `${output.name} [${output.id}]`, inputs: opened.map(p => `${p.name} [${p.id}]`) });
      this.host.say(`${output.name ?? 'APC40 mkII'} collegato: la griglia suona il riquadro rosso della session.`);
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
    this.apc = null;
    c.stopTimer();
    for (const input of c.inputs) input.onmidimessage = null;
    c.controller.stop();
    this.host.say('APC40 scollegato.');
    this.events.emit('change');
  }
}
