import { describe, expect, it } from 'vitest';
import { parseSpringTime, springTimeLabel } from '../../src/model/rack';
import type { MidiTrack } from '../../src/model/track';
import { captureRack, rackPresetFrom } from '../../src/model/rack-preset';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, setTempo } from '../../src/store/edits';
import { holdKey, pressKey, setKey } from '../../src/store/key-edits';
import { MacroSprings, SPRING_IDLE_MS, type SpringClock } from '../../src/store/macro-springs';
import { holdMidi, moveMidi, pressMidi, pullMidi, setMidi } from '../../src/store/midi-edits';
import { groupDevices, mapMacro, setMacro, setMacroMode, setMacroSpring, springsAtRest } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

/** Un orologio finto: il tempo avanza solo con `run`, che fa i passi della molla. */
class FakeClock implements SpringClock {
  t = 0;
  private fn: (() => void) | null = null;
  now() { return this.t; }
  every(_ms: number, fn: () => void) {
    this.fn = fn;
    return () => { this.fn = null; };
  }
  get ticking() { return this.fn !== null; }
  run(ms: number) {
    for (const end = this.t + ms; this.t < end;) {
      this.t = Math.min(end, this.t + 15);
      this.fn?.();
    }
  }
}

/** Una traccia MIDI con un Delay in un rack; la macro 1 muove il mix ed è una molla. */
function rig() {
  const s = setup({ midi: 1 });
  const t = s.track(0);
  s.store.apply(addEffect(t, 'delay', 'Delay'));
  const track = () => s.store.project.tracks[0] as MidiTrack;
  const delay = track().effects[0].id;
  s.store.apply(groupDevices(t, [delay]));
  const rack = track().racks[0].id;
  s.store.apply(mapMacro(t, rack, 0, delay, 'mix'));
  s.store.apply(setMacro(t, rack, 0, 0));
  s.store.apply(setMacroMode(t, rack, 0, 'spring'));
  const clock = new FakeClock();
  const springs = new MacroSprings(s.store, clock);
  const macro = () => track().racks[0].macros[0];
  const mix = () => track().effects[0].params.mix;
  return { ...s, t, rack, delay, clock, springs, macro, mix };
}

describe('macro molla', () => {
  it('diventando molla riposa dov\'è e torna in 1/4; il riposo e il ritorno si cambiano', () => {
    const r = rig();
    expect(r.macro()).toMatchObject({ mode: 'spring', value: 0, spring: { rest: 0, time: 1, sync: true } });
    r.store.apply(setMacroSpring(r.t, r.rack, 0, { rest: 64 }));
    expect([r.macro().value, r.macro().spring?.rest]).toEqual([64, 64]); // ferma sta al riposo
    expect(r.store.undoLabel).toBe('Riposo della molla');
    r.store.apply(setMacroSpring(r.t, r.rack, 0, { time: 300, sync: false }));
    expect(springTimeLabel(r.macro().spring!)).toBe('300 ms');
    r.store.apply(setMacroMode(r.t, r.rack, 0, 'knob'));
    expect(r.macro()).toEqual(expect.objectContaining({ value: 64 }));
    expect('spring' in r.macro()).toBe(false);
  });

  it('lasciata, torna al riposo nel tempo di ritorno (a tempo: dal BPM), senza passi di annullamento', () => {
    const r = rig();
    r.store.apply(setTempo(120)); // 1/4 = 500 ms
    const label = r.store.undoLabel;
    r.store.apply(setMacro(r.t, r.rack, 0, 127), { transient: true });
    expect(r.mix()).toBe(100);
    r.clock.run(SPRING_IDLE_MS - 20);
    expect(r.macro().value).toBe(127); // si sta ancora muovendo
    r.clock.run(20 + 250);
    expect(r.macro().value).toBeGreaterThan(55);
    expect(r.macro().value).toBeLessThan(72); // a metà strada a metà tempo
    r.clock.run(260);
    expect([r.macro().value, r.mix()]).toEqual([0, 0]);
    expect(r.store.undoLabel).toBe(label);
    expect(r.springs.pulling).toBe(false);
    expect(r.clock.ticking).toBe(false); // ferma, la molla non lavora
  });

  it('tenuta non torna; lasciata torna subito; mossa mentre torna, ricomincia da lì', () => {
    const r = rig();
    r.store.apply(setMacroSpring(r.t, r.rack, 0, { time: 100, sync: false }));
    r.springs.hold(r.t, r.rack, 0, true);
    r.store.apply(setMacro(r.t, r.rack, 0, 100), { transient: true });
    r.clock.run(2000);
    expect(r.macro().value).toBe(100);
    r.springs.hold(r.t, r.rack, 0, false);
    r.clock.run(65);
    expect(r.macro().value).toBeLessThan(60);
    r.store.apply(setMacro(r.t, r.rack, 0, 120), { transient: true });
    r.clock.run(SPRING_IDLE_MS - 20);
    expect(r.macro().value).toBe(120);
    r.clock.run(200);
    expect(r.macro().value).toBe(0);
  });

  it('un tasto la tira fino al capo lontano dal riposo finché è giù', () => {
    const r = rig();
    r.store.apply(setKey({ kind: 'macro', owner: r.t, rack: r.rack, index: 0 }, 'KeyQ'));
    expect(r.store.apply(pressKey('KeyQ'))).toBe(r.store.project); // non è un interruttore
    r.store.apply(holdKey('KeyQ', true), { transient: true });
    expect(r.macro().value).toBe(127);
    r.store.apply(setMacroSpring(r.t, r.rack, 0, { rest: 100 }));
    r.store.apply(holdKey('KeyQ', true), { transient: true });
    expect(r.macro().value).toBe(0);
  });

  it('MIDI: un CC la tira senza passi di annullamento, una nota la tira fino in fondo', () => {
    const r = rig();
    const target = { kind: 'macro', owner: r.t, rack: r.rack, index: 0 } as const;
    r.store.apply(setMidi(target, { type: 'cc', channel: 0, number: 21 }));
    const label = r.store.undoLabel;
    const cc = { type: 'cc', channel: 0, number: 21 } as const;
    expect(r.store.apply(moveMidi(cc, 90))).toBe(r.store.project); // le molle sono di pullMidi
    r.store.apply(holdMidi(cc, true, false), { transient: true });
    expect(r.macro().value).toBe(0);
    r.store.apply(pullMidi(cc, 127), { transient: true });
    expect(r.macro().value).toBe(127);
    expect(r.store.undoLabel).toBe(label);
    const n = { type: 'note', channel: 0, number: 36 } as const;
    r.store.apply(setMidi(target, n));
    r.clock.run(1000);
    expect(r.store.apply(pressMidi(n))).toBe(r.store.project);
    r.store.apply(holdMidi(n, true), { transient: true });
    expect(r.macro().value).toBe(127);
  });

  it('si salva al riposo, anche tirata; riposo e ritorno restano nel progetto e nei rack salvati', () => {
    const r = rig();
    r.store.apply(setMacroSpring(r.t, r.rack, 0, { rest: 30, time: 8, sync: true }));
    r.store.apply(setMacro(r.t, r.rack, 0, 127), { transient: true });
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(springsAtRest(r.store.project)));
    const t = back.tracks[0] as MidiTrack;
    expect(t.racks[0].macros[0]).toMatchObject({ mode: 'spring', value: 30, spring: { rest: 30, time: 8, sync: true } });
    expect(t.effects[0].params.mix).toBeCloseTo((30 / 127) * 100, 0);
    const preset = rackPresetFrom(JSON.parse(JSON.stringify(captureRack(springsAtRest(r.store.project), r.t, r.rack, 'Molla'))));
    expect(preset?.macros[0]).toMatchObject({ mode: 'spring', value: 30, spring: { rest: 30, time: 8, sync: true } });
  });

  it('il tempo di ritorno si scrive a mano', () => {
    expect(parseSpringTime('300 ms')).toEqual({ time: 300, sync: false });
    expect(parseSpringTime('1,5 s')).toEqual({ time: 1500, sync: false });
    expect(parseSpringTime('3/16')).toEqual({ time: 0.75, sync: true });
    expect(parseSpringTime('2 battute')).toEqual({ time: 8, sync: true });
    expect(parseSpringTime('3 battiti')).toEqual({ time: 3, sync: true });
    expect(parseSpringTime('750')).toEqual({ time: 750, sync: false });
    expect(parseSpringTime('presto')).toBeNull();
    expect(springTimeLabel({ rest: 0, time: 12, sync: true })).toBe('3 battute');
    expect(springTimeLabel({ rest: 0, time: 1500, sync: false })).toBe('1.5 s');
  });
});
