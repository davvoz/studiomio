/* The MIDI controllers connected to the computer: the Akai APC40 mkII and the Novation Launchpads (X, Mini
 * MK3, Pro MK3, MK2), recognized by their port names. Just connect them (even with the app open):
 * they're put in the mode for programs (Ableton mode, DAW mode) and bound to the session, with no
 * mappings to make. One at a time: if there are two, the first in the list wins. Web MIDI with
 * SysEx is in Chrome and Edge: the first time the browser asks for permission (🎛 button),
 * then at startup it connects by itself. The other input ports (any controller, a
 * keyboard) go to the MIDI mappings (see app/midi-mapper), but they open only if needed. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import { Apc40 } from './apc40/apc40';
import { PORT_NAME } from './apc40/protocol';
import { Launchpad } from './launchpad/launchpad';
import { ANY_LAUNCHPAD, dawPort, modelOfPort, MODELS, portInterface, type Model } from './launchpad/protocol';
import { IDENTITY_REQUEST, Liveness } from './liveness';
import type { SessionSurface, SurfaceHost } from './session-surface';

/** How often the LEDs are updated and faders and knobs applied. */
const TICK_MS = 30;
/** How often we check that the controller is still talking. */
const WATCH_MS = 500;
/** How many times a silent controller's ports are reopened before giving up. */
const MAX_REVIVALS = 2;
/** How many MIDI messages the log keeps for the report. */
const HISTORY = 400;

type SurfaceEvents = { change: []; midi: [data: Uint8Array] };

/** A kind of controller: how it's recognized, which ports to talk to, who drives it. */
interface Driver {
  readonly name: string;
  /** The controller's ports (on Windows the same device can have more than one). */
  readonly port: RegExp;
  /** Among the ports with its name: the output we talk to and the inputs we listen to. */
  pick(inputs: MIDIInput[], outputs: MIDIOutput[]): { output?: MIDIOutput; inputs: MIDIInput[] };
  create(host: SurfaceHost, out: (data: number[]) => void): SessionSurface;
}

const apcDriver: Driver = {
  name: 'APC40 mkII',
  port: PORT_NAME,
  // we don't know which input port talks: we listen to all of them
  pick: (inputs, outputs) => ({ output: outputs[0], inputs }),
  create: (host, out) => new Apc40(host, out),
};

/** A Launchpad talks to programs from only one of its interfaces (the "DAW" one): that one is used,
 *  for output and input (from the others come the notes of the Note and Custom modes, and on the Pro MK3
 *  what comes in from the MIDI socket). `prefer` chooses the interface by hand. */
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
  /** The input ports the controller is listened to on. */
  readonly inputs: readonly MIDIInput[];
  /** The controller's other ports: they open only for the log. */
  readonly others: readonly MIDIInput[];
  readonly output: MIDIOutput;
  /** The port ids, to tell whether they changed. */
  readonly ports: string;
  readonly liveness: Liveness;
  readonly stopTimers: () => void;
}

/** A MIDI message in hexadecimal, for the monitor. */
const hex = (data: ArrayLike<number>) => Array.from(data, b => b.toString(16).padStart(2, '0')).join(' ');

export class ControlSurfaces {
  private access: MIDIAccess | null = null;
  private conn: Connection | null = null;
  private connecting = false;
  /** Ports changed while connecting: check again at the end. */
  private rescan = false;
  /** MIDI monitor: from the console, `studiomio.surfaces.log = true` prints every message. */
  log = false;
  private feedback = true;
  /** From the console, `studiomio.surfaces.watchdog = true`: after a while of silence the
   *  controller is asked who it is, to notice whether it hung. Off by default: Live doesn't do it, and an
   *  APC40 mkII powered only by USB hung even with these requests alone. */
  watchdog = false;
  private preferred: number | undefined;
  /** Times in a row the ports were reopened because the controller didn't respond. */
  private revivals = 0;
  private gaveUp = false;
  /** The controller has already answered the identity request (holds also after reopening the ports). */
  private answersIdentity = false;
  /** A Launchpad studiomio doesn't know has already been reported. */
  private unknownSaid = false;
  /** The latest MIDI messages, for the report. */
  private readonly history: string[] = [];
  private readonly startedAt = performance.now();
  /** The input ports that don't belong to a session controller, listened to for the mappings. */
  private readonly free = new Map<string, MIDIInput>();
  private mapping = false;
  private readonly drivers: readonly Driver[];
  private readonly events = new Emitter<SurfaceEvents>();

  constructor(private readonly host: SurfaceHost) {
    this.drivers = [apcDriver, ...MODELS.map(m => launchpadDriver(m, () => this.preferred))];
  }

  /** True if the browser has Web MIDI. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get enabled(): boolean {
    return this.access !== null;
  }

  /** The name of the connected controller, or null. */
  get connected(): string | null {
    return this.conn?.driver.name ?? null;
  }

  /** From the console, `studiomio.surfaces.knobFeedback = false`: nothing more is sent to the APC40's
   *  knobs (LED rings frozen). To find out whether that traffic is what hangs the controller. */
  get knobFeedback(): boolean {
    return this.feedback;
  }

  set knobFeedback(on: boolean) {
    this.feedback = on;
    if (this.conn?.controller instanceof Apc40) this.conn.controller.knobFeedback = on;
  }

  /** From the console, `studiomio.surfaces.launchpadPort = 2`: which Launchpad interface to use
   *  ("LPX MIDI" is 1, "MIDIIN2 (LPX MIDI)" is 2…), if the one chosen automatically doesn't respond.
   *  `undefined` goes back to the automatic choice. It reconnects right away. */
  get launchpadPort(): number | undefined {
    return this.preferred;
  }

  set launchpadPort(n: number | undefined) {
    this.preferred = n;
    if (this.conn?.controller instanceof Launchpad) this.disconnect();
    void this.scan();
  }

  /** Are the other controllers' input ports listened to, for the MIDI mappings? Only if
   *  needed (MIDI on or mappings in the project): on Windows an open port can't be used
   *  by another program. */
  get listening(): boolean {
    return this.mapping;
  }

  set listening(on: boolean) {
    if (on === this.mapping) return;
    this.mapping = on;
    void this.scan();
  }

  /** The names of the ports listened to for the mappings. */
  get mappingInputs(): string[] {
    return [...this.free.values()].map(p => p.name ?? p.id);
  }

  /** A message from a port listened to for the mappings. */
  onMidi(fn: (data: Uint8Array) => void): Unsubscribe {
    return this.events.on('midi', fn);
  }

  /** The MIDI ports the browser sees (to find out what's wrong from the console). */
  ports(): { input: string[]; output: string[] } {
    const list = (ports: Iterable<MIDIPort>) => [...ports].map(p => `${p.name} [${p.id}] ${p.state}/${p.connection}`);
    return { input: list(this.access?.inputs.values() ?? []), output: list(this.access?.outputs.values() ?? []) };
  }

  /** Everything needed to understand what's happening with a controller, to paste in a message:
   *  from the console (F12), `copy(studiomio.surfaces.report())`. */
  report(): string {
    const c = this.conn;
    const lines = [
      `studiomio · controller · ${new Date().toISOString()}`,
      `Web MIDI: ${this.supported ? (this.enabled ? 'active' : 'not activated yet (🎛 button)') : 'missing'}`,
      'Input ports:', ...this.ports().input.map(p => `  ${p}`),
      'Output ports:', ...this.ports().output.map(p => `  ${p}`),
      c ? `Connected: ${c.driver.name}` : 'Connected: no controller',
      `Inputs for MIDI mappings: ${this.mapping ? this.mappingInputs.join(', ') || 'none' : 'closed (no mappings)'}`,
    ];
    if (c) {
      lines.push(`  output: ${c.output.name} [${c.output.id}]`);
      lines.push(`  inputs listened to: ${c.inputs.map(p => `${p.name} [${p.id}]`).join(', ')}`);
      if (c.others.length) lines.push(`  other inputs (log only): ${c.others.map(p => `${p.name} [${p.id}]`).join(', ')}`);
      lines.push(`  startup finished: ${c.controller.ready ? 'yes' : 'no'}`);
      if (c.controller instanceof Launchpad) {
        const lp = c.controller;
        lines.push(`  identity reply: ${lp.identified ? hex(lp.identified) : 'none'} (expected: ${hex(lp.model.family)})`);
        lines.push(`  mode: ${lp.state}`);
        if (this.preferred !== undefined) lines.push(`  interface chosen by hand: ${this.preferred}`);
      }
    }
    const ring = this.host.ui.sessionRing;
    lines.push(`Box: ${ring ? `tracks ${ring.track + 1}–${ring.track + ring.width}, scenes ${ring.scene + 1}–${ring.scene + ring.height}` : 'none'}`);
    lines.push(`Latest MIDI messages (${this.history.length}, oldest first):`, ...this.history);
    return lines.join('\n');
  }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** At startup: if permission is already there, it connects without asking anything. */
  async autoStart(): Promise<void> {
    if (!this.supported || !navigator.permissions) return;
    try {
      const status = await navigator.permissions.query({ name: 'midi', sysex: true } as PermissionDescriptor);
      if (status.state === 'granted') await this.enable();
    } catch {
      // the browser can't tell whether there's permission: wait for the button
    }
  }

  /** Asks for MIDI access (with SysEx, for the controllers' modes) and looks for the controllers. */
  async enable(): Promise<void> {
    if (!this.supported) throw new Error('this browser doesn\'t have Web MIDI: controllers need Chrome or Edge');
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => void this.scan();
      // closing the page the controller goes back to its mode, with the LEDs off
      window.addEventListener('pagehide', () => this.disconnect());
    }
    await this.scan();
    if (!this.conn && !this.unknownSaid && !this.mapping) {
      this.host.say('Controllers: no APC40 mkII or Launchpad (X, Mini MK3, Pro MK3, MK2) connected. Connect it whenever you like, it activates by itself.');
    }
    this.events.emit('change');
  }

  /** Ports changed (a controller connected or unplugged): connect or disconnect. */
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
    // first the controller is disconnected (it stops listening to its ports), then the free ports
    // go to the mappings, then a new controller takes its own
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
        try { output.send(data); } catch { /* unplugged just now */ }
      });
      // the controller's inputs are listened to; one taken by another program doesn't block the others
      const liveness = new Liveness(performance.now(), this.answersIdentity);
      const listen = async (input: MIDIInput, forward: boolean) => {
        try {
          await input.open();
          input.onmidimessage = e => {
            if (!e.data) return;
            this.record(forward ? '←' : '← (not listened)', input.name, e.data);
            if (this.log) console.log(`MIDI ← ${input.name} [${input.id}]: ${hex(e.data)}`);
            if (!forward) return;
            liveness.heard(performance.now(), e.data);
            this.recovered();
            controller.receive(e.data);
          };
          return true;
        } catch (e) {
          console.warn(`Controller: can't open input ${input.name} [${input.id}]`, e);
          return false;
        }
      };
      const opened: MIDIInput[] = [];
      for (const input of found.inputs) if (await listen(input, true)) opened.push(input);
      if (!opened.length) throw new Error("no input port opens");
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
      controller.start(); // asks for the identity: the reply starts the startup (and says the controller knows it)
      console.info('Controller connected', { driver: driver.name, output: `${output.name} [${output.id}]`, inputs: opened.map(p => `${p.name} [${p.id}]`) });
      if (!this.revivals) this.host.say(`${driver.name} connected: the grid plays the session box.`);
    } catch (e) {
      this.host.say(`Controller: can't open ${driver.name} (is another program using it?). ${e instanceof Error ? e.message : ''}`);
    } finally {
      this.connecting = false;
      this.events.emit('change');
    }
    if (this.rescan) {
      this.rescan = false;
      await this.scan();
    }
  }

  /** A Launchpad of a model studiomio doesn't drive, or whose port for programs can't be
   *  found: it's said once. */
  private unknownLaunchpad(ports: readonly MIDIPort[]): void {
    const lp = ports.find(p => ANY_LAUNCHPAD.test(p.name ?? ''));
    if (!lp || this.unknownSaid) return;
    this.unknownSaid = true;
    const model = modelOfPort(lp.name ?? '');
    console.warn(`Controller: ${model ? `${model.name} without the DAW port` : 'Launchpad not recognized'}`, this.ports());
    this.host.say(model
      ? `Controller: can't find the DAW port of the ${model.name} (from the console: studiomio.surfaces.ports()).`
      : `Controller: "${lp.name}" isn't a Launchpad studiomio knows (X, Mini MK3, Pro MK3, MK2).`);
  }

  /** Listens to the free ports for the mappings (all, if needed; none, otherwise). A port that
   *  goes to a session controller is listened to by it; one no longer needed is closed. */
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
        this.record('← (mappings)', input.name, e.data);
        if (this.log) console.log(`MIDI ← ${input.name} [${input.id}] (mappings): ${hex(e.data)}`);
        this.events.emit('midi', e.data);
      };
      input.open().catch(e => {
        console.warn(`MIDI: can't open input ${input.name} [${input.id}]`, e);
        this.host.say(`MIDI: can't open ${input.name} (is another program using it?).`);
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
    this.host.say(`${c.driver.name} disconnected.`);
    this.events.emit('change');
  }

  /** Stops listening to and updating the controller (without sending it anything). */
  private drop(c: Connection): void {
    if (this.conn === c) this.conn = null;
    this.answersIdentity ||= c.liveness.watching;
    c.stopTimers();
    for (const input of [...c.inputs, ...c.others]) input.onmidimessage = null;
  }

  /** Is the controller still talking? If it no longer responds, the ports are closed and reopened: if it was
   *  the MIDI connection that got stuck that's enough; if it's the controller, it must be power-cycled. */
  private watch(c: Connection): void {
    if (!this.watchdog) return;
    const action = c.liveness.check(performance.now());
    if (action === 'ping') {
      if (this.log) console.log(`MIDI → ${hex(IDENTITY_REQUEST)} (identity request)`);
      try { c.output.send(IDENTITY_REQUEST); } catch { /* staccato */ }
      return;
    }
    if (action !== 'silent' || this.gaveUp) return;
    if (this.revivals >= MAX_REVIVALS) {
      this.gaveUp = true;
      console.warn(`Controller: ${c.driver.name} doesn't respond even after reopening the ports`);
      this.host.say(`${c.driver.name} no longer responds: turn it off and on again, it reconnects by itself.`);
      return;
    }
    this.revivals++;
    console.warn(`Controller: ${c.driver.name} doesn't respond, reopening the ports (attempt ${this.revivals})`);
    void this.reopen(c);
  }

  private async reopen(c: Connection): Promise<void> {
    this.drop(c);
    await Promise.allSettled([...c.inputs.map(p => p.close()), ...c.others.map(p => p.close()), c.output.close()]);
    await this.scan();
  }

  /** Something arrived: if the controller was silent, it's back. */
  private recovered(): void {
    if (!this.revivals && !this.gaveUp) return;
    console.info(`Controller: responding again (after ${this.revivals} port reopenings)`);
    this.host.say(`${this.conn?.driver.name ?? 'Il controller'} ripreso.`);
    this.revivals = 0;
    this.gaveUp = false;
  }
}
