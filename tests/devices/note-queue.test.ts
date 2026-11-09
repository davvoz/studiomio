import { describe, expect, it } from 'vitest';
import type { InstrumentCore } from '../../src/devices/dsp/core';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

/** Records note-ons and note-offs with the sample they arrive at. */
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
  it('dropFrom: removes the notes that would start from there, those already started end as they were', () => {
    const q = new NoteQueue();
    q.add(60, 100, 0, 300);   // already started: it must end at 300
    q.add(62, 100, 100, 150); // starts before the cut: it stays
    q.add(64, 100, 200, 400); // starts from the cut on: it disappears
    q.dropFrom(200);
    const r = recorder();
    r.play(q, 512);
    expect(r.events).toEqual(['on 60 @0', 'on 62 @100', 'off #2 @150', 'off #1 @300']);
  });
});

describe('NoteQueue: notes held by hand', () => {
  it('plays from the press to the release', () => {
    const q = new NoteQueue(), r = recorder();
    q.press(60, 100, 10);
    r.play(q, 128);
    expect(r.events).toEqual(['on 60 @10']);
    q.release(60, 200);
    r.play(q, 128);
    expect(r.events).toEqual(['on 60 @10', 'off #1 @200']);
  });

  it('a key pressed and released in the same block doesn\'t stay on', () => {
    const q = new NoteQueue(), r = recorder();
    q.press(60, 100, 0);
    q.release(60, 0);
    r.play(q, 128);
    expect(r.events).toEqual(['on 60 @0', 'off #1 @1']);
  });

  it('the clips\' cuts don\'t touch the held note', () => {
    const q = new NoteQueue(), r = recorder();
    q.press(60, 100, 0);
    r.play(q, 128);
    q.cutAt(100);
    q.dropFrom(100);
    q.release(60, 200);
    r.play(q, 128);
    expect(r.events).toEqual(['on 60 @0', 'off #1 @200']);
  });

  it('after the stop the release does nothing', () => {
    const q = new NoteQueue(), r = recorder();
    q.press(60, 100, 0);
    r.play(q, 128);
    q.clear();
    q.release(60, 200);
    r.play(q, 128);
    expect(r.events).toEqual(['on 60 @0']);
  });

  it('the same pitch pressed again closes the previous note', () => {
    const q = new NoteQueue(), r = recorder();
    q.press(60, 100, 0);
    q.press(60, 100, 50);
    q.release(60, 100);
    r.play(q, 128);
    expect(r.events).toEqual(['on 60 @0', 'off #1 @50', 'on 60 @50', 'off #2 @100']);
  });
});
