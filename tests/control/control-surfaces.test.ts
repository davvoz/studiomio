import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceHost } from '../../src/control/session-surface';

/** Fake controllers: the real ones are tested elsewhere; here only the wiring matters. */
const created: { kind: string; surface: FakeSurface }[] = [];

class FakeSurface {
  started = 0;
  stopped = 0;
  ticks = 0;
  readonly received: number[][] = [];
  ready = true;
  out: (d: number[]) => void = () => {};
  knobFeedback = true;
  start() { this.started++; }
  stop() { this.stopped++; }
  tick() { this.ticks++; }
  receive(d: ArrayLike<number>) { this.received.push(Array.from(d)); }
}

vi.mock('../../src/control/apc40/apc40', () => ({
  Apc40: class extends FakeSurface {
    constructor(_host: unknown, out: (d: number[]) => void) {
      super();
      this.out = out;
      created.push({ kind: 'apc', surface: this });
    }
  },
}));

vi.mock('../../src/control/launchpad/launchpad', () => ({
  Launchpad: class extends FakeSurface {
    identified: readonly [number, number] | null = null;
    state = 'session';
    constructor(readonly model: { id: string; family: number[] }, _host: unknown, out: (d: number[]) => void) {
      super();
      this.out = out;
      created.push({ kind: `lp:${model.id}`, surface: this });
    }
  },
}));

const { ControlSurfaces } = await import('../../src/control/control-surfaces');

type Handler = ((e: { data?: Uint8Array }) => void) | null;

class FakePort {
  onmidimessage: Handler = null;
  opened = 0;
  closed = 0;
  failOpen = false;
  readonly sent: number[][] = [];
  state = 'connected';
  connection = 'closed';
  constructor(readonly id: string, readonly name: string) {}
  async open() {
    if (this.failOpen) throw new Error('busy');
    this.opened++;
    return this;
  }
  async close() { this.closed++; return this; }
  send(d: number[]) { this.sent.push(d); }
  emit(...data: number[]) { this.onmidimessage?.({ data: new Uint8Array(data) }); }
}

class FakeAccess {
  inputs = new Map<string, FakePort>();
  outputs = new Map<string, FakePort>();
  onstatechange: (() => void) | null = null;
  addIn(p: FakePort) { this.inputs.set(p.id, p); return p; }
  addOut(p: FakePort) { this.outputs.set(p.id, p); return p; }
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const logged = () => vi.mocked(console.log).mock.calls.map(c => String(c[0]));

describe('ControlSurfaces', () => {
  let access: FakeAccess;
  let said: string[];
  let ring: { track: number; scene: number; width: number; height: number } | null;
  let surfaces: InstanceType<typeof ControlSurfaces>;
  let pagehide: (() => void) | undefined;
  let granted: string;

  const host = () => ({ say: (t: string) => said.push(t), ui: { get sessionRing() { return ring; } } }) as unknown as SurfaceHost;
  const enabled = async () => { await surfaces.enable(); await flush(); };
  const lastOut = () => created.at(-1)!.surface.out;

  beforeEach(() => {
    created.length = 0;
    access = new FakeAccess();
    said = [];
    ring = null;
    granted = 'granted';
    pagehide = undefined;
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn(async () => access as unknown as MIDIAccess),
      permissions: { query: vi.fn(async () => ({ state: granted })) },
    });
    vi.stubGlobal('window', { addEventListener: (_: string, fn: () => void) => { pagehide = fn; } });
    surfaces = new ControlSurfaces(host());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('support and activation', () => {
    it('reports support and refuses to enable without Web MIDI', async () => {
      vi.stubGlobal('navigator', {});
      expect(surfaces.supported).toBe(false);
      await expect(surfaces.enable()).rejects.toThrow(/Web MIDI/);
      expect(surfaces.report()).toContain('Web MIDI: missing');
      vi.stubGlobal('navigator', undefined);
      expect(surfaces.supported).toBe(false);
    });

    it('is not enabled until the permission is given, then says so in the report', async () => {
      expect(surfaces.enabled).toBe(false);
      expect(surfaces.report()).toContain('not activated yet');
      await enabled();
      expect(surfaces.enabled).toBe(true);
      expect(surfaces.report()).toContain('Web MIDI: active');
      expect(said[0]).toMatch(/no APC40 mkII or Launchpad/);
    });

    it('autoStart connects only if the permission is already granted', async () => {
      await surfaces.autoStart();
      expect(surfaces.enabled).toBe(true);
      const other = new ControlSurfaces(host());
      granted = 'prompt';
      await other.autoStart();
      expect(other.enabled).toBe(false);
    });

    it('autoStart does nothing without permissions API or when the query fails', async () => {
      vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn() });
      await surfaces.autoStart();
      expect(surfaces.enabled).toBe(false);
      vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(), permissions: { query: vi.fn(async () => { throw new Error('x'); }) } });
      await surfaces.autoStart();
      expect(surfaces.enabled).toBe(false);
    });

    it('does not complain about missing controllers when listening for mappings', async () => {
      surfaces.listening = true;
      await enabled();
      expect(said).toEqual([]);
    });
  });

  describe('APC40 mkII', () => {
    let out: FakePort;
    let inA: FakePort;
    let inB: FakePort;

    beforeEach(() => {
      out = access.addOut(new FakePort('o1', 'APC40 mkII'));
      inA = access.addIn(new FakePort('i1', 'APC40 mkII'));
      inB = access.addIn(new FakePort('i2', 'MIDIIN2 (APC40 mkII)'));
    });

    it('is recognized by its port name, opens all its inputs and starts', async () => {
      await enabled();
      expect(surfaces.connected).toBe('APC40 mkII');
      expect(created.map(c => c.kind)).toEqual(['apc']);
      expect(created[0].surface.started).toBe(1);
      expect(out.opened).toBe(1);
      expect(inA.opened + inB.opened).toBe(2);
      expect(said).toContain('APC40 mkII connected: the grid plays the session box.');
    });

    it('forwards what the inputs send to the controller and logs it', async () => {
      await enabled();
      inA.emit(0x90, 1, 127);
      inB.emit(0xb0, 2, 3);
      inA.onmidimessage?.({});
      expect(created[0].surface.received).toEqual([[0x90, 1, 127], [0xb0, 2, 3]]);
      const report = surfaces.report();
      expect(report).toContain('← APC40 mkII: 90 01 7f');
      expect(report).toContain('Latest MIDI messages (2, oldest first)');
    });

    it('sends what the controller outputs to the output port, ignoring a failing port', async () => {
      await enabled();
      lastOut()([0x90, 5, 6]);
      expect(out.sent).toEqual([[0x90, 5, 6]]);
      out.send = () => { throw new Error('unplugged'); };
      expect(() => lastOut()([1, 2])).not.toThrow();
      expect(surfaces.report()).toContain('→ APC40 mkII: 01 02');
    });

    it('prints every message when log is on', async () => {
      surfaces.log = true;
      await enabled();
      inA.emit(0x90, 1, 2);
      lastOut()([0x80, 1, 0]);
      expect(logged()).toContain('MIDI ← APC40 mkII [i1]: 90 01 02');
      expect(logged()).toContain('MIDI → 80 01 00');
    });

    it('ticks the controller regularly', async () => {
      await enabled();
      vi.advanceTimersByTime(300);
      expect(created[0].surface.ticks).toBe(10);
    });

    it('applies knobFeedback to the connected APC40 and to the next one', async () => {
      surfaces.knobFeedback = false;
      expect(surfaces.knobFeedback).toBe(false);
      await enabled();
      expect(created[0].surface.knobFeedback).toBe(false);
      surfaces.knobFeedback = true;
      expect(created[0].surface.knobFeedback).toBe(true);
    });

    it('does not open ports of an unrelated device, and listens only when asked', async () => {
      const kb = access.addIn(new FakePort('k1', 'Keyboard'));
      await enabled();
      expect(kb.opened).toBe(0);
      expect(surfaces.mappingInputs).toEqual([]);
      expect(surfaces.report()).toContain('closed (no mappings)');
    });

    it('disconnects when the port goes away and says so', async () => {
      await enabled();
      access.outputs.clear();
      access.onstatechange?.();
      await flush();
      expect(surfaces.connected).toBeNull();
      expect(created[0].surface.stopped).toBe(1);
      expect(inA.onmidimessage).toBeNull();
      expect(said).toContain('APC40 mkII disconnected.');
      const ticks = created[0].surface.ticks;
      vi.advanceTimersByTime(300);
      expect(created[0].surface.ticks).toBe(ticks);
    });

    it('keeps the connection if the ports did not change', async () => {
      await enabled();
      access.onstatechange?.();
      await flush();
      expect(created).toHaveLength(1);
      expect(created[0].surface.stopped).toBe(0);
    });

    it('ignores ports that are not connected', async () => {
      inA.state = 'disconnected';
      inB.state = 'disconnected';
      await enabled();
      expect(surfaces.connected).toBeNull();
    });

    it('stops the controller when the page is closed', async () => {
      await enabled();
      pagehide?.();
      expect(created[0].surface.stopped).toBe(1);
      expect(surfaces.connected).toBeNull();
    });

    it('notifies change listeners and lets them unsubscribe', async () => {
      const fn = vi.fn();
      const off = surfaces.onChange(fn);
      await enabled();
      expect(fn).toHaveBeenCalled();
      off();
      fn.mockClear();
      await enabled();
      expect(fn).not.toHaveBeenCalled();
    });

    it('survives an input that fails to open', async () => {
      inA.failOpen = true;
      await enabled();
      expect(surfaces.connected).toBe('APC40 mkII');
      expect(inB.onmidimessage).not.toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it('gives up if no input opens', async () => {
      inA.failOpen = true;
      inB.failOpen = true;
      await enabled();
      expect(surfaces.connected).toBeNull();
      expect(said.some(t => t.includes("can't open APC40 mkII") && t.includes('no input port opens'))).toBe(true);
    });

    it('says it cannot open the controller when the output fails', async () => {
      out.failOpen = true;
      await enabled();
      expect(surfaces.connected).toBeNull();
      expect(said.some(t => t.includes("can't open APC40 mkII") && t.includes('busy'))).toBe(true);
    });

    it('the report describes the connection and the session box', async () => {
      ring = { track: 0, scene: 2, width: 8, height: 5 };
      await enabled();
      const report = surfaces.report();
      expect(report).toContain('Connected: APC40 mkII');
      expect(report).toContain('output: APC40 mkII [o1]');
      expect(report).toContain('startup finished: yes');
      expect(report).toContain('Box: tracks 1–8, scenes 3–7');
      expect(report).not.toContain('identity reply');
      expect(surfaces.ports().input[0]).toBe('APC40 mkII [i1] connected/closed');
    });
  });

  describe('Launchpad', () => {
    it('picks the DAW interface of the model for output and input', async () => {
      access.addOut(new FakePort('o1', 'LPX MIDI'));
      const dawOut = access.addOut(new FakePort('o2', 'MIDIOUT2 (LPX MIDI)'));
      access.addIn(new FakePort('i1', 'LPX MIDI'));
      const dawIn = access.addIn(new FakePort('i2', 'MIDIIN2 (LPX MIDI)'));
      await enabled();
      expect(surfaces.connected).toBe('Launchpad X');
      expect(created[0].kind).toBe('lp:x');
      expect(dawOut.opened).toBe(1);
      expect(dawIn.opened).toBe(1);
      const report = surfaces.report();
      expect(report).toContain('output: MIDIOUT2 (LPX MIDI) [o2]');
      expect(report).toContain('inputs listened to: MIDIIN2 (LPX MIDI) [i2]');
      expect(report).toContain('other inputs (log only): LPX MIDI [i1]');
      expect(report).toContain('identity reply: none (expected: 03 01)');
      expect(report).toContain('mode: session');
    });

    it('logs the other inputs without forwarding them to the controller', async () => {
      access.addOut(new FakePort('o2', 'MIDIOUT2 (LPX MIDI)'));
      const plain = access.addIn(new FakePort('i1', 'LPX MIDI'));
      const dawIn = access.addIn(new FakePort('i2', 'MIDIIN2 (LPX MIDI)'));
      await enabled();
      plain.emit(0x90, 10, 1);
      expect(created[0].surface.received).toEqual([]);
      expect(surfaces.report()).toContain('← (not listened) LPX MIDI: 90 0a 01');
      dawIn.emit(0x90, 11, 1);
      expect(created[0].surface.received).toEqual([[0x90, 11, 1]]);
    });

    it('does not connect without a DAW port, and says it once', async () => {
      access.addOut(new FakePort('o1', 'LPX MIDI'));
      access.addOut(new FakePort('o3', 'MIDIOUT3 (LPX MIDI)'));
      access.addIn(new FakePort('i1', 'LPX MIDI'));
      await enabled();
      expect(surfaces.connected).toBeNull();
      expect(said.filter(t => t.includes("can't find the DAW port of the Launchpad X"))).toHaveLength(1);
      access.onstatechange?.();
      await flush();
      expect(said.filter(t => t.includes('DAW port'))).toHaveLength(1);
    });

    it('reports a Launchpad of an unknown model', async () => {
      access.addOut(new FakePort('o1', 'Launchpad S'));
      access.addIn(new FakePort('i1', 'Launchpad S'));
      await enabled();
      expect(surfaces.connected).toBeNull();
      expect(said.some(t => t.includes('"Launchpad S" isn\'t a Launchpad studiomio knows'))).toBe(true);
    });

    it('launchpadPort chooses the interface by hand, reconnects, and shows in the report', async () => {
      access.addOut(new FakePort('o1', 'LPX MIDI'));
      access.addOut(new FakePort('o2', 'MIDIOUT2 (LPX MIDI)'));
      access.addIn(new FakePort('i1', 'LPX MIDI'));
      access.addIn(new FakePort('i2', 'MIDIIN2 (LPX MIDI)'));
      await enabled();
      expect(surfaces.launchpadPort).toBeUndefined();
      surfaces.launchpadPort = 1;
      await flush();
      expect(surfaces.launchpadPort).toBe(1);
      expect(created).toHaveLength(2);
      expect(created[0].surface.stopped).toBe(1);
      const report = surfaces.report();
      expect(report).toContain('output: LPX MIDI [o1]');
      expect(report).toContain('interface chosen by hand: 1');
    });

    it('launchpadPort leaves an APC40 connected', async () => {
      access.addOut(new FakePort('o1', 'APC40 mkII'));
      access.addIn(new FakePort('i1', 'APC40 mkII'));
      await enabled();
      surfaces.launchpadPort = 2;
      await flush();
      expect(created).toHaveLength(1);
      expect(created[0].surface.stopped).toBe(0);
    });

    it('prefers the APC40 when both are plugged (first in the list wins)', async () => {
      access.addOut(new FakePort('o2', 'MIDIOUT2 (LPX MIDI)'));
      access.addIn(new FakePort('i2', 'MIDIIN2 (LPX MIDI)'));
      access.addOut(new FakePort('o1', 'APC40 mkII'));
      access.addIn(new FakePort('i1', 'APC40 mkII'));
      await enabled();
      expect(surfaces.connected).toBe('APC40 mkII');
    });
  });

  describe('MIDI mappings (free ports)', () => {
    it('listens to the other inputs only while listening is on, and forwards their messages', async () => {
      const kb = access.addIn(new FakePort('k1', 'Keyboard'));
      await enabled();
      expect(surfaces.listening).toBe(false);
      const got: number[][] = [];
      surfaces.onMidi(d => got.push([...d]));
      surfaces.listening = true;
      await flush();
      expect(surfaces.listening).toBe(true);
      expect(surfaces.mappingInputs).toEqual(['Keyboard']);
      expect(kb.opened).toBe(1);
      kb.emit(0xb0, 7, 64);
      kb.onmidimessage?.({});
      expect(got).toEqual([[0xb0, 7, 64]]);
      expect(surfaces.report()).toContain('Inputs for MIDI mappings: Keyboard');
      expect(surfaces.report()).toContain('← (mappings) Keyboard: b0 07 40');

      surfaces.listening = false;
      await flush();
      expect(surfaces.mappingInputs).toEqual([]);
      expect(kb.onmidimessage).toBeNull();
      expect(kb.closed).toBe(1);
    });

    it('setting listening to the same value does not rescan', async () => {
      const fn = vi.fn();
      await enabled();
      surfaces.onChange(fn);
      surfaces.listening = false;
      await flush();
      expect(fn).not.toHaveBeenCalled();
    });

    it('unsubscribes midi listeners and logs when log is on', async () => {
      const kb = access.addIn(new FakePort('k1', 'Keyboard'));
      surfaces.listening = true;
      surfaces.log = true;
      await enabled();
      const fn = vi.fn();
      surfaces.onMidi(fn)();
      kb.emit(1, 2, 3);
      expect(fn).not.toHaveBeenCalled();
      expect(logged()).toContain('MIDI ← Keyboard [k1] (mappings): 01 02 03');
    });

    it('a port that cannot be opened is reported', async () => {
      const kb = access.addIn(new FakePort('k1', 'Keyboard'));
      kb.failOpen = true;
      surfaces.listening = true;
      await enabled();
      await flush();
      expect(said).toContain("MIDI: can't open Keyboard (is another program using it?).");
    });

    it('ports taken by a controller are not listened to for mappings, others are', async () => {
      access.addOut(new FakePort('o1', 'APC40 mkII'));
      access.addIn(new FakePort('i1', 'APC40 mkII'));
      access.addIn(new FakePort('k1', 'Keyboard'));
      surfaces.listening = true;
      await enabled();
      expect(surfaces.mappingInputs).toEqual(['Keyboard']);
    });

    it('a keyboard unplugged stops being listened to', async () => {
      surfaces.listening = true;
      access.addIn(new FakePort('k1', 'Keyboard'));
      await enabled();
      expect(surfaces.mappingInputs).toHaveLength(1);
      access.inputs.clear();
      access.onstatechange?.();
      await flush();
      expect(surfaces.mappingInputs).toEqual([]);
    });
  });

  describe('watchdog', () => {
    const REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x47, 0x29, 0xf7];
    let out: FakePort;
    let inp: FakePort;

    beforeEach(() => {
      out = access.addOut(new FakePort('o1', 'APC40 mkII'));
      inp = access.addIn(new FakePort('i1', 'APC40 mkII'));
    });

    it('does nothing while the watchdog is off', async () => {
      await enabled();
      vi.advanceTimersByTime(60_000);
      expect(out.sent).toEqual([]);
      expect(created).toHaveLength(1);
    });

    it('asks who it is after silence, with log on', async () => {
      surfaces.watchdog = true;
      surfaces.log = true;
      await enabled();
      inp.emit(...REPLY);
      vi.advanceTimersByTime(6000);
      expect(out.sent).toContainEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
      expect(logged().some(t => t.includes('identity request'))).toBe(true);
    });

    it('reopens the ports of a controller that stopped answering, then gives up', async () => {
      surfaces.watchdog = true;
      await enabled();
      inp.emit(...REPLY);
      vi.advanceTimersByTime(8000);
      await flush();
      expect(inp.closed).toBe(1);
      expect(out.closed).toBe(1);
      expect(created).toHaveLength(2);
      expect(created[0].surface.stopped).toBe(0); // dropped without sending anything
      expect(said.filter(t => t.includes('connected: the grid'))).toHaveLength(1); // not announced again
      expect(vi.mocked(console.warn).mock.calls.some(c => String(c[0]).includes('attempt 1'))).toBe(true);

      vi.advanceTimersByTime(8000);
      await flush();
      expect(created).toHaveLength(3);
      vi.advanceTimersByTime(8000);
      await flush();
      expect(created).toHaveLength(3);
      expect(said).toContain('APC40 mkII no longer responds: turn it off and on again, it reconnects by itself.');
      vi.advanceTimersByTime(20_000);
      await flush();
      expect(said.filter(t => t.includes('no longer responds'))).toHaveLength(1);
    });

    it('announces recovery when the controller talks again', async () => {
      surfaces.watchdog = true;
      await enabled();
      inp.emit(...REPLY);
      vi.advanceTimersByTime(8000);
      await flush();
      inp.emit(0x90, 1, 1);
      expect(said.some(t => t.includes('ripreso'))).toBe(true);
      said.length = 0;
      inp.emit(0x90, 1, 1);
      expect(said).toEqual([]);
    });
  });
});
