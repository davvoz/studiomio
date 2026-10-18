import { describe, expect, it } from 'vitest';
import { Tempo } from '../../src/core/music-time';
import { Scheduler, type ScheduledSource, type ScheduleWindow } from '../../src/engine/scheduler';

class Recorder implements ScheduledSource {
  windows: { from: number; to: number; runStart: number; runEnd: number; t0: number }[] = [];
  stops = 0;
  schedule(w: ScheduleWindow) {
    this.windows.push({ from: w.from, to: w.to, runStart: w.runStart, runEnd: w.runEnd, t0: w.timeAt(w.runStart) });
  }
  stopAll() { this.stops++; }
  retakes: number[] = [];
  retake(at: number) { this.retakes.push(at); }
}

const tempo = new Tempo(120); // 2 battiti al secondo
const noLoop = { enabled: false, start: 0, end: 4 };

describe('Scheduler', () => {
  it('programma in finestre contigue fino a now + lookahead', () => {
    const r = new Recorder();
    const s = new Scheduler(() => [r], 0.2);
    s.start(0, 1, tempo, noLoop);
    s.advance(1);    // fino a 1.2 s → battito 0.4
    s.advance(1.1);  // fino a 1.3 s → 0.6
    s.advance(1.1);  // niente di nuovo
    expect(r.windows).toHaveLength(2);
    expect(r.windows[0].from).toBe(0);
    expect(r.windows[0].to).toBeCloseTo(0.4, 12);
    expect(r.windows[1].from).toBe(r.windows[0].to); // finestre contigue
    expect(r.windows[1].to).toBeCloseTo(0.6, 12);
    expect(r.windows[0].t0).toBe(1);
  });

  it('con il loop riparte dall\'inizio del loop, all\'istante giusto', () => {
    const r = new Recorder();
    const s = new Scheduler(() => [r], 0.5);
    s.start(3, 0, tempo, { enabled: true, start: 1, end: 4 }); // 1 battito al loop = 0.5 s
    s.advance(0.4); // orizzonte 0.9 s: fine loop a 0.5 s, poi 0.4 s del giro nuovo
    expect(r.windows.map(w => [w.from, w.to, w.runStart, w.runEnd])).toEqual([
      [3, 4, 3, 4],
      [1, 1.8, 1, 4],
    ]);
    expect(r.windows[1].t0).toBeCloseTo(0.5, 12);
    expect(s.positionAt(0.75)).toBeCloseTo(1.5, 12); // 0.25 s nel secondo giro
    expect(s.positionAt(0.25)).toBeCloseTo(3.5, 12);
  });

  it('partendo dopo la fine del loop non si torna indietro', () => {
    const r = new Recorder();
    const s = new Scheduler(() => [r], 1);
    s.start(5, 0, tempo, { enabled: true, start: 0, end: 4 });
    s.advance(0);
    expect(r.windows).toEqual([{ from: 5, to: 7, runStart: 5, runEnd: Infinity, t0: 0 }]);
  });

  it('retake: solo le sorgenti indicate riprendono da quell\'istante, anche oltre il giro del loop', () => {
    const a = new Recorder(), b = new Recorder();
    const s = new Scheduler(() => [a, b], 0.5);
    s.start(3, 0, tempo, { enabled: true, start: 1, end: 4 });
    s.advance(0.4); // programmato fino al battito 1.8 del secondo giro
    a.windows = [];
    s.retake(0.25, [a]); // 0.25 s = battito 3.5
    expect(a.retakes).toEqual([0.25]);
    expect(b.retakes).toEqual([]);
    expect(a.windows.map(w => [w.from, w.to, w.runStart, w.runEnd])).toEqual([
      [3.5, 4, 3.5, 4], // ciò che è in corso riparte da 3.5
      [1, 1.8, 1, 4],
    ]);
    expect(a.windows[1].t0).toBeCloseTo(0.5, 12);
    expect(b.windows).toHaveLength(2); // le altre non si accorgono di niente
    expect(a.stops + b.stops).toBe(0);
  });

  it('resumeAt: tempo nuovo da quell\'istante, senza fermare niente', () => {
    const r = new Recorder();
    const s = new Scheduler(() => [r], 0.2);
    s.start(0, 0, tempo, noLoop);
    s.advance(0);
    s.resumeAt(0.1, new Tempo(60), noLoop); // battito 0.2
    s.advance(0.1);
    expect(r.retakes).toEqual([0.1]);
    expect(r.stops).toBe(0);
    expect(s.positionAt(1.1)).toBeCloseTo(1.2, 12); // un secondo dopo, a 60 BPM: un battito
    expect(r.windows.at(-1)!.from).toBeCloseTo(0.2, 12);
  });

  it('export: tutto l\'intervallo in una finestra; stop ferma le sorgenti', () => {
    const r = new Recorder();
    const s = new Scheduler(() => [r]);
    s.scheduleRange(2, 10, 0, tempo);
    expect(r.windows).toEqual([{ from: 2, to: 10, runStart: 2, runEnd: 10, t0: 0 }]);
    s.stop();
    expect(r.stops).toBe(1);
    expect(s.running).toBe(false);
  });
});
