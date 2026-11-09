import { describe, expect, it } from 'vitest';
import { ARP, ARP_RATES, ARP_STYLE, activeArp, arpParams } from '../../src/devices/arp/arp';
import { arpOrder, Arpeggiator } from '../../src/devices/arp/arpeggiator';
import type { InstrumentCore, TransportPosition } from '../../src/devices/dsp/core';
import { newEffect } from '../../src/model/device';
import type { DeviceId } from '../../src/core/id';

const SR = 48000, BLOCK = 128;
/** At 120 BPM a sixteenth is 6000 samples. */
const SIXTEENTH = 6000;
const RATE = (label: string) => ARP_RATES.findIndex(([l]) => l === label);

/** The fake instrument: notes the notes on and off with the absolute sample. */
function rig(params: Record<string, number> = {}) {
  const log: { kind: 'on' | 'off'; id: number; pitch: number; velocity: number; frame: number }[] = [];
  const open = new Map<number, number>();
  let frame = 0, blockStart = 0, position = 0;
  const core: InstrumentCore = {
    setParams() {},
    noteOn: (id, pitch, velocity) => { open.set(id, pitch); log.push({ kind: 'on', id, pitch, velocity, frame }); },
    noteOff: id => { log.push({ kind: 'off', id, pitch: open.get(id) ?? -1, velocity: 0, frame }); open.delete(id); },
    silence: () => open.clear(),
    render: (_l, _r, _from, to) => { frame = blockStart + to; },
  };
  const arp = new Arpeggiator(core, SR);
  arp.setParams({ arpOn: 1, ...params });
  const left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
  /** Lets `frames` samples pass; with `running` the transport advances. */
  const run = (frames: number, running = false) => {
    for (let done = 0; done + BLOCK <= frames; done += BLOCK) {
      blockStart = frame;
      const at: TransportPosition | null = running ? { beat: (position * 120) / 60 / SR, bpm: 120, beatsPerBar: 4 } : null;
      arp.setTransport(at);
      arp.render(left, right, 0, BLOCK);
      if (running) position += BLOCK;
    }
  };
  return {
    arp, log, run, open,
    ons: () => log.filter(e => e.kind === 'on').map(e => e.pitch),
    frames: () => log.filter(e => e.kind === 'on').map(e => e.frame),
    skip: (frames: number) => { position += frames; },
  };
}

const chord = (arp: Arpeggiator, ...pitches: number[]) => pitches.forEach((p, i) => arp.noteOn(i + 1, p, 100));

describe('arpeggiator: the order', () => {
  const tones = (...pitches: number[]) => pitches.map(pitch => ({ pitch, velocity: 100 }));
  const order = (style: number, octaves = 1, ...pitches: number[]) => arpOrder(tones(...pitches), style, octaves).map(t => t.pitch);

  it('up, down, and the returns don\'t repeat the ends', () => {
    expect(order(ARP_STYLE.up, 1, 67, 60, 64)).toEqual([60, 64, 67]);
    expect(order(ARP_STYLE.down, 1, 60, 64, 67)).toEqual([67, 64, 60]);
    expect(order(ARP_STYLE.upDown, 1, 60, 64, 67)).toEqual([60, 64, 67, 64]);
    expect(order(ARP_STYLE.downUp, 1, 60, 64, 67)).toEqual([67, 64, 60, 64]);
  });

  it('two notes and a single note don\'t break', () => {
    expect(order(ARP_STYLE.upDown, 1, 60, 64)).toEqual([60, 64]);
    expect(order(ARP_STYLE.upDown, 1, 60)).toEqual([60]);
    expect(order(ARP_STYLE.pedal, 1, 60)).toEqual([60]);
    expect(order(ARP_STYLE.inward, 1, 60)).toEqual([60]);
  });

  it('inward, pedal and as played', () => {
    expect(order(ARP_STYLE.inward, 1, 60, 62, 64, 65, 67)).toEqual([60, 67, 62, 65, 64]);
    expect(order(ARP_STYLE.pedal, 1, 60, 64, 67)).toEqual([60, 64, 60, 67]);
    expect(order(ARP_STYLE.played, 1, 67, 60, 64)).toEqual([67, 60, 64]);
  });

  it('the octaves lengthen the loop and don\'t leave the MIDI range', () => {
    expect(order(ARP_STYLE.up, 2, 60, 64)).toEqual([60, 64, 72, 76]);
    expect(order(ARP_STYLE.up, 2, 120)).toEqual([120]);
  });
});

describe('arpeggiator: when stopped', () => {
  it('starts right away with the first note and goes in time', () => {
    const r = rig();
    chord(r.arp, 60, 64, 67);
    r.run(SIXTEENTH * 4);
    expect(r.ons()).toEqual([60, 64, 67, 60]);
    expect(r.frames()).toEqual([0, SIXTEENTH, SIXTEENTH * 2, SIXTEENTH * 3]);
  });

  it('the gate closes the note before the next step', () => {
    const r = rig({ arpGate: 50 });
    chord(r.arp, 60);
    r.run(SIXTEENTH);
    expect(r.log.filter(e => e.kind === 'off').map(e => e.frame)).toEqual([SIXTEENTH / 2]);
  });

  it('with the gate over 100% the notes overlap', () => {
    const r = rig({ arpGate: 150 });
    chord(r.arp, 60, 64);
    r.run(SIXTEENTH + BLOCK);
    expect(r.open.size).toBe(2);
  });

  it('with the notes released it stops, and the next one restarts from the beginning', () => {
    const r = rig();
    chord(r.arp, 60, 64, 67);
    r.run(SIXTEENTH * 2);
    r.arp.noteOff(1); r.arp.noteOff(2); r.arp.noteOff(3);
    r.run(SIXTEENTH * 4);
    expect(r.ons()).toEqual([60, 64]);
    r.arp.noteOn(4, 72, 100);
    r.arp.noteOn(5, 76, 100);
    r.run(SIXTEENTH * 2);
    expect(r.ons()).toEqual([60, 64, 72, 76]);
  });

  it('each note keeps its velocity', () => {
    const r = rig();
    r.arp.noteOn(1, 60, 40);
    r.arp.noteOn(2, 64, 120);
    r.run(SIXTEENTH * 2);
    expect(r.log.filter(e => e.kind === 'on').map(e => e.velocity)).toEqual([40, 120]);
  });

  it('chord: all the notes at every step', () => {
    const r = rig({ arpStyle: ARP_STYLE.chord, arpOctaves: 2 });
    chord(r.arp, 60, 64);
    r.run(SIXTEENTH * 2);
    expect(r.ons()).toEqual([60, 64, 72, 76]);
  });

  it('repeat holds the same note for several steps', () => {
    const r = rig({ arpRepeat: 2 });
    chord(r.arp, 60, 64);
    r.run(SIXTEENTH * 4);
    expect(r.ons()).toEqual([60, 60, 64, 64]);
  });

  it('the division changes the step', () => {
    const r = rig({ arpRate: RATE('1/8') });
    chord(r.arp, 60);
    r.run(SIXTEENTH * 4);
    expect(r.frames()).toEqual([0, SIXTEENTH * 2]);
  });

  it('swing moves the odd steps', () => {
    const r = rig({ arpSwing: 50 });
    chord(r.arp, 60);
    r.run(SIXTEENTH * 4);
    expect(r.frames()).toEqual([0, SIXTEENTH * 1.5, SIXTEENTH * 2, SIXTEENTH * 3.5]);
  });

  it('random and chance give the same result at every round', () => {
    const play = () => {
      const r = rig({ arpStyle: ARP_STYLE.random, arpChance: 60, arpOctaves: 3 });
      chord(r.arp, 60, 63, 67);
      r.run(SIXTEENTH * 32);
      return r.ons();
    };
    const first = play();
    expect(play()).toEqual(first);
    expect(first.length).toBeGreaterThan(10);
    expect(first.length).toBeLessThan(32);
    expect(new Set(first).size).toBeGreaterThan(3);
  });

  it('chance at zero plays nothing', () => {
    const r = rig({ arpChance: 0 });
    chord(r.arp, 60);
    r.run(SIXTEENTH * 8);
    expect(r.ons()).toEqual([]);
  });
});

describe('arpeggiator: Hold', () => {
  it('the released notes stay, the next one starts a new chord', () => {
    const r = rig({ arpHold: 1 });
    chord(r.arp, 60, 64);
    r.arp.noteOff(1); r.arp.noteOff(2);
    r.run(SIXTEENTH * 3);
    expect(r.ons()).toEqual([60, 64, 60]);
    r.arp.noteOn(3, 70, 100);
    r.run(SIXTEENTH * 2);
    expect(r.ons().slice(3).every(p => p === 70)).toBe(true);
  });

  it('removing Hold the released notes leave the loop', () => {
    const r = rig({ arpHold: 1 });
    chord(r.arp, 60, 64);
    r.arp.noteOff(1);
    r.arp.setParams({ arpOn: 1, arpHold: 0 });
    r.run(SIXTEENTH * 3);
    expect(new Set(r.ons())).toEqual(new Set([64]));
  });

  it('the stop turns everything off, Hold included', () => {
    const r = rig({ arpHold: 1 });
    chord(r.arp, 60);
    r.arp.noteOff(1);
    r.run(SIXTEENTH);
    r.arp.silence();
    const before = r.ons().length;
    r.run(SIXTEENTH * 4);
    expect(r.ons()).toHaveLength(before);
  });
});

describe('arpeggiator: with the transport', () => {
  it('the steps sit on the bar\'s grid', () => {
    const r = rig();
    r.run(BLOCK * 2, true);                     // the transport runs
    r.skip(0);
    r.arp.noteOn(1, 60, 100);                   // arrived halfway through the first step...
    r.run(SIXTEENTH * 3, true);
    // ...it plays right away (recovery) and then goes on the grid
    expect(r.frames().slice(1)).toEqual([SIXTEENTH, SIXTEENTH * 2, SIXTEENTH * 3]);
  });

  it('a note too late waits for the next step', () => {
    const r = rig();
    r.run(SIXTEENTH * 0.75, true);
    r.arp.noteOn(1, 60, 100);
    r.run(SIXTEENTH, true);
    expect(r.frames()).toEqual([SIXTEENTH]);
  });

  it('a jump picks up the grid from there', () => {
    const r = rig();
    r.arp.noteOn(1, 60, 100);
    r.run(SIXTEENTH * 2, true);
    const before = r.frames().length;
    r.skip(SIXTEENTH * 10 + 1000);
    r.run(SIXTEENTH * 2, true);
    const after = r.frames().slice(before);
    expect(after.length).toBeGreaterThan(0);
    // on the transport's grid, not on the previous one
    expect((after.at(-1)! + SIXTEENTH * 10 + 1000) % SIXTEENTH).toBeLessThan(BLOCK);
  });
});

describe('arpeggiator: off', () => {
  it('the notes pass as they are', () => {
    const r = rig({ arpOn: 0 });
    r.arp.noteOn(1, 60, 100);
    r.run(SIXTEENTH * 4);
    r.arp.noteOff(1);
    expect(r.log.map(e => `${e.kind} ${e.id}`)).toEqual(['on 1', 'off 1']);
  });

  it('turned on with a held note it takes it into the loop; turned off it stops', () => {
    const r = rig({ arpOn: 0 });
    r.arp.noteOn(1, 60, 100);
    r.arp.setParams({ arpOn: 1 });
    r.run(SIXTEENTH * 2);
    expect(r.log.map(e => e.kind)).toEqual(['on', 'off', 'on', 'off', 'on', 'off']);
    expect(r.log[0].id).toBe(1);
    r.arp.setParams({ arpOn: 0 });
    r.run(SIXTEENTH * 2);
    expect(r.open.size).toBe(0);
  });
});

describe('arpeggiator in the chain', () => {
  const effect = (enabled = true) => ({ ...newEffect('d1' as DeviceId, ARP.type), enabled });

  it('the first active one plays; without, the note engine is off', () => {
    expect(arpParams(undefined)).toEqual({ arpOn: 0 });
    expect(arpParams(activeArp([effect(false)]))).toEqual({ arpOn: 0 });
    expect(arpParams(activeArp([effect()])).arpOn).toBe(1);
    expect(arpParams(activeArp([effect()])).arpGate).toBe(60);
  });
});
