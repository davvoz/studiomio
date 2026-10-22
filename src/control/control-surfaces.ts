/* I controller MIDI collegati al computer: l'Akai APC40 mkII e i Novation Launchpad (X, Mini
 * MK3, Pro MK3, MK2), riconosciuti dal nome delle porte. Basta collegarli (anche ad app aperta):
 * li si mette nel modo per i programmi (Ableton mode, DAW mode) e li si lega alla session, senza
 * mappature da fare. Uno alla volta: se ce ne sono due, vince il primo dell'elenco. Web MIDI con
 * il SysEx c'è in Chrome ed Edge: la prima volta il browser chiede il permesso (pulsante 🎛),
 * poi all'avvio si collega da solo. Le altre porte d'ingresso (un controller qualsiasi, una
 * tastiera) vanno alle mappature MIDI (vedi app/midi-mapper), ma si aprono solo se servono. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import { Apc40 } from './apc40/apc40';
import { PORT_NAME } from './apc40/protocol';
import { Launchpad } from './launchpad/launchpad';
import { ANY_LAUNCHPAD, dawPort, modelOfPort, MODELS, portInterface, type Model } from './launchpad/protocol';
import { IDENTITY_REQUEST, Liveness } from './liveness';
import type { SessionSurface, SurfaceHost } from './session-surface';

/** Ogni quanto si aggiornano i LED e si applicano fader e manopole. */
const TICK_MS = 30;
/** Ogni quanto si controlla che il controller parli ancora. */
const WATCH_MS = 500;
/** Quante volte si riaprono le porte di un controller muto prima di arrendersi. */
const MAX_REVIVALS = 2;
/** Quanti messaggi MIDI tiene il registro per il report. */
const HISTORY = 400;

type SurfaceEvents = { change: []; midi: [data: Uint8Array] };

/** Un tipo di controller: come lo si riconosce, a quali porte si parla, chi lo guida. */
interface Driver {
  readonly name: string;
  /** Le porte del controller (su Windows lo stesso apparecchio può averne più d'una). */
  readonly port: RegExp;
  /** Fra le porte col suo nome: l'uscita a cui si parla e gli ingressi da cui si ascolta. */
  pick(inputs: MIDIInput[], outputs: MIDIOutput[]): { output?: MIDIOutput; inputs: MIDIInput[] };
  create(host: SurfaceHost, out: (data: number[]) => void): SessionSurface;
}

const apcDriver: Driver = {
  name: 'APC40 mkII',
  port: PORT_NAME,
  // non si sa quale porta d'ingresso parla: si ascoltano tutte
  pick: (inputs, outputs) => ({ output: outputs[0], inputs }),
  create: (host, out) => new Apc40(host, out),
};

/** Un Launchpad parla ai programmi da una sola delle sue interfacce (la "DAW"): si usa quella,
 *  in uscita e in entrata (dalle altre arrivano le note dei modi Note e Custom, e sul Pro MK3
 *  ciò che entra dalla presa MIDI). `prefer` sceglie l'interfaccia a mano. */
const launchpadDriver = (model: Model, prefer: () => number | undefined): Driver => ({
  name: model.name,
  port: model.port,
  pick: (inputs, outputs) => {
    const output = dawPort(outputs, model, prefer());
    if (!output) return { inputs: [] };
    const same = inputs.filter(p => portInterface(p.name ?? '') === portInterface(output.name ?? ''));
    return { output, inputs: same.length ? same : inputs };
  },
  create: (host, out) => new Launchpad(model, host, out),
});

interface Connection {
  readonly driver: Driver;
  readonly controller: SessionSurface;
  /** Le porte d'ingresso da cui si ascolta il controller. */
  readonly inputs: readonly MIDIInput[];
  /** Le altre porte del controller: si aprono solo per il registro. */
  readonly others: readonly MIDIInput[];
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
  private conn: Connection | null = null;
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
  private preferred: number | undefined;
  /** Volte di fila in cui si sono riaperte le porte perché il controller non rispondeva. */
  private revivals = 0;
  private gaveUp = false;
  /** Il controller ha già risposto alla richiesta d'identità (vale anche dopo aver riaperto le porte). */
  private answersIdentity = false;
  /** Un Launchpad che studiomio non conosce è già stato segnalato. */
  private unknownSaid = false;
  /** Gli ultimi messaggi MIDI, per il report. */
  private readonly history: string[] = [];
  private readonly startedAt = performance.now();
  /** Le porte d'ingresso che non sono di un controller della session, ascoltate per le mappature. */
  private readonly free = new Map<string, MIDIInput>();
  private mapping = false;
  private readonly drivers: readonly Driver[];
  private readonly events = new Emitter<SurfaceEvents>();

  constructor(private readonly host: SurfaceHost) {
    this.drivers = [apcDriver, ...MODELS.map(m => launchpadDriver(m, () => this.preferred))];
  }

  /** Vero se il browser ha Web MIDI. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get enabled(): boolean {
    return this.access !== null;
  }

  /** Il nome del controller collegato, o null. */
  get connected(): string | null {
    return this.conn?.driver.name ?? null;
  }

  /** Dalla console, `studiomio.surfaces.knobFeedback = false`: alle manopole dell'APC40 non si
   *  manda più niente (anelli di LED fermi). Per capire se è quel traffico a bloccare il controller. */
  get knobFeedback(): boolean {
    return this.feedback;
  }

  set knobFeedback(on: boolean) {
    this.feedback = on;
    if (this.conn?.controller instanceof Apc40) this.conn.controller.knobFeedback = on;
  }

  /** Dalla console, `studiomio.surfaces.launchpadPort = 2`: quale interfaccia del Launchpad usare
   *  ("LPX MIDI" è la 1, "MIDIIN2 (LPX MIDI)" la 2…), se quella scelta da sola non risponde.
   *  `undefined` torna alla scelta automatica. Ci si ricollega subito. */
  get launchpadPort(): number | undefined {
    return this.preferred;
  }

  set launchpadPort(n: number | undefined) {
    this.preferred = n;
    if (this.conn?.controller instanceof Launchpad) this.disconnect();
    void this.scan();
  }

  /** Si ascoltano le porte d'ingresso degli altri controller, per le mappature MIDI? Solo se
   *  servono (MIDI acceso o mappature nel progetto): su Windows una porta aperta non la può usare
   *  un altro programma. */
  get listening(): boolean {
    return this.mapping;
  }

  set listening(on: boolean) {
    if (on === this.mapping) return;
    this.mapping = on;
    void this.scan();
  }

  /** I nomi delle porte ascoltate per le mappature. */
  get mappingInputs(): string[] {
    return [...this.free.values()].map(p => p.name ?? p.id);
  }

  /** Un messaggio da una porta ascoltata per le mappature. */
  onMidi(fn: (data: Uint8Array) => void): Unsubscribe {
    return this.events.on('midi', fn);
  }

  /** Le porte MIDI che il browser vede (per capire cosa non va dalla console). */
  ports(): { input: string[]; output: string[] } {
    const list = (ports: Iterable<MIDIPort>) => [...ports].map(p => `${p.name} [${p.id}] ${p.state}/${p.connection}`);
    return { input: list(this.access?.inputs.values() ?? []), output: list(this.access?.outputs.values() ?? []) };
  }

  /** Tutto ciò che serve per capire cosa succede con un controller, da incollare in un messaggio:
   *  dalla console (F12), `copy(studiomio.surfaces.report())`. */
  report(): string {
    const c = this.conn;
    const lines = [
      `studiomio · controller · ${new Date().toISOString()}`,
      `Web MIDI: ${this.supported ? (this.enabled ? 'attivo' : 'non ancora attivato (pulsante 🎛)') : 'assente'}`,
      'Porte d\'ingresso:', ...this.ports().input.map(p => `  ${p}`),
      'Porte d\'uscita:', ...this.ports().output.map(p => `  ${p}`),
      c ? `Collegato: ${c.driver.name}` : 'Collegato: nessun controller',
      `Ingressi per le mappature MIDI: ${this.mapping ? this.mappingInputs.join(', ') || 'nessuno' : 'chiusi (nessuna mappatura)'}`,
    ];
    if (c) {
      lines.push(`  uscita: ${c.output.name} [${c.output.id}]`);
      lines.push(`  ingressi ascoltati: ${c.inputs.map(p => `${p.name} [${p.id}]`).join(', ')}`);
      if (c.others.length) lines.push(`  altri ingressi (solo registro): ${c.others.map(p => `${p.name} [${p.id}]`).join(', ')}`);
      lines.push(`  avvio finito: ${c.controller.ready ? 'sì' : 'no'}`);
      if (c.controller instanceof Launchpad) {
        const lp = c.controller;
        lines.push(`  risposta d'identità: ${lp.identified ? hex(lp.identified) : 'nessuna'} (attesa: ${hex(lp.model.family)})`);
        lines.push(`  modo: ${lp.state}`);
        if (this.preferred !== undefined) lines.push(`  interfaccia scelta a mano: ${this.preferred}`);
      }
    }
    const ring = this.host.ui.sessionRing;
    lines.push(`Riquadro: ${ring ? `tracce ${ring.track + 1}–${ring.track + ring.width}, scene ${ring.scene + 1}–${ring.scene + ring.height}` : 'nessuno'}`);
    lines.push(`Ultimi messaggi MIDI (${this.history.length}, il più vecchio prima):`, ...this.history);
    return lines.join('\n');
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

  /** Chiede l'accesso al MIDI (con il SysEx, per i modi dei controller) e cerca i controller. */
  async enable(): Promise<void> {
    if (!this.supported) throw new Error('questo browser non ha Web MIDI: per i controller serve Chrome o Edge');
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => void this.scan();
      // chiudendo la pagina il controller torna al suo modo, con i LED spenti
      window.addEventListener('pagehide', () => this.disconnect());
    }
    await this.scan();
    if (!this.conn && !this.unknownSaid && !this.mapping) {
      this.host.say('Controller: nessun APC40 mkII o Launchpad (X, Mini MK3, Pro MK3, MK2) collegato. Collegalo quando vuoi, si attiva da solo.');
    }
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
    const connected = <P extends MIDIPort>(ports: Iterable<P>) => [...ports].filter(p => p.state === 'connected');
    const allInputs = connected(access.inputs.values()), allOutputs = connected(access.outputs.values());
    let found: { driver: Driver; output: MIDIOutput; inputs: MIDIInput[]; others: MIDIInput[] } | null = null;
    for (const driver of this.drivers) {
      const named = <P extends MIDIPort>(ports: P[]) => ports.filter(p => driver.port.test(p.name ?? ''));
      const ins = named(allInputs);
      const { output, inputs } = driver.pick(ins, named(allOutputs));
      if (output && inputs.length) {
        found = { driver, output, inputs, others: ins.filter(p => !inputs.includes(p)) };
        break;
      }
    }
    if (!found) this.unknownLaunchpad([...allInputs, ...allOutputs]);
    const ports = found ? [found.output.id, ...found.inputs.map(p => p.id)].join('|') : '';
    const claimed = new Set(found ? [...found.inputs, ...found.others].map(p => p.id) : []);
    const free = allInputs.filter(p => !claimed.has(p.id));
    if (this.conn && this.conn.ports === ports) return this.listenFree(free);
    // prima si scollega il controller (che smette di ascoltare le sue porte), poi le porte libere
    // passano alle mappature, poi un controller nuovo prende le sue
    if (this.conn) this.disconnect();
    this.listenFree(free);
    if (!found) return;
    const { driver, output } = found;
    this.connecting = true;
    try {
      await output.open();
      const controller = driver.create(this.host, data => {
        this.record('→', output.name, data);
        if (this.log) console.log(`MIDI → ${hex(data)}`);
        try { output.send(data); } catch { /* staccato proprio adesso */ }
      });
      // si ascoltano gli ingressi del controller; uno occupato da un altro programma non blocca gli altri
      const liveness = new Liveness(performance.now(), this.answersIdentity);
      const listen = async (input: MIDIInput, forward: boolean) => {
        try {
          await input.open();
          input.onmidimessage = e => {
            if (!e.data) return;
            this.record(forward ? '←' : '← (non ascoltato)', input.name, e.data);
            if (this.log) console.log(`MIDI ← ${input.name} [${input.id}]: ${hex(e.data)}`);
            if (!forward) return;
            liveness.heard(performance.now(), e.data);
            this.recovered();
            controller.receive(e.data);
          };
          return true;
        } catch (e) {
          console.warn(`Controller: non riesco ad aprire l'ingresso ${input.name} [${input.id}]`, e);
          return false;
        }
      };
      const opened: MIDIInput[] = [];
      for (const input of found.inputs) if (await listen(input, true)) opened.push(input);
      if (!opened.length) throw new Error("nessuna porta d'ingresso si apre");
      const others: MIDIInput[] = [];
      for (const input of found.others) if (await listen(input, false)) others.push(input);
      if (controller instanceof Apc40) controller.knobFeedback = this.feedback;
      const tick = setInterval(() => controller.tick(), TICK_MS);
      const watch = setInterval(() => this.watch(connection), WATCH_MS);
      const connection: Connection = {
        driver, controller, inputs: opened, others, output, ports, liveness,
        stopTimers: () => { clearInterval(tick); clearInterval(watch); },
      };
      this.conn = connection;
      controller.start(); // chiede l'identità: la risposta fa partire l'avvio (e dice che il controller la conosce)
      console.info('Controller collegato', { driver: driver.name, output: `${output.name} [${output.id}]`, inputs: opened.map(p => `${p.name} [${p.id}]`) });
      if (!this.revivals) this.host.say(`${driver.name} collegato: la griglia suona il riquadro della session.`);
    } catch (e) {
      this.host.say(`Controller: non riesco ad aprire ${driver.name} (lo sta usando un altro programma?). ${e instanceof Error ? e.message : ''}`);
    } finally {
      this.connecting = false;
      this.events.emit('change');
    }
    if (this.rescan) {
      this.rescan = false;
      await this.scan();
    }
  }

  /** Un Launchpad di un modello che studiomio non guida, o di cui non si trova la porta per i
   *  programmi: lo si dice una volta. */
  private unknownLaunchpad(ports: readonly MIDIPort[]): void {
    const lp = ports.find(p => ANY_LAUNCHPAD.test(p.name ?? ''));
    if (!lp || this.unknownSaid) return;
    this.unknownSaid = true;
    const model = modelOfPort(lp.name ?? '');
    console.warn(`Controller: ${model ? `${model.name} senza la porta DAW` : 'Launchpad non riconosciuto'}`, this.ports());
    this.host.say(model
      ? `Controller: non trovo la porta DAW del ${model.name} (dalla console: studiomio.surfaces.ports()).`
      : `Controller: "${lp.name}" non è un Launchpad che studiomio conosce (X, Mini MK3, Pro MK3, MK2).`);
  }

  /** Ascolta per le mappature le porte libere (tutte, se servono; nessuna, se no). Una porta che
   *  passa a un controller della session la ascolta lui; una che non serve più si chiude. */
  private listenFree(ports: readonly MIDIInput[]): void {
    const wanted = this.mapping ? ports : [];
    let changed = false;
    for (const [id, input] of this.free) {
      if (wanted.some(p => p.id === id)) continue;
      input.onmidimessage = null;
      this.free.delete(id);
      changed = true;
      if (!this.mapping) void input.close().catch(() => {});
    }
    for (const input of wanted) {
      if (this.free.has(input.id)) continue;
      this.free.set(input.id, input);
      changed = true;
      input.onmidimessage = e => {
        if (!e.data) return;
        this.record('← (mappature)', input.name, e.data);
        if (this.log) console.log(`MIDI ← ${input.name} [${input.id}] (mappature): ${hex(e.data)}`);
        this.events.emit('midi', e.data);
      };
      input.open().catch(e => {
        console.warn(`MIDI: non riesco ad aprire l'ingresso ${input.name} [${input.id}]`, e);
        this.host.say(`MIDI: non riesco ad aprire ${input.name} (lo sta usando un altro programma?).`);
      });
    }
    if (changed) this.events.emit('change');
  }

  private record(direction: string, port: string | null | undefined, data: ArrayLike<number>): void {
    const t = ((performance.now() - this.startedAt) / 1000).toFixed(3);
    this.history.push(`${t.padStart(9)} ${direction} ${port ?? '?'}: ${hex(data)}`);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
  }

  private disconnect(): void {
    const c = this.conn;
    if (!c) return;
    this.drop(c);
    c.controller.stop();
    this.host.say(`${c.driver.name} scollegato.`);
    this.events.emit('change');
  }

  /** Smette di ascoltare e di aggiornare il controller (senza mandargli niente). */
  private drop(c: Connection): void {
    if (this.conn === c) this.conn = null;
    this.answersIdentity ||= c.liveness.watching;
    c.stopTimers();
    for (const input of [...c.inputs, ...c.others]) input.onmidimessage = null;
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
      console.warn(`Controller: ${c.driver.name} non risponde nemmeno riaprendo le porte`);
      this.host.say(`${c.driver.name} non risponde più: spegnilo e riaccendilo, si ricollega da solo.`);
      return;
    }
    this.revivals++;
    console.warn(`Controller: ${c.driver.name} non risponde, riapro le porte (tentativo ${this.revivals})`);
    void this.reopen(c);
  }

  private async reopen(c: Connection): Promise<void> {
    this.drop(c);
    await Promise.allSettled([...c.inputs.map(p => p.close()), ...c.others.map(p => p.close()), c.output.close()]);
    await this.scan();
  }

  /** È arrivato qualcosa: se il controller era muto, è tornato. */
  private recovered(): void {
    if (!this.revivals && !this.gaveUp) return;
    console.info(`Controller: risponde di nuovo (dopo ${this.revivals} riaperture delle porte)`);
    this.host.say(`${this.conn?.driver.name ?? 'Il controller'} ripreso.`);
    this.revivals = 0;
    this.gaveUp = false;
  }
}
