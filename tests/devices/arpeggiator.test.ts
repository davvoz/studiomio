import { describe, expect, it } from 'vitest';
import { ARP, ARP_RATES, ARP_STYLE, activeArp, arpParams } from '../../src/devices/arp/arp';
import { arpOrder, Arpeggiator } from '../../src/devices/arp/arpeggiator';
import type { InstrumentCore, TransportPosition } from '../../src/devices/dsp/core';
import { newEffect } from '../../src/model/device';
import type { DeviceId } from '../../src/core/id';

const SR = 48000, BLOCK = 128;
/** A 120 BPM un sedicesimo sono 6000 campioni. */
const SIXTEENTH = 6000;
const RATE = (label: string) => ARP_RATES.findIndex(([l]) => l === label);

/** Lo strumento finto: annota note accese e spente con il campione assoluto. */
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
  /** Fa passare `frames` campioni; con `running` il trasporto avanza. */
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

describe('arpeggiatore: l\'ordine', () => {
  const tones = (...pitches: number[]) => pitches.map(pitch => ({ pitch, velocity: 100 }));
  const order = (style: number, octaves = 1, ...pitches: number[]) => arpOrder(tones(...pitches), style, octaves).map(t => t.pitch);

  it('su, giù, e i ritorni non ripetono le estremità', () => {
    expect(order(ARP_STYLE.up, 1, 67, 60, 64)).toEqual([60, 64, 67]);
    expect(order(ARP_STYLE.down, 1, 60, 64, 67)).toEqual([67, 64, 60]);
    expect(order(ARP_STYLE.upDown, 1, 60, 64, 67)).toEqual([60, 64, 67, 64]);
    expect(order(ARP_STYLE.downUp, 1, 60, 64, 67)).toEqual([67, 64, 60, 64]);
  });

  it('due note e una nota sola non si rompono', () => {
    expect(order(ARP_STYLE.upDown, 1, 60, 64)).toEqual([60, 64]);
    expect(order(ARP_STYLE.upDown, 1, 60)).toEqual([60]);
    expect(order(ARP_STYLE.pedal, 1, 60)).toEqual([60]);
    expect(order(ARP_STYLE.inward, 1, 60)).toEqual([60]);
  });

  it('dentro, pedale e come suonate', () => {
    expect(order(ARP_STYLE.inward, 1, 60, 62, 64, 65, 67)).toEqual([60, 67, 62, 65, 64]);
    expect(order(ARP_STYLE.pedal, 1, 60, 64, 67)).toEqual([60, 64, 60, 67]);
    expect(order(ARP_STYLE.played, 1, 67, 60, 64)).toEqual([67, 60, 64]);
  });

  it('le ottave allungano il giro e non escono dalla gamma MIDI', () => {
    expect(order(ARP_STYLE.up, 2, 60, 64)).toEqual([60, 64, 72, 76]);
    expect(order(ARP_STYLE.up, 2, 120)).toEqual([120]);
  });
});

describe('arpeggiatore: da fermo', () => {
  it('parte subito con la prima nota e va a tempo', () => {
    const r = rig();
    chord(r.arp, 60, 64, 67);
    r.run(SIXTEENTH * 4);
    expect(r.ons()).toEqual([60, 64, 67, 60]);
    expect(r.frames()).toEqual([0, SIXTEENTH, SIXTEENTH * 2, SIXTEENTH * 3]);
  });

  it('il gate chiude la nota prima del passo dopo', () => {
    const r = rig({ arpGate: 50 });
    chord(r.arp, 60);
    r.run(SIXTEENTH);
    expect(r.log.filter(e => e.kind === 'off').map(e => e.frame)).toEqual([SIXTEENTH / 2]);
  });

  it('con il gate oltre il 100% le note si sovrappongono', () => {
    const r = rig({ arpGate: 150 });
    chord(r.arp, 60, 64);
    r.run(SIXTEENTH + BLOCK);
    expect(r.open.size).toBe(2);
  });

  it('lasciate le note smette, e la prossima riparte dall\'inizio', () => {
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

  it('ogni nota tiene la sua velocity', () => {
    const r = rig();
    r.arp.noteOn(1, 60, 40);
    r.arp.noteOn(2, 64, 120);
    r.run(SIXTEENTH * 2);
    expect(r.log.filter(e => e.kind === 'on').map(e => e.velocity)).toEqual([40, 120]);
  });

  it('accordo: tutte le note a ogni passo', () => {
    const r = rig({ arpStyle: ARP_STYLE.chord, arpOctaves: 2 });
    chord(r.arp, 60, 64);
    r.run(SIXTEENTH * 2);
    expect(r.ons()).toEqual([60, 64, 72, 76]);
  });

  it('ripeti tiene la stessa nota per più passi', () => {
    const r = rig({ arpRepeat: 2 });
    chord(r.arp, 60, 64);
    r.run(SIXTEENTH * 4);
    expect(r.ons()).toEqual([60, 60, 64, 64]);
  });

  it('la divisione cambia il passo', () => {
    const r = rig({ arpRate: RATE('1/8') });
    chord(r.arp, 60);
    r.run(SIXTEENTH * 4);
    expect(r.frames()).toEqual([0, SIXTEENTH * 2]);
  });

  it('lo swing sposta i passi dispari', () => {
    const r = rig({ arpSwing: 50 });
    chord(r.arp, 60);
    r.run(SIXTEENTH * 4);
    expect(r.frames()).toEqual([0, SIXTEENTH * 1.5, SIXTEENTH * 2, SIXTEENTH * 3.5]);
  });

  it('casuale e probabilità danno lo stesso risultato a ogni giro', () => {
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

  it('probabilità a zero non suona niente', () => {
    const r = rig({ arpChance: 0 });
    chord(r.arp, 60);
    r.run(SIXTEENTH * 8);
    expect(r.ons()).toEqual([]);
  });
});

describe('arpeggiatore: Hold', () => {
  it('le note lasciate restano, la prossima comincia un accordo nuovo', () => {
    const r = rig({ arpHold: 1 });
    chord(r.arp, 60, 64);
    r.arp.noteOff(1); r.arp.noteOff(2);
    r.run(SIXTEENTH * 3);
    expect(r.ons()).toEqual([60, 64, 60]);
    r.arp.noteOn(3, 70, 100);
    r.run(SIXTEENTH * 2);
    expect(r.ons().slice(3).every(p => p === 70)).toBe(true);
  });

  it('togliendo Hold le note lasciate escono dal giro', () => {
    const r = rig({ arpHold: 1 });
    chord(r.arp, 60, 64);
    r.arp.noteOff(1);
    r.arp.setParams({ arpOn: 1, arpHold: 0 });
    r.run(SIXTEENTH * 3);
    expect(new Set(r.ons())).toEqual(new Set([64]));
  });

  it('lo stop spegne tutto, Hold compreso', () => {
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

describe('arpeggiatore: con il trasporto', () => {
  it('i passi stanno sulla griglia della battuta', () => {
    const r = rig();
    r.run(BLOCK * 2, true);                     // il trasporto gira
    r.skip(0);
    r.arp.noteOn(1, 60, 100);                   // arrivata a metà del primo passo...
    r.run(SIXTEENTH * 3, true);
    // ...suona subito (recupero) e poi va sulla griglia
    expect(r.frames().slice(1)).toEqual([SIXTEENTH, SIXTEENTH * 2, SIXTEENTH * 3]);
  });

  it('una nota troppo in ritardo aspetta il passo dopo', () => {
    const r = rig();
    r.run(SIXTEENTH * 0.75, true);
    r.arp.noteOn(1, 60, 100);
    r.run(SIXTEENTH, true);
    expect(r.frames()).toEqual([SIXTEENTH]);
  });

  it('un salto riprende la griglia da lì', () => {
    const r = rig();
    r.arp.noteOn(1, 60, 100);
    r.run(SIXTEENTH * 2, true);
    const before = r.frames().length;
    r.skip(SIXTEENTH * 10 + 1000);
    r.run(SIXTEENTH * 2, true);
    const after = r.frames().slice(before);
    expect(after.length).toBeGreaterThan(0);
    // sulla griglia del trasporto, non su quella di prima
    expect((after.at(-1)! + SIXTEENTH * 10 + 1000) % SIXTEENTH).toBeLessThan(BLOCK);
  });
});

describe('arpeggiatore: spento', () => {
  it('le note passano com\'è', () => {
    const r = rig({ arpOn: 0 });
    r.arp.noteOn(1, 60, 100);
    r.run(SIXTEENTH * 4);
    r.arp.noteOff(1);
    expect(r.log.map(e => `${e.kind} ${e.id}`)).toEqual(['on 1', 'off 1']);
  });

  it('acceso con una nota tenuta la prende nel giro; spento smette', () => {
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

describe('arpeggiatore nella catena', () => {
  const effect = (enabled = true) => ({ ...newEffect('d1' as DeviceId, ARP.type), enabled });

  it('suona il primo acceso; senza, il motore delle note è spento', () => {
    expect(arpParams(undefined)).toEqual({ arpOn: 0 });
    expect(arpParams(activeArp([effect(false)]))).toEqual({ arpOn: 0 });
    expect(arpParams(activeArp([effect()])).arpOn).toBe(1);
    expect(arpParams(activeArp([effect()])).arpGate).toBe(60);
  });
});
