import { describe, expect, it } from 'vitest';
import type { InstrumentCore } from '../../src/devices/dsp/core';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

/** Registra accensioni e spegnimenti con il campione in cui arrivano. */
function recorder() {
  const events: string[] = [];
  let frame = 0;
  const core = {
    noteOn: (_id: number, pitch: number) => events.push(`on ${pitch} @${frame}`),
    noteOff: (id: number) => events.push(`off #${id} @${frame}`),
    render: (_l: Float32Array, _r: Float32Array, from: number, to: number) => { frame += to - from; },
  } as unknown as InstrumentCore;
  return { core, events, play: (q: NoteQueue, frames: number) => q.renderBlock(core, new Float32Array(frames), new Float32Array(frames), frame) };
}

describe('NoteQueue', () => {
  it('dropFrom: toglie le note che partirebbero da lì, quelle già partite finiscono com\'erano', () => {
    const q = new NoteQueue();
    q.add(60, 100, 0, 300);   // già partita: deve finire a 300
    q.add(62, 100, 100, 150); // parte prima del taglio: resta
    q.add(64, 100, 200, 400); // parte dal taglio in poi: sparisce
    q.dropFrom(200);
    const r = recorder();
    r.play(q, 512);
    expect(r.events).toEqual(['on 60 @0', 'on 62 @100', 'off #2 @150', 'off #1 @300']);
  });
});
