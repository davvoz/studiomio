// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DRUMS, padSlot } from '../../../src/devices/instruments/drums/drums';
import { NO_SPECTRUM, type DisplayContext } from '../../../src/ui/device/displays';
import { DrumDisplay } from '../../../src/ui/device/drums/drum-display';
import { recordCanvases } from '../../helpers/dom';

beforeEach(() => { recordCanvases(); });

/** The panel, whose files named "broken…" can't be loaded; what it loaded, and the notes it played. */
function setup() {
  const loaded: [string, string][] = [], played: number[] = [];
  const ctx: DisplayContext = {
    type: DRUMS, settings: { type: DRUMS.type, preset: null, params: {} }, sampleRate: 48000,
    setParams: () => undefined, controlsChanged: () => undefined, openSpectrum: () => NO_SPECTRUM,
    audition: pitch => { played.push(pitch); }, playedNotes: () => [],
    samples: {
      list: () => [], assign: () => undefined,
      load: async (slot, file) => {
        await Promise.resolve();
        if (file.name.startsWith('broken')) throw new Error('not audio');
        loaded.push([slot, file.name]);
      },
    },
  };
  const display = new DrumDisplay(ctx);
  document.body.append(display.element);
  const drop = async (pad: number, names: readonly string[]) => {
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer: { types: ['Files'], files: names.map(n => new File([], n)) } });
    display.element.querySelector(`[data-pad="${pad}"]`)!.dispatchEvent(e);
    await new Promise(resolve => { setTimeout(resolve, 5); });
  };
  return { loaded, played, drop, hint: () => display.element.querySelector('.drum-hint')!.textContent };
}

describe('audio files dropped on a drum pad', () => {
  it('go on the following pads, in order, up to the last; then the first plays', async () => {
    const { loaded, played, drop } = setup();
    await drop(14, ['a.wav', 'notes.txt', 'b.wav', 'c.wav']);
    expect(loaded).toEqual([[padSlot(14), 'a.wav'], [padSlot(15), 'b.wav']]);
    expect(played).toHaveLength(1);
  });

  it('one that can\'t be loaded is named and stops the others; nothing plays', async () => {
    const { loaded, played, drop, hint } = setup();
    await drop(0, ['a.wav', 'broken.wav', 'c.wav']);
    expect(loaded).toEqual([[padSlot(0), 'a.wav']]);
    expect(hint()).toBe('Can\'t load "broken.wav": not audio');
    expect(played).toEqual([]);
  });
});
