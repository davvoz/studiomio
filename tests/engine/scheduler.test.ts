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
